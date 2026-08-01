"""
StockInsight - Master Application Launcher & Scheduler

Unified Entry Point:
  1. Checks Python dependencies and verifies PostgreSQL DB schema (auto-creates tables/columns).
  2. Launches Flask Backend on http://127.0.0.1:2500
  3. Launches React Vite Frontend on http://127.0.0.1:2501
  4. Starts background Daily Scraper Scheduler (Runs Mon-Sat at 5:00 AM, skipping Sunday).

Usage:
  - Start application + background 5:00 AM scraper scheduler:
      python run.py

  - Run all scrapers immediately on startup:
      python run.py --scrape-now

  - Disable background scraper scheduler:
      python run.py --no-scheduler
"""

import os
import sys
import time
import logging
import argparse
import subprocess
import threading
from datetime import datetime, timedelta
from pathlib import Path

# Setup Logging for Scraper Sub-system
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(__file__).resolve().parent / "backend" / "scrapers.log", encoding="utf-8")
    ]
)

# Base Paths
BASE_DIR = Path(__file__).resolve().parent
SCRAPE_DIR = BASE_DIR / "backend" / "scrape"

# Ordered list of scraper scripts (located in backend/scrape/)
SCRAPERS = [
    "scrape_nifty_lists_scrapy.py",
    "scrape_trade_scrapy.py",
    "scrape_historical.py",
    "scrape_global_historical.py",
    "scrape_sectoral_activity.py",
    "scrape_commodities.py",
]


def run_all_scrapers(python_exec=None):
    """Executes all 6 scrapers sequentially in order."""
    if python_exec is None:
        python_exec = sys.executable

    start_all = time.time()
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    logging.info("=" * 65)
    logging.info(f"STARTING DAILY SCRAPE BATCH AT {now_str}")
    logging.info("=" * 65)

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
            subprocess.run(
                [python_exec, str(script_path)],
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


def start_scheduler_thread(python_exec):
    """Background daemon loop that triggers scrapers every Mon-Sat at 5:00 AM."""
    days_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}

    while True:
        next_run = get_next_run_time()
        now = datetime.now()
        seconds_to_wait = (next_run - now).total_seconds()
        day_name = days_map[next_run.weekday()]

        logging.info(f"[Scheduler] Next scrape scheduled at: {next_run.strftime('%Y-%m-%d %H:%M:%S')} ({day_name})")

        time.sleep(seconds_to_wait)
        run_all_scrapers(python_exec=python_exec)
        time.sleep(10)


def get_local_lan_ip():
    """Detects primary local LAN IP address (e.g. 192.168.0.7)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "192.168.0.7"


def main():
    parser = argparse.ArgumentParser(description="StockInsight Master Application Launcher & Scheduler")
    parser.add_argument("--scrape-now", action="store_true", help="Run scrapers immediately on startup")
    parser.add_argument("--no-scheduler", action="store_true", help="Disable the background 5:00 AM daily scraper scheduler")
    args = parser.parse_args()

    network_ip = get_local_lan_ip()

    print("=" * 68)
    print("  StockInsight - Master Application Launcher")
    print("=" * 68)
    print("  [Local Access (This Machine)]:")
    print("    • Frontend UI: http://localhost:2501 (or http://127.0.0.1:2501)")
    print("    • Backend API: http://localhost:2500 (or http://127.0.0.1:2500)")
    print("\n  [Network Access (LAN / Other Devices)]:")
    print(f"    • Frontend UI: http://{network_ip}:2501")
    print(f"    • Backend API: http://{network_ip}:2500")
    print("\n  [Scraper Schedule]:")
    print("    • Daily 05:00 AM (Monday - Saturday, except Sunday)")
    print("=" * 68)

    base_dir = str(BASE_DIR)
    backend_dir = os.path.join(base_dir, "backend")

    # Resolve Python virtual environment (prioritizes backend/env)
    possible_venv_paths = [
        os.path.join(backend_dir, "env"),
        os.path.join(backend_dir, "venv"),
        os.path.join(base_dir, "env"),
        os.path.join(base_dir, "venv"),
    ]

    venv_python = None
    for v_path in possible_venv_paths:
        if sys.platform == "win32":
            py_bin = os.path.join(v_path, "Scripts", "python.exe")
        else:
            py_bin = os.path.join(v_path, "bin", "python")

        if os.path.exists(py_bin):
            venv_python = py_bin
            break

    if sys.platform == "win32":
        npm_cmd = "npm.cmd"
    else:
        npm_cmd = "npm"

    if not venv_python:
        print(f"Virtualenv not found. Using current python: {sys.executable}")
        venv_python = sys.executable
    else:
        print(f"Activated Virtualenv Python: {venv_python}")

    # 1. Check backend dependencies
    req_file = os.path.join(base_dir, "backend", "requirements.txt")
    if os.path.exists(req_file):
        print("Checking backend dependencies...")
        subprocess.run([venv_python, "-m", "pip", "install", "-q", "-r", req_file])

    # 2. Verify and auto-create PostgreSQL database tables and columns
    init_db_script = os.path.join(base_dir, "backend", "init_db.py")
    if os.path.exists(init_db_script):
        print("\nVerifying database tables and columns...")
        subprocess.run([venv_python, init_db_script])

    # 3. Optional: Run scrapers immediately if requested
    if args.scrape_now:
        print("\n[+] Triggering immediate scrape batch (--scrape-now requested)...")
        run_all_scrapers(python_exec=venv_python)

    # 4. Start background scraper scheduler thread if enabled
    if not args.no_scheduler:
        next_run = get_next_run_time()
        days_map = {0: "Monday", 1: "Tuesday", 2: "Wednesday", 3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday"}
        print(f"\n[+] Background Scraper Scheduler: Active (Next run: {next_run.strftime('%Y-%m-%d %H:%M:%S')} {days_map[next_run.weekday()]})")
        scheduler_thread = threading.Thread(
            target=start_scheduler_thread,
            args=(venv_python,),
            daemon=True
        )
        scheduler_thread.start()

    backend_app = os.path.join(base_dir, "backend", "app.py")
    frontend_dir = os.path.join(base_dir, "frontend")

    processes = []

    try:
        # Start Flask Backend Server (Port 2500)
        print("\n[1/2] Starting Flask Backend on http://127.0.0.1:2500 ...")
        backend_proc = subprocess.Popen(
            [venv_python, backend_app],
            cwd=os.path.join(base_dir, "backend")
        )
        processes.append(backend_proc)

        time.sleep(1.5)

        # Start React Vite Frontend Server (Port 2501)
        print("[2/2] Starting Vite Frontend on http://127.0.0.1:2501 ...")
        vite_cmd = os.path.join(frontend_dir, "node_modules", ".bin", "vite.cmd")
        if os.path.exists(vite_cmd):
            frontend_args = [vite_cmd, "--port", "2501", "--host"]
        else:
            frontend_args = [npm_cmd, "run", "dev"]

        frontend_proc = subprocess.Popen(
            frontend_args,
            cwd=frontend_dir,
            shell=(sys.platform == "win32")
        )
        processes.append(frontend_proc)

        print("\n[+] StockInsight system fully operational!")
        print("  • Local UI:   http://localhost:2501  (Backend API: http://localhost:2500)")
        print(f"  • Network UI: http://{network_ip}:2501  (Backend API: http://{network_ip}:2500)")
        print("[+] Press Ctrl+C to stop all services.\n")

        # Monitor subprocesses
        while True:
            for p in processes:
                if p.poll() is not None:
                    print(f"[-] A process (PID {p.pid}) has exited unexpectedly.")
            time.sleep(1)

    except KeyboardInterrupt:
        print("\n[!] Shutting down StockInsight application...")
        for p in processes:
            try:
                p.terminate()
            except Exception:
                pass
        print("[+] StockInsight stopped successfully.")


if __name__ == "__main__":
    main()
