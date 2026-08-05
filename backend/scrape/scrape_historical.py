"""
Historical Price Data Scraper — 1 Year OHLCV
Fetches daily OHLCV (Open, High, Low, Close, Volume) data for all stocks 
in the nifty_750 table using yfinance (NSE tickers).

Saves to PostgreSQL table: trading_db.stock_history
  - Symbol references nifty_750(symbol).
  - Truncates stock_history table and resets ID sequence to 1 on every run.

Usage:
    python scrape_historical.py
    python scrape_historical.py --ticker RELIANCE
    python scrape_historical.py --ticker RELIANCE --period 2y
    python scrape_historical.py --workers 5

Install deps:
    pip install yfinance psycopg2-binary
"""

import os
import time
import argparse
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
from psycopg2.extras import execute_values

# ---------------------------------------------------------------------------
# Try importing yfinance
# ---------------------------------------------------------------------------
try:
    import yfinance as yf
except ImportError:
    print("[error] yfinance not installed. Run: pip install yfinance")
    raise


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEFAULT_PERIOD  = "1y"   # yfinance period string: 1d, 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, 10y, ytd, max
DEFAULT_WORKERS = 4      # parallel workers for batch fetching

# NSE tickers in yfinance require a ".NS" suffix (e.g. "RELIANCE.NS")
EXCHANGE_SUFFIX = ".NS"

# ---------------------------------------------------------------------------
# PostgreSQL config
# ---------------------------------------------------------------------------
DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS stock_history (
    id                SERIAL PRIMARY KEY,
    symbol            VARCHAR(50)   NOT NULL,
    trade_date        DATE          NOT NULL,
    open              NUMERIC(14,4),
    high              NUMERIC(14,4),
    low               NUMERIC(14,4),
    close             NUMERIC(14,4),
    volume            BIGINT,
    scraped_at        TIMESTAMP     DEFAULT NOW(),
    UNIQUE (symbol, trade_date)
);
"""

ALTER_TABLE_SQL = """
DO $$
BEGIN
    -- Ensure symbol column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='stock_history' AND column_name='symbol'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='stock_history' AND column_name='stock_name'
        ) THEN
            ALTER TABLE stock_history RENAME COLUMN stock_name TO symbol;
        ELSE
            ALTER TABLE stock_history ADD COLUMN symbol VARCHAR(50);
        END IF;
    END IF;

    -- Drop stock_name if still exists alongside symbol
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='stock_history' AND column_name='stock_name'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='stock_history' AND column_name='symbol'
    ) THEN
        ALTER TABLE stock_history DROP COLUMN stock_name;
    END IF;

    -- Drop exact_stock_name column if exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='stock_history' AND column_name='exact_stock_name'
    ) THEN
        ALTER TABLE stock_history DROP COLUMN exact_stock_name;
    END IF;

    -- Drop old unique constraint if exists
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_history_stock_name_trade_date_key'
    ) THEN
        ALTER TABLE stock_history DROP CONSTRAINT stock_history_stock_name_trade_date_key;
    END IF;

    -- Add new unique constraint on (symbol, trade_date)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'stock_history_symbol_trade_date_key'
    ) THEN
        ALTER TABLE stock_history ADD CONSTRAINT stock_history_symbol_trade_date_key UNIQUE (symbol, trade_date);
    END IF;
END$$;
"""

CREATE_INDEX_SQL = """
CREATE INDEX IF NOT EXISTS idx_stock_history_symbol_date
    ON stock_history (symbol, trade_date DESC);
"""


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------
def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)


def ensure_table(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        cur.execute(ALTER_TABLE_SQL)
        cur.execute(CREATE_INDEX_SQL)
    conn.commit()
    print("[db] Table 'stock_history' ready.")
    sync_db_with_nifty_750()


def sync_db_with_nifty_750():
    """
    Removes records from 'stock_history' for any stocks no longer in nifty_750.
    """
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM stock_history
                WHERE symbol IS NOT NULL
                  AND symbol != ''
                  AND UPPER(symbol) NOT IN (
                      SELECT UPPER(symbol) FROM nifty_750 WHERE symbol IS NOT NULL AND symbol != ''
                  );
            """)
            deleted_cnt = cur.rowcount
        conn.commit()
        conn.close()
        if deleted_cnt > 0:
            print(f"[db] Synced stock_history with nifty_750: Removed {deleted_cnt} obsolete historical record(s).")
    except Exception as e:
        print(f"[db] Error syncing stock_history with nifty_750: {e}")


def truncate_stock_history(conn=None):
    """
    Truncates table 'stock_history' and resets auto-increment id sequence to 1.
    """
    close_at_end = False
    if conn is None:
        conn = get_db_conn()
        close_at_end = True

    with conn.cursor() as cur:
        print("[db] Truncating table 'stock_history' (resetting ID sequence to 1)...")
        cur.execute("TRUNCATE TABLE stock_history RESTART IDENTITY;")
    conn.commit()

    if close_at_end:
        conn.close()


def upsert_rows(conn, rows: list) -> int:
    """
    Insert rows into stock_history table.
    rows: list of (symbol, trade_date, open, high, low, close, volume)
    """
    if not rows:
        return 0

    sql = """
        INSERT INTO stock_history (symbol, trade_date, open, high, low, close, volume)
        VALUES %s
        ON CONFLICT (symbol, trade_date)
        DO UPDATE SET
            open       = EXCLUDED.open,
            high       = EXCLUDED.high,
            low        = EXCLUDED.low,
            close      = EXCLUDED.close,
            volume     = EXCLUDED.volume,
            scraped_at = NOW();
    """
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    return len(rows)


# ---------------------------------------------------------------------------
# Fetch stock tickers from nifty_750
# ---------------------------------------------------------------------------
def fetch_tickers_from_db() -> list:
    """
    Returns list of (symbol, yfinance_ticker) tuples from nifty_750 table.
    symbol is the ticker (e.g. 'RELIANCE').
    yfinance_ticker appends the NSE suffix (e.g. 'RELIANCE.NS').
    """
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(symbol, ''), stock_link FROM nifty_750 WHERE (symbol IS NOT NULL AND symbol != '') OR stock_link IS NOT NULL;")
            rows = cur.fetchall()
        conn.close()
    except Exception as e:
        print(f"[db] ERROR fetching nifty_750: {e}")
        return []

    tickers = []
    seen = set()
    for sym, link in rows:
        sym = (sym or "").strip().upper()
        if not sym and link:
            link = link.strip().rstrip("/")
            parts = [p for p in link.split("/") if p]
            try:
                idx = parts.index("company")
                sym = parts[idx + 1].upper()
            except (ValueError, IndexError):
                sym = parts[-1].upper() if parts else ""
        if sym and sym not in seen:
            seen.add(sym)
            tickers.append((sym, sym + EXCHANGE_SUFFIX))

    print(f"[db] {len(tickers)} tickers loaded from nifty_750.")
    return tickers


# ---------------------------------------------------------------------------
# Fetch historical data for a single ticker via yfinance
# ---------------------------------------------------------------------------
def fetch_history(symbol: str, yf_ticker: str, period: str) -> list:
    """
    Downloads OHLCV data for `yf_ticker` for the given period.
    Returns list of (symbol, date, open, high, low, close, volume).
    """
    try:
        ticker_obj = yf.Ticker(yf_ticker)
        df = ticker_obj.history(period=period, auto_adjust=True, actions=False)

        if df is None or df.empty:
            print(f"  [warn] No data returned for {yf_ticker}")
            return []

        rows = []
        for trade_date, row in df.iterrows():
            d = trade_date.date() if hasattr(trade_date, "date") else trade_date

            rows.append((
                symbol,
                d,
                round(float(row["Open"]),  4) if row["Open"]   == row["Open"] else None,
                round(float(row["High"]),  4) if row["High"]   == row["High"] else None,
                round(float(row["Low"]),   4) if row["Low"]    == row["Low"]  else None,
                round(float(row["Close"]), 4) if row["Close"]  == row["Close"] else None,
                int(row["Volume"])            if row["Volume"] == row["Volume"] else None,
            ))

        print(f"  [ok] {symbol}: {len(rows)} trading days fetched")
        return rows

    except Exception as e:
        print(f"  [error] {symbol} ({yf_ticker}): {e}")
        return []


# ---------------------------------------------------------------------------
# Batch fetch with optional parallelism
# ---------------------------------------------------------------------------
def scrape_batch(tickers: list, period: str, workers: int) -> dict:
    """
    Fetches history for all tickers.
    Returns dict: {symbol: [rows]}
    """
    results = {}

    if workers <= 1:
        for symbol, yf_ticker in tickers:
            results[symbol] = fetch_history(symbol, yf_ticker, period)
            time.sleep(0.3)
    else:
        def _fetch(args):
            return args[0], fetch_history(args[0], args[1], period)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_fetch, t): t for t in tickers}
            for future in as_completed(futures):
                symbol, rows = future.result()
                results[symbol] = rows

    return results


# ---------------------------------------------------------------------------
# Main Execution Entrypoint
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Fetch historical OHLCV data for Nifty 750 stocks"
    )
    parser.add_argument(
        "--ticker",
        default=None,
        help="Single NSE ticker to fetch (e.g. RELIANCE). Skips nifty_750 batch."
    )
    parser.add_argument(
        "--company",
        default=None,
        help="Single NSE ticker to fetch (e.g. RELIANCE). Alias for --ticker."
    )
    parser.add_argument(
        "--period",
        default=DEFAULT_PERIOD,
        help="yfinance period string: 1y, 2y, 5y, ytd, max ... (default: 1y)"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Parallel worker threads for batch mode (default: 4)"
    )
    args = parser.parse_args()
    target_ticker = args.ticker or args.company

    # -- Connect and ensure table --------------------------------------------
    conn = get_db_conn()
    ensure_table(conn)

    # -- Single-ticker mode --------------------------------------------------
    if target_ticker:
        symbol    = target_ticker.upper()
        yf_ticker = symbol + EXCHANGE_SUFFIX
        print(f"\n[single] Fetching {args.period} history for {yf_ticker} ...")
        rows = fetch_history(symbol, yf_ticker, args.period)
        inserted = upsert_rows(conn, rows)
        print(f"[db] {inserted} row(s) upserted for {symbol}.")
        conn.close()
        print("\nDone.")
        return

    truncate_stock_history(conn)

    # -- Batch mode: all stocks from nifty_750 --------------------------------
    tickers = fetch_tickers_from_db()
    if not tickers:
        print("[error] No tickers found in nifty_750. Exiting.")
        conn.close()
        return

    total = len(tickers)
    print(f"\n[batch] Fetching {args.period} history for {total} stocks "
          f"with {args.workers} worker(s) ...\n")

    results      = scrape_batch(tickers, args.period, args.workers)
    grand_total  = 0
    failed       = []

    for symbol, rows in results.items():
        if not rows:
            failed.append(symbol)
            continue
        try:
            inserted = upsert_rows(conn, rows)
            grand_total += inserted
        except Exception as e:
            print(f"[db] ERROR inserting {symbol}: {e}")
            conn.rollback()
            failed.append(symbol)

    conn.close()

    print(f"\n{'='*60}")
    print(f"  Batch complete  [{datetime.now().strftime('%Y-%m-%d %H:%M')}]")
    print(f"  Stocks fetched : {total - len(failed)}/{total}")
    print(f"  Failed         : {len(failed)} -- {failed if failed else 'none'}")
    print(f"  DB rows saved  : {grand_total} upserted into stock_history")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
