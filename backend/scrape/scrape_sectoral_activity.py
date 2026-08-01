"""
Moneycontrol — FPI Sectoral Activity & FII/DII Cash Activity Scraper using Selenium (Chrome Webdriver)

Scrapes:
  1. FPI Sectoral Activity (Fortnightly, Monthly, Yearly) -> Table: sectoral_activity
  2. FII/DII Cash Activity (Daily, Monthly, Yearly)        -> Table: fii_dii_cash

Database Storage:
  - Clears tables and resets auto-increment ID sequence to 1 using TRUNCATE RESTART IDENTITY before inserting records.

Usage:
    python scrape_sectoral_activity.py
"""

import os
import re
import time
from datetime import datetime
import psycopg2
from psycopg2.extras import execute_values

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from scrapy.selector import Selector

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

MONEYCONTROL_FPI_URL  = "https://www.moneycontrol.com/markets/fii-dii-data/fpi-sectoral-activity/"
MONEYCONTROL_CASH_URL = "https://www.moneycontrol.com/markets/fii-dii-data/cash/"

CREATE_SECTORAL_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS sectoral_activity (
    id            SERIAL PRIMARY KEY,
    sector        VARCHAR(100)  NOT NULL,
    period        VARCHAR(30)   NOT NULL,
    period_type   VARCHAR(20)   NOT NULL,
    amount        NUMERIC(14,2),
    amount_cr     NUMERIC(14,2),
    scraped_at    TIMESTAMP     DEFAULT NOW(),
    UNIQUE (sector, period, period_type)
);
"""

ALTER_SECTORAL_TABLE_SQL = """
ALTER TABLE sectoral_activity ADD COLUMN IF NOT EXISTS amount NUMERIC(14,2);
ALTER TABLE sectoral_activity ADD COLUMN IF NOT EXISTS amount_cr NUMERIC(14,2);
"""

CREATE_CASH_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS fii_dii_cash (
    id            SERIAL PRIMARY KEY,
    period        VARCHAR(50)   NOT NULL,
    period_type   VARCHAR(20)   NOT NULL,
    fii_buy       NUMERIC(14,2),
    fii_sell      NUMERIC(14,2),
    fii_net       NUMERIC(14,2),
    dii_buy       NUMERIC(14,2),
    dii_sell      NUMERIC(14,2),
    dii_net       NUMERIC(14,2),
    scraped_at    TIMESTAMP     DEFAULT NOW(),
    UNIQUE (period, period_type)
);
"""


def ensure_tables():
    conn = psycopg2.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        cur.execute(CREATE_SECTORAL_TABLE_SQL)
        cur.execute(ALTER_SECTORAL_TABLE_SQL)
        cur.execute(CREATE_CASH_TABLE_SQL)
    conn.commit()
    conn.close()


def parse_float(val_str: str) -> float:
    if not val_str:
        return 0.0
    clean_s = val_str.replace(",", "").replace("(", "-").replace(")", "").strip()
    try:
        return float(clean_s)
    except ValueError:
        return 0.0


def save_sectoral_records(records: list) -> int:
    if not records:
        print("[db] No sectoral records to save.")
        return 0

    ensure_tables()

    dedup = {}
    for sector, period, ptype, amt, amt_cr in records:
        key = (sector, period, ptype)
        dedup[key] = (sector, period, ptype, amt, amt_cr)

    rows = list(dedup.values())

    conn = psycopg2.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        print("[db] Truncating table 'sectoral_activity' (RESTART IDENTITY)...")
        cur.execute("TRUNCATE TABLE sectoral_activity RESTART IDENTITY;")

        sql = """
            INSERT INTO sectoral_activity (sector, period, period_type, amount, amount_cr)
            VALUES %s
            ON CONFLICT (sector, period, period_type)
            DO UPDATE SET
                amount     = EXCLUDED.amount,
                amount_cr  = EXCLUDED.amount_cr,
                scraped_at = NOW();
        """
        execute_values(cur, sql, rows)

    conn.commit()
    conn.close()
    print(f"[db] Successfully saved {len(rows)} record(s) into 'sectoral_activity'.")
    return len(rows)


def save_cash_records(records: list) -> int:
    if not records:
        print("[db] No cash records to save.")
        return 0

    ensure_tables()

    dedup = {}
    for period, ptype, fii_b, fii_s, fii_n, dii_b, dii_s, dii_n in records:
        key = (period, ptype)
        dedup[key] = (period, ptype, fii_b, fii_s, fii_n, dii_b, dii_s, dii_n)

    rows = list(dedup.values())

    conn = psycopg2.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        print("[db] Truncating table 'fii_dii_cash' (RESTART IDENTITY)...")
        cur.execute("TRUNCATE TABLE fii_dii_cash RESTART IDENTITY;")

        sql = """
            INSERT INTO fii_dii_cash (period, period_type, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net)
            VALUES %s
            ON CONFLICT (period, period_type)
            DO UPDATE SET
                fii_buy    = EXCLUDED.fii_buy,
                fii_sell   = EXCLUDED.fii_sell,
                fii_net    = EXCLUDED.fii_net,
                dii_buy    = EXCLUDED.dii_buy,
                dii_sell   = EXCLUDED.dii_sell,
                dii_net    = EXCLUDED.dii_net,
                scraped_at = NOW();
        """
        execute_values(cur, sql, rows)

    conn.commit()
    conn.close()
    print(f"[db] Successfully saved {len(rows)} record(s) into 'fii_dii_cash'.")
    return len(rows)


# ---------------------------------------------------------------------------
# Selenium Web Scraper
# ---------------------------------------------------------------------------
def scrape_moneycontrol_tables():
    chrome_options = Options()
    chrome_options.add_argument("--headless=new")
    chrome_options.add_argument("--disable-gpu")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_options.add_argument("--disable-blink-features=AutomationControlled")
    chrome_options.add_argument("user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36")

    print("[selenium] Starting Chrome driver ...")
    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=chrome_options)
    driver.set_window_size(1400, 900)

    sectoral_records = []
    cash_records     = []

    try:
        # ===================================================================
        # 1. Scrape FPI Sectoral Activity Page
        # ===================================================================
        print(f"\n[selenium] 1. Navigating to FPI Sectoral Activity: {MONEYCONTROL_FPI_URL}")
        driver.get(MONEYCONTROL_FPI_URL)
        time.sleep(5)

        def extract_sectoral_tab(period_type):
            time.sleep(3)
            sel = Selector(text=driver.page_source)

            th_texts = sel.xpath("//table//th//text() | //table//thead//td//text() | //table//tr[1]//th//text()").getall()
            date_headers = [t.strip() for t in th_texts if t.strip() and t.strip() not in ["Sectors", "Trend", "Sector", ""]]
            print(f"[sectoral:{period_type}] Headers ({len(date_headers)}): {date_headers}")

            rows = sel.xpath("//table//tr")
            parsed_count = 0

            for r in rows:
                cells = [c.strip() for c in r.xpath(".//td//text() | .//th//text()").getall() if c.strip()]
                if not cells or cells[0] in ["Sectors", "Trend", "Sector", ""]:
                    continue

                sec_name = cells[0]
                vals = []
                for cell in cells[1:]:
                    if cell in ["Trend", "^", "v", "-"] or cell.startswith("Created with"):
                        continue
                    try:
                        vals.append(parse_float(cell))
                    except ValueError:
                        pass

                if sec_name and vals and len(vals) == len(date_headers):
                    for dt, v in zip(date_headers, vals):
                        full_dt = dt if len(dt.split()) >= 2 else f"{dt} 2026"
                        sectoral_records.append((sec_name, full_dt, period_type, v, v))
                    parsed_count += 1

            print(f"[sectoral:{period_type}] Parsed {parsed_count} sectors.")

        # Fortnightly
        extract_sectoral_tab("fortnightly")

        # Monthly
        try:
            m_btn = driver.find_element(By.XPATH, "//*[contains(text(), 'Monthly')]")
            driver.execute_script("arguments[0].click();", m_btn)
            print("\n[selenium] Clicked 'Monthly' tab.")
            extract_sectoral_tab("monthly")
        except Exception as e:
            print(f"[sectoral] Monthly click error: {e}")

        # Yearly
        try:
            y_btn = driver.find_element(By.XPATH, "//*[contains(text(), 'Yearly')]")
            driver.execute_script("arguments[0].click();", y_btn)
            print("\n[selenium] Clicked 'Yearly' tab.")
            extract_sectoral_tab("yearly")
        except Exception as e:
            print(f"[sectoral] Yearly click error: {e}")


        # ===================================================================
        # 2. Scrape FII / DII Cash Activity Page
        # ===================================================================
        print(f"\n[selenium] 2. Navigating to FII/DII Cash Activity: {MONEYCONTROL_CASH_URL}")
        driver.get(MONEYCONTROL_CASH_URL)
        time.sleep(5)

        def extract_cash_tab(period_type):
            time.sleep(3)
            sel = Selector(text=driver.page_source)

            rows = sel.xpath("//table//tr")
            parsed_count = 0

            for r in rows:
                cells = [c.strip() for c in r.xpath(".//td//text() | .//th//text()").getall() if c.strip()]
                if not cells:
                    continue

                # Filter header rows
                if cells[0] in ["Date", "Month", "Year", "Gross Purchase", "Sectors"] or "FII Cash" in cells[0] or "DII Cash" in cells[0]:
                    continue

                # A valid row must have Period + 6 numbers (fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net)
                if len(cells) >= 7:
                    period_str = cells[0]
                    # Parse numerical values
                    try:
                        fii_buy  = parse_float(cells[1])
                        fii_sell = parse_float(cells[2])
                        fii_net  = parse_float(cells[3])
                        dii_buy  = parse_float(cells[4])
                        dii_sell = parse_float(cells[5])
                        dii_net  = parse_float(cells[6])

                        cash_records.append((period_str, period_type, fii_buy, fii_sell, fii_net, dii_buy, dii_sell, dii_net))
                        parsed_count += 1
                    except Exception:
                        pass

            print(f"[cash:{period_type}] Parsed {parsed_count} records.")

        # Daily
        extract_cash_tab("daily")

        # Monthly
        try:
            m_btn = driver.find_element(By.XPATH, "//*[contains(text(), 'Monthly')]")
            driver.execute_script("arguments[0].click();", m_btn)
            print("\n[selenium] Clicked Cash 'Monthly' tab.")
            extract_cash_tab("monthly")
        except Exception as e:
            print(f"[cash] Monthly click error: {e}")

        # Yearly
        try:
            y_btn = driver.find_element(By.XPATH, "//*[contains(text(), 'Yearly')]")
            driver.execute_script("arguments[0].click();", y_btn)
            print("\n[selenium] Clicked Cash 'Yearly' tab.")
            extract_cash_tab("yearly")
        except Exception as e:
            print(f"[cash] Yearly click error: {e}")

    finally:
        driver.quit()

    print(f"\n[selenium] Finished. Scraped {len(sectoral_records)} FPI sectoral records & {len(cash_records)} FII/DII cash records.")
    return sectoral_records, cash_records


def main():
    sectoral_records, cash_records = scrape_moneycontrol_tables()
    
    if sectoral_records:
        save_sectoral_records(sectoral_records)
        
    if cash_records:
        save_cash_records(cash_records)

if __name__ == "__main__":
    main()
