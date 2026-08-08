"""Multi-factor opportunity screener across the whole Nifty 750 universe.

Answers "out of all 750 stocks, which look strongest right now?" by scoring every stock
on six independent criteria and combining them into one composite score.

Why this is Python and not the model's job
------------------------------------------
Comparing 750 stocks across six dimensions is thousands of numbers. It does not fit in a
local model's context window, and a model asked to do it anyway will pattern-match on
whatever happens to be in the conversation already. So all filtering, scoring and ranking
happens here, deterministically; the model receives a short ranked list with a per-factor
breakdown and does what it is actually good at — explaining it.

Scoring method
--------------
Each factor produces a raw signal per stock, which is then converted to a 0-100
*percentile rank* against the rest of the universe. Percentile ranking makes the six
factors comparable without hand-tuned thresholds, and is immune to outliers and to the
wildly different units involved (rupees, percentages, share counts, message counts).

The composite is a weighted mean over the factors that actually have data for that
stock, with the weights renormalised — so a stock is never penalised merely for a gap in
your scraped data. `factors_available` reports the honest coverage per row.

Data coverage caveat: consensus_recommendations currently covers a handful of symbols,
so the consensus factor is off by default. Turn it on with include_consensus=True and it
applies only to the stocks that have it.
"""

import re
from collections import defaultdict

import crossovers
from formatting import format_mcap, format_price

# Factor -> default weight in the composite. Renormalised per stock over available factors.
DEFAULT_WEIGHTS = {
    "trend": 0.25,       # DMA crossover tier + historical reliability
    "breakout": 0.20,    # position vs the 2-year base high
    "metrics": 0.20,     # fundamentals: sales / profit / margin growth
    "ownership": 0.15,   # promoter + institutional accumulation
    "trades": 0.10,      # insider and bulk-deal net buying
    "sentiment": 0.10,   # retail forum bullishness, confidence-weighted
}

# Order the criteria are applied in, matching the Trends-page tab order. When a strict
# screen finds nothing, the LAST entry is dropped first, then the next-last, and so on.
# Consensus sits last deliberately: it is the sparsest data, so it is the cheapest to lose.
CRITERIA_ORDER = ["trades", "ownership", "trend", "breakout", "metrics", "consensus"]

# Tolerate the plural/singular the user or model may type.
CRITERIA_ALIASES = {"trends": "trend", "trade": "trades", "metric": "metrics",
                    "breakouts": "breakout", "owner": "ownership"}

CRITERIA_LABELS = {
    "trend": "Trends (DMA crossovers)",
    "breakout": "Breakout (vs 2-year base high)",
    "metrics": "Metrics (sales, profit, margin growth)",
    "ownership": "Ownership (promoter / FII / DII moves)",
    "trades": "Trades (insider & bulk-deal flow)",
    "sentiment": "Sentiment (forum bullishness)",
    "consensus": "Consensus (analyst ratings)",
}


def _f(value):
    """Parse the scraped VARCHAR numerics: '₹1,216 Cr', '+19.80%', '5.24', ''."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = re.sub(r"[^0-9eE+\-.]", "", str(value))
    if s in ("", "+", "-", ".", "e", "E"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _growth(new, old):
    """Percent change, guarding division by zero and sign flips."""
    n, o = _f(new), _f(old)
    if n is None or o is None or o == 0:
        return None
    return (n - o) / abs(o) * 100.0


def _factor_diagnostics(values_by_symbol):
    """Coverage and discriminating power of one factor.

    A factor whose values pile into one bucket cannot rank anything — averaging it into
    the composite just dilutes the factors that do carry signal. The clearest live example
    is forum sentiment: moneycontrol_boarders.buy_perc is scraped as an effectively binary
    verdict (~600 stocks at exactly 100, ~130 at 0), so it separates the universe into
    three blocks rather than ranking it.
    """
    present = [v for v in values_by_symbol.values() if v is not None]
    if not present:
        return {"coverage": 0, "distinct": 0, "top_bucket_share": 1.0, "usable": False,
                "reason": "no data"}

    counts = defaultdict(int)
    for v in present:
        counts[round(v, 6)] += 1
    top_share = max(counts.values()) / len(present)
    distinct = len(counts)

    usable, reason = True, None
    if distinct < 3:
        usable, reason = False, f"only {distinct} distinct value(s) across {len(present)} stocks"
    elif top_share > 0.5:
        usable = False
        reason = (f"{top_share * 100:.0f}% of stocks share one value — too coarse to rank on")

    return {"coverage": len(present), "distinct": distinct,
            "top_bucket_share": round(top_share, 3), "usable": usable, "reason": reason}


def _percentile_ranks(values_by_symbol):
    """Map {symbol: raw} -> {symbol: 0..100 percentile}. Ties share the average rank."""
    present = {s: v for s, v in values_by_symbol.items() if v is not None}
    if not present:
        return {}
    ordered = sorted(present.items(), key=lambda kv: kv[1])
    n = len(ordered)
    if n == 1:
        return {ordered[0][0]: 50.0}

    ranks, i = {}, 0
    while i < n:
        j = i
        while j + 1 < n and ordered[j + 1][1] == ordered[i][1]:
            j += 1
        avg_idx = (i + j) / 2.0
        pct = round(avg_idx / (n - 1) * 100.0, 1)
        for k in range(i, j + 1):
            ranks[ordered[k][0]] = pct
        i = j + 1
    return ranks


# ---------------------------------------------------------------------------
# Raw signal extraction, one function per criterion
# ---------------------------------------------------------------------------

def _trend_signals(rows):
    """Crossover tier, weighted by how reliable that signal has been historically."""
    out = {}
    for r in rows:
        tier_score = 0.0
        for tier, base in (("pro", 3.0), ("golden", 2.0), ("lite", 1.0)):
            if r[tier]["isActive"]:
                stats = r[tier]
                # Reliability multiplier: historical hit rate and average gain, mildly weighted.
                reliability = 1.0 + (stats["prob"] / 100.0) * 0.5 + min(stats["avgGainPct"], 30.0) / 100.0
                tier_score = base * reliability
                break
        out[r["ticker"]] = tier_score
    return out


def _breakout_signals(rows):
    """Signed distance from the 2-year base high — above it is a genuine breakout."""
    return {r["ticker"]: r["breakout"].get("pctFromBaseHigh") for r in rows}


def _metrics_signals(conn):
    """Blend of full-year and quarterly growth from financial_metrics."""
    from psycopg2.extras import RealDictCursor
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM financial_metrics;")
        rows = [dict(r) for r in cur.fetchall()]

    out, detail = {}, {}
    for r in rows:
        sym = str(r.get("symbol") or "").upper()
        sales_g = _growth(r.get("pl_sales_1"), r.get("pl_sales_2"))
        profit_g = _growth(r.get("nt_profit_1"), r.get("nt_profit_2"))
        opprofit_g = _growth(r.get("operating_profit_1"), r.get("operating_profit_2"))
        opm_g = _growth(r.get("pl_opm_1"), r.get("pl_opm_2"))
        q_yoy = _f(r.get("q_sales_yoy_growth"))
        roce_g = _growth(r.get("roce_1"), r.get("roce_2"))

        parts = [p for p in (sales_g, profit_g, opprofit_g, opm_g, q_yoy, roce_g) if p is not None]
        if not parts:
            out[sym] = None
            continue
        # Clamp so one freak number can't dominate the blend.
        out[sym] = sum(max(-100.0, min(p, 200.0)) for p in parts) / len(parts)
        detail[sym] = {
            "fy_sales_growth_pct": None if sales_g is None else round(sales_g, 1),
            "fy_net_profit_growth_pct": None if profit_g is None else round(profit_g, 1),
            "fy_operating_profit_growth_pct": None if opprofit_g is None else round(opprofit_g, 1),
            "opm_change_pct": None if opm_g is None else round(opm_g, 1),
            "q_sales_yoy_growth_pct": q_yoy,
        }
    return out, detail


def _ownership_signals(conn):
    """Change in promoter / FII / DII holding between the two most recent periods."""
    from psycopg2.extras import RealDictCursor
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT symbol, period, promoters, fiis, diis, public, id
            FROM shareholding_pattern ORDER BY UPPER(symbol), id DESC;
        """)
        rows = [dict(r) for r in cur.fetchall()]

    by_symbol = defaultdict(list)
    for r in rows:
        by_symbol[str(r["symbol"]).upper()].append(r)

    out, detail = {}, {}
    for sym, periods in by_symbol.items():
        if len(periods) < 2:
            out[sym] = None
            continue
        curr, prev = periods[0], periods[1]
        promo = _growth_pp(curr.get("promoters"), prev.get("promoters"))
        fii = _growth_pp(curr.get("fiis"), prev.get("fiis"))
        dii = _growth_pp(curr.get("diis"), prev.get("diis"))
        parts = [p for p in (promo, fii, dii) if p is not None]
        if not parts:
            out[sym] = None
            continue
        # Promoter and institutional accumulation all count as positive; promoters weigh most.
        out[sym] = ((promo or 0.0) * 1.5) + ((fii or 0.0) * 1.0) + ((dii or 0.0) * 1.0)
        detail[sym] = {
            "period": curr.get("period"), "vs_period": prev.get("period"),
            "promoter_change_pp": promo, "fii_change_pp": fii, "dii_change_pp": dii,
            "promoter_pct": _f(curr.get("promoters")),
        }
    return out, detail


def _growth_pp(new, old):
    """Change in percentage points (holdings are already percentages)."""
    n, o = _f(new), _f(old)
    if n is None or o is None:
        return None
    return round(n - o, 2)


def _trade_signals(conn, lookback=200):
    """Net insider / bulk-deal buying by value over the most recent trades."""
    from psycopg2.extras import RealDictCursor
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT symbol, buy_sell, value_lacs FROM trades
            WHERE symbol IS NOT NULL AND symbol <> ''
            ORDER BY id DESC LIMIT %s;
        """, (lookback * 400,))
        rows = [dict(r) for r in cur.fetchall()]

    buys, sells, counts = defaultdict(float), defaultdict(float), defaultdict(int)
    for r in rows:
        sym = str(r["symbol"]).upper()
        val = _f(r.get("value_lacs")) or 0.0
        side = str(r.get("buy_sell") or "").strip().lower()
        counts[sym] += 1
        if side in ("buy", "acq"):
            buys[sym] += val
        elif side == "sell":
            sells[sym] += val

    out, detail = {}, {}
    for sym in counts:
        total = buys[sym] + sells[sym]
        if total <= 0:
            out[sym] = None
            continue
        # Net buy share, -100 (all selling) .. +100 (all buying).
        out[sym] = (buys[sym] - sells[sym]) / total * 100.0
        detail[sym] = {
            "buy_value_lacs": round(buys[sym], 1),
            "sell_value_lacs": round(sells[sym], 1),
            "net_buy_pct": round(out[sym], 1),
            "trades_seen": counts[sym],
        }
    return out, detail


def _sentiment_signals(conn):
    """Forum bullishness, damped when the message count is too small to trust."""
    from psycopg2.extras import RealDictCursor
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT symbol, msg_count, buy_perc, sell_perc FROM moneycontrol_boarders;")
        rows = [dict(r) for r in cur.fetchall()]

    out, detail = {}, {}
    for r in rows:
        sym = str(r["symbol"]).upper()
        buy_p, msgs = _f(r.get("buy_perc")), _f(r.get("msg_count")) or 0.0
        if buy_p is None:
            out[sym] = None
            continue
        # Pull thin-volume boards toward neutral instead of trusting a 100% from 3 posts.
        confidence = min(msgs / 500.0, 1.0)
        out[sym] = 50.0 + (buy_p - 50.0) * confidence
        detail[sym] = {"bullish_pct": buy_p, "messages": int(msgs)}
    return out, detail


def _consensus_signals(conn):
    """Analyst bullishness. Sparse — only a handful of symbols are scraped so far."""
    from psycopg2.extras import RealDictCursor
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT symbol, total, strong_buy, buy, hold, sell, strong_sell, consensus_rating
            FROM consensus_recommendations;
        """)
        rows = [dict(r) for r in cur.fetchall()]

    out, detail = {}, {}
    for r in rows:
        sym = str(r["symbol"]).upper()
        total = _f(r.get("total")) or 0.0
        if total <= 0:
            out[sym] = None
            continue
        score = ((_f(r.get("strong_buy")) or 0) * 2 + (_f(r.get("buy")) or 0)
                 - (_f(r.get("sell")) or 0) - (_f(r.get("strong_sell")) or 0) * 2)
        out[sym] = score / total * 50.0
        detail[sym] = {"rating": r.get("consensus_rating"), "analysts": int(total),
                       "strong_buy": r.get("strong_buy"), "buy": r.get("buy"),
                       "hold": r.get("hold"), "sell": r.get("sell")}
    return out, detail


# ---------------------------------------------------------------------------
# Composite
# ---------------------------------------------------------------------------

def normalise_criterion(name):
    key = str(name or "").strip().lower()
    return CRITERIA_ALIASES.get(key, key)


def screen(conn, limit=5, weights=None, include_consensus=False, min_factors=3,
           require_trend=False, market_cap_min_cr=None, keep_low_information=False,
           require_all=False, min_score=60.0, criteria_order=None):
    """Score the universe and return the top `limit` stocks with a factor breakdown."""
    cross = crossovers.compute_all(conn)
    meta = {r["ticker"]: r for r in cross}

    raw = {
        "trend": _trend_signals(cross),
        "breakout": _breakout_signals(cross),
    }
    raw["metrics"], metrics_detail = _metrics_signals(conn)
    raw["ownership"], ownership_detail = _ownership_signals(conn)
    raw["trades"], trades_detail = _trade_signals(conn)
    raw["sentiment"], sentiment_detail = _sentiment_signals(conn)

    details = {"metrics": metrics_detail, "ownership": ownership_detail,
               "trades": trades_detail, "sentiment": sentiment_detail}

    active_weights = dict(weights or DEFAULT_WEIGHTS)
    if include_consensus:
        raw["consensus"], consensus_detail = _consensus_signals(conn)
        details["consensus"] = consensus_detail
        active_weights["consensus"] = active_weights.get("consensus", 0.15)

    # Drop factors that cannot discriminate before they dilute the composite.
    diagnostics = {f: _factor_diagnostics(values) for f, values in raw.items()}
    excluded = {}
    if not keep_low_information:
        for factor, diag in diagnostics.items():
            if not diag["usable"] and factor in active_weights:
                excluded[factor] = diag["reason"]
                active_weights.pop(factor)

    ranks = {factor: _percentile_ranks(values) for factor, values in raw.items()}

    # Ties share an averaged rank, so a factor where many stocks tie at the best value
    # can never reach 100 — trend and trades typically cap in the mid-90s. Surface the
    # ceiling so an unreachable min_score is explained rather than silently returning none.
    ceilings = {f: round(max(r.values()), 1) if r else 0.0 for f, r in ranks.items()}

    scored = []
    for symbol, m in meta.items():
        per_factor = {f: ranks[f][symbol] for f in active_weights if symbol in ranks.get(f, {})}
        if len(per_factor) < min_factors:
            continue
        if require_trend and not any(m[t]["isActive"] for t in ("lite", "golden", "pro")):
            continue
        if market_cap_min_cr is not None:
            cap = _f(m.get("marketCapRaw"))
            if cap is None or cap < market_cap_min_cr:
                continue

        total_w = sum(active_weights[f] for f in per_factor)
        if total_w <= 0:
            continue
        composite = sum(per_factor[f] * active_weights[f] for f in per_factor) / total_w

        tier = next((t for t in ("pro", "golden", "lite") if m[t]["isActive"]), None)
        scored.append({
            "symbol": symbol,
            "stock_name": m["stockName"],
            # Pre-formatted: a local model converting crore to lakh crore gets it wrong
            # by factors of 100, so hand it strings to copy rather than numbers to convert.
            "price": format_price(m["priceRaw"]),
            "market_cap": format_mcap(m["marketCapRaw"]),
            "composite_score": round(composite, 1),
            "factor_scores": {f: round(v, 1) for f, v in sorted(per_factor.items())},
            "factors_available": sorted(per_factor),
            "factors_missing": sorted(set(active_weights) - set(per_factor)),
            "crossover_tier": tier,
            "crossover_days_active": m[tier]["activeDays"] if tier else 0,
            "breakout": m["breakout"]["highBreakout"] if m["breakout"]["highPct"] >= 0
                        else m["breakout"]["lowBreakout"],
            # Only surface supporting detail for factors that actually scored — showing
            # sentiment numbers next to "sentiment was excluded" reads as contradictory.
            "detail": {k: details[k].get(symbol) for k in details
                       if k in per_factor and details[k].get(symbol)},
        })

    # ---- strict mode: must clear min_score on EVERY criterion ----------------
    relaxation = None
    if require_all:
        order = [normalise_criterion(c) for c in (criteria_order or CRITERIA_ORDER)]
        order = [c for c in order if c in active_weights]
        dropped, attempts = [], []

        unreachable = {c: ceilings.get(c, 0.0) for c in order if ceilings.get(c, 0.0) < min_score}

        while True:
            passing = [
                s for s in scored
                if all(s["factor_scores"].get(c) is not None and s["factor_scores"][c] >= min_score
                       for c in order)
            ]
            attempts.append({"criteria": list(order), "matches": len(passing)})
            if passing or len(order) <= 1:
                break
            # Nothing cleared the bar — drop the last criterion and try again.
            dropped.append(order.pop())

        # Re-score survivors over only the criteria that were actually applied, so the
        # ranking reflects the relaxed rule rather than the original six.
        for s in passing:
            weight_sum = sum(active_weights[c] for c in order)
            s["composite_score"] = round(
                sum(s["factor_scores"][c] * active_weights[c] for c in order) / weight_sum, 1)
            s["criteria_applied"] = list(order)

        scored = passing
        def _label(c):
            return CRITERIA_LABELS[c].split(" (")[0]

        relaxation = {
            "requested_min_score": min_score,
            "criteria_applied": list(order),
            "criteria_dropped_in_order": dropped,
            "attempts": attempts,
            "max_achievable_score_per_criterion": ceilings,
            "summary": (
                f"All {len(order)} criteria met at a score of {min_score}+."
                if not dropped else
                f"No stock cleared {min_score}+ on every criterion. Dropped "
                + ", ".join(_label(d) for d in dropped)
                + f" (one at a time, from the end) until {len(passing)} stock(s) matched on "
                + ", ".join(_label(c) for c in order) + "."
            ),
        }
        if unreachable:
            relaxation["unreachable_criteria"] = {
                c: (f"{_label(c)} tops out at {cap} because many stocks tie at the best value, "
                    f"so a {min_score} bar can never be met on it")
                for c, cap in unreachable.items()
            }
        if not passing:
            best_reachable = max(ceilings.get(c, 0.0) for c in (order or ceilings)) if ceilings else 0.0
            relaxation["summary"] = (
                f"No stock cleared {min_score}+ on any criterion, even after dropping all "
                f"others. The highest score any stock can reach here is {best_reachable} — "
                f"lower min_score below that and try again.")

    scored.sort(key=lambda s: -s["composite_score"])
    for i, s in enumerate(scored[:limit]):
        s["rank"] = i + 1

    out = {
        "universe_size": len(meta),
        "scored": len(scored),
        "criteria_used": {f: CRITERIA_LABELS[f] for f in sorted(active_weights)},
        "weights": {f: round(active_weights[f], 3) for f in sorted(active_weights)},
        "method": ("Each stock is scored 0-100 per criterion by percentile rank against the "
                   "whole universe, then combined into a weighted composite. Scores are "
                   "relative standing among these 750 stocks, not a price forecast."),
        "results": scored[:limit],
        "note": "Already scored and ranked across every stock. Report these rows in order.",
    }
    if excluded:
        out["criteria_excluded"] = {
            f: f"{CRITERIA_LABELS[f]} — {reason}" for f, reason in excluded.items()
        }
        out["mention_to_user"] = (
            "Tell the user which criteria were excluded and why — they asked for all of them.")
    if relaxation:
        out["relaxation"] = relaxation
        out["mention_to_user"] = (
            "State which criteria were applied and, if any were dropped to find a match, "
            "say which ones were dropped and in what order.")
    return out
