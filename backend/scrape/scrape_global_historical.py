"""
Global Indices Historical Data Scraper — 1 Year OHLCV
Fetches daily OHLCV data for global market indices using yfinance.

Saves to PostgreSQL table: trading_db.global_index_history

Usage:
    python scrape_global_historical.py
    python scrape_global_historical.py --ticker ^GSPC
"""

import os
import time
import argparse
from datetime import datetime, date
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
from psycopg2.extras import execute_values

try:
    import yfinance as yf
except ImportError:
    print("[error] yfinance not installed. Run: pip install yfinance")
    raise

DEFAULT_PERIOD  = "5y"
DEFAULT_WORKERS = 4

DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

GLOBAL_INDICES = [
    # US
    {"ticker": "^GSPC", "name": "S&P 500", "region": "US"},
    {"ticker": "^IXIC", "name": "NASDAQ", "region": "US"},
    
    # European
    {"ticker": "^FTSE", "name": "FTSE 100", "region": "European"},
    
    # Asian & Japan
    {"ticker": "^N225", "name": "Nikkei 225", "region": "Japan"},
    {"ticker": "^HSI", "name": "Hang Seng", "region": "Asian"},
    {"ticker": "000001.SS", "name": "Shanghai Composite", "region": "Asian"},
    {"ticker": "KOSPI.KS", "name": "KOSPI", "region": "Asian"},
    {"ticker": "^TWII", "name": "Taiwan", "region": "Asian"},
    
    # Indian
    {"ticker": "^NSEI", "name": "NIFTY 50", "region": "Indian"},
    {"ticker": "^NSEBANK", "name": "NIFTY BANK", "region": "Indian"},
    {"ticker": "NIFTY_FIN_SERVICE.NS", "name": "NIFTY FIN SERVICE", "region": "Indian"},
    {"ticker": "NIFTY_IT.NS", "name": "NIFTY IT", "region": "Indian"},
    {"ticker": "NIFTY_PHARMA.NS", "name": "NIFTY PHARMA", "region": "Indian"},
    {"ticker": "^CNXREALTY", "name": "NIFTY REALTY", "region": "Indian"},
    {"ticker": "POWENE.BO", "name": "BSE POWER", "region": "Indian"},
    {"ticker": "^CNXENERGY", "name": "NIFTY ENERGY", "region": "Indian"},
    {"ticker": "^CNXAUTO", "name": "NIFTY AUTO", "region": "Indian"},
    {"ticker": "^CNXFMCG", "name": "NIFTY FMCG", "region": "Indian"},
    {"ticker": "NIFTYMIDCAP150.NS", "name": "NIFTY MIDCAP 150", "region": "Indian"},
    {"ticker": "NIFTYSMLCAP250.NS", "name": "NIFTY SMLCAP 250", "region": "Indian"},
    {"ticker": "^NSMIDCP", "name": "NIFTY NEXT 50", "region": "Indian"},
    
]

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)

def upsert_rows(conn, rows: list) -> int:
    if not rows:
        return 0

    sql = """
        INSERT INTO global_index_history (index_name, exact_index_name, region, trade_date, open, high, low, close, volume)
        VALUES %s
        ON CONFLICT (index_name, trade_date)
        DO UPDATE SET
            exact_index_name = EXCLUDED.exact_index_name,
            region     = EXCLUDED.region,
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

def fetch_history(index_info: dict, period: str) -> list:
    yf_ticker = index_info["ticker"]
    index_name = index_info["name"]
    region = index_info["region"]
    
    try:
        ticker_obj = yf.Ticker(yf_ticker)
        df = ticker_obj.history(period=period, auto_adjust=True, actions=False)

        if df is None or df.empty:
            print(f"  [warn] No data returned for {yf_ticker}")
            return []

        try:
            exact_name = ticker_obj.info.get("longName") or ticker_obj.info.get("shortName") or yf_ticker
        except Exception:
            exact_name = yf_ticker

        rows = []
        for trade_date, row in df.iterrows():
            d = trade_date.date() if hasattr(trade_date, "date") else trade_date

            rows.append((
                index_name,
                exact_name,
                region,
                d,
                round(float(row["Open"]),  4) if row["Open"]   == row["Open"] else None,
                round(float(row["High"]),  4) if row["High"]   == row["High"] else None,
                round(float(row["Low"]),   4) if row["Low"]    == row["Low"]  else None,
                round(float(row["Close"]), 4) if row["Close"]  == row["Close"] else None,
                int(row["Volume"])            if row["Volume"] == row["Volume"] else None,
            ))

        print(f"  [ok] {index_name}: {len(rows)} trading days fetched")
        return rows

    except Exception as e:
        print(f"  [error] {index_name} ({yf_ticker}): {e}")
        return []

def scrape_batch(indices: list, period: str, workers: int) -> dict:
    results = {}

    if workers <= 1:
        for idx_info in indices:
            results[idx_info["ticker"]] = fetch_history(idx_info, period)
            time.sleep(0.3)
    else:
        def _fetch(args):
            return args["ticker"], fetch_history(args, period)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_fetch, t): t for t in indices}
            for future in as_completed(futures):
                ticker, rows = future.result()
                results[ticker] = rows

    return results

def main():
    parser = argparse.ArgumentParser(
        description="Fetch historical OHLCV data for Global Indices"
    )
    parser.add_argument(
        "--ticker",
        default=None,
        help="Single yfinance ticker to fetch (e.g. ^GSPC). Skips full batch."
    )
    parser.add_argument(
        "--period",
        default=DEFAULT_PERIOD,
        help="yfinance period string (default: 1y)"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Parallel worker threads for batch mode (default: 4)"
    )
    args = parser.parse_args()

    conn = get_db_conn()

    if args.ticker:
        yf_ticker = args.ticker.upper()
        # Find if it matches our list
        index_info = next((i for i in GLOBAL_INDICES if i["ticker"].upper() == yf_ticker), None)
        if not index_info:
            index_info = {"ticker": yf_ticker, "name": yf_ticker, "region": "Unknown"}
            
        print(f"\n[single] Fetching {args.period} history for {yf_ticker} ...")
        rows = fetch_history(index_info, args.period)
        inserted = upsert_rows(conn, rows)
        print(f"[db] {inserted} row(s) upserted for {index_info['name']}.")
        conn.close()
        print("\nDone.")
        return

    total = len(GLOBAL_INDICES)
    print(f"\n[batch] Fetching {args.period} history for {total} indices with {args.workers} worker(s) ...\n")

    results      = scrape_batch(GLOBAL_INDICES, args.period, args.workers)
    grand_total  = 0
    failed       = []

    for idx_info in GLOBAL_INDICES:
        ticker = idx_info["ticker"]
        rows = results.get(ticker, [])
        if not rows:
            failed.append(idx_info["name"])
            continue
        try:
            inserted = upsert_rows(conn, rows)
            grand_total += inserted
        except Exception as e:
            print(f"[db] ERROR inserting {idx_info['name']}: {e}")
            conn.rollback()
            failed.append(idx_info["name"])

    conn.close()

    print(f"\n{'='*60}")
    print(f"  Batch complete  [{datetime.now().strftime('%Y-%m-%d %H:%M')}]")
    print(f"  Indices fetched: {total - len(failed)}/{total}")
    print(f"  Failed         : {len(failed)} -- {failed if failed else 'none'}")
    print(f"  DB rows saved  : {grand_total} upserted into global_index_history")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
