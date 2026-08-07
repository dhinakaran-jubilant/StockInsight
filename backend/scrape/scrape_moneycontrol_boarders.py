"""
StockInsight — Moneycontrol Forum & Boarders Data Scraper

Scrapes forum discussion activity, sentiment (buy/sell/hold %), total message & follower counts,
and AI-generated Boarders Summary ("Hear What Our Boarders Have to Say") from Moneycontrol
for all stocks in nifty_750.

Primary Sources:
  1. Autosuggest API:  https://www.moneycontrol.com/mccode/common/autosuggestion.php?query={symbol}&type=1&format=json
  2. AI Summary API:  https://api.moneycontrol.com/mcapi/v2/mmb/get-ai-summary?scId={sc_id}
  3. Sentimeter API:  https://api.moneycontrol.com/mcapi/v2/mmb/get-market-sentiments?scId={sc_id}
  4. Messages API:    https://api.moneycontrol.com/mcapi/v2/mmb/get-messages/?section=topic&sectionId={topic_id}&limitStart=0&limitCount=1

Saves to PostgreSQL table: trading_db.moneycontrol_boarders

Usage:
    python scrape_moneycontrol_boarders.py
    python scrape_moneycontrol_boarders.py --company SUZLON
    python scrape_moneycontrol_boarders.py --workers 10
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

DEFAULT_WORKERS = 10
REQUEST_TIMEOUT = 12

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://mmb.moneycontrol.com",
    "Referer": "https://mmb.moneycontrol.com/",
    "Accept-Language": "en-US,en;q=0.9",
}

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS moneycontrol_boarders (
    id                  SERIAL PRIMARY KEY,
    symbol              VARCHAR(50) UNIQUE NOT NULL,
    stock_name          VARCHAR(255),
    sc_id               VARCHAR(50),
    topic_id            VARCHAR(50),
    msg_count           INTEGER DEFAULT 0,
    follower_count      INTEGER DEFAULT 0,
    buy_perc            INTEGER DEFAULT 0,
    sell_perc           INTEGER DEFAULT 0,
    hold_perc           INTEGER DEFAULT 0,
    ai_summary          TEXT,
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
    """Ensure moneycontrol_boarders table and unique constraint exist."""
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        try:
            cur.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint WHERE conname = 'moneycontrol_boarders_symbol_key'
                    ) THEN
                        BEGIN
                            ALTER TABLE moneycontrol_boarders ADD CONSTRAINT moneycontrol_boarders_symbol_key UNIQUE (symbol);
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
    """Fetch distinct stock symbols from nifty_750 table."""
    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute("SELECT DISTINCT symbol FROM nifty_750 WHERE symbol IS NOT NULL AND symbol != '';")
        rows = cur.fetchall()
    conn.close()
    return [r[0].strip().upper() for r in rows if r[0]]

def clean_html_summary(html_content: str) -> str:
    """Clean HTML tags from Moneycontrol AI summary and convert to structured text/markdown."""
    if not html_content or not isinstance(html_content, str):
        return ""
    
    try:
        from bs4 import BeautifulSoup
        import html as html_lib

        soup = BeautifulSoup(html_content, "html.parser")
        
        for h in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6"]):
            h_text = h.get_text().strip()
            h.replace_with(f"\n\n### {h_text}\n")

        for li in soup.find_all("li"):
            li_text = li.get_text().strip()
            li.replace_with(f"\n* {li_text}")

        for p in soup.find_all("p"):
            p_text = p.get_text().strip()
            p.replace_with(f"{p_text}\n\n")

        for br in soup.find_all("br"):
            br.replace_with("\n")

        text = soup.get_text()
        text = html_lib.unescape(text)

        lines = [line.strip() for line in text.split("\n")]
        cleaned = []
        prev_empty = False
        for line in lines:
            if line:
                cleaned.append(line)
                prev_empty = False
            elif not prev_empty:
                cleaned.append("")
                prev_empty = True

        return "\n".join(cleaned).strip()
    except Exception:
        # Fallback regex strip if BeautifulSoup encounters any error
        clean = re.sub(r"<[^>]+>", " ", html_content)
        return re.sub(r"\s+", " ", clean).strip()

def scrape_stock_boarders(symbol: str) -> dict | None:
    """
    Fetch Moneycontrol forum & boarders data for a single stock symbol.
    """
    symbol = symbol.strip().upper()
    session = requests.Session()
    session.headers.update(HEADERS)

    sc_id = None
    stock_name = None
    topic_id = None

    # Step 1: Autosuggestion API to resolve sc_id and topic_id
    auto_url = f"https://www.moneycontrol.com/mccode/common/autosuggestion.php?query={symbol}&type=1&format=json"
    try:
        r_auto = session.get(auto_url, timeout=REQUEST_TIMEOUT)
        if r_auto.status_code == 200:
            data = r_auto.json()
            if isinstance(data, list) and len(data) > 0:
                # Find best matching stock entry
                matched = None
                for item in data:
                    pdt_name = item.get("pdt_dis_nm", "").upper()
                    if symbol in pdt_name or item.get("sc_id", "").upper() == symbol:
                        matched = item
                        break
                if not matched:
                    matched = data[0]

                sc_id = matched.get("sc_id")
                stock_name = matched.get("stock_name") or matched.get("name")
                forum_url = matched.get("forum_topics_url", "")
                
                topic_match = re.search(r"-(\d+)\.html", forum_url)
                if topic_match:
                    topic_id = topic_match.group(1)
    except Exception as e:
        logging.warning(f"[{symbol}] Autosuggest failed: {e}")

    if not sc_id:
        logging.warning(f"[{symbol}] Could not resolve Moneycontrol sc_id, skipping.")
        return None

    # Step 2: Fetch AI Boarders Summary
    ai_summary = ""
    ai_url = f"https://api.moneycontrol.com/mcapi/v2/mmb/get-ai-summary?topicId={topic_id}&scId={sc_id}" if topic_id else f"https://api.moneycontrol.com/mcapi/v2/mmb/get-ai-summary?scId={sc_id}"
    try:
        r_ai = session.get(ai_url, timeout=REQUEST_TIMEOUT)
        if r_ai.status_code == 200:
            ai_data = r_ai.json().get("data", {})
            if isinstance(ai_data, dict):
                raw_html = ai_data.get("result", "") or ""
                # If API response is truncated or ends mid-sentence without closing tag, do not clean truncated string
                if raw_html and not raw_html.endswith(">") and not raw_html.endswith("."):
                    logging.warning(f"[{symbol}] AI Summary response appears truncated from API.")
                ai_summary = clean_html_summary(raw_html)
    except Exception as e:
        logging.warning(f"[{symbol}] AI Summary fetch error: {e}")

    # Step 3: Fetch Forum Sentimeter (Buy, Sell, Hold percentages)
    buy_perc = sell_perc = hold_perc = 0
    senti_url = f"https://api.moneycontrol.com/mcapi/v2/mmb/get-market-sentiments?scId={sc_id}"
    try:
        r_senti = session.get(senti_url, timeout=REQUEST_TIMEOUT)
        if r_senti.status_code == 200:
            senti_obj = r_senti.json().get("data", {}).get("sentimeter", {})
            if isinstance(senti_obj, dict):
                buy_perc = int(senti_obj.get("buy_perc", 0) or 0)
                sell_perc = int(senti_obj.get("sell_per", 0) or 0)
                hold_perc = int(senti_obj.get("hold_per", 0) or 0)
    except Exception as e:
        logging.warning(f"[{symbol}] Sentimeter fetch error: {e}")

    # Step 4: Fetch Message Count and Followers Count
    msg_count = 0
    follower_count = 0
    if topic_id:
        msg_url = f"https://api.moneycontrol.com/mcapi/v2/mmb/get-messages/?section=topic&sectionId={topic_id}&limitStart=0&limitCount=1"
        try:
            r_msg = session.get(msg_url, timeout=REQUEST_TIMEOUT)
            if r_msg.status_code == 200:
                top_details = r_msg.json().get("data", {}).get("topicDetails", {})
                if isinstance(top_details, dict):
                    msg_count = int(top_details.get("msg_count", 0) or 0)
                    follower_count = int(top_details.get("folowr_count", 0) or top_details.get("Followers", 0) or 0)
        except Exception as e:
            logging.warning(f"[{symbol}] Messages API error: {e}")

    return {
        "symbol": symbol,
        "stock_name": stock_name or symbol,
        "sc_id": sc_id,
        "topic_id": topic_id or "",
        "msg_count": msg_count,
        "follower_count": follower_count,
        "buy_perc": buy_perc,
        "sell_perc": sell_perc,
        "hold_perc": hold_perc,
        "ai_summary": ai_summary
    }

def save_boarders_data(conn, records: list[dict]):
    """
    Checks if stock symbol exists in moneycontrol_boarders table before saving.
    If symbol exists, updates the values; otherwise inserts a new stock record.
    Preserves existing ai_summary if newly scraped ai_summary is empty/null.
    """
    if not records:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT symbol FROM moneycontrol_boarders;")
        existing_symbols = {row[0].upper() for row in cur.fetchall() if row[0]}

        update_rows = []
        insert_rows = []

        for r in records:
            if not r or not r.get("symbol"):
                continue
            sym = str(r["symbol"]).strip().upper()
            st_name = r.get("stock_name") or sym
            sc_id = r.get("sc_id") or ""
            topic_id = r.get("topic_id") or ""
            msg_count = int(r.get("msg_count", 0) or 0)
            fol_count = int(r.get("follower_count", 0) or 0)
            buy_p = int(r.get("buy_perc", 0) or 0)
            sell_p = int(r.get("sell_perc", 0) or 0)
            hold_p = int(r.get("hold_perc", 0) or 0)
            ai_sum = r.get("ai_summary") or ""

            val = (sym, st_name, sc_id, topic_id, msg_count, fol_count, buy_p, sell_p, hold_p, ai_sum)

            if sym in existing_symbols:
                # For update_rows: (stock_name, sc_id, topic_id, msg_count, follower_count, buy_perc, sell_perc, hold_perc, ai_summary, symbol)
                update_rows.append((st_name, sc_id, topic_id, msg_count, fol_count, buy_p, sell_p, hold_p, ai_sum, sym))
            else:
                insert_rows.append(val)

        if update_rows:
            update_sql = """
                UPDATE moneycontrol_boarders SET
                    stock_name      = COALESCE(NULLIF(data.stock_name, ''), moneycontrol_boarders.stock_name),
                    sc_id           = COALESCE(NULLIF(data.sc_id, ''), moneycontrol_boarders.sc_id),
                    topic_id        = COALESCE(NULLIF(data.topic_id, ''), moneycontrol_boarders.topic_id),
                    msg_count       = data.msg_count::integer,
                    follower_count  = data.follower_count::integer,
                    buy_perc        = data.buy_perc::integer,
                    sell_perc       = data.sell_perc::integer,
                    hold_perc       = data.hold_perc::integer,
                    ai_summary      = CASE 
                                        WHEN data.ai_summary IS NOT NULL AND data.ai_summary != '' 
                                        THEN data.ai_summary 
                                        ELSE moneycontrol_boarders.ai_summary 
                                      END,
                    scraped_at      = NOW()
                FROM (VALUES %s) AS data(
                    stock_name, sc_id, topic_id, msg_count, follower_count,
                    buy_perc, sell_perc, hold_perc, ai_summary, symbol
                )
                WHERE UPPER(moneycontrol_boarders.symbol) = UPPER(data.symbol);
            """
            execute_values(cur, update_sql, update_rows)

        if insert_rows:
            insert_sql = """
                INSERT INTO moneycontrol_boarders (
                    symbol, stock_name, sc_id, topic_id, msg_count, follower_count,
                    buy_perc, sell_perc, hold_perc, ai_summary, scraped_at
                ) VALUES %s
                ON CONFLICT (symbol) DO UPDATE SET
                    stock_name      = EXCLUDED.stock_name,
                    sc_id           = EXCLUDED.sc_id,
                    topic_id        = EXCLUDED.topic_id,
                    msg_count       = EXCLUDED.msg_count,
                    follower_count  = EXCLUDED.follower_count,
                    buy_perc        = EXCLUDED.buy_perc,
                    sell_perc       = EXCLUDED.sell_perc,
                    hold_perc       = EXCLUDED.hold_perc,
                    ai_summary      = CASE 
                                        WHEN EXCLUDED.ai_summary IS NOT NULL AND EXCLUDED.ai_summary != '' 
                                        THEN EXCLUDED.ai_summary 
                                        ELSE moneycontrol_boarders.ai_summary 
                                      END,
                    scraped_at      = NOW();
            """
            insert_tuples = [row + (datetime.now(),) for row in insert_rows]
            execute_values(cur, insert_sql, insert_tuples)

        logging.info(f"[DB] Boarders processed {len(records)} record(s): {len(update_rows)} updated, {len(insert_rows)} inserted.")

    conn.commit()
    return len(update_rows) + len(insert_rows)

def run_scraper(symbols: list[str], max_workers: int = DEFAULT_WORKERS):
    """Scrape Moneycontrol Boarders data for all provided symbols using multithreading."""
    conn = get_db_conn()
    ensure_table(conn)
    conn.close()

    total = len(symbols)
    logging.info(f"Starting Moneycontrol Boarders Scraper for {total} stocks using {max_workers} worker threads.")

    scraped_records = []
    failed_symbols = []

    start_time = time.time()

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_symbol = {executor.submit(scrape_stock_boarders, sym): sym for sym in symbols}

        completed = 0
        for future in as_completed(future_to_symbol):
            sym = future_to_symbol[future]
            completed += 1
            try:
                res = future.result()
                if res:
                    scraped_records.append(res)
                    ai_status = "AI Summary [Yes]" if res["ai_summary"] else "AI Summary [No]"
                    logging.info(f"[{completed}/{total}] {sym}: Messages={res['msg_count']}, Sentimeter=B:{res['buy_perc']}%/S:{res['sell_perc']}%/H:{res['hold_perc']}%, {ai_status}")
                else:
                    failed_symbols.append(sym)
            except Exception as e:
                logging.error(f"[{completed}/{total}] {sym} failed with error: {e}")
                failed_symbols.append(sym)

            # Batch save to DB every 50 records
            if len(scraped_records) >= 50:
                try:
                    c = get_db_conn()
                    save_boarders_data(c, scraped_records)
                    c.close()
                    logging.info(f"Saved batch of {len(scraped_records)} records to DB.")
                    scraped_records.clear()
                except Exception as db_err:
                    logging.error(f"Failed saving batch to database: {db_err}")

    # Save remaining records
    if scraped_records:
        try:
            c = get_db_conn()
            save_boarders_data(c, scraped_records)
            c.close()
            logging.info(f"Saved final batch of {len(scraped_records)} records to DB.")
        except Exception as db_err:
            logging.error(f"Failed saving final batch to database: {db_err}")

    elapsed = round(time.time() - start_time, 2)
    success_count = total - len(failed_symbols)
    logging.info(f"Scraping completed in {elapsed}s. Total: {total}, Success: {success_count}, Failed: {len(failed_symbols)}")
    if failed_symbols:
        logging.info(f"Failed symbols: {failed_symbols[:20]}{'...' if len(failed_symbols) > 20 else ''}")

def main():
    parser = argparse.ArgumentParser(description="Moneycontrol Boarders & Sentiment Scraper")
    parser.add_argument("--company", "--symbol", type=str, help="Single stock symbol to scrape (e.g. SUZLON)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help=f"Number of parallel workers (default {DEFAULT_WORKERS})")
    args = parser.parse_args()

    if args.company:
        symbols = [args.company.strip().upper()]
    else:
        symbols = fetch_tickers_from_db()
        if not symbols:
            logging.error("No symbols found in nifty_750 table!")
            sys.exit(1)

    run_scraper(symbols, max_workers=args.workers)

if __name__ == "__main__":
    main()
