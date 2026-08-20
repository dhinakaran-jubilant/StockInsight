"""
StockInsight — Consensus Recommendation & Analyst Details Scraper

Scrapes analyst consensus recommendations data (total analysts, buy/hold/sell counts, consensus rating, target prices)
and detailed analyst research reports (author, report date, target price, LTP, upside, reco type, report title/link)
for Nifty 750 stocks.

Filtering Rule for Analyst Details:
- Scrapes current quarter data after June (July 1 onwards of current year).
- If no reports exist after June, fallbacks to scraping the latest 5 reports.

Tables Updated:
- PostgreSQL table: trading_db.consensus_recommendations
- PostgreSQL table: trading_db.analyst_recommendations

Usage:
    python scrape_consensus_recommendation.py
    python scrape_consensus_recommendation.py --company KALYANKJIL
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
from bs4 import BeautifulSoup

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

CREATE_CONSENSUS_TABLE_SQL = """
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

CREATE_ANALYST_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS analyst_recommendations (
    id                SERIAL PRIMARY KEY,
    symbol            VARCHAR(50)   NOT NULL,
    stock_name        VARCHAR(255),
    report_date       DATE          NOT NULL,
    author            VARCHAR(255)  NOT NULL,
    ltp               VARCHAR(50),
    target_price      VARCHAR(50),
    price_at_reco     VARCHAR(100),
    upside            VARCHAR(50),
    reco_type         VARCHAR(50),
    report_title      TEXT,
    report_url        TEXT,
    scraped_at        TIMESTAMP DEFAULT NOW(),
    CONSTRAINT unique_analyst_reco UNIQUE (symbol, author, report_date)
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


def ensure_tables(conn):
    with conn.cursor() as cur:
        cur.execute(CREATE_CONSENSUS_TABLE_SQL)
        cur.execute(CREATE_ANALYST_TABLE_SQL)
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


def parse_date(date_str: str) -> datetime | None:
    if not date_str:
        return None
    clean_str = date_str.strip()
    for fmt in ('%d %b %Y', '%d-%b-%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try:
            return datetime.strptime(clean_str, fmt)
        except ValueError:
            pass
    return None


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

            # Extract target price from JSON if present
            target_mean = ""
            target_high = ""
            target_low = ""
            tgt_match = re.search(r'&quot;TARGET_PRICE&quot;\s*:\s*\{[^\}]*?&quot;AVG&quot;\s*:\s*([0-9\.]+)', r.text)
            if tgt_match:
                target_mean = tgt_match.group(1)
            high_match = re.search(r'&quot;TARGET_PRICE&quot;\s*:\s*\{[^\}]*?&quot;HIGH&quot;\s*:\s*([0-9\.]+)', r.text)
            if high_match:
                target_high = high_match.group(1)
            low_match = re.search(r'&quot;TARGET_PRICE&quot;\s*:\s*\{[^\}]*?&quot;LOW&quot;\s*:\s*([0-9\.]+)', r.text)
            if low_match:
                target_low = low_match.group(1)

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
                            "eq_id": eq_id,
                            "slug": slug,
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
                except Exception:
                    pass
    except Exception as e:
        logging.debug(f"[trendlyne] Error fetching consensus for {symbol}: {e}")

def get_current_quarter_cutoff(now: datetime):
    """
    Computes the start date for the current quarter's analyst research reports:
    - Current month in Jul/Aug/Sep (e.g., August): Cutoff is June 1 (June and after June month)
    - Current month in Oct/Nov/Dec (e.g., October): Cutoff is September 1 (September and after September month)
    - Current month in Jan/Feb/Mar: Cutoff is December 1 of previous year (December and after December month)
    - Current month in Apr/May/Jun: Cutoff is March 1 of current year (March and after March month)
    """
    m = now.month
    y = now.year
    if m in (1, 2, 3):
        return datetime(y - 1, 12, 1).date()
    elif m in (4, 5, 6):
        return datetime(y, 3, 1).date()
    elif m in (7, 8, 9):
        return datetime(y, 6, 1).date()
    else:
        return datetime(y, 9, 1).date()


def fetch_analyst_details_trendlyne(symbol: str, eq_id=None, slug=None, consensus_data=None) -> list:
    """
    Scrapes detailed analyst research reports from Trendlyne research reports page.

    Filter rules:
    - Scrapes current quarter data based on March, June, September, December result cycles.
    - For August (current month), the current quarter cutoff is June 30 (reports after June 30).
    - If no reports exist in the current quarter, fallbacks to scraping the latest 5 reports.
    """
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest'
    }

    if not eq_id or not slug:
        try:
            s_url = f"https://trendlyne.com/member/api/ac_snames/all/?term={symbol}"
            res = requests.get(s_url, headers=headers, timeout=8).json()
            if res and isinstance(res, list):
                for item in res:
                    if item.get('stock_code') == symbol or item.get('NSEcode') == symbol or item.get('value') == symbol:
                        eq_id = item.get('k')
                        slug = item.get('slugname')
                        break
                if not eq_id and len(res) > 0:
                    eq_id = res[0].get('k')
                    slug = res[0].get('slugname')
        except Exception:
            pass

    if not eq_id or not slug:
        return []

    url = f"https://trendlyne.com/research-reports/stock/{eq_id}/{symbol}/{slug}/"
    try:
        r = requests.get(url, headers=headers, timeout=10)
        if r.status_code != 200:
            return []

        soup = BeautifulSoup(r.text, 'html.parser')
        rows = soup.find_all('tr')

        raw_reports = []    
        for r_elem in rows:
            tds = r_elem.find_all(['td', 'th'])
            if len(tds) < 8:
                continue

            date_txt = tds[1].get_text(strip=True)
            dt = parse_date(date_txt)
            if not dt:
                continue

            stock_name = tds[2].get_text(strip=True)

            author_raw = tds[3].get_text(' ', strip=True)
            # Remove trailing badge words like 'Target', 'Reco', 'RecoTarget'
            author = re.sub(r'\s*(Target|Reco)+\s*$', '', author_raw, flags=re.IGNORECASE).strip()

            ltp = tds[4].get_text(strip=True)
            target_price = tds[5].get_text(strip=True)
            price_at_reco = tds[6].get_text(' ', strip=True)
            upside = tds[7].get_text(strip=True)
            reco_type = tds[8].get_text(strip=True)

            # Extract title and report URL if present
            title = ""
            report_url = ""
            details_td = r_elem.find('td', class_='hidden') or r_elem.find('article')
            if details_td:
                link_elem = details_td.find('a', class_='newslink')
                if link_elem:
                    title = link_elem.get_text(strip=True)
                    report_url = link_elem.get('href') or link_elem.get('data-redirecturl') or ""

            raw_reports.append({
                "symbol": symbol,
                "stock_name": stock_name,
                "report_date": dt.date(),
                "author": author,
                "ltp": ltp,
                "target_price": target_price,
                "price_at_reco": price_at_reco,
                "upside": upside,
                "reco_type": reco_type,
                "report_title": title,
                "report_url": report_url
            })

        if not raw_reports:
            return []

        now = datetime.now()
        cutoff_date = get_current_quarter_cutoff(now)

        current_quarter_reports = [rep for rep in raw_reports if rep["report_date"] >= cutoff_date]

        if current_quarter_reports:
            selected_reports = current_quarter_reports
        else:
            selected_reports = raw_reports[:5]

        # Check if we should prepend Consensus Share Price Target row
        if consensus_data and consensus_data.get("target_mean_price"):
            target_mean = consensus_data.get("target_mean_price")
            latest_ltp = selected_reports[0]["ltp"] if selected_reports else ""
            stock_nm = selected_reports[0]["stock_name"] if selected_reports else symbol

            upside_pct = "-"
            try:
                if target_mean and latest_ltp:
                    t_val = float(target_mean)
                    l_val = float(latest_ltp)
                    if l_val > 0:
                        diff = ((t_val - l_val) / l_val) * 100
                        upside_pct = f"{round(diff, 2)}"
            except Exception:
                pass

            consensus_row = {
                "symbol": symbol,
                "stock_name": stock_nm,
                "report_date": datetime.now().date(),
                "author": "Consensus Share Price Target",
                "ltp": latest_ltp,
                "target_price": target_mean,
                "price_at_reco": "-",
                "upside": upside_pct,
                "reco_type": consensus_data.get("consensus_rating", "Buy").lower(),
                "report_title": "Consensus Share Price Target Summary",
                "report_url": f"https://trendlyne.com/research-reports/stock/{eq_id}/{symbol}/{slug}/"
            }
            # Prepend consensus row if not already in selected_reports
            if not any(r["author"] == "Consensus Share Price Target" for r in selected_reports):
                selected_reports.insert(0, consensus_row)

        return selected_reports

    except Exception as e:
        logging.debug(f"[trendlyne] Error fetching analyst details for {symbol}: {e}")

    return []


def scrape_symbol(symbol: str) -> dict:
    """Attempts Trendlyne first for consensus recommendation, falls back to yfinance, and scrapes analyst details."""
    consensus = fetch_consensus_trendlyne(symbol)
    if not consensus:
        consensus = fetch_consensus_yfinance(symbol)

    eq_id = consensus.get("eq_id") if consensus else None
    slug = consensus.get("slug") if consensus else None

    analyst_reports = fetch_analyst_details_trendlyne(
        symbol=symbol,
        eq_id=eq_id,
        slug=slug,
        consensus_data=consensus
    )

    return {
        "symbol": symbol,
        "consensus": consensus,
        "analyst_reports": analyst_reports
    }


def upsert_consensus_records(conn, records: list) -> int:
    """Inserts or updates consensus_recommendations records."""
    if not records:
        return 0

    deduped = {}
    for r in records:
        if r and r.get("symbol"):
            sym = str(r["symbol"]).strip().upper()[:50]
            deduped[sym] = r

    valid_records = list(deduped.values())
    if not valid_records:
        return 0

    with conn.cursor() as cur:
        cur.execute("SELECT symbol FROM consensus_recommendations;")
        existing_symbols = {row[0].upper() for row in cur.fetchall() if row[0]}

        update_rows = []
        insert_rows = []

        for r in valid_records:
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

    conn.commit()
    return len(update_rows) + len(insert_rows)


def upsert_analyst_records(conn, records: list) -> int:
    """Inserts or updates analyst_recommendations records."""
    if not records:
        return 0

    deduped = {}
    for r in records:
        if not r or not r.get("symbol") or not r.get("author") or not r.get("report_date"):
            continue
        sym = str(r["symbol"]).strip().upper()[:50]
        author = str(r["author"]).strip()[:255]
        report_date = r["report_date"]

        # Composite unique key matching table constraint: (symbol, author, report_date)
        key = (sym, author, str(report_date))
        deduped[key] = (
            sym,
            str(r.get("stock_name", ""))[:255],
            report_date,
            author,
            str(r.get("ltp", ""))[:50],
            str(r.get("target_price", ""))[:50],
            str(r.get("price_at_reco", ""))[:100],
            str(r.get("upside", ""))[:50],
            str(r.get("reco_type", ""))[:50],
            str(r.get("report_title", "")),
            str(r.get("report_url", "")),
            datetime.now()
        )

    tuples = list(deduped.values())

    if not tuples:
        return 0

    sql = """
        INSERT INTO analyst_recommendations (
            symbol, stock_name, report_date, author, ltp, target_price,
            price_at_reco, upside, reco_type, report_title, report_url, scraped_at
        ) VALUES %s
        ON CONFLICT (symbol, author, report_date) DO UPDATE SET
            stock_name    = EXCLUDED.stock_name,
            ltp           = EXCLUDED.ltp,
            target_price  = EXCLUDED.target_price,
            price_at_reco = EXCLUDED.price_at_reco,
            upside        = EXCLUDED.upside,
            reco_type     = EXCLUDED.reco_type,
            report_title  = EXCLUDED.report_title,
            report_url    = EXCLUDED.report_url,
            scraped_at    = NOW();
    """

    with conn.cursor() as cur:
        execute_values(cur, sql, tuples)

    conn.commit()
    return len(tuples)


def main():
    parser = argparse.ArgumentParser(description="Scrape Consensus Recommendations & Analyst Details for Nifty 750 stocks")
    parser.add_argument("--company", "--ticker", default=None, help="Single stock ticker (e.g., KALYANKJIL, RELIANCE)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS, help="Parallel workers count (default: 10)")
    args = parser.parse_args()

    conn = get_db_conn()
    ensure_tables(conn)

    target_symbol = args.company
    start_time = time.time()

    if target_symbol:
        symbol = target_symbol.strip().upper()
        logging.info(f"[+] Scraping consensus & analyst recommendations for single stock: {symbol}")
        data = scrape_symbol(symbol)
        rec = data.get("consensus")
        analyst_reps = data.get("analyst_reports", [])

        if rec:
            upsert_consensus_records(conn, [rec])
            logging.info(f"[SUCCESS Consensus] {symbol} -> Total: {rec['total']}, Rating: {rec['consensus_rating']}, Mean Tgt: {rec['target_mean_price']}")
        else:
            logging.warning(f"[-] No consensus recommendation summary found for {symbol}")

        if analyst_reps:
            saved_reps = upsert_analyst_records(conn, analyst_reps)
            logging.info(f"[SUCCESS Analyst Details] {symbol} -> Saved {saved_reps} analyst report(s):")
            for rep in analyst_reps:
                logging.info(f"  - {rep['report_date']} | {rep['author']} | Target: {rep['target_price']} | Upside: {rep['upside']} | Type: {rep['reco_type']}")
        else:
            logging.warning(f"[-] No analyst details found for {symbol}")

        conn.close()
        return

    tickers = fetch_tickers_from_db()
    if not tickers:
        logging.error("[-] No tickers found in nifty_750 table.")
        conn.close()
        return

    logging.info(f"[+] Starting batch scraping for {len(tickers)} stocks using {args.workers} workers...")
    collected_consensus = []
    collected_analysts = []
    failed_symbols = []

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(scrape_symbol, sym): sym for sym in tickers}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                res = fut.result()
                if res.get("consensus"):
                    collected_consensus.append(res["consensus"])
                if res.get("analyst_reports"):
                    collected_analysts.extend(res["analyst_reports"])
                if not res.get("consensus") and not res.get("analyst_reports"):
                    failed_symbols.append(sym)
            except Exception as e:
                logging.error(f"[-] Error processing {sym}: {e}")
                failed_symbols.append(sym)

    saved_consensus = upsert_consensus_records(conn, collected_consensus)
    saved_analysts = upsert_analyst_records(conn, collected_analysts)
    conn.close()

    duration = round(time.time() - start_time, 2)
    logging.info("=" * 65)
    logging.info("CONSENSUS & ANALYST RECOMMENDATIONS SCRAPE SUMMARY")
    logging.info("=" * 65)
    logging.info(f" Total Stocks Checked        : {len(tickers)}")
    logging.info(f" Consensus Summaries Saved  : {saved_consensus}")
    logging.info(f" Analyst Reports Saved       : {saved_analysts}")
    logging.info(f" Stocks Without Data         : {len(failed_symbols)}")
    logging.info(f" Total Execution Time        : {duration}s ({round(duration/60, 2)}m)")
    logging.info("=" * 65)


if __name__ == "__main__":
    main()
