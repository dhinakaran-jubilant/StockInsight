"""
StockInsight - Master Application Launcher

Unified Project Entry Point:
  1. Checks Python virtual environment and backend dependencies.
  2. Verifies PostgreSQL DB schema & auto-creates missing tables/columns.
  3. Launches Flask Backend on http://127.0.0.1:2500
  4. Launches React Vite Frontend on http://127.0.0.1:2501

Usage:
  - Start application:
      python run.py
"""

import os
import sys
import time
import socket
import subprocess
from pathlib import Path

# Base Paths
BASE_DIR = Path(__file__).resolve().parent


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
        print(f"\n[+] Virtualenv not found. Using current python: {sys.executable}")
        venv_python = sys.executable
    else:
        print(f"\n[+] Activated Virtualenv Python: {venv_python}")

    # 1. Check backend dependencies
    req_file = os.path.join(base_dir, "backend", "requirements.txt")
    if os.path.exists(req_file):
        print("[+] Checking backend dependencies...")
        subprocess.run([venv_python, "-m", "pip", "install", "-q", "-r", req_file])

    # 2. Verify and auto-create PostgreSQL database tables and columns
    init_db_script = os.path.join(base_dir, "backend", "init_db.py")
    if os.path.exists(init_db_script):
        print("\n[+] Verifying database tables and columns...")
        subprocess.run([venv_python, init_db_script])

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
