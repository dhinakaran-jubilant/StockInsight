"""Tara AI — StockInsight conversational agent, running on a local Ollama model.

Architecture note
-----------------
The model is NOT fine-tuned on database rows, and deliberately so: prices, DMAs,
consensus counts and sentiment percentages change every scraper run, so any figure
baked into model weights is wrong within hours and cannot be corrected without
retraining. Instead:

  * the *domain* is baked in  -> Modelfile.tara specialises a base model on the
    StockInsight schema, vocabulary, and answer style (build it once, see README
    notes at the bottom of this file)
  * the *data* is read live   -> every factual answer comes from the read-only,
    parameterised tools below, executed against trading_db at question time

That split keeps answers permanently current while still giving you a model that
speaks your schema.

Usage from Flask:

    from ai_agent import run_agent, agent_enabled, AgentUnavailable

    try:
        result = run_agent(user_msg, history, get_db_conn)
    except AgentUnavailable:
        ...fall back to the keyword engine...
"""

import os
import re
import json
import decimal
import datetime as _dt

try:
    import ollama
except ImportError:  # package not installed yet
    ollama = None

from psycopg2.extras import RealDictCursor

import crossovers
import screener
from formatting import format_mcap, format_price


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

# Default is the custom model built from Modelfile.tara. Falls back to the base
# model automatically if that hasn't been built yet.
MODEL = os.environ.get("STOCKINSIGHT_AI_MODEL", "tara-stock")
FALLBACK_MODEL = os.environ.get("STOCKINSIGHT_AI_FALLBACK_MODEL", "qwen2.5:14b")

# Tool results are JSON-heavy — a small context window silently truncates them,
# which is the single most common cause of a local model inventing numbers.
NUM_CTX = int(os.environ.get("STOCKINSIGHT_AI_NUM_CTX", "16384"))
TEMPERATURE = float(os.environ.get("STOCKINSIGHT_AI_TEMPERATURE", "0.2"))

MAX_TOOL_ROUNDS = 6
MAX_HISTORY_TURNS = 8            # smaller than the cloud build — local ctx is precious
MAX_TOOL_RESULT_CHARS = 6000     # per tool result, before it eats the window
REQUEST_TIMEOUT = float(os.environ.get("STOCKINSIGHT_AI_TIMEOUT", "180"))

# Ollama unloads an idle model after 5 minutes by default, and reloading a 7B costs
# ~60s on the next question. Hold it resident instead — the cost is RAM, not compute.
# Set to "0" to unload immediately if you need the memory back.
KEEP_ALIVE = os.environ.get("STOCKINSIGHT_AI_KEEP_ALIVE", "30m")


class AgentUnavailable(Exception):
    """Raised when the agent cannot run (package missing / Ollama unreachable)."""


_resolved_model = None


def _client():
    if ollama is None:
        raise AgentUnavailable("The `ollama` package is not installed (pip install ollama).")
    return ollama.Client(host=OLLAMA_HOST, timeout=REQUEST_TIMEOUT)


def available_models():
    """Model names Ollama currently has pulled. Empty list if the server is down."""
    try:
        data = _client().list()
        models = data.get("models", []) if isinstance(data, dict) else getattr(data, "models", [])
        names = []
        for m in models:
            name = m.get("model") or m.get("name") if isinstance(m, dict) else getattr(m, "model", None)
            if name:
                names.append(name)
        return names
    except Exception:
        return []


def _base_name(model_name):
    """'tara-stock:latest' and 'tara-stock' are the same model."""
    return (model_name or "").split(":")[0]


def is_custom_model(model_name):
    return _base_name(model_name) == _base_name(MODEL)


def resolve_model():
    """Pick the custom model if it exists, else the base model, else whatever is pulled."""
    global _resolved_model
    # Only cache once we've landed on the preferred model — otherwise keep re-checking,
    # so building tara-stock while the server is running takes effect without a restart.
    if _resolved_model and is_custom_model(_resolved_model):
        return _resolved_model

    names = available_models()
    if not names:
        return None

    def has(target):
        return next((n for n in names if _base_name(n) == _base_name(target)), None)

    _resolved_model = has(MODEL) or has(FALLBACK_MODEL) or names[0]
    return _resolved_model


def agent_enabled():
    return ollama is not None and resolve_model() is not None


def agent_status():
    """Human-readable status for /api/health."""
    if ollama is None:
        return "disabled — `ollama` package not installed (pip install ollama)"
    names = available_models()
    if not names:
        return f"disabled — no Ollama server reachable at {OLLAMA_HOST}"
    chosen = resolve_model()
    if not is_custom_model(chosen):
        return (f"enabled on base model '{chosen}' — build the specialised model with "
                f"`python build_tara_model.py` for better accuracy")
    return f"enabled on '{chosen}' (domain-specialised)"


# ---------------------------------------------------------------------------
# JSON helpers — Postgres returns Decimal / date / datetime which json chokes on
# ---------------------------------------------------------------------------

def _jsonable(value):
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (_dt.date, _dt.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _rows(conn, sql, params=()):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute(sql, params)
        return _jsonable([dict(r) for r in cur.fetchall()])


def _row(conn, sql, params=()):
    result = _rows(conn, sql, params)
    return result[0] if result else None


def _sma(closes, window):
    if len(closes) < window:
        return None
    return round(sum(closes[-window:]) / window, 2)


# ---------------------------------------------------------------------------
# Tool implementations — all read-only, all parameterised
# ---------------------------------------------------------------------------

def t_find_stocks(conn, query, limit=8):
    limit = max(1, min(int(limit or 8), 25))
    pattern = f"%{(query or '').strip()}%"
    return {
        "matches": _rows(conn, """
            SELECT symbol, stock_name, price, market_cap
            FROM nifty_750
            WHERE symbol ILIKE %s OR stock_name ILIKE %s
            ORDER BY
                CASE WHEN UPPER(symbol) = UPPER(%s) THEN 0
                     WHEN symbol ILIKE %s THEN 1
                     ELSE 2 END,
                stock_name
            LIMIT %s;
        """, (pattern, pattern, (query or '').strip(), pattern, limit))
    }


def t_get_stock_snapshot(conn, symbol):
    sym = (symbol or "").strip().upper()

    base = _row(conn, """
        SELECT symbol, stock_name, price, market_cap, updated_at
        FROM nifty_750 WHERE UPPER(symbol) = %s LIMIT 1;
    """, (sym,))
    if not base:
        return {"found": False, "symbol": sym,
                "hint": "Symbol not in nifty_750. Call find_stocks first to resolve the name."}

    consensus = _row(conn, """
        SELECT total, strong_buy, buy, hold, sell, strong_sell, consensus_rating,
               target_mean_price, target_high_price, target_low_price, scraped_at
        FROM consensus_recommendations WHERE UPPER(symbol) = %s;
    """, (sym,))

    sentiment = _row(conn, """
        SELECT msg_count, follower_count, buy_perc, sell_perc, hold_perc, ai_summary, scraped_at
        FROM moneycontrol_boarders WHERE UPPER(symbol) = %s;
    """, (sym,))

    shareholding = _rows(conn, """
        SELECT period, period_type, promoters, fiis, diis, public, num_shareholders
        FROM shareholding_pattern WHERE UPPER(symbol) = %s
        ORDER BY id DESC LIMIT 4;
    """, (sym,))

    trades = _rows(conn, """
        SELECT trade_date, person, designation, buy_sell, quantity, price, value_lacs, trade_type
        FROM trades WHERE UPPER(symbol) = %s ORDER BY id DESC LIMIT 5;
    """, (sym,))

    history = _rows(conn, """
        SELECT trade_date, close, volume FROM stock_history
        WHERE UPPER(symbol) = %s ORDER BY trade_date DESC LIMIT 100;
    """, (sym,))
    closes = [float(h["close"]) for h in reversed(history) if h.get("close") is not None]

    technicals = None
    if closes:
        last = closes[-1]
        dma20, dma50, dma100 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 100)
        technicals = {
            "last_close": round(last, 2),
            "last_trade_date": history[0]["trade_date"],
            "dma20": dma20, "dma50": dma50, "dma100": dma100,
            "below_dma20": dma20 is not None and last < dma20,
            "below_dma50": dma50 is not None and last < dma50,
            "below_dma100": dma100 is not None and last < dma100,
            "period_high": round(max(closes), 2),
            "period_low": round(min(closes), 2),
            "sessions_covered": len(closes),
        }

    return {
        "found": True,
        "profile": base,
        "analyst_consensus": consensus,
        "forum_sentiment": sentiment,
        "shareholding_recent_periods": shareholding,
        "recent_insider_trades": trades,
        "technicals": technicals,
    }


def t_get_price_history(conn, symbol, days=90):
    sym = (symbol or "").strip().upper()
    days = max(5, min(int(days or 90), 750))
    history = _rows(conn, """
        SELECT trade_date, open, high, low, close, volume
        FROM stock_history WHERE UPPER(symbol) = %s
        ORDER BY trade_date DESC LIMIT %s;
    """, (sym, days))
    if not history:
        return {"symbol": sym, "rows": [], "note": "No price history stored for this symbol."}

    history = list(reversed(history))
    closes = [float(h["close"]) for h in history if h.get("close") is not None]
    first, last = (closes[0], closes[-1]) if closes else (None, None)

    # Keep the payload small: at most ~25 evenly spaced points plus summary stats.
    step = max(1, len(history) // 25)
    sampled = history[::step]
    if history and sampled[-1] is not history[-1]:
        sampled.append(history[-1])

    return {
        "symbol": sym,
        "from": history[0]["trade_date"],
        "to": history[-1]["trade_date"],
        "sessions": len(history),
        "summary": {
            "first_close": first,
            "last_close": last,
            "change_pct": round((last - first) / first * 100, 2) if first else None,
            "high": round(max(closes), 2) if closes else None,
            "low": round(min(closes), 2) if closes else None,
            "dma20": _sma(closes, 20), "dma50": _sma(closes, 50), "dma100": _sma(closes, 100),
        },
        "sampled_rows": sampled,
    }


# Whitelist of rankable metrics -> the SQL expression they map to. The model can only
# name a key here, so no model-generated text ever reaches the ORDER BY clause.
_RANK_METRICS = {
    "analyst_coverage":   "c.total",
    "strong_buy_count":   "c.strong_buy",
    "buy_count":          "c.buy",
    "sell_count":         "(COALESCE(c.sell,0) + COALESCE(c.strong_sell,0))",
    "forum_messages":     "m.msg_count",
    "forum_followers":    "m.follower_count",
    "forum_bullish_pct":  "m.buy_perc",
    "forum_bearish_pct":  "m.sell_perc",
}


def t_rank_stocks(conn, metric, limit=10, order="desc", consensus_rating=None, min_analysts=None):
    if metric not in _RANK_METRICS:
        return {"error": f"Unknown metric '{metric}'. Allowed: {sorted(_RANK_METRICS)}"}
    expr = _RANK_METRICS[metric]
    direction = "ASC" if str(order).lower() == "asc" else "DESC"
    limit = max(1, min(int(limit or 10), 25))

    where, params = [f"{expr} IS NOT NULL"], []
    if consensus_rating:
        where.append("c.consensus_rating ILIKE %s")
        params.append(f"%{consensus_rating}%")
    if min_analysts:
        where.append("c.total >= %s")
        params.append(int(min_analysts))

    sql = f"""
        SELECT n.symbol,
               COALESCE(n.stock_name, n.symbol) AS stock_name,
               n.price, n.market_cap,
               c.consensus_rating, c.total AS analyst_total,
               c.strong_buy, c.buy, c.hold, c.sell, c.strong_sell, c.target_mean_price,
               m.msg_count, m.follower_count, m.buy_perc, m.sell_perc,
               {expr} AS ranked_value
        FROM nifty_750 n
        LEFT JOIN consensus_recommendations c ON UPPER(n.symbol) = UPPER(c.symbol)
        LEFT JOIN moneycontrol_boarders    m ON UPPER(n.symbol) = UPPER(m.symbol)
        WHERE {' AND '.join(where)}
        ORDER BY {expr} {direction} NULLS LAST
        LIMIT %s;
    """
    params.append(limit)
    return {"metric": metric, "order": direction.lower(), "results": _rows(conn, sql, tuple(params))}


def t_get_insider_trades(conn, symbol=None, buy_sell=None, limit=10):
    limit = max(1, min(int(limit or 10), 30))
    where, params = ["1=1"], []
    if symbol:
        where.append("UPPER(t.symbol) = %s")
        params.append(symbol.strip().upper())
    if buy_sell:
        where.append("t.buy_sell ILIKE %s")
        params.append(f"%{buy_sell.strip()}%")
    params.append(limit)

    return {"trades": _rows(conn, f"""
        SELECT t.trade_date, t.symbol, COALESCE(n.stock_name, t.symbol) AS stock_name,
               t.person, t.designation, t.buy_sell, t.quantity, t.price,
               t.value_lacs, t.mode, t.percent, t.trade_type
        FROM trades t
        LEFT JOIN nifty_750 n ON UPPER(t.symbol) = UPPER(n.symbol)
        WHERE {' AND '.join(where)}
        ORDER BY t.id DESC LIMIT %s;
    """, tuple(params))}


def t_get_watchlist_status(conn, group_name=None, below_dma=None, holding_above_all=False):
    where, params = ["1=1"], []
    if group_name:
        where.append("w.group_name ILIKE %s")
        params.append(f"%{group_name.strip()}%")

    watch = _rows(conn, f"""
        SELECT w.symbol, w.stock_name, w.group_name, w.price, w.market_cap, w.change
        FROM watchlist w WHERE {' AND '.join(where)} ORDER BY w.group_name, w.stock_name;
    """, tuple(params))
    if not watch:
        return {"watchlist": [], "note": "Watchlist is empty for this filter."}

    for item in watch:
        closes = [
            float(r["close"]) for r in reversed(_rows(conn, """
                SELECT close FROM stock_history WHERE UPPER(symbol) = %s
                ORDER BY trade_date DESC LIMIT 100;
            """, (str(item["symbol"]).upper(),)))
            if r.get("close") is not None
        ]
        if not closes:
            item["exit_signal"] = "no price history"
            continue
        last = closes[-1]
        dma20, dma50, dma100 = _sma(closes, 20), _sma(closes, 50), _sma(closes, 100)
        # Explicit per-DMA booleans matter: exit_signal below is mutually exclusive, so
        # "Lite Exit" implies *not* below the 50 DMA. Models reliably get that inference
        # wrong when asked "which are below their 50 DMA", so state each one outright.
        item.update({
            "last_close": round(last, 2),
            "dma20": dma20, "dma50": dma50, "dma100": dma100,
            "below_dma20": dma20 is not None and last < dma20,
            "below_dma50": dma50 is not None and last < dma50,
            "below_dma100": dma100 is not None and last < dma100,
        })

        if dma100 is not None and last < dma100:
            item["exit_signal"] = "Strong Exit (below 100 DMA)"
        elif dma50 is not None and last < dma50:
            item["exit_signal"] = "Exit (below 50 DMA)"
        elif dma20 is not None and last < dma20:
            item["exit_signal"] = "Lite Exit (below 20 DMA)"
        else:
            item["exit_signal"] = "Holding above all DMAs"

    # Filter here rather than leaving it to the model — asking a small model to select
    # rows from a list by a boolean field is where it reliably slips (it pattern-matches
    # "has any alert" and both over- and under-includes). Python cannot get this wrong.
    if holding_above_all:
        matched = [w for w in watch if w.get("exit_signal") == "Holding above all DMAs"]
        return {
            "filter": "watchlist stocks trading above their 20, 50 and 100 DMA",
            "count": len(matched),
            "watchlist": matched,
            "watchlist_total": len(watch),
            "note": "This list is already filtered and complete. Report every row and add none. "
                    "If count is 0 say none qualify; never claim the watchlist has fewer "
                    "stocks than watchlist_total.",
        }

    if below_dma is not None:
        try:
            key = f"below_dma{int(below_dma)}"
        except (TypeError, ValueError):
            key = None
        if key not in ("below_dma20", "below_dma50", "below_dma100"):
            return {"error": "below_dma must be 20, 50 or 100."}
        matched = [w for w in watch if w.get(key)]
        return {
            "filter": f"stocks trading below their {int(below_dma)} DMA",
            "count": len(matched),
            "watchlist": matched,
            "watchlist_total": len(watch),
            "note": "This list is already filtered and complete. Report every row and add none. "
                    "If count is 0 say none qualify; never claim the watchlist has fewer "
                    "stocks than watchlist_total.",
        }

    return {
        "watchlist": watch,
        "alerts": [w for w in watch if str(w.get("exit_signal", "")).endswith("DMA)")],
    }


def t_get_market_overview(conn):
    return {
        "global_indices": _rows(conn, """
            SELECT DISTINCT ON (index_name) index_name, region, trade_date, close, open, high, low
            FROM global_index_history ORDER BY index_name, trade_date DESC;
        """),
        "commodities": _rows(conn, """
            SELECT DISTINCT ON (name) name, symbol, category, trade_date, close, open, high, low
            FROM commodity_history ORDER BY name, trade_date DESC;
        """),
        "fii_dii_cashflow": _rows(conn, """
            SELECT period, period_type, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net
            FROM fii_dii_cash ORDER BY id DESC LIMIT 8;
        """),
        "sectoral_activity": _rows(conn, """
            SELECT sector, period, period_type, amount, amount_cr
            FROM sectoral_activity ORDER BY id DESC LIMIT 15;
        """),
    }


def t_get_financials(conn, symbol):
    sym = (symbol or "").strip().upper()
    return {
        "symbol": sym,
        "metrics": _row(conn, "SELECT * FROM financial_metrics WHERE UPPER(symbol) = %s;", (sym,)),
        "compounded_growth": _rows(conn, """
            SELECT metric_title, period, value FROM compounded_growth
            WHERE UPPER(symbol) = %s ORDER BY metric_title, period;
        """, (sym,)),
    }


def t_get_shareholding_trend(conn, symbol, periods=8):
    sym = (symbol or "").strip().upper()
    periods = max(1, min(int(periods or 8), 20))
    return {"symbol": sym, "periods": _rows(conn, """
        SELECT period, period_type, promoters, fiis, diis, public, num_shareholders, market_cap
        FROM shareholding_pattern WHERE UPPER(symbol) = %s
        ORDER BY id DESC LIMIT %s;
    """, (sym, periods))}


_CROSSOVER_SORTS = {
    "recent": lambda s: (s["activeDays"], -s["prob"]),        # freshest signal first
    "probability": lambda s: (-s["prob"], -s["avgGainPct"]),
    "avg_gain": lambda s: (-s["avgGainPct"], -s["prob"]),
    "occurrences": lambda s: (-s["crossoverCount"], -s["prob"]),
}


def t_get_crossovers(conn, tier="golden", limit=5, sort_by="recent", symbol=None, active_only=True):
    """DMA crossover screen — the same figures the Trends tab shows."""
    tier = str(tier or "golden").lower()
    if tier in ("core", "gold"):          # tolerate near-misses from the model
        tier = "golden"
    if tier not in crossovers.TIERS:
        return {"error": f"Unknown tier '{tier}'. Use 'lite', 'golden', or 'pro'."}

    sort_by = str(sort_by or "recent").lower()
    if sort_by not in _CROSSOVER_SORTS:
        return {"error": f"Unknown sort_by '{sort_by}'. Use {sorted(_CROSSOVER_SORTS)}."}

    limit = max(1, min(int(limit or 5), 25))
    rows = crossovers.compute_all(conn)

    definition = {
        "lite": "20 DMA above the 200 DMA",
        "golden": "50 DMA above the 200 DMA (with the 20 DMA also above it)",
        "pro": "100 DMA above the 200 DMA (with the 20 and 50 DMA also above it)",
    }[tier]

    if symbol:
        sym = symbol.strip().upper()
        row = next((r for r in rows if r["ticker"] == sym), None)
        if not row:
            return {"symbol": sym, "found": False, "note": "No price history stored for this symbol."}
        return {
            "symbol": sym, "found": True, "stock_name": row["stockName"],
            "definition": {k: definition for k in [tier]},
            "lite": row["lite"], "golden": row["golden"], "pro": row["pro"],
        }

    # Filter and rank here rather than in the model — selecting and ordering rows is
    # exactly where a small model slips.
    candidates = [r for r in rows if r[tier]["isActive"]] if active_only else list(rows)
    candidates.sort(key=lambda r: _CROSSOVER_SORTS[sort_by](r[tier]))

    top = [{
        "rank": i + 1,
        "symbol": r["ticker"],
        "stock_name": r["stockName"],
        # Pre-formatted: the model must copy these strings, never convert them itself.
        "price": format_price(r["priceRaw"]),
        "market_cap": format_mcap(r["marketCapRaw"]),
        "in_crossover": r[tier]["isActive"],
        "days_active": r[tier]["activeDays"],
        "past_occurrences": r[tier]["crossoverCount"],
        "success_probability_pct": r[tier]["prob"],
        "avg_gain_pct": r[tier]["avgGainPct"],
    } for i, r in enumerate(candidates[:limit])]

    return {
        "tier": tier,
        "definition": f"{tier.capitalize()} crossover = {definition}",
        "sorted_by": sort_by,
        "total_in_crossover": sum(1 for r in rows if r[tier]["isActive"]),
        "returned": len(top),
        "results": top,
        "note": "Already filtered and ranked. Report these rows in order and add none.",
    }


def t_screen_best_stocks(conn, limit=5, include_consensus=False, require_trend=False,
                         market_cap_min_cr=None, focus=None, require_all=False,
                         min_score=60):
    """Multi-factor screen across the entire 750-stock universe."""
    limit = max(1, min(int(limit or 5), 15))
    try:
        min_score = max(0.0, min(float(min_score if min_score is not None else 60), 100.0))
    except (TypeError, ValueError):
        min_score = 60.0

    weights = None
    if focus:
        focus = str(focus).strip().lower()
        if focus not in screener.DEFAULT_WEIGHTS:
            return {"error": f"Unknown focus '{focus}'. Use one of {sorted(screener.DEFAULT_WEIGHTS)}."}
        # Double the requested criterion's weight rather than scoring on it alone, so the
        # answer still reflects a rounded view.
        weights = dict(screener.DEFAULT_WEIGHTS)
        weights[focus] *= 2.0

    return screener.screen(
        conn,
        limit=limit,
        weights=weights,
        include_consensus=bool(include_consensus),
        require_trend=bool(require_trend),
        market_cap_min_cr=float(market_cap_min_cr) if market_cap_min_cr else None,
        require_all=bool(require_all),
        min_score=min_score,
    )


def t_get_data_freshness(conn):
    return _row(conn, """
        SELECT (SELECT MAX(scraped_at) FROM trades)                     AS insider_trades,
               (SELECT MAX(scraped_at) FROM shareholding_pattern)       AS shareholding,
               (SELECT MAX(scraped_at) FROM stock_history)              AS price_history,
               (SELECT MAX(scraped_at) FROM financial_metrics)          AS financials,
               (SELECT MAX(scraped_at) FROM global_index_history)       AS global_indices,
               (SELECT MAX(scraped_at) FROM commodity_history)          AS commodities,
               (SELECT MAX(scraped_at) FROM sectoral_activity)          AS sectoral,
               (SELECT MAX(scraped_at) FROM fii_dii_cash)               AS cashflow,
               (SELECT MAX(scraped_at) FROM consensus_recommendations)  AS consensus,
               (SELECT MAX(scraped_at) FROM moneycontrol_boarders)      AS forum_sentiment,
               (SELECT MAX(updated_at) FROM nifty_750)                  AS nifty_750,
               NOW()                                                    AS server_time;
    """)


TOOL_IMPLS = {
    "find_stocks": t_find_stocks,
    "get_stock_snapshot": t_get_stock_snapshot,
    "get_price_history": t_get_price_history,
    "rank_stocks": t_rank_stocks,
    "get_insider_trades": t_get_insider_trades,
    "get_watchlist_status": t_get_watchlist_status,
    "get_market_overview": t_get_market_overview,
    "get_financials": t_get_financials,
    "get_shareholding_trend": t_get_shareholding_trend,
    "get_crossovers": t_get_crossovers,
    "screen_best_stocks": t_screen_best_stocks,
    "get_data_freshness": t_get_data_freshness,
}


# ---------------------------------------------------------------------------
# Tool schemas (OpenAI "function" shape — what Ollama's /api/chat expects)
#
# Descriptions are deliberately short and concrete. Local 7B-14B models degrade
# on long tool prose far more than frontier models do.
# ---------------------------------------------------------------------------

def _tool(name, description, properties=None, required=None):
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {
                "type": "object",
                "properties": properties or {},
                "required": required or [],
            },
        },
    }


TOOLS = [
    _tool(
        "find_stocks",
        "Resolve a company name or partial name into exact ticker symbols. Call this FIRST "
        "whenever the user names a company in words rather than a ticker.",
        {
            "query": {"type": "string", "description": "Company name, partial name, or ticker."},
            "limit": {"type": "integer", "description": "Max matches, 1-25. Default 8."},
        },
        ["query"],
    ),
    _tool(
        "get_stock_snapshot",
        "Everything about one stock: price, market cap, analyst consensus and target prices, "
        "forum sentiment, shareholding, recent insider trades, and technicals (last close, "
        "20/50/100 DMA, period high/low). Use for any 'tell me about X' question.",
        {"symbol": {"type": "string", "description": "Exact ticker symbol, e.g. SUZLON."}},
        ["symbol"],
    ),
    _tool(
        "get_price_history",
        "Daily price history for one stock with change %, high, low and DMAs. Use for trend or "
        "performance-over-time questions. About 250 sessions make one year.",
        {
            "symbol": {"type": "string", "description": "Exact ticker symbol."},
            "days": {"type": "integer", "description": "Recent sessions to load, 5-750. Default 90."},
        },
        ["symbol"],
    ),
    _tool(
        "rank_stocks",
        "Rank all stocks by one metric. Use for 'top', 'best', 'most', 'which stocks' questions.",
        {
            "metric": {
                "type": "string",
                "enum": sorted(_RANK_METRICS.keys()),
                "description": "Metric to rank by.",
            },
            "limit": {"type": "integer", "description": "Rows to return, 1-25. Default 10."},
            "order": {"type": "string", "enum": ["desc", "asc"], "description": "Default desc."},
            "consensus_rating": {"type": "string", "description": "Optional filter, e.g. 'Strong Buy'."},
            "min_analysts": {"type": "integer", "description": "Optional minimum analyst count."},
        },
        ["metric"],
    ),
    _tool(
        "get_insider_trades",
        "Individual insider, bulk and block deals — who bought or sold and how much. Omit symbol "
        "for the latest market-wide trades. NOT for FII/DII shareholding percentages (use "
        "get_shareholding_trend) and NOT for market-wide institutional flows "
        "(use get_market_overview).",
        {
            "symbol": {"type": "string", "description": "Optional exact ticker symbol."},
            "buy_sell": {"type": "string", "description": "Optional 'Buy' or 'Sell' filter."},
            "limit": {"type": "integer", "description": "Rows, 1-30. Default 10."},
        },
    ),
    _tool(
        "get_watchlist_status",
        "The user's watchlist with live exit signals (Lite Exit = below 20 DMA, Exit = below "
        "50 DMA, Strong Exit = below 100 DMA). If the user asks about ONE specific moving "
        "average, pass below_dma; if they ask which are healthy or above all their averages, "
        "pass holding_above_all. Either way the result comes back already filtered — report "
        "every row it returns and add none of your own.",
        {
            "group_name": {"type": "string", "description": "Optional watchlist group filter."},
            "below_dma": {
                "type": "integer",
                "enum": [20, 50, 100],
                "description": "Return only stocks trading below this moving average.",
            },
            "holding_above_all": {
                "type": "boolean",
                "description": "Return only stocks trading above their 20, 50 AND 100 DMA — "
                               "the healthy ones with no exit signal.",
            },
        },
    ),
    _tool(
        "get_market_overview",
        "Market-wide context, not per-stock: latest close for every global index and commodity "
        "(gold, silver, oil), FII and DII cash flows — daily buy/sell/net institutional money "
        "into the whole market — and sectoral activity. Use for questions about FII/DII flows, "
        "foreign money, commodities, or how world markets are doing.",
    ),
    _tool(
        "get_financials",
        "Fundamentals for one stock: sales, operating profit, OPM, net profit, ROE, ROCE, "
        "YoY and compounded growth.",
        {"symbol": {"type": "string", "description": "Exact ticker symbol."}},
        ["symbol"],
    ),
    _tool(
        "get_shareholding_trend",
        "Who owns a stock: promoter, FII, DII and public holding percentages over recent "
        "quarters, plus the change since the previous quarter. This is the tool for any "
        "question about FII or DII stake in a COMPANY — whether institutions are adding or "
        "trimming, promoter holding, or ownership changes. Not get_insider_trades (that is "
        "individual deals) and not get_market_overview (that is market-wide flows).",
        {
            "symbol": {"type": "string", "description": "Exact ticker symbol."},
            "periods": {"type": "integer", "description": "Periods to return, 1-20. Default 8."},
        },
        ["symbol"],
    ),
    _tool(
        "get_crossovers",
        "DMA crossover screen — the Trends tab's Lite / Golden / Pro crossover columns. "
        "Use this for ANY question mentioning crossover, golden cross, death cross, moving "
        "average cross, or trend signal. Returns an already-ranked list; report it in order. "
        "Pass a symbol instead to get all three tiers for one stock.",
        {
            "tier": {
                "type": "string",
                "enum": ["lite", "golden", "pro"],
                "description": "lite = 20 DMA over 200 DMA; golden = 50 over 200; pro = 100 over 200.",
            },
            "limit": {"type": "integer", "description": "How many stocks to return, 1-25. Default 5."},
            "sort_by": {
                "type": "string",
                "enum": ["recent", "probability", "avg_gain", "occurrences"],
                "description": "recent = newest signal first (default); probability = best "
                               "historical hit rate; avg_gain = biggest average gain.",
            },
            "symbol": {"type": "string", "description": "Optional — one stock's crossover status instead of a screen."},
            "active_only": {"type": "boolean", "description": "Only stocks currently in crossover. Default true."},
        },
    ),
    _tool(
        "screen_best_stocks",
        "Scores ALL 750 stocks across every criterion at once — trends, breakout, metrics, "
        "ownership, insider trades and sentiment — and returns the highest-scoring ones with "
        "a per-criterion breakdown. This is the tool for 'which stock is best', 'best buy "
        "opportunity', 'analyse all stocks', 'out of 750 which one', or any question asking "
        "to weigh several criteria together. Never answer those from an earlier reply — this "
        "tool looks at the whole universe, not just stocks already mentioned.",
        {
            "limit": {"type": "integer", "description": "How many stocks to return, 1-15. Default 5."},
            "focus": {
                "type": "string",
                "enum": ["trend", "breakout", "metrics", "ownership", "trades", "sentiment"],
                "description": "Optional — double the weight of one criterion the user emphasised.",
            },
            "require_trend": {
                "type": "boolean",
                "description": "Only stocks currently in a DMA crossover. Default false.",
            },
            "market_cap_min_cr": {
                "type": "number",
                "description": "Optional minimum market cap in Rs crore, e.g. 10000 for large caps.",
            },
            "include_consensus": {
                "type": "boolean",
                "description": "Add analyst consensus as a criterion. Off by default — only a "
                               "handful of symbols have consensus data scraped so far.",
            },
            "require_all": {
                "type": "boolean",
                "description": "Strict mode: a stock must score at least min_score on EVERY "
                               "criterion. If none qualify, the last criterion is dropped and "
                               "it retries, repeating until something matches. Use when the "
                               "user says 'must meet all criteria' or 'satisfies everything'.",
            },
            "min_score": {
                "type": "number",
                "description": "Bar each criterion must clear in strict mode, 0-100. Default 60.",
            },
        },
    ),
    _tool(
        "get_data_freshness",
        "When each dataset was last scraped, plus current server time.",
    ),
]


# ---------------------------------------------------------------------------
# System prompt
#
# Kept tight on purpose. Local models follow a short, concrete prompt far more
# reliably than a long one; the domain knowledge lives in Modelfile.tara.
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are Tara AI, the assistant inside StockInsight, an Indian equity research \
dashboard covering the Nifty 750. You are talking to the analyst who uses it.

RULES
1. Every price, percentage, rating, count and date must come from a tool result in this \
conversation. You have no market knowledge of your own — never state a figure you did not just \
receive from a tool.
2. If the user names a company in words, call find_stocks first, then use the exact symbol it \
returns. If several companies match, ask which one they meant.
3. If a tool returns nothing or a null field, say so plainly. Never fill the gap with a guess.
4. Never substitute a different metric for the one you were asked about. If no tool covers the \
question, say what you cannot see and name what you do have — answering about "buy count" when \
asked about "crossovers" is worse than saying you can't check it.
5. When a tool returns an already-filtered or already-ranked list, report exactly those rows in \
that order. Do not add, drop or re-sort them.
6. Every question gets fresh tool calls. Never answer a new question by re-using stocks from an \
earlier reply — if the user asks about "all 750 stocks" or "the best" after you listed five, \
those five are not the answer set; screen the whole universe again.
7. If a tool reports that a criterion was excluded, tell the user which one and why.
8. Answer only what was asked, at the length it needs. One-number questions get one line.
9. You present data. You do not give personalised buy/sell/hold advice — if asked, show what the \
data says on both sides and note it is information, not a recommendation. Say that once, briefly.

FORMATTING — the chat window renders only these marks:
  "### " starts a section title. Write your own title describing that section's content. \
Use at most one, and none at all for a short answer — a one-line reply needs no heading.
  "• " starts a bullet line.
  "**text**" is bold, "`text`" is code style, "*text*" is italic, "> " starts a quoted line.
Never copy a title from these instructions; they describe marks, not content.
No tables, no numbered lists, no fenced code blocks, no links — they will not render.

Always give a stock's ticker in brackets the first time you name it, like Reliance \
Industries (RELIANCE), so the user knows exactly which listing you mean.

TONE
Warm, professional, brief. Greet naturally when greeted. Lead with the answer, then the numbers. \
No filler openers like "Great question!". Do not repeat the question back."""


# Durable knowledge about *this* database — schema meaning and house definitions.
# Unlike the data itself, none of this changes between scraper runs, so it is safe
# to bake in. build_tara_model.py compiles it into the Ollama Modelfile, and it is
# also sent at runtime so the agent works on a plain base model too.
DOMAIN_BRIEF = """
STOCKINSIGHT DOMAIN

Tables behind your tools:
• nifty_750 — the stock universe: symbol, stock_name, latest price, market cap in ₹ crore
• stock_history — daily OHLC and volume; the source of every moving average
• consensus_recommendations — analyst counts (strong_buy, buy, hold, sell, strong_sell), an \
overall consensus_rating, and target mean/high/low prices
• moneycontrol_boarders — retail forum activity: message and follower counts, buy/sell/hold \
percentages, and an AI summary of the discussion
• trades — insider, bulk and block deals: person, designation, buy/sell, quantity, value in lacs
• shareholding_pattern — promoter / FII / DII / public percentages by quarter
• financial_metrics, compounded_growth — sales, operating profit, OPM, net profit, ROE, ROCE, growth
• global_index_history, commodity_history — world indices and commodities
• fii_dii_cash, sectoral_activity — foreign and domestic institutional flows
• watchlist — the user's tracked stocks

House definitions — use these exact meanings:
• DMA is the daily moving average of closing price. StockInsight tracks 20, 50 and 100 DMA.
• Exit signals are strictly price vs DMA: below 20 DMA is a "Lite Exit", below 50 DMA is an \
"Exit", below 100 DMA is a "Strong Exit". Above all three is "holding above all DMAs".
• A breakout is measured against the 2-year high or low.
• Crossovers are always measured against the 200 DMA, and the Trends tab names three tiers: \
"Lite" is the 20 DMA above the 200 DMA, "Golden" is the 50 DMA above the 200 DMA (with the 20 \
also above), "Pro" is the 100 DMA above the 200 DMA (with the 20 and 50 also above). "Golden \
cross" and "golden crossover" both mean the Golden tier. Each carries how many days the signal \
has been active, how many times it has occurred historically, the share of those past occurrences \
that gained ("probability"), and the average gain.
• Market caps are in ₹ crore; 100000 crore is written ₹1.00L Cr (one lakh crore).
• Trade values in the trades table are in lacs, not crore.
• "Boarders" are Moneycontrol message-board participants — retail forum sentiment, not analysts. \
Never conflate boarder sentiment with analyst consensus; they are separate signals that often \
disagree, and saying so is often the useful insight."""


# ---------------------------------------------------------------------------
# Deterministic symbol pre-resolution
#
# Small models often skip find_stocks and hallucinate a ticker. Resolving the
# obvious case in Python first and handing the model the answer removes that
# failure mode entirely for the common "tell me about <company>" question.
# ---------------------------------------------------------------------------

_STOPWORDS = {
    "THE", "AND", "FOR", "WHAT", "HOW", "WHY", "WHEN", "WHO", "IS", "ARE", "DO", "DOES",
    "TELL", "ME", "ABOUT", "SHOW", "GIVE", "GET", "STOCK", "STOCKS", "SHARE", "SHARES",
    "PRICE", "TOP", "BEST", "LATEST", "NEWS", "BUY", "SELL", "HOLD", "MY", "IT", "ITS",
    "OF", "IN", "ON", "TO", "A", "AN", "VS", "OR", "CAN", "YOU", "PLEASE", "HI", "HELLO",
}


# Questions that ask the model to weigh the whole universe. A small model reliably fails
# these two ways: it answers with no tool call at all, or it recycles stocks from the
# previous turn. Detecting the intent here and pre-running the screen removes both.
_SCREEN_INTENT = re.compile(
    r"\b(best|top|most|strongest|greatest|highest)\b.{0,40}\b"
    r"(stock|share|buy|opportunit|pick|invest|option|candidate)"
    r"|\b(which|what)\b.{0,30}\b(stock|share|one)\b.{0,40}"
    r"\b(best|buy|strong|good|opportunit|recommend|pick)"
    r"|\ball\s+(criteria|parameters|factors|metrics)\b"
    r"|\bout\s+of\s+\d{2,4}\b"
    r"|\boverall\b.{0,25}\b(best|analysis|score)",
    re.IGNORECASE,
)

# Anything that needs a number from the database. Used to decide whether answering with
# zero tool calls is acceptable (a greeting) or a hallucination risk (everything else).
_DATA_INTENT = re.compile(
    r"\b(stock|share|price|dma|crossover|breakout|consensus|analyst|sentiment|boarder|"
    r"forum|insider|trade|watchlist|exit|alert|promoter|fii|dii|shareholding|holding|"
    r"metric|roe|roce|profit|sales|growth|market\s*cap|nifty|index|commodity|sector|"
    r"buy|sell|top|best|which|compare|screen)\b",
    re.IGNORECASE,
)


# Naming one specific criterion means a dedicated tool fits better than the whole-universe
# screen — "top 5 golden crossover stocks" wants get_crossovers, not a composite score.
_SPECIFIC_CRITERION = re.compile(
    r"\b(crossover|golden\s*cross|death\s*cross|breakout|watchlist|exit\s*alert|dma|"
    r"insider|bulk\s*deal|block\s*deal|shareholding|promoter|fii|dii|consensus|analyst|"
    r"forum|boarder|commodity|global\s*index|sector)\b",
    re.IGNORECASE,
)

# ...unless the user explicitly asks for everything weighed together.
_ALL_CRITERIA = re.compile(
    r"\ball\s+(criteria|parameters|factors|metrics|of\s+them)\b|\bevery\s+criteri|"
    r"\boverall\b|\bcombined\b|\bacross\s+all\b",
    re.IGNORECASE,
)


def _detect_screen_intent(user_msg):
    msg = user_msg or ""
    if not _SCREEN_INTENT.search(msg):
        return False
    if _SPECIFIC_CRITERION.search(msg) and not _ALL_CRITERIA.search(msg):
        return False
    return True


def _needs_data(user_msg):
    return bool(_DATA_INTENT.search(user_msg or ""))


# Keyword -> tool, used only to name candidates when the model answers with no tool call
# at all. Ordered most specific first; falls back to the general per-stock lookup.
_TOOL_HINTS = [
    (r"fii|dii|foreign|institution|promoter|shareholding|ownership|stake|holding",
     ["get_shareholding_trend", "get_market_overview"]),
    (r"crossover|golden\s*cross|death\s*cross", ["get_crossovers"]),
    (r"watchlist|exit\s*alert", ["get_watchlist_status"]),
    (r"insider|bulk\s*deal|block\s*deal", ["get_insider_trades"]),
    (r"commodit|gold|silver|oil|global|index|indices|sector", ["get_market_overview"]),
    (r"roe|roce|margin|opm|profit|sales|revenue|growth|financial|fundamental", ["get_financials"]),
    (r"consensus|analyst|rating|target\s*price", ["rank_stocks", "get_stock_snapshot"]),
    (r"best|top|strongest|screen|opportunit", ["screen_best_stocks"]),
    (r"fresh|updated|last\s*scrape|how\s*current", ["get_data_freshness"]),
]


def _suggest_tools(user_msg):
    msg = user_msg or ""
    for pattern, tools in _TOOL_HINTS:
        if re.search(pattern, msg, re.IGNORECASE):
            return tools
    return ["get_stock_snapshot", "find_stocks"]


def _preresolve_symbols(conn, user_msg, limit=3):
    """Best-effort exact/near matches for company names in the question."""
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z0-9&\.\-]{1,}", user_msg or "")
             if w.upper() not in _STOPWORDS and len(w) >= 3]
    if not words:
        return []

    # Try the longest phrases first so "tata motors" beats "tata".
    candidates = []
    for size in (3, 2, 1):
        for i in range(len(words) - size + 1):
            candidates.append(" ".join(words[i:i + size]))

    seen, hits = set(), []
    for cand in candidates:
        if len(hits) >= limit:
            break
        for row in _rows(conn, """
            SELECT symbol, stock_name FROM nifty_750
            WHERE UPPER(symbol) = UPPER(%s) OR stock_name ILIKE %s
            ORDER BY CASE WHEN UPPER(symbol) = UPPER(%s) THEN 0 ELSE 1 END, LENGTH(stock_name)
            LIMIT 2;
        """, (cand, f"{cand}%", cand)):
            if row["symbol"] not in seen:
                seen.add(row["symbol"])
                hits.append(row)
    return hits[:limit]


# ---------------------------------------------------------------------------
# Agent loop
# ---------------------------------------------------------------------------

def _normalise_history(history):
    """Turn the frontend's message list into chat turns."""
    turns = []
    for item in (history or [])[-(MAX_HISTORY_TURNS * 2):]:
        if not isinstance(item, dict):
            continue
        role = "assistant" if item.get("sender") == "ai" or item.get("role") == "assistant" else "user"
        text = (item.get("text") or item.get("content") or "").strip()
        if not text:
            continue
        if turns and turns[-1]["role"] == role:      # merge consecutive same-role turns
            turns[-1]["content"] += "\n\n" + text
        else:
            turns.append({"role": role, "content": text})
    while turns and turns[0]["role"] != "user":       # history must start on a user turn
        turns.pop(0)
    return turns


def _execute_tool(conn, name, args):
    impl = TOOL_IMPLS.get(name)
    if impl is None:
        return {"error": f"Unknown tool '{name}'. Available: {sorted(TOOL_IMPLS)}"}
    if not isinstance(args, dict):
        args = {}
    # Models sometimes emit stringified JSON args, or extra keys the tool doesn't take.
    allowed = impl.__code__.co_varnames[1:impl.__code__.co_argcount]
    args = {k: v for k, v in args.items() if k in allowed}
    try:
        return impl(conn, **args)
    except Exception as exc:            # surface it so the model can retry differently
        conn.rollback()
        return {"error": f"{type(exc).__name__}: {exc}"}


def _tool_result_text(payload):
    text = json.dumps(payload, default=str, separators=(",", ":"))
    if len(text) > MAX_TOOL_RESULT_CHARS:
        text = text[:MAX_TOOL_RESULT_CHARS] + '..."TRUNCATED":true}'
    return text


def _parse_tool_calls(message):
    """Normalise Ollama's tool_calls across client versions (dict or object)."""
    raw = message.get("tool_calls") if isinstance(message, dict) else getattr(message, "tool_calls", None)
    calls = []
    for call in raw or []:
        fn = call.get("function") if isinstance(call, dict) else getattr(call, "function", None)
        if fn is None:
            continue
        name = fn.get("name") if isinstance(fn, dict) else getattr(fn, "name", None)
        args = fn.get("arguments") if isinstance(fn, dict) else getattr(fn, "arguments", None)
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (ValueError, TypeError):
                args = {}
        calls.append({"name": name, "args": args or {}})
    return calls


def _message_content(message):
    value = message.get("content") if isinstance(message, dict) else getattr(message, "content", "")
    return (value or "").strip()


def run_agent(user_message, history, get_conn):
    """Run one conversational turn. Returns a dict ready to jsonify."""
    model = resolve_model()
    if model is None:
        raise AgentUnavailable(f"No Ollama model available at {OLLAMA_HOST}.")

    client = _client()
    conn = get_conn()
    tools_used, last_symbol = [], None

    try:
        system = SYSTEM_PROMPT + "\n" + DOMAIN_BRIEF
        hints = _preresolve_symbols(conn, user_message)
        if hints:
            listed = "; ".join(f"{h['stock_name']} = {h['symbol']}" for h in hints)
            system += (f"\n\nRESOLVED FOR THIS QUESTION: the company names in the user's message "
                       f"map to these exact symbols — {listed}. Use them directly; no need to call "
                       f"find_stocks for these.")
            last_symbol = hints[0]["symbol"]

        turns = _normalise_history(history)
        if turns and turns[-1]["role"] == "user":     # history ended mid-turn — merge in
            turns[-1]["content"] += "\n\n" + user_message
        else:
            turns.append({"role": "user", "content": user_message})

        messages = [{"role": "system", "content": system}] + turns

        # Pre-run the universe screen when the question calls for it. Injecting the real
        # result as a tool message means the model cannot answer from the previous turn's
        # stocks even if it declines to call the tool itself.
        if _detect_screen_intent(user_message):
            # "check all criteria" asks for the strict screen with progressive relaxation;
            # a plain "best stocks" just wants the composite ranking.
            strict = bool(_ALL_CRITERIA.search(user_message or ""))
            payload = t_screen_best_stocks(conn, limit=5, require_all=strict)
            tools_used.append("screen_best_stocks")
            messages.append({
                "role": "tool",
                "tool_name": "screen_best_stocks",
                "content": _tool_result_text(payload),
            })
            messages.append({
                "role": "system",
                "content": "The full 750-stock screen above was just run for this question. "
                           "Answer from it and nothing else — ignore any stocks mentioned "
                           "earlier in the conversation.",
            })

        nudged = False
        for _ in range(MAX_TOOL_ROUNDS):
            response = client.chat(
                model=model,
                messages=messages,
                tools=TOOLS,
                options={"temperature": TEMPERATURE, "num_ctx": NUM_CTX},
                keep_alive=KEEP_ALIVE,
            )
            message = response.get("message") if isinstance(response, dict) else response.message
            calls = _parse_tool_calls(message)

            if not calls:
                # A factual question answered with no tool call anywhere in the turn means
                # the model is writing from memory or from an earlier reply. Push back once.
                if not tools_used and not nudged and _needs_data(user_message):
                    nudged = True
                    suggested = _suggest_tools(user_message)
                    messages.append({
                        "role": "system",
                        "content": "You answered without looking anything up, and you have no "
                                   "market knowledge of your own. Call "
                                   + (f"{suggested[0]} now" if len(suggested) == 1
                                      else "one of these now: " + ", ".join(suggested))
                                   + ", then answer only from what it returns.",
                    })
                    continue

                text = _message_content(message)
                return {
                    "response": text or "I couldn't put an answer together for that. Try rephrasing?",
                    "stockSymbol": last_symbol,
                    "toolsUsed": tools_used,
                    "model": model,
                }

            # Echo the assistant turn back as plain dicts — the client accepts pydantic
            # objects too, but plain dicts keep the transcript uniform and picklable.
            messages.append({
                "role": "assistant",
                "content": _message_content(message),
                "tool_calls": [
                    {"function": {"name": c["name"], "arguments": c["args"]}} for c in calls
                ],
            })

            for call in calls:
                tools_used.append(call["name"])
                if call["args"].get("symbol"):
                    last_symbol = str(call["args"]["symbol"]).strip().upper()
                payload = _execute_tool(conn, call["name"], call["args"])
                messages.append({
                    "role": "tool",
                    "tool_name": call["name"],
                    "content": _tool_result_text(payload),
                })

        return {
            "response": "That needed more lookups than I can do in one go. Could you narrow it "
                        "down — a single stock, or one metric at a time?",
            "stockSymbol": last_symbol,
            "toolsUsed": tools_used,
            "model": model,
        }
    finally:
        try:
            conn.close()
        except Exception:
            pass
