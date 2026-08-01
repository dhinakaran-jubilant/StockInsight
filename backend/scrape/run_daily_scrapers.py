"""
Daily Scraper Orchestrator for StockInsight (backend/scrape folder runner)

Runs scrapers sequentially in exact order:
  1. scrape_nifty_lists_scrapy.py
  2. scrape_trade_scrapy.py
  3. scrape_historical.py
  4. scrape_global_historical.py
  5. scrape_sectoral_activity.py
  6. scrape_commodities.py

Schedule:
  Every day at 5:00 AM, except Sunday (Monday - Saturday).

Usage:
  python run_daily_scrapers.py --now
"""

import sys
from pathlib import Path

# Redirect to root orchestrator script
parent_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(parent_dir))

from run_daily_scrapers import main if "main" in globals() else None, run_all_scrapers, start_scheduler, argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StockInsight Daily Scraper Orchestrator")
    parser.add_argument("--now", action="store_true", help="Run scrapers immediately")
    args = parser.parse_args()

    if args.now:
        run_all_scrapers()
    else:
        start_scheduler()
