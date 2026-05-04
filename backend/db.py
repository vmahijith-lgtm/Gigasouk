# ════════════════════════════════════════════════════════════════
# db.py — Database Client
# Creates two Supabase clients:
#   db       → uses anon key  (respects Row Level Security)
#   db_admin → uses service key (bypasses RLS, for backend only)
# Import whichever you need in your router/service files.
#
# Clients are created on first use so the app can import and uvicorn can
# start without a filled .env; routes that touch the DB will error until
# Supabase env vars are set.
# ════════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
from typing import Any

from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions

from config import SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY

logger = logging.getLogger(__name__)

# Default client PostgREST timeout is short; cold connections on Railway need headroom.
POSTGREST_CLIENT_TIMEOUT_S = 60


def _supabase_options() -> ClientOptions:
    return ClientOptions(postgrest_client_timeout=POSTGREST_CLIENT_TIMEOUT_S)

_db: Client | None = None
_db_admin: Client | None = None


def _supabase_env_msg() -> str:
    return (
        "Supabase is not configured. Copy backend/.env.example to backend/.env and set "
        "SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_KEY."
    )


def _get_db() -> Client:
    global _db
    if _db is None:
        if not (SUPABASE_URL or "").strip() or not (SUPABASE_ANON_KEY or "").strip():
            raise RuntimeError(_supabase_env_msg())
        url = SUPABASE_URL.strip()
        opts = _supabase_options()
        logger.debug(
            "create_client(anon) url=%s postgrest_client_timeout_s=%s",
            url,
            POSTGREST_CLIENT_TIMEOUT_S,
        )
        try:
            _db = create_client(
                url,
                SUPABASE_ANON_KEY.strip(),
                options=opts,
            )
        except Exception:
            logger.exception("create_client(anon) failed")
            raise
        logger.info("Supabase client ready (anon)")
    return _db


def _get_db_admin() -> Client:
    global _db_admin
    if _db_admin is None:
        if not (SUPABASE_URL or "").strip() or not (SUPABASE_SERVICE_KEY or "").strip():
            raise RuntimeError(_supabase_env_msg())
        url = SUPABASE_URL.strip()
        opts = _supabase_options()
        logger.debug(
            "create_client(service) url=%s postgrest_client_timeout_s=%s",
            url,
            POSTGREST_CLIENT_TIMEOUT_S,
        )
        try:
            _db_admin = create_client(
                url,
                SUPABASE_SERVICE_KEY.strip(),
                options=opts,
            )
        except Exception:
            logger.exception("create_client(service) failed")
            raise
        logger.info("Supabase client ready (service role)")
    return _db_admin


class _LazyClient:
    """Forwards attribute access to a real Client created on first use."""

    def __init__(self, factory):
        object.__setattr__(self, "_factory", factory)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._factory(), name)


# ── Public client (respects RLS) ─────────────────────────────────
db = _LazyClient(_get_db)

# ── Admin client (bypasses RLS) ──────────────────────────────────
# Never expose this client to frontend requests directly.
db_admin = _LazyClient(_get_db_admin)


# ── Helper: fetch a single row or return None ────────────────────
def get_one(table: str, match: dict) -> dict | None:
    """
    Fetch a single row from a table by matching fields.
    Returns the row as a dict, or None if not found.

    Usage:
        order = get_one("orders", {"id": order_id})
    """
    try:
        key, val = next(iter(match.items()))
        res = db_admin.table(table).select("*").eq(key, val).single().execute()
        return res.data
    except Exception:
        return None


# ── Helper: safe update with error return ────────────────────────
def safe_update(table: str, match: dict, updates: dict) -> tuple[bool, str]:
    """
    Update rows in a table. Returns (success: bool, error: str).

    Usage:
        ok, err = safe_update("orders", {"id": order_id}, {"status": "shipped"})
    """
    try:
        key, val = next(iter(match.items()))
        db_admin.table(table).update(updates).eq(key, val).execute()
        return True, ""
    except Exception as e:
        return False, str(e)
