"""DMA crossover analysis — the single source of truth for the Trends tab and Tara AI.

Both the /api/trends endpoint and the chat agent's get_crossovers tool call into here,
so the numbers a user reads in the table and the numbers the assistant quotes can never
drift apart.

The three tiers, all measured against the 200 DMA:

    Lite    dma20  > dma200
    Golden  dma50  > dma200  AND dma20 > dma200
    Pro     dma100 > dma200  AND dma20 > dma200 AND dma50 > dma200

For each tier and stock we walk the full price history, group consecutive in-crossover
days into events, and report:

    isActive        currently in crossover
    activeDays      length of the ongoing event (0 if not active)
    crossoverCount  how many such events have ever occurred ("2x" in the UI)
    prob            % of past events that ended higher than they started
    avgGainPct      mean peak gain across events
"""

import time
from collections import defaultdict

# Tier name -> (fast DMA key, require dma20 > dma200, require dma50 > dma200)
TIERS = {
    "lite":   ("dma20", False, False),
    "golden": ("dma50", True, False),
    "pro":    ("dma100", True, True),
}

# The computation scans ~185k history rows and takes a couple of seconds, so it is cached.
# Rather than trusting a TTL, the cache is keyed on the newest scraped_at in stock_history:
# a ~16ms probe per request means the 5am scrape batch invalidates it on the very next
# question, with no window where the chat and the database disagree. The TTL is only a
# backstop for the case where a scraper writes rows without advancing scraped_at.
CACHE_TTL_SECONDS = 900
_cache = {"at": 0.0, "data": None, "stamp": None}


def data_stamp(conn):
    """Newest scrape timestamp in stock_history — the cache key. None if unavailable."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT MAX(scraped_at) FROM stock_history;")
            return cur.fetchone()[0]
    except Exception:
        return None


def calc_crossover_stats(rows, dma_key, req_dma20=False, req_dma50=False):
    """Crossover statistics for one symbol's history against one tier."""
    if not rows:
        return {"text": "No", "crossoverCount": 0, "prob": 0.0,
                "avgGainPct": 0.0, "isActive": False, "activeDays": 0}

    events = []
    current_event = None

    for idx, r in enumerate(rows):
        fast_dma = r.get(dma_key)
        slow_dma = r.get("dma200")
        dma20 = r.get("dma20")
        dma50 = r.get("dma50")
        close = r.get("close", 0.0)

        if fast_dma is None or slow_dma is None:
            continue

        dma20_ok = (not req_dma20) or (dma20 is not None and dma20 > slow_dma)
        dma50_ok = (not req_dma50) or (dma50 is not None and dma50 > slow_dma)
        is_cross = (fast_dma > slow_dma) and dma20_ok and dma50_ok

        prev_fast = rows[idx - 1].get(dma_key) if idx > 0 else None
        prev_slow = rows[idx - 1].get("dma200") if idx > 0 else None
        prev_dma20 = rows[idx - 1].get("dma20") if idx > 0 else None
        prev_dma50 = rows[idx - 1].get("dma50") if idx > 0 else None

        prev_dma20_ok = (not req_dma20) or (
            prev_dma20 is not None and prev_slow is not None and prev_dma20 > prev_slow)
        prev_dma50_ok = (not req_dma50) or (
            prev_dma50 is not None and prev_slow is not None and prev_dma50 > prev_slow)
        prev_cross = (prev_fast is not None and prev_slow is not None
                      and prev_fast > prev_slow) and prev_dma20_ok and prev_dma50_ok

        if is_cross and not prev_cross:
            if current_event:
                events.append(current_event)
            current_event = {"start_date": r["date"], "start_price": close,
                             "max_price": close, "days": 1}
        elif is_cross and current_event:
            current_event["max_price"] = max(current_event["max_price"], close)
            current_event["days"] += 1
        elif not is_cross and current_event:
            events.append(current_event)
            current_event = None

    if current_event:
        events.append(current_event)

    latest = rows[-1]
    latest_fast, latest_slow = latest.get(dma_key), latest.get("dma200")
    d20_act = (not req_dma20) or (
        latest.get("dma20") is not None and latest_slow is not None and latest["dma20"] > latest_slow)
    d50_act = (not req_dma50) or (
        latest.get("dma50") is not None and latest_slow is not None and latest["dma50"] > latest_slow)
    is_active = (latest_fast is not None and latest_slow is not None
                 and latest_fast > latest_slow) and d20_act and d50_act

    active_days = events[-1]["days"] if (events and is_active) else 0
    status_text = "No"
    if is_active:
        status_text = f"Yes {active_days} day" if active_days == 1 else f"Yes {active_days} days"

    if not events:
        return {"text": "No", "crossoverCount": 0, "prob": 0.0,
                "avgGainPct": 0.0, "isActive": is_active, "activeDays": active_days}

    successes, total_gain = 0, 0.0
    for ev in events:
        pct = (((ev["max_price"] - ev["start_price"]) / ev["start_price"]) * 100.0
               if ev["start_price"] > 0 else 0.0)
        if pct > 0:
            successes += 1
        total_gain += pct

    count = len(events)
    return {
        "text": status_text,
        "crossoverCount": count,
        "prob": round((successes / count) * 100.0, 1),
        "avgGainPct": round(total_gain / count, 1),
        "isActive": is_active,
        "activeDays": active_days,
    }


def calc_breakout_stats(history):
    """2-year high/low breakout, measured against a base window that excludes the last
    ~3 months so a fresh push above the base reads as a genuine breakout."""
    empty = {"highBreakout": "—", "highPct": -1.0, "highBase": 0.0,
             "lowBreakout": "—", "lowPct": -1.0, "lowBase": 0.0}
    if not history or len(history) < 63:
        return dict(empty)

    total_pts = len(history)
    current_price = history[-1]["close"]
    base_window = history[max(0, total_pts - 504):max(0, total_pts - 63)]  # 2y back to 3m ago
    if not base_window:
        return dict(empty)

    high_base = max(r["close"] for r in base_window)
    low_base = min(r["close"] for r in base_window)

    is_high_breakout = current_price >= high_base
    high_diff_pct = round(((current_price - high_base) / high_base) * 100.0, 1) if high_base > 0 else 0.0
    low_diff_pct = round(((high_base - current_price) / high_base) * 100.0, 1) if high_base > 0 else 0.0

    return {
        "highBreakout": f"Yes +{high_diff_pct}%" if is_high_breakout else "—",
        "highPct": high_diff_pct if is_high_breakout else -1.0,
        "highBase": round(high_base, 2),
        "lowBreakout": f"Yes -{low_diff_pct}%" if not is_high_breakout else "—",
        "lowPct": low_diff_pct if not is_high_breakout else -1.0,
        "lowBase": round(low_base, 2),
        # Signed distance from the base high — the screener's continuous breakout signal.
        "pctFromBaseHigh": round(((current_price - high_base) / high_base) * 100.0, 2) if high_base > 0 else 0.0,
        "lastClose": round(current_price, 2),
    }


def calc_momentum_stats(history):
    """Headroom to the 2-year base high, plus trailing returns.

    "Momentum" here means capacity to rise, not distance already travelled. A stock
    trading 12% under its base high has a defined 12% runway to reclaim that level;
    one already 95% above it has no defined target left and is, if anything, extended.
    So the signal of interest is the GAP BELOW the base high, narrow enough to be
    reachable but wide enough to be worth taking.
    """
    empty = {"gapToHighPct": None, "ret20d": None, "ret60d": None, "ret120d": None,
             "aboveDma20": None, "aboveDma50": None, "baseHigh": None, "lastClose": None}
    if not history or len(history) < 63:
        return dict(empty)

    total = len(history)
    last = history[-1]["close"]
    base_window = history[max(0, total - 504):max(0, total - 63)]
    if not base_window or last <= 0:
        return dict(empty)

    base_high = max(r["close"] for r in base_window)
    if base_high <= 0:
        return dict(empty)

    def ret(days):
        if total <= days:
            return None
        prev = history[-1 - days]["close"]
        return round((last - prev) / prev * 100.0, 2) if prev > 0 else None

    return {
        # Positive = trading BELOW the base high by this much, i.e. the runway.
        # Negative = already above it.
        "gapToHighPct": round((base_high - last) / base_high * 100.0, 2),
        "ret20d": ret(20), "ret60d": ret(60), "ret120d": ret(120),
        "aboveDma20": (history[-1].get("dma20") is not None and last > history[-1]["dma20"]),
        "aboveDma50": (history[-1].get("dma50") is not None and last > history[-1]["dma50"]),
        "baseHigh": round(base_high, 2),
        "lastClose": round(last, 2),
    }


def load_symbol_history(conn):
    """Every symbol's close plus its 20/50/100/200 DMA series, oldest first."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT symbol, trade_date, close,
                AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN  19 PRECEDING AND CURRENT ROW) AS dma20,
                AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN  49 PRECEDING AND CURRENT ROW) AS dma50,
                AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN  99 PRECEDING AND CURRENT ROW) AS dma100,
                AVG(close) OVER (PARTITION BY symbol ORDER BY trade_date ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS dma200
            FROM stock_history
            WHERE close IS NOT NULL   -- a missing close is not a price of zero; treating it
            ORDER BY symbol, trade_date ASC;  -- as one made 406 stocks look like -100% crashes
        """)
        rows = cur.fetchall()

    history = defaultdict(list)
    for sym, t_date, close, dma20, dma50, dma100, dma200 in rows:
        if close is None:          # belt and braces — the query already filters these out
            continue
        history[sym].append({
            "date": t_date,
            "close": float(close),
            "dma20": float(dma20) if dma20 is not None else None,
            "dma50": float(dma50) if dma50 is not None else None,
            "dma100": float(dma100) if dma100 is not None else None,
            "dma200": float(dma200) if dma200 is not None else None,
        })
    return history


def load_stock_meta(conn):
    """Symbol -> (stock_name, market_cap, price), preferring nifty_750 values."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH symbols_list AS (SELECT DISTINCT UPPER(symbol) AS symbol FROM stock_history)
            SELECT s.symbol,
                   COALESCE(n.stock_name, s.symbol) AS stock_name,
                   COALESCE(NULLIF(n.market_cap, ''), sh.market_cap, '') AS market_cap,
                   COALESCE(NULLIF(n.price, ''), t.price, '') AS price
            FROM symbols_list s
            LEFT JOIN nifty_750 n ON s.symbol = UPPER(n.symbol)
            LEFT JOIN (
                SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) AS symbol, market_cap
                FROM shareholding_pattern ORDER BY UPPER(symbol), id DESC
            ) sh ON s.symbol = sh.symbol
            LEFT JOIN (
                SELECT DISTINCT ON (UPPER(symbol)) UPPER(symbol) AS symbol, price
                FROM trades WHERE price IS NOT NULL AND price != ''
                ORDER BY UPPER(symbol), id DESC
            ) t ON s.symbol = t.symbol
            ORDER BY COALESCE(n.stock_name, s.symbol) ASC;
        """)
        return cur.fetchall()


def compute_all(conn, use_cache=True):
    """All three crossover tiers for every symbol.

    Served from cache only while the newest scrape timestamp is unchanged, so a scraper
    run makes the next question recompute automatically.
    """
    stamp = data_stamp(conn)
    if (use_cache and _cache["data"] is not None
            and _cache["stamp"] == stamp
            and (time.time() - _cache["at"]) < CACHE_TTL_SECONDS):
        return _cache["data"]

    history = load_symbol_history(conn)
    results = []
    for idx, (symbol, stock_name, market_cap, price) in enumerate(load_stock_meta(conn)):
        rows = history.get(symbol, [])
        results.append({
            "id": idx + 1,
            "ticker": symbol,
            "stockName": stock_name or symbol,
            "marketCapRaw": market_cap,
            "priceRaw": price,
            "lite": calc_crossover_stats(rows, "dma20"),
            "golden": calc_crossover_stats(rows, "dma50", req_dma20=True),
            "pro": calc_crossover_stats(rows, "dma100", req_dma20=True, req_dma50=True),
            "breakout": calc_breakout_stats(rows),
            "momentum": calc_momentum_stats(rows),
        })

    _cache["at"], _cache["data"], _cache["stamp"] = time.time(), results, stamp
    return results


def invalidate_cache():
    _cache["at"], _cache["data"], _cache["stamp"] = 0.0, None, None
