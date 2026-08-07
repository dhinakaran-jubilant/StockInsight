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
    "scrape_moneycontrol_boarders.py",
]

COMPANY_SUPPORTED_SCRAPERS = [
    "scrape_trade_scrapy.py",
    "scrape_historical.py",
    "scrape_consensus_recommendation.py",
    "scrape_moneycontrol_boarders.py"
]

BOARDERS_HOURS = [8, 10, 12, 14, 16, 18]


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


def run_single_scraper(script_name, python_exec=None, company=None):
    """Executes a single scraper script from backend/scrape/."""
    if python_exec is None:
        python_exec = resolve_venv_python()

    script_path = SCRAPE_DIR / script_name
    if not script_path.exists():
        logging.error(f"Script not found: {script_path}")
        return False

    cmd = [python_exec, str(script_path)]
    if company and script_name in COMPANY_SUPPORTED_SCRAPERS:
        cmd.extend(["--company", company.upper()])

    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logging.info(f"\n---> Running single scraper: {script_name}{' (--company ' + company.upper() + ')' if company and script_name in COMPANY_SUPPORTED_SCRAPERS else ''} at {now_str}...")
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
        return True
    except subprocess.CalledProcessError as e:
        duration = round(time.time() - t_start, 2)
        logging.error(f"[ERROR] {script_name} failed with exit code {e.returncode} ({duration}s)")
        return False
    except Exception as e:
        duration = round(time.time() - t_start, 2)
        logging.error(f"[EXCEPTION] Failed to run {script_name}: {e} ({duration}s)")
        return False


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
        if company and script_name in COMPANY_SUPPORTED_SCRAPERS:
            cmd.extend(["--company", company.upper()])

        logging.info(f"\n---> [{index}/{len(SCRAPERS)}] Running: {script_name}{' (--company ' + company.upper() + ')' if company and script_name in COMPANY_SUPPORTED_SCRAPERS else ''}...")
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


def get_next_scheduled_event(now=None):
    """
    Returns (next_run_datetime, event_type) for the next scheduled task.
    event_type can be 'FULL_BATCH' (5:00 AM) or 'BOARDERS' (8:00 AM - 6:00 PM every 2 hours).
    Skips Sundays (weekday 6).
    """
    if now is None:
        now = datetime.now()

    candidates = []
    
    # Check next 7 days for scheduled events
    for day_offset in range(8):
        day_date = (now + timedelta(days=day_offset)).date()
        if day_date.weekday() == 6:  # Skip Sunday
            continue

        # 5:00 AM full batch
        dt_full = datetime.combine(day_date, datetime.min.time()).replace(hour=5, minute=0, second=0, microsecond=0)
        if dt_full > now:
            candidates.append((dt_full, "FULL_BATCH"))

        # 2-hour boarders scrapes between 8am and 6pm (8, 10, 12, 14, 16, 18)
        for h in BOARDERS_HOURS:
            dt_b = datetime.combine(day_date, datetime.min.time()).replace(hour=h, minute=0, second=0, microsecond=0)
            if dt_b > now:
                candidates.append((dt_b, "BOARDERS"))

    candidates.sort(key=lambda x: x[0])
    return candidates[0]


def start_scheduler_loop(python_exec=None):
    """Loop that triggers daily scrapers at 5:00 AM and Moneycontrol Boarders every 2h (8 AM - 6 PM, Mon-Sat)."""
    if python_exec is None:
        python_exec = resolve_venv_python()

    days_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}

    print("=" * 65)
    print("  StockInsight - Scraper Scheduler")
    print("=" * 65)
    print("  • Daily Full Batch: 05:00 AM (Mon-Sat, skipping Sunday)")
    print("  • Moneycontrol Boarders: Every 2h between 08:00 AM - 06:00 PM (Mon-Sat)")
    print("  • Log File: backend/scrapers.log")
    print("=" * 65 + "\n")

    while True:
        next_run, event_type = get_next_scheduled_event()
        now = datetime.now()
        seconds_to_wait = max(0, (next_run - now).total_seconds())
        day_name = days_map[next_run.weekday()]
        event_label = "Daily Full Scrape Batch" if event_type == "FULL_BATCH" else "Moneycontrol Boarders Scraper"

        logging.info(f"[Scheduler] Next job ({event_label}) scheduled at: {next_run.strftime('%Y-%m-%d %H:%M:%S')} ({day_name})")

        time.sleep(seconds_to_wait)

        if event_type == "FULL_BATCH":
            run_all_scrapers(python_exec=python_exec)
        elif event_type == "BOARDERS":
            run_single_scraper("scrape_moneycontrol_boarders.py", python_exec=python_exec)

        time.sleep(10)


def main():
    parser = argparse.ArgumentParser(description="StockInsight Scraper Scheduler & Executor")
    parser.add_argument("--now", action="store_true", help="Run scrapers immediately right now")
    parser.add_argument("--company", default=None, help="Specific company/stock ticker (e.g. RELIANCE, BHARATFORG)")
    parser.add_argument("--schedule", action="store_true", help="Continue running the scheduler loop after batch completes")
    args = parser.parse_args()

    python_exec = resolve_venv_python()

    if args.now or args.company:
        logging.info(f"[+] Executing immediate scraper batch{' for company ' + args.company.upper() if args.company else ''}...")
        run_all_scrapers(python_exec=python_exec, company=args.company)

        if args.schedule:
            logging.info("[+] Starting scraper scheduler loop...")
            start_scheduler_loop(python_exec=python_exec)
        else:
            logging.info("[+] Scraper batch completed.")
    else:
        start_scheduler_loop(python_exec=python_exec)


if __name__ == "__main__":
    main()
