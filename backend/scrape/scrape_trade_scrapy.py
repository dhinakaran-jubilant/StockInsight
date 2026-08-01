"""
Screener.in — Trades & Shareholding Pattern scraper using Scrapy framework.

Scrapes:
  1. Trades data for all stocks (Insider Trades, Bulk Deals, Block Deals, Sast Trades)
  2. Shareholding pattern data (Quarterly & Yearly: Promoters, FIIs, DIIs, Public, Shareholders, Market Cap)
     - Smart checking: Shareholding data is only scraped for stocks that do NOT already have data for the latest expected quarter (Mar, Jun, Sep, Dec).
     - Trades data is always scraped for all stocks.

Database linking:
  - Both 'trades' and 'shareholding_pattern' tables use 'symbol' as foreign key reference to 'nifty_750(symbol)'.

Usage:
    python scrape_trade_scrapy.py
    python scrape_trade_scrapy.py --company BHARATFORG
"""

import os
import re
import random
import argparse
import logging
from datetime import datetime
import requests as _requests
import psycopg2
from psycopg2.extras import execute_values

import scrapy
from scrapy.crawler import CrawlerProcess
from scrapy.http import FormRequest, Request

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

SCREENER_USER = os.environ.get("SCREENER_USER", "supportdeskjubilant@gmail.com")
SCREENER_PASS = os.environ.get("SCREENER_PASS", "")

CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS trades (
    id            SERIAL PRIMARY KEY,
    trade_date    VARCHAR(50),
    person        TEXT,
    designation   TEXT,
    buy_sell      VARCHAR(10),
    quantity      VARCHAR(50),
    price         VARCHAR(50),
    value_lacs    VARCHAR(50),
    mode          TEXT,
    percent       VARCHAR(50),
    symbol        VARCHAR(50),
    trade_type    VARCHAR(50),
    scraped_at    TIMESTAMP DEFAULT NOW()
);
"""

MIGRATE_SQL = [
    "ALTER TABLE trades ALTER COLUMN mode TYPE TEXT;",
    "ALTER TABLE trades ALTER COLUMN trade_date TYPE VARCHAR(50);",
    "ALTER TABLE trades ALTER COLUMN quantity TYPE VARCHAR(50);",
    "ALTER TABLE trades ALTER COLUMN price TYPE VARCHAR(50);",
    "ALTER TABLE trades ALTER COLUMN value_lacs TYPE VARCHAR(50);",
    "ALTER TABLE trades ALTER COLUMN percent TYPE VARCHAR(50);",
    "ALTER TABLE trades ALTER COLUMN trade_type TYPE VARCHAR(50);",
    "ALTER TABLE trades ADD COLUMN IF NOT EXISTS symbol VARCHAR(50);",
    "DO $$ BEGIN IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trades' AND column_name='stock_name') AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trades' AND column_name='symbol') THEN ALTER TABLE trades RENAME COLUMN stock_name TO symbol; ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='trades' AND column_name='stock_name') THEN ALTER TABLE trades DROP COLUMN stock_name; END IF; END $$;",
]

CREATE_SHP_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS shareholding_pattern (
    id               SERIAL PRIMARY KEY,
    symbol           VARCHAR(50)   NOT NULL,
    period           VARCHAR(20)   NOT NULL,
    period_type      VARCHAR(10)   NOT NULL DEFAULT 'quarterly',
    promoters        VARCHAR(10),
    fiis             VARCHAR(10),
    diis             VARCHAR(10),
    public           VARCHAR(10),
    num_shareholders VARCHAR(20),
    market_cap       VARCHAR(30),
    scraped_at       TIMESTAMP DEFAULT NOW(),
    UNIQUE (symbol, period, period_type)
);
"""

CREATE_FINANCIAL_METRICS_SQL = """
CREATE TABLE IF NOT EXISTS financial_metrics (
    id                  SERIAL PRIMARY KEY,
    symbol              VARCHAR(50) UNIQUE NOT NULL,
    q_last_period       VARCHAR(100),
    q_prev_period       VARCHAR(100),
    q_last_period_prev_month VARCHAR(100),
    q_sales_last_period VARCHAR(100),
    q_sales_prev_period VARCHAR(100),
    q_sales_last_period_prev_month VARCHAR(100),
    q_sales_growth_1    VARCHAR(100),
    q_sales_growth_2    VARCHAR(100),
    q_sales_yoy_growth  VARCHAR(100),
    q_opm_1             VARCHAR(100),
    q_opm_2             VARCHAR(100),
    fy_last_period      VARCHAR(100),
    fy_prev_period      VARCHAR(100),
    pl_sales_1          VARCHAR(100),
    pl_sales_2          VARCHAR(100),
    pl_opm_1            VARCHAR(100),
    pl_opm_2            VARCHAR(100),
    nt_profit_1         VARCHAR(100),
    nt_profit_2         VARCHAR(100),
    operating_profit_1  VARCHAR(100),
    operating_profit_2  VARCHAR(100),
    roe_1               VARCHAR(100),
    roe_2               VARCHAR(100),
    roce_1              VARCHAR(100),
    roce_2              VARCHAR(100),
    scraped_at          TIMESTAMP DEFAULT NOW()
);
"""

ALTER_FINANCIAL_METRICS_SQL = """
DO $$
DECLARE
    col RECORD;
BEGIN
    FOR col IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'financial_metrics' 
          AND data_type = 'character varying' 
          AND (character_maximum_length IS NULL OR character_maximum_length < 100)
    LOOP
        EXECUTE format('ALTER TABLE financial_metrics ALTER COLUMN %I TYPE VARCHAR(100);', col.column_name);
    END LOOP;
END$$;
"""

CREATE_COMPOUNDED_GROWTH_SQL = """
CREATE TABLE IF NOT EXISTS compounded_growth (
    id            SERIAL PRIMARY KEY,
    symbol        VARCHAR(50)   NOT NULL,
    metric_title  VARCHAR(100)  NOT NULL,
    period        VARCHAR(50)   NOT NULL,
    value         VARCHAR(50),
    scraped_at    TIMESTAMP DEFAULT NOW(),
    UNIQUE (symbol, metric_title, period)
);
"""

ALTER_COMPOUNDED_GROWTH_SQL = """
DO $$
DECLARE
    col RECORD;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='compounded_growth' AND column_name='symbol'
    ) THEN
        ALTER TABLE compounded_growth ADD COLUMN symbol VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'compounded_growth_symbol_metric_title_period_key'
    ) THEN
        ALTER TABLE compounded_growth ADD CONSTRAINT compounded_growth_symbol_metric_title_period_key UNIQUE (symbol, metric_title, period);
    END IF;

    FOR col IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'compounded_growth' 
          AND data_type = 'character varying' 
          AND (character_maximum_length IS NULL OR character_maximum_length < 100)
    LOOP
        EXECUTE format('ALTER TABLE compounded_growth ALTER COLUMN %I TYPE VARCHAR(100);', col.column_name);
    END LOOP;
END$$;
"""

ALTER_SHP_TABLE_SQL = """
DO $$
DECLARE
    col RECORD;
BEGIN
    -- Rename stock_name to symbol if stock_name exists and symbol does not
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='stock_name'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='symbol'
    ) THEN
        ALTER TABLE shareholding_pattern RENAME COLUMN stock_name TO symbol;
    END IF;

    -- Ensure symbol column exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='symbol'
    ) THEN
        ALTER TABLE shareholding_pattern ADD COLUMN symbol VARCHAR(50);
    END IF;

    -- Drop stock_name if still exists alongside symbol
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='stock_name'
    ) AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='symbol'
    ) THEN
        ALTER TABLE shareholding_pattern DROP COLUMN stock_name;
    END IF;

    -- Add period_type if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='period_type'
    ) THEN
        ALTER TABLE shareholding_pattern ADD COLUMN period_type VARCHAR(10) NOT NULL DEFAULT 'quarterly';
    END IF;

    -- Add market_cap if missing
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name='shareholding_pattern' AND column_name='market_cap'
    ) THEN
        ALTER TABLE shareholding_pattern ADD COLUMN market_cap VARCHAR(30);
    END IF;

    -- Drop old unique constraints
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'shareholding_pattern_stock_name_period_key'
    ) THEN
        ALTER TABLE shareholding_pattern DROP CONSTRAINT shareholding_pattern_stock_name_period_key;
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'shareholding_pattern_stock_name_period_period_type_key'
    ) THEN
        ALTER TABLE shareholding_pattern DROP CONSTRAINT shareholding_pattern_stock_name_period_period_type_key;
    END IF;

    -- Add new unique constraint on (symbol, period, period_type)
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'shareholding_pattern_symbol_period_period_type_key'
    ) THEN
        ALTER TABLE shareholding_pattern ADD CONSTRAINT shareholding_pattern_symbol_period_period_type_key UNIQUE (symbol, period, period_type);
    END IF;

    -- Expand any VARCHAR columns with length < 100 to VARCHAR(100)
    FOR col IN 
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'shareholding_pattern' 
          AND data_type = 'character varying' 
          AND (character_maximum_length IS NULL OR character_maximum_length < 100)
    LOOP
        EXECUTE format('ALTER TABLE shareholding_pattern ALTER COLUMN %I TYPE VARCHAR(100);', col.column_name);
    END LOOP;
END$$;
"""

# ---------------------------------------------------------------------------
# Proxy Rotation — country-based fetch from iplocate/free-proxy-list
# ---------------------------------------------------------------------------
PROXY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "all-proxies.txt")
IPLOCATE_BASE = (
    "https://raw.githubusercontent.com/iplocate/free-proxy-list/main/countries/{cc}/proxies.txt"
)
GEONODE_PROXY_API = (
    "https://proxylist.geonode.com/api/proxy-list"
    "?page=1&limit=500&sort_by=responseTime&sort_type=asc"
)
# Default country codes to pull when no --proxy-countries flag is given.
# Chosen for availability and low latency to typical scrape targets.
DEFAULT_PROXY_COUNTRIES = [
    "US", "DE", "GB", "FR", "NL", "SG", "HK", "JP", "CA", "AU",
    "IN", "BR", "RU", "UA", "PL", "SE", "TR", "ID", "VN", "KR",
]

log = logging.getLogger(__name__)


def _parse_proxy_lines(text: str) -> list:
    """Parse newline-separated 'scheme://ip:port' lines; auto-prefix bare ip:port."""
    proxies = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "://" not in line:
            line = f"http://{line}"
        proxies.append(line)
    return proxies


def _fetch_country_proxies(cc: str) -> list:
    """Fetch proxies.txt for one ISO-3166 country code. Returns [] on error."""
    url = IPLOCATE_BASE.format(cc=cc.upper())
    try:
        resp = _requests.get(url, timeout=10)
        if resp.status_code == 404:
            log.debug(f"[proxy] No proxies for country {cc} (404).")
            return []
        resp.raise_for_status()
        proxies = _parse_proxy_lines(resp.text)
        log.debug(f"[proxy] {cc}: {len(proxies)} proxies fetched.")
        return proxies
    except Exception as exc:
        log.debug(f"[proxy] {cc}: failed ({exc}).")
        return []


def fetch_proxy_list(countries: list | None = None) -> list:
    """
    Load proxies using the following priority:

    1. Country-based fetch  — download proxies.txt for each ISO-3166 country
       code from https://github.com/iplocate/free-proxy-list (parallel fetch).
    2. Local file fallback  — all-proxies.txt in the same directory.
    3. GeoNode API fallback — if neither of the above yields results.

    Returns a shuffled list of 'scheme://ip:port' strings.
    """
    import concurrent.futures

    chosen = [c.strip().upper() for c in (countries or DEFAULT_PROXY_COUNTRIES) if c.strip()]
    log.info(f"[proxy] Fetching proxies for countries: {', '.join(chosen)}")

    # --- Primary: fetch per-country files in parallel ---
    proxies: list[str] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(_fetch_country_proxies, cc): cc for cc in chosen}
        for fut in concurrent.futures.as_completed(futures):
            proxies.extend(fut.result())

    if proxies:
        # Deduplicate while preserving order
        seen: set[str] = set()
        unique = [p for p in proxies if not (p in seen or seen.add(p))]
        random.shuffle(unique)
        log.info(f"[proxy] Loaded {len(unique)} proxies from {len(chosen)} countries (iplocate).")
        return unique

    # --- Secondary: local all-proxies.txt ---
    if os.path.isfile(PROXY_FILE):
        log.warning(f"[proxy] Country fetch returned 0 results. Falling back to {PROXY_FILE}.")
        with open(PROXY_FILE, "r", encoding="utf-8") as fh:
            proxies = _parse_proxy_lines(fh.read())
        random.shuffle(proxies)
        log.info(f"[proxy] Loaded {len(proxies)} proxies from {PROXY_FILE}.")
        return proxies

    # --- Tertiary: GeoNode REST API ---
    log.warning("[proxy] Falling back to GeoNode API.")
    try:
        resp = _requests.get(GEONODE_PROXY_API, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        proxies = []
        for item in data.get("data", []):
            ip, port = item.get("ip", ""), item.get("port", "")
            if ip and port:
                scheme = "https" if "https" in item.get("protocols", []) else "http"
                proxies.append(f"{scheme}://{ip}:{port}")
        random.shuffle(proxies)
        log.info(f"[proxy] Loaded {len(proxies)} proxies from GeoNode API.")
        return proxies
    except Exception as exc:
        log.warning(f"[proxy] Failed to fetch proxy list: {exc}. Running without proxies.")
        return []


# ---------------------------------------------------------------------------
# Trade helpers
# ---------------------------------------------------------------------------
BUY_ALIASES  = {"buy", "b", "purchase", "acquisition"}
SELL_ALIASES = {"sell", "sale", "s", "disposal"}

def normalise_buysell(raw: str) -> str:
    if not raw:
        return ""
    val = raw.strip().lower()
    if val in BUY_ALIASES:
        return "Buy"
    if val in SELL_ALIASES:
        return "Sell"
    return raw.strip()

DATE_FORMATS = ["%b %Y", "%d %b %Y"]

def parse_date_header(text: str):
    for fmt in DATE_FORMATS:
        try:
            datetime.strptime(text.strip(), fmt)
            return text.strip()
        except ValueError:
            pass
    return None

def get_target_quarter(dt: datetime = None) -> str:
    """
    Returns expected target quarter string for shareholding pattern data based on current date.
    Quarterly shareholding updates every 3 months:
      - Jan, Feb, Mar (months 1..3) -> Dec of previous year (e.g. 'Dec 2025')
      - Apr, May, Jun (months 4..6) -> Mar of current year (e.g. 'Mar 2026')
      - Jul, Aug, Sep (months 7..9) -> Jun of current year (e.g. 'Jun 2026')
      - Oct, Nov, Dec (months 10..12) -> Sep of current year (e.g. 'Sep 2026')
    """
    if dt is None:
        dt = datetime.now()
    m = dt.month
    y = dt.year
    if m in (1, 2, 3):
        return f"Dec {y - 1}"
    elif m in (4, 5, 6):
        return f"Mar {y}"
    elif m in (7, 8, 9):
        return f"Jun {y}"
    else:
        return f"Sep {y}"

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG)

def ensure_table():
    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
        for sql in MIGRATE_SQL:
            cur.execute(sql)
        cur.execute(CREATE_SHP_TABLE_SQL)
        cur.execute(ALTER_SHP_TABLE_SQL)
        cur.execute(CREATE_FINANCIAL_METRICS_SQL)
        cur.execute(ALTER_FINANCIAL_METRICS_SQL)
        cur.execute(CREATE_COMPOUNDED_GROWTH_SQL)
        cur.execute(ALTER_COMPOUNDED_GROWTH_SQL)
    conn.commit()
    conn.close()
    sync_db_with_nifty_750()

def sync_db_with_nifty_750():
    """
    Checks nifty_750 table and removes records from 'trades' and 'shareholding_pattern'
    for any stocks that are no longer available in nifty_750.
    """
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("""
                DELETE FROM trades
                WHERE symbol IS NOT NULL
                  AND symbol != ''
                  AND UPPER(symbol) NOT IN (
                      SELECT UPPER(symbol) FROM nifty_750 WHERE symbol IS NOT NULL AND symbol != ''
                  );
            """)
            deleted_trades = cur.rowcount

            cur.execute("""
                DELETE FROM shareholding_pattern
                WHERE symbol IS NOT NULL
                  AND symbol != ''
                  AND UPPER(symbol) NOT IN (
                      SELECT UPPER(symbol) FROM nifty_750 WHERE symbol IS NOT NULL AND symbol != ''
                  );
            """)
            deleted_shp = cur.rowcount

        conn.commit()
        conn.close()
        print(f"[db] Synced with nifty_750: Removed {deleted_trades} obsolete trade record(s) and {deleted_shp} obsolete shareholding record(s).")
    except Exception as e:
        print(f"[db] Error syncing with nifty_750: {e}")

def fetch_stock_links():
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(symbol, ''), stock_link FROM nifty_750 WHERE stock_link IS NOT NULL;")
            rows = cur.fetchall()
        conn.close()
    except Exception as e:
        print(f"[db] ERROR fetching nifty_750: {e}")
        return []

    stocks = []
    for sym, link in rows:
        link = (link or "").strip().rstrip("/")
        if not sym:
            parts = [p for p in link.split("/") if p]
            try:
                idx = parts.index("company")
                sym = parts[idx + 1].upper()
            except (ValueError, IndexError):
                sym = parts[-1].upper() if parts else "UNKNOWN"
        stocks.append((sym.upper(), link))
    return stocks

def fetch_stocks_with_target_shp(target_period: str) -> set:
    """
    Returns set of stock tickers (uppercase) that already have a quarterly 
    shareholding entry for target_period (e.g. 'Jun 2026').
    """
    try:
        conn = get_db_conn()
        with conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT UPPER(symbol) FROM shareholding_pattern WHERE period = %s AND period_type = 'quarterly';",
                (target_period,)
            )
            rows = cur.fetchall()
        conn.close()
        return {r[0] for r in rows if r[0]}
    except Exception as e:
        print(f"[db] Error checking shareholding_pattern for target period '{target_period}': {e}")
        return set()


# ---------------------------------------------------------------------------
# Scrapy Spider
# ---------------------------------------------------------------------------
class ScreenerTradesSpider(scrapy.Spider):
    name = "screener_trades_spider"
    allowed_domains = ["screener.in"]
    start_urls = ["https://www.screener.in/login/?"]

    custom_settings = {
        'USER_AGENT': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'CONCURRENT_REQUESTS': 2,
        'DOWNLOAD_DELAY': 2,
        'RETRY_TIMES': 5,
        'RETRY_HTTP_CODES': [500, 502, 503, 504, 522, 524, 408, 429],
        'COOKIES_ENABLED': True,
        'LOG_LEVEL': 'INFO',
        'RANDOMIZE_DOWNLOAD_DELAY': True,
        'AUTOTHROTTLE_ENABLED': True,
        'AUTOTHROTTLE_START_DELAY': 5,
        'AUTOTHROTTLE_MAX_DELAY': 10,
        'AUTOTHROTTLE_TARGET_CONCURRENCY': 1,
        'AUTOTHROTTLE_DEBUG': True,
        # NOTE: ROTATING_PROXY_LIST is intentionally NOT set here.
        # custom_settings (priority 30) overrides CrawlerProcess settings (priority 20),
        # so setting it to [] here would wipe out the real proxy list every time.
        # It is injected exclusively via CrawlerProcess(settings={...}) in main().
        'DOWNLOADER_MIDDLEWARES': {
            # Disable the default User-Agent middleware so our USER_AGENT above is used
            'scrapy.downloadermiddlewares.useragent.UserAgentMiddleware': None,
            # Built-in retry middleware
            'scrapy.downloadermiddlewares.retry.RetryMiddleware': 550,
        },
    }


    def __init__(self, username=None, password=None, company=None, *args, **kwargs):
        super(ScreenerTradesSpider, self).__init__(*args, **kwargs)
        self.username = username or SCREENER_USER
        self.password = password or SCREENER_PASS
        self.target_company = company
        self.scraped_records = []
        self.scraped_shp_records = []
        self.scraped_fm_records = []
        self.scraped_cg_records = []
        self.target_quarter = get_target_quarter()
        self.logger.info(f"Target quarter for shareholding pattern check: {self.target_quarter}")

    def parse(self, response):
        """Extract CSRF token and submit login request if password provided, otherwise proceed directly."""
        csrf_token = response.css('input[name="csrfmiddlewaretoken"]::attr(value)').get()
        if csrf_token and self.password:
            yield FormRequest(
                url="https://www.screener.in/login/?",
                formdata={
                    'username': self.username,
                    'password': self.password,
                    'csrfmiddlewaretoken': csrf_token
                },
                headers={'Referer': 'https://www.screener.in/login/?'},
                callback=self.after_login
            )
        else:
            self.logger.warning("No password provided for Screener.in login. Proceeding to scrape company data.")
            yield from self.start_crawling_companies()

    def after_login(self, response):
        """Check authentication status and begin scraping companies."""
        if "login" in response.url:
            self.logger.warning("Login failed. Screener.in credentials may be invalid. Proceeding to scrape company data.")
        else:
            self.logger.info("Successfully logged into Screener.in!")

        yield from self.start_crawling_companies()

    def start_crawling_companies(self):
        if self.target_company:
            stock_url = f"https://www.screener.in/company/{self.target_company.upper()}/consolidated/"
            yield Request(
                url=stock_url,
                callback=self.parse_company_page,
                meta={'ticker': self.target_company.upper()}
            )
        else:
            stocks = fetch_stock_links()
            self.logger.info(f"Loaded {len(stocks)} stocks from nifty_750 to scrape.")
            for ticker, link in stocks:
                full_url = link if link.startswith("http") else f"https://www.screener.in{link}"
                yield Request(
                    url=full_url,
                    callback=self.parse_company_page,
                    meta={'ticker': ticker}
                )

    def parse_company_page(self, response):
        """Extract shareholding pattern, financial metrics and trades modal endpoint from company page."""
        ticker = response.meta.get('ticker')
        is_fallback = response.meta.get('is_fallback', False)

        # 1. Shareholding Pattern Scraping
        shp_records = self.parse_shareholding_pattern(response, ticker)
        if shp_records:
            self.logger.info(f"Collected {len(shp_records)} shareholding records for {ticker}")

        # 2. Financial Metrics Scraping (ROCE, ROE, quarterly/annual tables)
        fm = {"symbol": ticker}
        fm.update(self.parse_quarterly_results(response))
        fm.update(self.parse_profit_loss(response))
        fm.update(self.parse_balance_sheet(response))

        # 3. Compounded Growth Metrics Scraping (Compounded Sales/Profit Growth, CAGR, ROE)
        cg_records = self.parse_compounded_growth(response, ticker)

        # Smart Fallback: If financial metrics or compounded growth are empty/null (e.g. empty consolidated page)
        has_valid_cg = any(r.get("value") for r in cg_records)
        has_valid_fm = any(v for k, v in fm.items() if k != "symbol" and v)

        if not is_fallback and not (has_valid_cg or has_valid_fm):
            fallback_url = f"https://www.screener.in/company/{ticker}/"
            if response.url != fallback_url:
                self.logger.warning(f"Financial data for {ticker} at {response.url} is empty. Retrying with default company page: {fallback_url}")
                yield Request(
                    url=fallback_url,
                    callback=self.parse_company_page,
                    meta={'ticker': ticker, 'is_fallback': True},
                    dont_filter=True
                )
                return

        if cg_records:
            self.logger.info(f"Collected {len(cg_records)} compounded growth records for {ticker}")

        # 4. Trades Data Scraping
        trades_url = response.xpath("//button[contains(@data-url, '/trades/')]/@data-url").get()
        if not trades_url:
            self.logger.warning(f"No Trades modal data-url found for: {ticker}")
            self.save_stock_data(ticker, [], shp_records, fm, cg_records)
            return

        full_trades_url = response.urljoin(trades_url)
        self.logger.info(f"Found Trades URL for {ticker}: {full_trades_url}")

        yield Request(
            url=full_trades_url,
            callback=self.parse_trades_modal,
            meta={'ticker': ticker, 'shp': shp_records, 'fm': fm, 'cg': cg_records}
        )

    # -----------------------------------------------------------------------
    # Financial Metrics Parsers
    # -----------------------------------------------------------------------

    def parse_quarterly_results(self, response) -> dict:
        """Extract YOY Sales Growth % (last 2 + same-quarter-last-year) and OPM % (last 2)."""
        section = response.xpath("//section[@id='quarters']")
        if not section:
            return {}

        def clean_label(td_node):
            text = td_node.xpath("string()").get("").replace("\xa0", " ").strip()
            return text.rstrip("+").strip().lower()

        def pct_change(v1, v2):
            try:
                a = float(v1.replace(",", ""))
                b = float(v2.replace(",", ""))
                if b == 0:
                    return ""
                return str(round((a - b) / abs(b) * 100, 2))
            except Exception:
                return ""

        # Period headers live in <thead>, not in <tbody> rows
        period = [
            th.xpath("string()").get("").strip()
            for th in section.xpath(".//thead//th")[1:]  # skip the row-label column
            if th.xpath("string()").get("").strip()
        ]

        row_data = {}
        for row in section.xpath(".//tbody/tr"):
            tds = row.xpath("./td")
            if not tds:
                continue
            lbl = clean_label(tds[0])
            vals = [td.xpath("string()").get("").strip() for td in tds[1:]]
            if lbl == "sales":
                row_data["sales"] = vals
            elif lbl == "operating profit":
                row_data["opm"] = vals

        result = {}
        sales = row_data.get("sales", [])
        opm = row_data.get("opm", [])

        # Period labels (e.g. "Mar 2026", "Dec 2025", "Mar 2025")
        result["q_last_period"] = period[-1] if len(period) >= 1 else ""
        result["q_prev_period"] = period[-2] if len(period) >= 2 else ""
        result["q_last_period_prev_month"] = period[-5] if len(period) >= 5 else ""

        # Latest period raw Sales value (e.g. 4,528 for Mar 2026)
        result["q_sales_last_period"] = sales[-1].replace(",", "").strip() if len(sales) >= 1 else ""
        result["q_sales_prev_period"] = sales[-2].replace(",", "").strip() if len(sales) >= 2 else ""
        result["q_sales_last_period_prev_month"] = sales[-5].replace(",", "").strip() if len(sales) >= 5 else ""

        # OPM Value — last 2 quarters (most recent at end of list)
        result["q_opm_1"] = opm[-1].replace(",", "").strip() if len(opm) >= 1 else ""
        result["q_opm_2"] = opm[-2].replace(",", "").strip() if len(opm) >= 2 else ""

        # Sales Growth — last 2 sequential quarters
        result["q_sales_growth_1"] = pct_change(sales[-1], sales[-2]) if len(sales) >= 2 else ""
        result["q_sales_growth_2"] = pct_change(sales[-2], sales[-3]) if len(sales) >= 3 else ""

        # Same quarter last year: col[-1] vs col[-5] (4 quarters back = 1 year)
        result["q_sales_yoy_growth"] = pct_change(sales[-1], sales[-5]) if len(sales) >= 5 else ""

        return result

    def parse_profit_loss(self, response) -> dict:
        """Extract Sales Growth %, OPM %, Profit for EPS, Profit Growth % — last 2 annual periods."""
        section = response.xpath("//section[@id='profit-loss']")
        if not section:
            return {}

        def clean_label(td_node):
            text = td_node.xpath("string()").get("").replace("\xa0", " ").strip()
            return text.rstrip("+").strip().lower()

        def pct_change(v1, v2):
            try:
                a = float(v1.replace(",", ""))
                b = float(v2.replace(",", ""))
                if b == 0:
                    return ""
                return str(round((a - b) / abs(b) * 100, 2))
            except Exception:
                return ""

        # Period headers live in <thead>, not in <tbody> rows
        period = [
            th.xpath("string()").get("").strip()
            for th in section.xpath(".//thead//th")[1:]  # skip the row-label column
            if th.xpath("string()").get("").strip()
        ]

        row_data = {}
        for row in section.xpath(".//tbody/tr"):
            tds = row.xpath("./td")
            if not tds:
                continue
            lbl = clean_label(tds[0])
            vals = [td.xpath("string()").get("").strip() for td in tds[1:]]
            if lbl == "sales":
                row_data["sales"] = vals
            elif lbl == "opm %":
                row_data["opm"] = vals
            elif lbl == "net profit":
                row_data["profit"] = vals
            elif lbl == "operating profit":
                row_data["operating_profit"] = vals

        sales            = row_data.get("sales", [])
        opm              = row_data.get("opm", [])
        profit           = row_data.get("profit", [])
        operating_profit = row_data.get("operating_profit", [])

        # Use POSITIVE indices so range() arithmetic works correctly.
        # Negative-index-based range() (e.g. range(-2, -1, -1)) is always empty.
        last_mar_idx = next(
            (i for i in range(len(period) - 1, -1, -1) if period[i].startswith("Mar")),
            None
        )
        second_last_mar_idx = next(
            (i for i in range(last_mar_idx - 1, -1, -1) if period[i].startswith("Mar")),
            None
        ) if last_mar_idx is not None else None

        def _get(lst, idx):
            """Safely fetch list[idx] (positive int); strip commas/%; return ''"""
            if idx is None or not lst or idx >= len(lst):
                return ""
            return lst[idx].replace(",", "").replace("%", "").strip()

        fy_last_period = period[last_mar_idx]        if last_mar_idx        is not None else ""
        fy_prev_period = period[second_last_mar_idx] if second_last_mar_idx is not None else ""

        opm1 = _get(opm,   last_mar_idx)
        opm2 = _get(opm,   second_last_mar_idx)
        pe1  = _get(profit, last_mar_idx)
        pe2  = _get(profit, second_last_mar_idx)
        sg1  = _get(sales,  last_mar_idx)
        sg2  = _get(sales,  second_last_mar_idx)
        op1  = _get(operating_profit, last_mar_idx)
        op2  = _get(operating_profit, second_last_mar_idx)

        return {
            "fy_last_period":     fy_last_period,
            "fy_prev_period":     fy_prev_period,
            "pl_sales_1":         sg1,
            "pl_sales_2":         sg2,
            "pl_opm_1":           opm1,
            "pl_opm_2":           opm2,
            "nt_profit_1":        pe1,
            "nt_profit_2":        pe2,
            "operating_profit_1": op1,
            "operating_profit_2": op2,
        }

    def parse_balance_sheet(self, response) -> dict:
        """Extract latest Equity Capital and Reserves from Balance Sheet."""
        section = response.xpath("//section[@id='balance-sheet']")
        if not section:
            return {}

        def clean_label(td_node):
            text = td_node.xpath("string()").get("").replace("\xa0", " ").strip()
            return text.rstrip("+").strip().lower()

        period = [
            th.xpath("string()").get("").strip()
            for th in section.xpath(".//thead//th")[1:]  # skip the row-label column
            if th.xpath("string()").get("").strip()
        ]

        row_data = {}
        for row in section.xpath(".//tbody/tr"):
            tds = row.xpath("./td")
            if not tds:
                continue
            lbl = clean_label(tds[0])
            vals = [td.xpath("string()").get("").strip() for td in tds[1:]]
            if lbl == "equity capital":
                row_data["equity"] = vals
            elif lbl == "reserves":
                row_data["reserves"] = vals
            elif lbl == "borrowings":
                row_data["borrowings"] = vals

        eq  = row_data.get("equity",    [])
        res = row_data.get("reserves",  [])
        brw = row_data.get("borrowings", [])

        # Use POSITIVE indices (same fix as parse_profit_loss)
        last_mar_idx = next(
            (i for i in range(len(period) - 1, -1, -1) if period[i].startswith("Mar")),
            None
        )
        second_last_mar_idx = next(
            (i for i in range(last_mar_idx - 1, -1, -1) if period[i].startswith("Mar")),
            None
        ) if last_mar_idx is not None else None

        def _safe_float(lst, idx):
            """Safely parse a float from lst[idx] (positive). Returns 0.0 on any error."""
            if idx is None or not lst or idx >= len(lst):
                return 0.0
            try:
                return float(lst[idx].replace(",", "").strip())
            except (ValueError, AttributeError):
                return 0.0

        eq_1  = _safe_float(eq,  last_mar_idx)
        eq_2  = _safe_float(eq,  second_last_mar_idx)
        res_1 = _safe_float(res, last_mar_idx)
        res_2 = _safe_float(res, second_last_mar_idx)
        brw_1 = _safe_float(brw, last_mar_idx)
        brw_2 = _safe_float(brw, second_last_mar_idx)

        # roe  = equity + reserves   (net worth / shareholders' equity)
        # roce = equity + reserves + borrowings  (capital employed)
        # Store as strings to match VARCHAR(20) columns
        roe_1  = str(round(eq_1  + res_1,        2)) if (eq_1  or res_1)  else ""
        roe_2  = str(round(eq_2  + res_2,        2)) if (eq_2  or res_2)  else ""
        roce_1 = str(round(eq_1  + res_1 + brw_1, 2)) if (eq_1 or res_1) else ""
        roce_2 = str(round(eq_2  + res_2 + brw_2, 2)) if (eq_2 or res_2) else ""

        return {
            "roe_1":  roe_1,
            "roe_2":  roe_2,
            "roce_1": roce_1,
            "roce_2": roce_2,
        }

    def parse_compounded_growth(self, response, ticker: str) -> list:
        """Extract Compounded Sales Growth, Compounded Profit Growth, Stock Price CAGR, Return on Equity tables from #profit-loss."""
        section = response.xpath("//section[@id='profit-loss']")
        if not section:
            return []

        tables = section.xpath(".//table[contains(@class,'ranges-table')]")
        records = []
        for tbl in tables:
            title = tbl.xpath(".//th//text()").get("").strip()
            if not title:
                continue
            for tr in tbl.xpath(".//tr[td]"):
                tds = tr.xpath("./td")
                if len(tds) >= 2:
                    period = tds[0].xpath("string()").get("").strip().rstrip(":")
                    val = tds[1].xpath("string()").get("").strip()
                    if val == "%":
                        val = ""
                    records.append({
                        "symbol": ticker,
                        "metric_title": title,
                        "period": period,
                        "value": val,
                    })
        return records

    # -----------------------------------------------------------------------
    # Shareholding Pattern Parser (unchanged)
    # -----------------------------------------------------------------------

    def parse_shareholding_pattern(self, response, ticker: str) -> list:
        """Parse quarterly and yearly shareholding pattern tables from company page response."""
        ROW_KEYS = {
            "promoters":           "promoters",
            "fiis":                "fiis",
            "diis":                "diis",
            "public":              "public",
            "no. of shareholders": "num_shareholders",
        }
        
        market_cap = ""
        li = response.xpath("//ul[@id='top-ratios']//li[.//span[contains(@class,'name') and contains(text(),'Market Cap')]]")
        if li:
            val_parts = li.xpath(".//span[contains(@class,'value')]//text()").getall()
            market_cap = "".join([v.strip() for v in val_parts if v.strip()]).replace("₹", "").replace("Cr.", "").strip()

        tables = response.xpath("//section[contains(@id,'shareholding')]//table[contains(@class,'data-table')]")
        if not tables:
            return []

        all_recs = []
        for idx, period_type in enumerate(["quarterly", "yearly"]):
            if idx >= len(tables):
                break
            table_sel = tables[idx]
            header_cells = table_sel.xpath(".//thead/tr/th")
            periods = [c.xpath("string()").get("").strip() for c in header_cells[1:] if c.xpath("string()").get("").strip()]
            if not periods:
                continue
            
            row_data = {}
            body_rows = table_sel.xpath(".//tbody/tr")
            for row in body_rows:
                tds = row.xpath("./td")
                if not tds:
                    continue
                raw_text = tds[0].xpath("string()").get("").strip()
                lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
                if not lines:
                    continue
                label_raw = lines[0].lower().rstrip("+").strip()
                
                matched_key = None
                for prefix, key in ROW_KEYS.items():
                    if label_raw.startswith(prefix):
                        matched_key = key
                        break
                if not matched_key:
                    continue
                
                vals = [c.xpath("string()").get("").strip() for c in tds[1:]]
                row_data[matched_key] = vals

            for col_idx, per in enumerate(periods):
                rec = {
                    "symbol": ticker,
                    "period": per,
                    "period_type": period_type,
                    "market_cap": market_cap,
                }
                for key in ("promoters", "fiis", "diis", "public", "num_shareholders"):
                    v = row_data.get(key, [])
                    rec[key] = v[col_idx] if col_idx < len(v) else ""
                all_recs.append(rec)

        return all_recs

    def parse_trades_modal(self, response):
        """Parse company trades tables from the trades modal HTML response."""
        ticker = response.meta.get('ticker')
        shp_records = response.meta.get('shp', [])
        fm_record = response.meta.get('fm', None)
        self.logger.info(f"Parsing Trades Modal HTML for: {ticker}")

        tabs = {
            "trades-insider-trades": "Insider Trades",
            "trades-bulk-deals":     "Bulk Deals",
            "trades-block-deals":    "Block Deals",
            "trades-sast-trades":    "Sast Trades",
        }

        stock_trades = []

        for div_id, trade_type in tabs.items():
            tab_div = response.xpath(f"//div[@id='{div_id}']")
            if not tab_div:
                continue

            rows = tab_div.xpath(".//table[contains(@class,'data-table')]/tbody/tr")
            current_date = ""

            for row in rows:
                tds = row.xpath("./td")
                if not tds:
                    continue

                if len(tds) == 1:
                    raw_text = tds[0].xpath("string()").get("").strip()
                    parsed_dt = parse_date_header(raw_text)
                    if parsed_dt:
                        current_date = parsed_dt
                    continue

                def extract_person_name(td_node):
                    if not td_node:
                        return ""
                    raw_text = td_node.xpath("string()").get("").strip()
                    if not raw_text:
                        return ""
                    lines = [l.strip() for l in raw_text.splitlines() if l.strip()]
                    return lines[0] if lines else ""

                if trade_type == "Insider Trades":
                    person_name = extract_person_name(tds[0])
                    designation = tds[0].xpath(".//*[contains(@class,'badge') or contains(@class,'tag') or contains(@class,'sub') or contains(@class,'designation')]/text()").get("")
                    if not designation and len(tds[0].xpath(".//text()").getall()) > 1:
                        all_texts = [t.strip() for t in tds[0].xpath(".//text()").getall() if t.strip()]
                        if len(all_texts) > 1 and all_texts[0] == person_name:
                            designation = all_texts[1]

                    qty_raw = tds[1].xpath("string()").get("").strip() if len(tds) > 1 else ""
                    buy_sell = "Sell" if qty_raw.lstrip().startswith("-") else "Buy"
                    price = tds[2].xpath("string()").get("").strip() if len(tds) > 2 else ""
                    val_lacs = tds[3].xpath("string()").get("").strip() if len(tds) > 3 else ""

                    record = {
                        "date": current_date,
                        "person_name": person_name,
                        "designation": designation.strip() if designation else "",
                        "buy_sell": buy_sell,
                        "quantity": qty_raw,
                        "price": price,
                        "value_lacs": val_lacs,
                        "mode": "",
                        "percent": "",
                        "symbol": ticker,
                        "trade_type": trade_type
                    }
                    stock_trades.append(record)

                elif trade_type in ["Bulk Deals", "Block Deals"]:
                    person_name = extract_person_name(tds[0])
                    raw_bs = tds[1].xpath("string()").get("").strip() if len(tds) > 1 else ""
                    qty = tds[2].xpath("string()").get("").strip() if len(tds) > 2 else ""
                    price = tds[3].xpath("string()").get("").strip() if len(tds) > 3 else ""

                    record = {
                        "date": current_date,
                        "person_name": person_name,
                        "designation": "",
                        "buy_sell": normalise_buysell(raw_bs),
                        "quantity": qty,
                        "price": price,
                        "value_lacs": "",
                        "mode": "",
                        "percent": "",
                        "symbol": ticker,
                        "trade_type": trade_type
                    }
                    stock_trades.append(record)

                elif trade_type == "Sast Trades":
                    person_name = extract_person_name(tds[0])
                    raw_txn = tds[1].xpath("string()").get("").strip() if len(tds) > 1 else ""
                    mode = tds[2].xpath("string()").get("").strip() if len(tds) > 2 else ""
                    qty = tds[3].xpath("string()").get("").strip() if len(tds) > 3 else ""
                    percent = tds[4].xpath("string()").get("").strip() if len(tds) > 4 else ""

                    record = {
                        "date": current_date,
                        "person_name": person_name,
                        "designation": "",
                        "buy_sell": normalise_buysell(raw_txn),
                        "quantity": qty,
                        "price": "",
                        "value_lacs": "",
                        "mode": mode,
                        "percent": percent,
                        "symbol": ticker,
                        "trade_type": trade_type
                    }
                    stock_trades.append(record)

        cg_records = response.meta.get('cg', [])
        self.save_stock_data(ticker, stock_trades, shp_records, fm_record, cg_records)

    def save_stock_data(self, ticker, trades, shp, fm, cg=None):
        """Save a single stock's scraped records to DB immediately after scraping."""
        self.scraped_records.extend(trades)
        if shp:
            self.scraped_shp_records.extend(shp)
        if fm:
            self.scraped_fm_records.append(fm)
        if cg:
            self.scraped_cg_records.extend(cg)

        try:
            saved_t = save_trades_for_stock(ticker, trades)
            saved_s = save_shp_records_to_db(shp) if shp else 0
            saved_f = save_fm_records_to_db([fm]) if fm else 0
            saved_c = save_cg_records_to_db(cg) if cg else 0
            self.logger.info(f"[db] Saved {ticker} -> {saved_t} trades, {saved_s} shareholding, {saved_f} financial metrics, {saved_c} compounded growth")
        except Exception as e:
            self.logger.error(f"[db] Error saving data for {ticker}: {e}")


# ---------------------------------------------------------------------------
# Computed Metric Helper
# ---------------------------------------------------------------------------
def compute_overall_roe(pl_profit_eps_1: str, bs_equity_capital: str, bs_reserves: str) -> str:
    """overall_roe = Profit after tax / (Equity Capital + Reserves) * 100."""
    try:
        profit    = float(pl_profit_eps_1.replace(",", "").strip())
        equity    = float(bs_equity_capital.replace(",", "").strip())
        reserves  = float(bs_reserves.replace(",", "").strip())
        net_worth = equity + reserves
        if net_worth == 0:
            return ""
        return str(round((profit / net_worth) * 100, 2))
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Database Save Helpers
# ---------------------------------------------------------------------------
def save_trades_for_stock(symbol: str, records: list) -> int:
    """
    Delete existing trades for this symbol and insert newly scraped trades immediately.
    """
    conn = get_db_conn()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM trades WHERE UPPER(symbol) = UPPER(%s);", (symbol,))
        if records:
            rows = [
                (
                    str(r.get("date", ""))[:100],
                    str(r.get("person_name", ""))[:500],
                    str(r.get("designation", ""))[:500],
                    str(r.get("buy_sell", ""))[:20],
                    str(r.get("quantity", ""))[:100],
                    str(r.get("price", ""))[:100],
                    str(r.get("value_lacs", ""))[:100],
                    str(r.get("mode", ""))[:500],
                    str(r.get("percent", ""))[:100],
                    str(r.get("symbol", symbol))[:50],
                    str(r.get("trade_type", ""))[:100],
                )
                for r in records
            ]
            sql = """
                INSERT INTO trades
                    (trade_date, person, designation, buy_sell, quantity, price,
                     value_lacs, mode, percent, symbol, trade_type)
                VALUES %s
            """
            execute_values(cur, sql, rows)
    conn.commit()
    conn.close()
    return len(records)

def save_records_to_db(records):
    """Fallback bulk save for trades (if needed)."""
    if not records:
        print("[db] No trade records collected to save.")
        return 0

    conn = get_db_conn()
    ensure_table()

    rows = []
    for r in records:
        rows.append((
            str(r.get("date", ""))[:100],
            str(r.get("person_name", ""))[:500],
            str(r.get("designation", ""))[:500],
            str(r.get("buy_sell", ""))[:20],
            str(r.get("quantity", ""))[:100],
            str(r.get("price", ""))[:100],
            str(r.get("value_lacs", ""))[:100],
            str(r.get("mode", ""))[:500],
            str(r.get("percent", ""))[:100],
            str(r.get("symbol", ""))[:50],
            str(r.get("trade_type", ""))[:100],
        ))

    sql = """
        INSERT INTO trades
            (trade_date, person, designation, buy_sell, quantity, price,
             value_lacs, mode, percent, symbol, trade_type)
        VALUES %s
    """
    with conn.cursor() as cur:
        print("[db] Clearing existing trade data from table 'trades' (resetting ID sequence to 1)...")
        cur.execute("TRUNCATE TABLE trades RESTART IDENTITY;")
        execute_values(cur, sql, rows)
    conn.commit()
    conn.close()
    print(f"[db] Inserted {len(rows)} record(s) into trading_db.trades.")
    return len(rows)

def save_shp_records_to_db(records: list) -> int:
    if not records:
        return 0

    rows = [
        (
            str(r["symbol"])[:50],
            str(r["period"])[:100],
            str(r.get("period_type", "quarterly"))[:50],
            str(r.get("promoters", ""))[:100],
            str(r.get("fiis", ""))[:100],
            str(r.get("diis", ""))[:100],
            str(r.get("public", ""))[:100],
            str(r.get("num_shareholders", ""))[:100],
            str(r.get("market_cap", ""))[:100],
        )
        for r in records
        if r.get("symbol")
    ]

    sql = """
        INSERT INTO shareholding_pattern
            (symbol, period, period_type, promoters, fiis, diis, public, num_shareholders, market_cap)
        VALUES %s
        ON CONFLICT (symbol, period, period_type)
        DO UPDATE SET
            promoters        = EXCLUDED.promoters,
            fiis             = EXCLUDED.fiis,
            diis             = EXCLUDED.diis,
            public           = EXCLUDED.public,
            num_shareholders = EXCLUDED.num_shareholders,
            market_cap       = EXCLUDED.market_cap,
            scraped_at       = NOW()
    """
    conn = get_db_conn()
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    conn.close()
    return len(rows)


def save_fm_records_to_db(records: list) -> int:
    """Upsert financial metrics records into financial_metrics table."""
    if not records:
        return 0

    rows = [
        (
            str(r.get("symbol", ""))[:50],
            str(r.get("q_last_period", ""))[:100],
            str(r.get("q_prev_period", ""))[:100],
            str(r.get("q_last_period_prev_month", ""))[:100],
            str(r.get("q_sales_last_period", ""))[:100],
            str(r.get("q_sales_prev_period", ""))[:100],
            str(r.get("q_sales_last_period_prev_month", ""))[:100],
            str(r.get("q_sales_growth_1", ""))[:100],
            str(r.get("q_sales_growth_2", ""))[:100],
            str(r.get("q_sales_yoy_growth", ""))[:100],
            str(r.get("q_opm_1", ""))[:100],
            str(r.get("q_opm_2", ""))[:100],
            str(r.get("fy_last_period", ""))[:100],
            str(r.get("fy_prev_period", ""))[:100],
            str(r.get("pl_sales_1", ""))[:100],
            str(r.get("pl_sales_2", ""))[:100],
            str(r.get("pl_opm_1", ""))[:100],
            str(r.get("pl_opm_2", ""))[:100],
            str(r.get("nt_profit_1", ""))[:100],
            str(r.get("nt_profit_2", ""))[:100],
            str(r.get("operating_profit_1", ""))[:100],
            str(r.get("operating_profit_2", ""))[:100],
            str(r.get("roe_1", ""))[:100],
            str(r.get("roe_2", ""))[:100],
            str(r.get("roce_1", ""))[:100],
            str(r.get("roce_2", ""))[:100],
        )
        for r in records
        if r.get("symbol")
    ]

    sql = """
        INSERT INTO financial_metrics
            (symbol,
             q_last_period, q_prev_period, q_last_period_prev_month,
             q_sales_last_period, q_sales_prev_period, q_sales_last_period_prev_month,
             q_sales_growth_1, q_sales_growth_2, q_sales_yoy_growth,
             q_opm_1, q_opm_2,
             fy_last_period, fy_prev_period,
             pl_sales_1, pl_sales_2,
             pl_opm_1, pl_opm_2,
             nt_profit_1, nt_profit_2,
             operating_profit_1, operating_profit_2,
             roe_1, roe_2,
             roce_1, roce_2)
        VALUES %s
        ON CONFLICT (symbol) DO UPDATE SET
            q_last_period       = EXCLUDED.q_last_period,
            q_prev_period       = EXCLUDED.q_prev_period,
            q_last_period_prev_month = EXCLUDED.q_last_period_prev_month,
            q_sales_last_period = EXCLUDED.q_sales_last_period,
            q_sales_prev_period = EXCLUDED.q_sales_prev_period,
            q_sales_last_period_prev_month = EXCLUDED.q_sales_last_period_prev_month,
            q_sales_growth_1    = EXCLUDED.q_sales_growth_1,
            q_sales_growth_2    = EXCLUDED.q_sales_growth_2,
            q_sales_yoy_growth  = EXCLUDED.q_sales_yoy_growth,
            q_opm_1             = EXCLUDED.q_opm_1,
            q_opm_2             = EXCLUDED.q_opm_2,
            fy_last_period      = EXCLUDED.fy_last_period,
            fy_prev_period      = EXCLUDED.fy_prev_period,
            pl_sales_1          = EXCLUDED.pl_sales_1,
            pl_sales_2          = EXCLUDED.pl_sales_2,
            pl_opm_1            = EXCLUDED.pl_opm_1,
            pl_opm_2            = EXCLUDED.pl_opm_2,
            nt_profit_1         = EXCLUDED.nt_profit_1,
            nt_profit_2         = EXCLUDED.nt_profit_2,
            operating_profit_1  = EXCLUDED.operating_profit_1,
            operating_profit_2  = EXCLUDED.operating_profit_2,
            roe_1               = EXCLUDED.roe_1,
            roe_2               = EXCLUDED.roe_2,
            roce_1              = EXCLUDED.roce_1,
            roce_2              = EXCLUDED.roce_2,
            scraped_at          = NOW()
    """

    conn = get_db_conn()
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    conn.close()
    return len(rows)


def save_cg_records_to_db(records: list) -> int:
    """Upsert compounded growth records into compounded_growth table."""
    if not records:
        return 0

    rows = [
        (
            str(r.get("symbol", ""))[:50],
            str(r.get("metric_title", ""))[:100],
            str(r.get("period", ""))[:50],
            str(r.get("value", ""))[:50],
        )
        for r in records
        if r.get("symbol") and r.get("metric_title") and r.get("period")
    ]

    if not rows:
        return 0

    sql = """
        INSERT INTO compounded_growth
            (symbol, metric_title, period, value)
        VALUES %s
        ON CONFLICT (symbol, metric_title, period)
        DO UPDATE SET
            value      = EXCLUDED.value,
            scraped_at = NOW()
    """

    conn = get_db_conn()
    with conn.cursor() as cur:
        execute_values(cur, sql, rows)
    conn.commit()
    conn.close()
    return len(rows)


# ---------------------------------------------------------------------------
# Main Execution Entrypoint
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Scrape Screener.in trades, shareholding pattern, and compounded growth using Scrapy")
    parser.add_argument("--company", default=None, help="Single stock ticker (e.g., RELIANCE, BHARATFORG)")
    parser.add_argument("--password", default=None, help="Screener.in password")
    args = parser.parse_args()

    password = args.password or SCREENER_PASS or ""

    ensure_table()

    records_storage = []
    shp_records_storage = []
    fm_records_storage = []
    cg_records_storage = []

    class StorageSpider(ScreenerTradesSpider):
        def closed(self, reason):
            records_storage.extend(self.scraped_records)
            shp_records_storage.extend(self.scraped_shp_records)
            fm_records_storage.extend(self.scraped_fm_records)
            cg_records_storage.extend(self.scraped_cg_records)

    process = CrawlerProcess()
    process.crawl(
        StorageSpider,
        username=SCREENER_USER,
        password=password,
        company=args.company,
    )
    process.start()

    print(f"\n[scrapy] Crawling complete.")
    print(f"[scrapy] Total trades records collected:           {len(records_storage)}")
    print(f"[scrapy] Total shareholding records collected:     {len(shp_records_storage)}")
    print(f"[scrapy] Total financial metrics records collected:{len(fm_records_storage)}")
    print(f"[scrapy] Total compounded growth records collected:{len(cg_records_storage)}")

if __name__ == "__main__":
    main()
