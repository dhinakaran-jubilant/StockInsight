"""
Commodities Historical Data Scraper — yfinance & Business Insider
Fetches daily OHLCV historical data for major commodities.

Commodities Tracked:
  - Gold (GC=F) [yfinance]
  - Silver (SI=F) [yfinance]
  - Copper (HG=F) [yfinance]
  - Platinum (PL=F) [yfinance]
  - Crude Oil (CL=F) [yfinance]
  - Brent (BZ=F) [yfinance]
  - Natural Gas (NG=F) [yfinance]
  - Gasoline (RB=F) [yfinance]
  - Heating Oil (HO=F) [yfinance]
  - Coal (COAL) [markets.businessinsider.com]

Saves to PostgreSQL table: trading_db.commodity_history

Usage:
    python scrape_commodities.py
    python scrape_commodities.py --symbol COAL
    python scrape_commodities.py --period 3y
"""

import os
import time
import argparse
from datetime import datetime, date, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

import psycopg2
from psycopg2.extras import execute_values
import requests

try:
    import yfinance as yf
except ImportError:
    print("[error] yfinance is not installed. Please run: pip install yfinance")
    raise

DEFAULT_PERIOD  = "3y"
DEFAULT_WORKERS = 4

DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

COMMODITIES = [
    {"name": "Gold",        "symbol": "GC=F", "category": "Precious Metals",   "source": "yfinance"},
    {"name": "Silver",      "symbol": "SI=F", "category": "Precious Metals",   "source": "yfinance"},
    {"name": "Copper",      "symbol": "HG=F", "category": "Industrial Metals", "source": "yfinance"},
    {"name": "Platinum",    "symbol": "PL=F", "category": "Precious Metals",   "source": "yfinance"},
    {"name": "Crude Oil",   "symbol": "CL=F", "category": "Energy",            "source": "yfinance"},
    {"name": "Brent",       "symbol": "BZ=F", "category": "Energy",            "source": "yfinance"},
    {"name": "Natural Gas", "symbol": "NG=F", "category": "Energy",            "source": "yfinance"},
    {"name": "Gasoline",    "symbol": "RB=F", "category": "Energy",            "source": "yfinance"},
    {"name": "Heating Oil", "symbol": "HO=F", "category": "Energy",            "source": "yfinance"},
    {"name": "Coal",        "symbol": "COAL", "category": "Energy",            "source": "business_insider"},
]

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS commodity_history (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(100) NOT NULL,
    symbol       VARCHAR(50)  NOT NULL,
    category     VARCHAR(100),
    trade_date   DATE         NOT NULL,
    open         NUMERIC(14, 4),
    high         NUMERIC(14, 4),
    low          NUMERIC(14, 4),
    close        NUMERIC(14, 4),
    volume       BIGINT,
    scraped_at   TIMESTAMP DEFAULT NOW(),
    UNIQUE (symbol, trade_date)
);
"""

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)

def ensure_table():
    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
    conn.commit()
    conn.close()

def upsert_rows(conn, rows: list) -> int:
    if not rows:
        return 0

    sql = """
        INSERT INTO commodity_history
            (name, symbol, category, trade_date, open, high, low, close, volume)
        VALUES %s
        ON CONFLICT (symbol, trade_date)
        DO UPDATE SET
            name       = EXCLUDED.name,
            category   = EXCLUDED.category,
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

def fetch_coal_history_bi(comm_info: dict, period: str = "3y") -> list:
    """Fetch Coal historical daily prices from Business Insider for specified period."""
    name     = comm_info["name"]
    symbol   = comm_info["symbol"]
    category = comm_info.get("category", "Energy")

    end_dt = date.today()
    if period.endswith("y"):
        try:
            years = int(period[:-1])
        except ValueError:
            years = 3
        start_dt = end_dt - timedelta(days=365 * years)
    elif period.endswith("m") or period.endswith("mo"):
        try:
            months = int(period.rstrip("mo").rstrip("m"))
        except ValueError:
            months = 6
        start_dt = end_dt - timedelta(days=30 * months)
    else:
        start_dt = end_dt - timedelta(days=365 * 3)

    d_start = start_dt.strftime("%Y-%m-%d")
    d_end   = end_dt.strftime("%Y-%m-%d")

    url = f"https://markets.businessinsider.com/ajax/Valor_HistoricPriceList/2590857/{d_start}_{d_end}/IET"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://markets.businessinsider.com/commodities/coal-price",
    }

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            print(f"  [warn] Business Insider returned status {resp.status_code} for {name}")
            return []

        data = resp.json()
        if not data or not isinstance(data, list):
            print(f"  [warn] No valid JSON array returned for {name}")
            return []

        rows = []
        for item in data:
            raw_date = item.get("Date", "")
            if not raw_date:
                continue
            try:
                d = datetime.strptime(raw_date, "%m/%d/%y").date()
            except ValueError:
                continue

            open_val  = round(float(item["Open"]), 4)  if item.get("Open")  is not None and str(item["Open"]) != ""  else None
            close_val = round(float(item["Close"]), 4) if item.get("Close") is not None and str(item["Close"]) != "" else None
            high_val  = round(float(item["High"]), 4)  if item.get("High")  is not None and str(item["High"]) != ""  else None
            low_val   = round(float(item["Low"]), 4)   if item.get("Low")   is not None and str(item["Low"]) != ""   else None
            vol_val   = int(item["Volume"])            if item.get("Volume") and str(item["Volume"]).isdigit()       else None

            rows.append((
                name,
                symbol,
                category,
                d,
                open_val,
                high_val,
                low_val,
                close_val,
                vol_val,
            ))

        print(f"  [ok] {name:<12} ({symbol:<5}): {len(rows)} trading days fetched from Business Insider")
        return rows

    except Exception as e:
        print(f"  [error] {name} ({symbol}): {e}")
        return []

def fetch_commodity_history(comm_info: dict, period: str) -> list:
    if comm_info.get("source") == "business_insider" or comm_info["symbol"].upper() in ["COAL", "2590857"]:
        return fetch_coal_history_bi(comm_info, period)

    name     = comm_info["name"]
    symbol   = comm_info["symbol"]
    category = comm_info.get("category", "General")

    try:
        ticker_obj = yf.Ticker(symbol)
        df = ticker_obj.history(period=period, auto_adjust=True, actions=False)

        if df is None or df.empty:
            print(f"  [warn] No data returned for {name} ({symbol})")
            return []

        rows = []
        for trade_date, row in df.iterrows():
            d = trade_date.date() if hasattr(trade_date, "date") else trade_date

            open_val  = round(float(row["Open"]), 4)  if row["Open"]  == row["Open"]  else None
            high_val  = round(float(row["High"]), 4)  if row["High"]  == row["High"]  else None
            low_val   = round(float(row["Low"]), 4)   if row["Low"]   == row["Low"]   else None
            close_val = round(float(row["Close"]), 4) if row["Close"] == row["Close"] else None
            vol_val   = int(row["Volume"])            if row["Volume"] == row["Volume"] else None

            rows.append((
                name,
                symbol,
                category,
                d,
                open_val,
                high_val,
                low_val,
                close_val,
                vol_val,
            ))

        print(f"  [ok] {name:<12} ({symbol:<5}): {len(rows)} trading days fetched")
        return rows

    except Exception as e:
        print(f"  [error] {name} ({symbol}): {e}")
        return []

def scrape_batch(commodities: list, period: str, workers: int) -> dict:
    results = {}

    if workers <= 1:
        for item in commodities:
            results[item["symbol"]] = fetch_commodity_history(item, period)
            time.sleep(0.2)
    else:
        def _fetch(item):
            return item["symbol"], fetch_commodity_history(item, period)

        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = {executor.submit(_fetch, c): c for c in commodities}
            for future in as_completed(futures):
                sym, rows = future.result()
                results[sym] = rows

    return results

def main():
    parser = argparse.ArgumentParser(
        description="Fetch historical OHLCV data for Commodities (yfinance & Business Insider)"
    )
    parser.add_argument(
        "--symbol",
        default=None,
        help="Single commodity symbol to fetch (e.g. GC=F, CL=F, COAL). Skips full batch."
    )
    parser.add_argument(
        "--period",
        default=DEFAULT_PERIOD,
        help="History period string (default: 3y, e.g. 1y, 3y, 5y)"
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help="Parallel worker threads for batch mode (default: 4)"
    )
    args = parser.parse_args()

    ensure_table()
    conn = get_db_conn()

    if args.symbol:
        sym_input = args.symbol.upper()
        comm_info = next((c for c in COMMODITIES if c["symbol"].upper() == sym_input or c["name"].upper() == sym_input), None)
        if not comm_info:
            if sym_input in ["COAL", "2590857"]:
                comm_info = {"name": "Coal", "symbol": "COAL", "category": "Energy", "source": "business_insider"}
            else:
                comm_info = {"name": sym_input, "symbol": sym_input, "category": "General", "source": "yfinance"}

        print(f"\n[single] Fetching {args.period} history for {comm_info['name']} ({comm_info['symbol']}) ...")
        rows = fetch_commodity_history(comm_info, args.period)
        inserted = upsert_rows(conn, rows)
        print(f"[db] {inserted} row(s) upserted for {comm_info['name']}.")
        conn.close()
        print("\nDone.")
        return

    total = len(COMMODITIES)
    print(f"\n[batch] Fetching {args.period} history for {total} commodities with {args.workers} worker(s) ...\n")

    results     = scrape_batch(COMMODITIES, args.period, args.workers)
    grand_total = 0
    failed      = []

    for item in COMMODITIES:
        sym = item["symbol"]
        rows = results.get(sym, [])
        if not rows:
            failed.append(item["name"])
            continue
        try:
            inserted = upsert_rows(conn, rows)
            grand_total += inserted
        except Exception as e:
            print(f"[db] ERROR inserting {item['name']}: {e}")
            conn.rollback()
            failed.append(item["name"])

    conn.close()

    print(f"\n{'='*60}")
    print(f"  Batch complete  [{datetime.now().strftime('%Y-%m-%d %H:%M')}]")
    print(f"  Commodities fetched: {total - len(failed)}/{total}")
    print(f"  Failed             : {len(failed)} -- {failed if failed else 'none'}")
    print(f"  DB rows saved      : {grand_total} upserted into commodity_history")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
