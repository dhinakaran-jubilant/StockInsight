"""Build `tara-stock`, StockInsight's domain-specialised Ollama model.

    cd backend
    python build_tara_model.py                      # build on the default base model
    python build_tara_model.py --base qwen2.5:7b    # lighter machine
    python build_tara_model.py --write-only         # just regenerate Modelfile.tara

Talks to the Ollama server over HTTP rather than shelling out to the `ollama` CLI,
so it works even when the CLI isn't on PATH (common on Windows).

Modelfile.tara is GENERATED from the prompt constants in ai_agent.py so the two can
never drift apart. Edit SYSTEM_PROMPT / DOMAIN_BRIEF there, then re-run this. The
file itself is only needed for `ollama create -f` or `ollama run` by hand — this
script builds directly from the same constants.

What this does and does not do
------------------------------
It specialises the model on your *schema, vocabulary and answer style* — the parts
of "your data" that are stable. It does NOT train on database rows: prices, DMAs and
consensus counts change every scraper run, so those are read live through the agent's
tools at question time instead. You rebuild this model when the schema changes, not
when the data does.
"""

import os
import sys
import argparse

from ai_agent import (
    SYSTEM_PROMPT, DOMAIN_BRIEF, MODEL, FALLBACK_MODEL,
    NUM_CTX, TEMPERATURE, OLLAMA_HOST,
)

HERE = os.path.dirname(os.path.abspath(__file__))
MODELFILE = os.path.join(HERE, "Modelfile.tara")

INSTALL_HINT = f"""
[!] Could not reach an Ollama server at {OLLAMA_HOST}.

    1. Install Ollama:  https://ollama.com/download
    2. Launch it (the Windows installer runs it in the background and adds a tray icon;
       if it isn't running, start "Ollama" from the Start menu).
    3. Confirm it's up:  curl {OLLAMA_HOST}/api/version
    4. Re-run this script.

    Already installed but the CLI isn't on PATH? That's fine — this script only needs
    the server, not the `ollama` command. The usual install path is
    %LOCALAPPDATA%\\Programs\\Ollama\\ollama.exe if you want to add it yourself.

    If Ollama runs on another machine or port, set OLLAMA_HOST first, e.g.
        set OLLAMA_HOST=http://192.168.1.20:11434
"""

PARAMETERS = {
    "temperature": TEMPERATURE,
    "top_p": 0.9,
    "repeat_penalty": 1.05,
    "num_ctx": NUM_CTX,
}

HEADER = """# GENERATED FILE — do not edit by hand.
# Regenerate with:  python build_tara_model.py --write-only
# Source of truth:  ai_agent.py  (SYSTEM_PROMPT + DOMAIN_BRIEF)
#
# You do not need this file to build the model — `python build_tara_model.py` builds
# straight from the constants above. It's here for `ollama create -f Modelfile.tara`
# and for reading the config at a glance.
#
# Base model note: qwen2.5 is currently the most reliable open tool-caller in the
# 7B-14B range, which matters far more here than "finance training" does — every
# number comes from your database, so the model's job is picking the right tool and
# reading JSON accurately, not recalling market facts.
#   qwen2.5:14b  ~9.0 GB  recommended, best accuracy
#   qwen2.5:7b   ~4.7 GB  good on 8 GB VRAM or CPU-only
#   llama3.1:8b  ~4.9 GB  alternative if you already have it
"""


def system_text():
    return SYSTEM_PROMPT + "\n" + DOMAIN_BRIEF


def render_modelfile(base_model):
    params = "\n".join(f"PARAMETER {k} {v}" for k, v in PARAMETERS.items())
    # Escape any triple-quote in the prompt so it can't terminate the SYSTEM block early.
    system = system_text().replace('"""', "'''")
    quote = '"""'
    return f"""{HEADER}
FROM {base_model}

# Low temperature: this reports data, it does not write prose. num_ctx is large because
# tool results are JSON-heavy — a small window silently truncates them, which is the
# number one cause of a local model inventing figures.
{params}

SYSTEM {quote}{system}
{quote}
"""


def _progress(stream, label):
    """Render Ollama's streaming pull/create progress on one line."""
    last = ""
    for chunk in stream:
        status = getattr(chunk, "status", None) or (chunk.get("status") if isinstance(chunk, dict) else "")
        total = getattr(chunk, "total", None) or (chunk.get("total") if isinstance(chunk, dict) else None)
        done = getattr(chunk, "completed", None) or (chunk.get("completed") if isinstance(chunk, dict) else None)
        if total and done:
            pct = done / total * 100
            line = f"    {label}: {status} {pct:5.1f}%  ({done / 1e9:.2f}/{total / 1e9:.2f} GB)"
        else:
            line = f"    {label}: {status}"
        if line != last:
            print(line.ljust(len(last)), end="\r", flush=True)
            last = line
    print(" " * len(last), end="\r")


def main():
    parser = argparse.ArgumentParser(description="Build the tara-stock Ollama model.")
    parser.add_argument("--base", default=FALLBACK_MODEL, help=f"Base model (default {FALLBACK_MODEL})")
    parser.add_argument("--name", default=MODEL, help=f"Model name to create (default {MODEL})")
    parser.add_argument("--write-only", action="store_true", help="Regenerate Modelfile.tara, don't build")
    args = parser.parse_args()

    with open(MODELFILE, "w", encoding="utf-8") as fh:
        fh.write(render_modelfile(args.base))
    print(f"[+] Wrote {MODELFILE}  (base: {args.base})")

    if args.write_only:
        return 0

    try:
        import ollama
    except ImportError:
        print("[!] The `ollama` package is missing. Run:  pip install -r requirements.txt")
        return 1

    client = ollama.Client(host=OLLAMA_HOST, timeout=3600)

    # Preflight — a clear message beats a stack trace.
    try:
        client.list()
    except Exception as exc:
        print(INSTALL_HINT)
        print(f"    (underlying error: {type(exc).__name__}: {exc})")
        return 1

    print(f"[+] Ollama reachable at {OLLAMA_HOST}")

    print(f"[+] Pulling base model '{args.base}' (skipped instantly if already present)...")
    try:
        _progress(client.pull(args.base, stream=True), args.base)
    except Exception as exc:
        print(f"[!] Pull failed: {exc}")
        print(f"    Check the model name exists: https://ollama.com/library/{args.base.split(':')[0]}")
        return 1
    print(f"    {args.base}: ready")

    print(f"[+] Creating '{args.name}'...")
    try:
        _progress(
            client.create(
                model=args.name,
                from_=args.base,
                system=system_text(),
                parameters=PARAMETERS,
                stream=True,
            ),
            args.name,
        )
    except Exception as exc:
        print(f"[!] Create failed: {exc}")
        return 1

    print(f"\n[OK] Built '{args.name}'. The backend picks it up on the next question — no restart needed.")
    print(f"     Verify:  curl http://localhost:2500/api/health")
    print(f"     Try it:  ollama run {args.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
