"""
Daily Scraper Orchestrator & Scheduler for StockInsight

Runs all 6 backend scrapers sequentially in exact order:
  1. scrape_nifty_lists_scrapy.py
  2. scrape_trade_scrapy.py
  3. scrape_historical.py
  4. scrape_global_historical.py
  5. scrape_sectoral_activity.py
  6. scrape_commodities.py

Schedule:
  Every day at 5:00 AM, except Sunday (Monday - Saturday).

Usage:
  - Run immediately on demand:
      python run_daily_scrapers.py --now

  - Start persistent 5:00 AM (Mon-Sat) scheduler:
      python run_daily_scrapers.py

  - Windows Task Scheduler command (Alternative OS scheduler):
      schtasks /create /tn "StockInsight_DailyScrape" /tr "python D:\\Projects\\StockInsight\\backend\\run_daily_scrapers.py --now" /sc weekly /d MON,TUE,WED,THU,FRI,SAT /st 05:00
"""

import os
import sys
import time
import logging
import argparse
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(__file__).resolve().parent / "scrapers.log", encoding="utf-8")
    ]
)

# Ordered list of scraper scripts (located in backend/scrape/)
SCRAPE_DIR = Path(__file__).resolve().parent / "scrape"

SCRAPERS = [
    "scrape_nifty_lists_scrapy.py",
    "scrape_trade_scrapy.py",
    "scrape_historical.py",
    "scrape_global_historical.py",
    "scrape_sectoral_activity.py",
    "scrape_commodities.py",
]


def run_all_scrapers():
    """Executes all scrapers sequentially in order."""
    start_all = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logging.info(f"=" * 65)
    logging.info(f"STARTING DAILY SCRAPE BATCH AT {now_str}")
    logging.info(f"=" * 65)

    summary = []

    for index, script_name in enumerate(SCRAPERS, 1):
        script_path = SCRAPE_DIR / script_name
        if not script_path.exists():
            logging.error(f"[{index}/{len(SCRAPERS)}] Script not found: {script_path}")
            summary.append((script_name, "FAILED (Not Found)", 0))
            continue

        logging.info(f"\n---> [{index}/{len(SCRAPERS)}] Running: {script_name}...")
        t_start = time.time()

        try:
            # Run script using current Python executable
            result = subprocess.run(
                [sys.executable, str(script_path)],
                cwd=str(SCRAPE_DIR),
                capture_output=False,  # Stream output directly to console
                text=True,
                check=True
            )
            duration = round(time.time() - t_start, 2)
            logging.info(f"[SUCCESS] {script_name} completed in {duration}s")
            summary.append((script_name, "SUCCESS", duration))

        except subprocess.CalledProcessError as e:
            duration = round(time.time() - t_start, 2)
            logging.error(f"[ERROR] {script_name} failed with exit code {e.returncode} ({duration}s)")
            summary.append((script_name, f"FAILED (Exit Code {e.returncode})", duration))
        except Exception as e:
            duration = round(time.time() - t_start, 2)
            logging.error(f"[EXCEPTION] Failed to run {script_name}: {e} ({duration}s)")
            summary.append((script_name, f"FAILED ({type(e).__name__})", duration))

    total_time = round(time.time() - start_all, 2)
    logging.info("\n" + "=" * 65)
    logging.info("DAILY SCRAPE BATCH SUMMARY")
    logging.info("=" * 65)
    for name, status, dur in summary:
        logging.info(f"  • {name:<32} [{status}] ({dur}s)")
    logging.info(f"Total Batch Time: {total_time} seconds ({round(total_time/60, 2)} minutes)")
    logging.info("=" * 65 + "\n")


def get_next_run_time(now=None):
    """
    Calculates the next run time at 5:00 AM on a non-Sunday day (Monday-Saturday).
    Sunday is weekday 6 (where Monday=0, Sunday=6).
    """
    if now is None:
        now = datetime.now()

    # Target 5:00:00 AM today
    target = now.replace(hour=5, minute=0, second=0, microsecond=0)

    # If 5 AM today has already passed, start checking from tomorrow 5 AM
    if now >= target:
        target += timedelta(days=1)

    # Skip Sunday (weekday() == 6)
    while target.weekday() == 6:
        target += timedelta(days=1)

    return target


def start_scheduler():
    """Runs a daemon loop that waken up and triggers scrapers every Mon-Sat at 5:00 AM."""
    logging.info("Starting Daily Scraper Scheduler...")
    logging.info("Schedule: Every day at 05:00 AM (Monday to Saturday, excluding Sunday).")

    while True:
        next_run = get_next_run_time()
        now = datetime.now()
        seconds_to_wait = (next_run - now).total_seconds()

        days_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}
        day_name = days_map[next_run.weekday()]

        logging.info(f"Next scheduled run: {next_run.strftime('%Y-%m-%d %H:%M:%S')} ({day_name})")
        logging.info(f"Sleeping for {round(seconds_to_wait/3600, 2)} hours ({int(seconds_to_wait)} seconds)...")

        # Sleep until scheduled time
        time.sleep(seconds_to_wait)

        # Execute scrapers
        run_all_scrapers()

        # Brief pause to avoid re-triggering immediately
        time.sleep(10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="StockInsight Daily Scraper Orchestrator")
    parser.add_argument("--now", action="store_true", help="Run all scrapers immediately without waiting for 5 AM schedule")
    args = parser.parse_args()

    if args.now:
        run_all_scrapers()
    else:
        start_scheduler()
