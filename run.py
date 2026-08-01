import os
import sys
import subprocess
import time
import signal

def main():
    print("=" * 60)
    print("  StockInsight - Application Launcher")
    print("  Backend: http://127.0.0.1:2500")
    print("  Frontend: http://127.0.0.1:2501")
    print("=" * 60)

    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # Virtualenv Python Executable resolution
    if sys.platform == "win32":
        venv_python = os.path.join(base_dir, "env", "Scripts", "python.exe")
        npm_cmd = "npm.cmd"
    else:
        venv_python = os.path.join(base_dir, "env", "bin", "python")
        npm_cmd = "npm"

    if not os.path.exists(venv_python):
        print(f"Virtualenv not found at {venv_python}. Using current python interpreter: {sys.executable}")
        venv_python = sys.executable
    else:
        print(f"Activated Virtualenv Python: {venv_python}")

    # Ensure backend dependencies are installed in virtualenv
    req_file = os.path.join(base_dir, "backend", "requirements.txt")
    if os.path.exists(req_file):
        print("Checking backend dependencies...")
        subprocess.run([venv_python, "-m", "pip", "install", "-q", "-r", req_file])

    # Check and auto-create PostgreSQL database tables and columns
    init_db_script = os.path.join(base_dir, "backend", "init_db.py")
    if os.path.exists(init_db_script):
        print("\nVerifying database tables and columns...")
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

        print("\n[+] Both Backend (Port 2500) and Frontend (Port 2501) are running!")
        print("[+] Press Ctrl+C to terminate both servers.\n")

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
