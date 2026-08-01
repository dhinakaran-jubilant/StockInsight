"""
Scrapes 750 stock list (stock_name, symbol, stock_link, price, market_cap, updated_at) from Screener.in using Scrapy framework.

Sources:
  1. Nifty 500 (CNX500)             : https://www.screener.in/company/CNX500/      (500 stocks)
  2. Nifty Microcap 250 (NFMICRO250): https://www.screener.in/company/NFMICRO250/   (250 stocks)

Workflow:
1. Crawls all constituent pages of CNX500 (pages 1..20) and NFMICRO250 (pages 1..10).
2. Collects all 750 stock records with CMP Price and Market Cap (deduplicated by symbol).
3. Clears table 'nifty_750' and resets ID sequence to 1 using TRUNCATE RESTART IDENTITY.
4. Inserts newly scraped stock records into PostgreSQL table 'nifty_750'.

Usage:
    python scrape_nifty_lists_scrapy.py
"""

import os
import argparse
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_values

import scrapy
from scrapy.crawler import CrawlerProcess
from scrapy.http import Request

# ---------------------------------------------------------------------------
# Config & Database Setup
# ---------------------------------------------------------------------------
DB_CONFIG = {
    "dbname":   "trading_db",
    "user":     "postgres",
    "password": "1234",
    "host":     "localhost",
    "port":     "5432",
}

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS nifty_750 (
    id          SERIAL PRIMARY KEY,
    stock_name  TEXT,
    symbol      VARCHAR(50),
    stock_link  TEXT,
    price       VARCHAR(50),
    market_cap  VARCHAR(100),
    updated_at  TIMESTAMP DEFAULT NOW()
);
"""

MIGRATE_SQL = [
    'ALTER TABLE nifty_750 DROP COLUMN IF EXISTS "S.No";',
    'ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS id SERIAL;',
    "ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);",
    "ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS stock_name TEXT;",
    "ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS stock_link TEXT;",
    "ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS price VARCHAR(50);",
    "ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS market_cap VARCHAR(100);",
    "ALTER TABLE nifty_750 ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();",
]

def extract_symbol(url: str) -> str:
    if not url:
        return ""
    cleaned = url.strip().rstrip("/")
    parts = [p for p in cleaned.split("/") if p]
    try:
        idx = parts.index("company")
        return parts[idx + 1].upper()
    except (ValueError, IndexError):
        return parts[-1].upper() if parts else ""

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)

def ensure_table():
    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        for sql in MIGRATE_SQL:
            cur.execute(sql)
    conn.commit()
    conn.close()

# ---------------------------------------------------------------------------
# Scrapy Spider
# ---------------------------------------------------------------------------
class ScreenerNiftyListsSpider(scrapy.Spider):
    name = "screener_nifty_lists_spider"
    allowed_domains = ["screener.in"]
    start_urls = [
        "https://www.screener.in/company/CNX500/?page=1",
        "https://www.screener.in/company/NFMICRO250/?page=1"
    ]

    custom_settings = {
        'USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'CONCURRENT_REQUESTS': 2,
        'DOWNLOAD_DELAY': 1.0,
        'RETRY_TIMES': 5,
        'RETRY_HTTP_CODES': [500, 502, 503, 504, 522, 524, 408, 429],
        'COOKIES_ENABLED': True,
        'LOG_LEVEL': 'INFO',
    }

    def __init__(self, *args, **kwargs):
        super(ScreenerNiftyListsSpider, self).__init__(*args, **kwargs)
        self.scraped_records = []
        self.seen_symbols = set()

    def parse(self, response):
        list_type = "CNX500" if "CNX500" in response.url else "NFMICRO250"

        current_page = 1
        if "page=" in response.url:
            try:
                current_page = int(response.url.split("page=")[-1].split("&")[0])
            except ValueError:
                current_page = 1

        rows = response.xpath("//table//tbody/tr[td]")
        if not rows:
            self.logger.warning(f"[{list_type}] No constituent rows found on page {current_page}")
            return

        # Determine column index for Price (CMP) and Market Cap from the main table header
        headers = [th.xpath("string()").get("").strip() for th in response.xpath("//table//tr[th][1]/th")]
        cmp_idx = 2
        mcap_idx = 4
        for idx, h in enumerate(headers):
            h_clean = h.replace("\n", " ").lower()
            if "cmp" in h_clean or "price" in h_clean:
                cmp_idx = idx
            elif "mar cap" in h_clean or "market cap" in h_clean:
                mcap_idx = idx

        added_this_page = 0
        for row in rows:
            link_el = row.xpath(".//a[contains(@href, '/company/')]")
            if not link_el:
                continue

            stock_name = link_el.xpath("text()").get("").strip()
            raw_href = link_el.xpath("@href").get("").strip()
            full_link = response.urljoin(raw_href)
            sym = extract_symbol(full_link)

            if not stock_name or not sym or sym in ["CNX500", "NFMICRO250"]:
                continue

            tds = row.xpath("./td")
            price_val = tds[cmp_idx].xpath("string()").get("").strip() if len(tds) > cmp_idx else ""
            mcap_val = tds[mcap_idx].xpath("string()").get("").strip() if len(tds) > mcap_idx else ""

            if sym not in self.seen_symbols:
                self.seen_symbols.add(sym)
                record = {
                    "stock_name": stock_name,
                    "symbol": sym,
                    "stock_link": full_link,
                    "price": price_val,
                    "market_cap": mcap_val
                }
                self.scraped_records.append(record)
                added_this_page += 1

        self.logger.info(f"[{list_type}] Page {current_page}: Scraped {added_this_page} new stocks. Total unique so far: {len(self.scraped_records)}")

        max_pages = 20 if list_type == 'CNX500' else 10
        if added_this_page > 0 and current_page < max_pages:
            next_page = current_page + 1
            next_url = f"https://www.screener.in/company/{list_type}/?page={next_page}"
            yield Request(
                url=next_url,
                callback=self.parse
            )

# ---------------------------------------------------------------------------
# Database Storage Helper
# ---------------------------------------------------------------------------
def save_to_nifty_750(records):
    if not records:
        print("[db] No records collected to save.")
        return 0

    conn = get_db_conn()
    ensure_table()

    with conn.cursor() as cur:
        # Clear existing data and reset auto-increment ID to 1
        print(f"[db] Truncating table 'nifty_750' and resetting ID sequence to 1...")
        cur.execute("TRUNCATE TABLE nifty_750 RESTART IDENTITY;")
        
        now = datetime.now()
        print(f"[db] Inserting {len(records)} new stock records into 'nifty_750'...")
        rows = [
            (
                r['stock_name'],
                r['symbol'],
                r['stock_link'],
                str(r.get('price', ''))[:50],
                str(r.get('market_cap', ''))[:100],
                now
            )
            for r in records
        ]
        
        sql = """
            INSERT INTO nifty_750 (stock_name, symbol, stock_link, price, market_cap, updated_at)
            VALUES %s;
        """
        execute_values(cur, sql, rows)
    
    conn.commit()
    conn.close()
    print(f"[db] Successfully saved {len(records)} stocks into 'nifty_750'.")
    return len(records)

# ---------------------------------------------------------------------------
# Main Execution Entrypoint
# ---------------------------------------------------------------------------
def main():
    ensure_table()

    collected_records = []

    class StorageSpider(ScreenerNiftyListsSpider):
        def closed(self, reason):
            collected_records.extend(self.scraped_records)

    process = CrawlerProcess()
    process.crawl(StorageSpider)
    process.start()

    print(f"\n[scrapy] Crawling complete. Total unique stocks collected: {len(collected_records)}")
    save_to_nifty_750(collected_records)

if __name__ == "__main__":
    main()
