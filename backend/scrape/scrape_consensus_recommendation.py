"""
StockInsight — Consensus Recommendation Scraper

Scrapes analyst consensus recommendations data (total analysts, strong buy, buy, hold, sell, strong sell counts, and consensus rating)
for all stocks in nifty_750.

Primary Source: High-speed Yahoo Finance API (recommendations_summary / info)
Fallback Source: Trendlyne stock page embedded consensus data

Saves to PostgreSQL table: trading_db.consensus_recommendations

Usage:
    python scrape_consensus_recommendation.py
    python scrape_consensus_recommendation.py --company BHARTIARTL
    python scrape_consensus_recommendation.py --workers 10
"""

import os
import sys
import time
import re
import json
import logging
import argparse
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
import psycopg2
from psycopg2.extras import execute_values

try:
    import yfinance as yf
except ImportError:
    print("[error] yfinance not installed. Run: pip install yfinance")
    raise

# ---------------------------------------------------------------------------
# Database Configuration
# ---------------------------------------------------------------------------
DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

EXCHANGE_SUFFIX = ".NS"
DEFAULT_WORKERS = 10

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS consensus_recommendations (
    id                  SERIAL PRIMARY KEY,
    symbol              VARCHAR(50) UNIQUE NOT NULL,
    total               INTEGER DEFAULT 0,
    strong_buy          INTEGER DEFAULT 0,
    buy                 INTEGER DEFAULT 0,
    hold                INTEGER DEFAULT 0,
    sell                INTEGER DEFAULT 0,
    strong_sell         INTEGER DEFAULT 0,
    consensus_rating    VARCHAR(100),
    target_mean_price   VARCHAR(50),
    target_high_price   VARCHAR(50),
    target_low_price    VARCHAR(50),
    scraped_at          TIMESTAMP DEFAULT NOW()
);
"""

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(os.path.dirname(__file__), "..", "scrapers.log"), encoding="utf-8")
    ]
)

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)

def ensure_table(conn):
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        try:
            cur.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'consensus_recommendations_symbol_key'
                    ) THEN
                        BEGIN
                            ALTER TABLE consensus_recommendations ADD CONSTRAINT consensus_recommendations_symbol_key UNIQUE (symbol);
                        EXCEPTION WHEN OTHERS THEN
                            NULL;
                        END;
                    END IF;
                END $$;
            """)
        except Exception:
            pass
    conn.commit()

def fetch_tickers_from_db():
    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT symbol FROM nifty_750 WHERE symbol IS NOT NULL AND symbol != '';")
        rows = cur.fetchall()
    conn.close()
    return [r[0].strip().upper() for r in rows if r[0]]

def fetch_consensus_yfinance(symbol: str) -> dict | None:
    """Fetch analyst recommendations from yfinance."""
    try:
        yf_symbol = f"{symbol}{EXCHANGE_SUFFIX}"
        t = yf.Ticker(yf_symbol)
        df = t.recommendations_summary

        sb = b = h = s = ss = 0
        tot = 0

        if df is not None and not df.empty:
            row = df.iloc[0]
            sb = int(row.get('strongBuy', 0) or 0)
            b  = int(row.get('buy', 0) or 0)
            h  = int(row.get('hold', 0) or 0)
            s  = int(row.get('sell', 0) or 0)
            ss = int(row.get('strongSell', 0) or 0)
            tot = sb + b + h + s + ss

        info = t.info or {}
        rating = info.get('averageAnalystRating', '') or info.get('recommendationKey', '')
        if not tot and info.get('numberOfAnalystOpinions'):
            tot = int(info.get('numberOfAnalystOpinions', 0))

        if not rating and tot > 0:
            if sb + b > h + s + ss:
                rating = "Strong Buy" if sb > b else "Buy"
            elif s + ss > sb + b + h:
                rating = "Strong Sell" if ss > s else "Sell"
            else:
                rating = "Hold"

        target_mean = str(round(info.get('targetMeanPrice', 0.0), 2)) if info.get('targetMeanPrice') else ""
        target_high = str(round(info.get('targetHighPrice', 0.0), 2)) if info.get('targetHighPrice') else ""
        target_low  = str(round(info.get('targetLowPrice', 0.0), 2)) if info.get('targetLowPrice') else ""

        if tot > 0:
            return {
                "symbol": symbol,
                "total": tot,
                "strong_buy": sb,
                "buy": b,
                "hold": h,
                "sell": s,
                "strong_sell": ss,
                "consensus_rating": str(rating).strip().title() if rating else "N/A",
                "target_mean_price": target_mean,
                "target_high_price": target_high,
                "target_low_price": target_low,
            }
    except Exception as e:
        logging.debug(f"[yfinance] Error fetching {symbol}: {e}")

    return None


def fetch_consensus_trendlyne(symbol: str) -> dict | None:
    """Primary Source: Scrape Trendlyne consensus recommendation from HTML with exact equity resolution."""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
    }
    try:
        s_url = f"https://trendlyne.com/member/api/ac_snames/all/?term={symbol}"
        res = requests.get(s_url, headers=headers, timeout=8).json()

        eq_id = None
        slug = None
        if res and isinstance(res, list):
            for item in res:
                if item.get('stock_code') == symbol or item.get('NSEcode') == symbol or item.get('value') == symbol:
                    eq_id = item.get('k')
                    slug = item.get('slugname')
                    break
            if not eq_id and len(res) > 0:
                eq_id = res[0].get('k')
                slug = res[0].get('slugname')

        page_urls = []
        if eq_id and slug:
            page_urls.append(f"https://trendlyne.com/equity/consensus-estimates/{eq_id}/{symbol}/{slug}/")
            page_urls.append(f"https://trendlyne.com/equity/{eq_id}/{symbol}/{slug}/")

        page_urls.append(f"https://trendlyne.com/equity/consensus-estimates/dashboard/forecaster/{symbol}/")

        for url in page_urls:
            r = requests.get(url, headers=headers, timeout=8)
            if r.status_code != 200:
                continue

            matches = re.findall(r'\{&quot;STRONG_SELL&quot;:.*?(?=\s*,\s*\{&quot;STRONG_SELL&quot;|\s*\]|\s*</)', r.text, re.DOTALL)
            if not matches:
                matches = re.findall(r'\{"STRONG_SELL":.*?(?=\s*,\s*\{"STRONG_SELL"|\s*\]|\s*</)', r.text, re.DOTALL)

            for raw_match in reversed(matches):
                clean_str = raw_match.replace('&quot;', '"').strip()
                open_b = clean_str.count('{')
                close_b = clean_str.count('}')
                if open_b > close_b:
                    clean_str += '}' * (open_b - close_b)

                try:
                    data = json.loads(clean_str)
                    sb = int(data.get("STRONG_BUY", {}).get("value", 0))
                    b  = int(data.get("BUY", {}).get("value", 0))
                    h  = int(data.get("HOLD", {}).get("value", 0))
                    s  = int(data.get("SELL", {}).get("value", 0))
                    ss = int(data.get("STRONG_SELL", {}).get("value", 0))
                    tot = int(data.get("NUMBER_OF_ANALYSTS", sb + b + h + s + ss))

                    reco_obj = data.get("RECO_TEXT", {})
                    rating = reco_obj.get("value") if isinstance(reco_obj, dict) else str(reco_obj)
                    if not rating:
                        rating = data.get("AVG_RECO_TEXT", "")

                    if tot > 0:
                        return {
                            "symbol": symbol,
                            "total": tot,
                            "strong_buy": sb,
                            "buy": b,
                            "hold": h,
                            "sell": s,
                            "strong_sell": ss,
                            "consensus_rating": str(rating).strip().title() if rating else "N/A",
                            "target_mean_price": "",
                            "target_high_price": "",
                            "target_low_price": "",
                        }
                except Exception as ex:
                    pass
    except Exception as e:
        logging.debug(f"[trendlyne] Error fetching {symbol}: {e}")

    return None


def scrape_symbol(symbol: str) -> dict | None:
    """Attempts Trendlyne first for exact matching, falls back to yfinance."""
    data = fetch_consensus_trendlyne(symbol)
    if not data:
        data = fetch_consensus_yfinance(symbol)
    return data


def check_symbol_exists(conn, symbol: str) -> bool:
    """Check if stock symbol exists in consensus_recommendations table."""
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM consensus_recommendations WHERE symbol = %s LIMIT 1;", (symbol,))
        return cur.fetchone() is not None


def upsert_consensus_records(conn, records: list) -> int:
    """
    Checks if stock symbol exists in consensus_recommendations table before saving.
    If symbol exists, updates the values; otherwise adds (inserts) a new stock record.
    """
    if not records:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT symbol FROM consensus_recommendations;")
        existing_symbols = {row[0].upper() for row in cur.fetchall() if row[0]}

        update_rows = []
        insert_rows = []

        for r in records:
            if not r or not r.get("symbol"):
                continue
            sym = str(r["symbol"]).strip().upper()[:50]
            val = (
                int(r.get("total", 0)),
                int(r.get("strong_buy", 0)),
                int(r.get("buy", 0)),
                int(r.get("hold", 0)),
                int(r.get("sell", 0)),
                int(r.get("strong_sell", 0)),
                str(r.get("consensus_rating", ""))[:100],
                str(r.get("target_mean_price", ""))[:50],
                str(r.get("target_high_price", ""))[:50],
                str(r.get("target_low_price", ""))[:50],
            )
            if sym in existing_symbols:
                update_rows.append(val + (sym,))
            else:
                insert_rows.append((sym,) + val)

        if update_rows:
            update_sql = """
                UPDATE consensus_recommendations SET
                    total               = data.total::integer,
                    strong_buy          = data.strong_buy::integer,
                    buy                 = data.buy::integer,
                    hold                = data.hold::integer,
                    sell                = data.sell::integer,
                    strong_sell         = data.strong_sell::integer,
                    consensus_rating    = data.consensus_rating::varchar,
                    target_mean_price   = data.target_mean_price::varchar,
                    target_high_price   = data.target_high_price::varchar,
                    target_low_price    = data.target_low_price::varchar,
                    scraped_at          = NOW()
                FROM (VALUES %s) AS data(
                    total, strong_buy, buy, hold, sell, strong_sell,
                    consensus_rating, target_mean_price, target_high_price, target_low_price, symbol
                )
                WHERE UPPER(consensus_recommendations.symbol) = UPPER(data.symbol);
            """
            execute_values(cur, update_sql, update_rows)

        if insert_rows:
            insert_sql = """
                INSERT INTO consensus_recommendations (
                    symbol, total, strong_buy, buy, hold, sell, strong_sell,
                    consensus_rating, target_mean_price, target_high_price, target_low_price, scraped_at
                ) VALUES %s
                ON CONFLICT (symbol) DO UPDATE SET
                    total               = EXCLUDED.total,
                    strong_buy          = EXCLUDED.strong_buy,
                    buy                 = EXCLUDED.buy,
                    hold                = EXCLUDED.hold,
                    sell                = EXCLUDED.sell,
                    strong_sell         = EXCLUDED.strong_sell,
                    consensus_rating    = EXCLUDED.consensus_rating,
                    target_mean_price   = EXCLUDED.target_mean_price,
                    target_high_price   = EXCLUDED.target_high_price,
                    target_low_price    = EXCLUDED.target_low_price,
                    scraped_at          = NOW();
            """
            insert_tuples = [row + (datetime.now(),) for row in insert_rows]
            execute_values(cur, insert_sql, insert_tuples)

        logging.info(f"[DB] Consensus recommendations processed {len(records)} record(s): {len(update_rows)} updated, {len(insert_rows)} inserted.")

    conn.commit()
    return len(update_rows) + len(insert_rows)


def main():
    parser = argparse.ArgumentParser(description="Scrape Consensus Recommendations for Nifty 750 stocks")
    parser.add_argument("--company", "--ticker", default=None, help="Single stock ticker (e.g., BHARTIARTL, RELIANCE)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel workers count (default: 10)")
    args = parser.parse_args()

    conn = get_db_conn()
    ensure_table(conn)

    target_symbol = args.company
    start_time = time.time()

    if target_symbol:
        symbol = target_symbol.strip().upper()
        logging.info(f"[+] Scraping consensus recommendations for single stock: {symbol}")
        rec = scrape_symbol(symbol)
        if rec:
            inserted = upsert_consensus_records(conn, [rec])
            logging.info(f"[SUCCESS] {symbol} -> Total: {rec['total']}, Strong Buy: {rec['strong_buy']}, Buy: {rec['buy']}, Hold: {rec['hold']}, Sell: {rec['sell']}, Strong Sell: {rec['strong_sell']} (Rating: {rec['consensus_rating']})")
        else:
            logging.warning(f"[-] No consensus recommendation data found for {symbol}")
        conn.close()
        return

    tickers = fetch_tickers_from_db()
    if not tickers:
        logging.error("[-] No tickers found in nifty_750 table.")
        conn.close()
        return

    logging.info(f"[+] Starting batch consensus recommendation scraping for {len(tickers)} stocks using {args.workers} workers...")
    collected_records = []
    failed_symbols = []

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(scrape_symbol, sym): sym for sym in tickers}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                rec = fut.result()
                if rec:
                    collected_records.append(rec)
                else:
                    failed_symbols.append(sym)
            except Exception as e:
                logging.error(f"[-] Error processing {sym}: {e}")
                failed_symbols.append(sym)

    saved_count = upsert_consensus_records(conn, collected_records)
    conn.close()

    duration = round(time.time() - start_time, 2)
    logging.info("=" * 65)
    logging.info("CONSENSUS RECOMMENDATIONS SCRAPE SUMMARY")
    logging.info("=" * 65)
    logging.info(f" Total Stocks Checked  : {len(tickers)}")
    logging.info(f" Stocks with Data Saved : {saved_count}")
    logging.info(f" Stocks Without Data    : {len(failed_symbols)}")
    logging.info(f" Total Execution Time   : {duration}s ({round(duration/60, 2)}m)")
    logging.info("=" * 65)


if __name__ == "__main__":
    main()
