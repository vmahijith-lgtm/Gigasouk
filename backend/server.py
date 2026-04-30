# server.py — Supervisor entry-point shim.
# Supervisor runs `uvicorn server:app`; the actual FastAPI app is defined
# in main.py. This file re-exports `app` so both naming conventions work.
from main import app  # noqa: F401
