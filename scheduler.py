"""
StockInsight - Standalone Scraper Scheduler & Executor

Usage:
  - Run 5:00 AM Daily Scraper Scheduler (Mon-Sat, skipping Sunday):
      python scheduler.py

  - Run all 6 scrapers immediately right now:
      python scheduler.py --now

  - Run scrapers immediately right now AND continue with 5:00 AM daily scheduler:
      python scheduler.py --now --schedule
"""

import os
import sys
import time
import logging
import argparse
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
SCRAPE_DIR = BASE_DIR / "backend" / "scrape"

# Setup Logging for Scraper Sub-system
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(BASE_DIR / "backend" / "scrapers.log", encoding="utf-8")
    ]
)

# Ordered list of scraper scripts (located in backend/scrape/)
SCRAPERS = [
    "scrape_nifty_lists_scrapy.py",
    "scrape_trade_scrapy.py",
    "scrape_historical.py",
    "scrape_consensus_recommendation.py",
    "scrape_global_historical.py",
    "scrape_sectoral_activity.py",
    "scrape_commodities.py",
]


def resolve_venv_python():
    """Find and return virtual environment python executable if present."""
    base_dir = str(BASE_DIR)
    backend_dir = os.path.join(base_dir, "backend")

    possible_paths = [
        os.path.join(backend_dir, "env"),
        os.path.join(backend_dir, "venv"),
        os.path.join(base_dir, "env"),
        os.path.join(base_dir, "venv"),
    ]

    for v_path in possible_paths:
        if sys.platform == "win32":
            py_bin = os.path.join(v_path, "Scripts", "python.exe")
        else:
            py_bin = os.path.join(v_path, "bin", "python")

        if os.path.exists(py_bin):
            return py_bin

    return sys.executable


def run_all_scrapers(python_exec=None, company=None):
    """Executes scrapers sequentially in order (with optional single company filtering)."""
    if python_exec is None:
        python_exec = resolve_venv_python()

    start_all = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logging.info("=" * 65)
    if company:
        logging.info(f"STARTING SCRAPE BATCH FOR COMPANY: {company.upper()} AT {now_str}")
    else:
        logging.info(f"STARTING DAILY SCRAPE BATCH AT {now_str}")
    logging.info("=" * 65)

    summary = []

    for index, script_name in enumerate(SCRAPERS, 1):
        script_path = SCRAPE_DIR / script_name
        if not script_path.exists():
            logging.error(f"[{index}/{len(SCRAPERS)}] Script not found: {script_path}")
            summary.append((script_name, "FAILED (Not Found)", 0))
            continue

        cmd = [python_exec, str(script_path)]
        if company and script_name in ["scrape_trade_scrapy.py", "scrape_historical.py", "scrape_consensus_recommendation.py"]:
            cmd.extend(["--company", company.upper()])

        logging.info(f"\n---> [{index}/{len(SCRAPERS)}] Running: {script_name}{' (--company ' + company.upper() + ')' if company and script_name in ['scrape_trade_scrapy.py', 'scrape_historical.py', 'scrape_consensus_recommendation.py'] else ''}...")
        t_start = time.time()

        try:
            subprocess.run(
                cmd,
                cwd=str(SCRAPE_DIR),
                capture_output=False,
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
    """Calculates next 5:00 AM run time on Mon-Sat (skipping Sunday = weekday 6)."""
    if now is None:
        now = datetime.now()

    target = now.replace(hour=5, minute=0, second=0, microsecond=0)

    if now >= target:
        target += timedelta(days=1)

    while target.weekday() == 6:  # Skip Sunday
        target += timedelta(days=1)

    return target


def start_scheduler_loop(python_exec=None):
    """Loop that triggers scrapers every Mon-Sat at 5:00 AM."""
    if python_exec is None:
        python_exec = resolve_venv_python()

    days_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}

    print("=" * 65)
    print("  StockInsight - Scraper Scheduler")
    print("=" * 65)
    print("  • Schedule: Daily 05:00 AM (Monday - Saturday, skipping Sunday)")
    print("  • Log File: backend/scrapers.log")
    print("=" * 65 + "\n")

    while True:
        next_run = get_next_run_time()
        now = datetime.now()
        seconds_to_wait = (next_run - now).total_seconds()
        day_name = days_map[next_run.weekday()]

        logging.info(f"[Scheduler] Next scrape scheduled at: {next_run.strftime('%Y-%m-%d %H:%M:%S')} ({day_name})")

        time.sleep(seconds_to_wait)
        run_all_scrapers(python_exec=python_exec)
        time.sleep(10)


def main():
    parser = argparse.ArgumentParser(description="StockInsight Scraper Scheduler & Executor")
    parser.add_argument("--now", action="store_true", help="Run scrapers immediately right now")
    parser.add_argument("--company", default=None, help="Specific company/stock ticker (e.g. RELIANCE, BHARATFORG)")
    parser.add_argument("--schedule", action="store_true", help="Continue running the 5:00 AM daily scheduler after batch completes")
    args = parser.parse_args()

    python_exec = resolve_venv_python()

    if args.now or args.company:
        logging.info(f"[+] Executing immediate scraper batch{' for company ' + args.company.upper() if args.company else ''}...")
        run_all_scrapers(python_exec=python_exec, company=args.company)

        if args.schedule:
            logging.info("[+] Starting 5:00 AM daily scraper scheduler loop...")
            start_scheduler_loop(python_exec=python_exec)
        else:
            logging.info("[+] Scraper batch completed.")
    else:
        start_scheduler_loop(python_exec=python_exec)


if __name__ == "__main__":
    main()
