# ════════════════════════════════════════════════════════════════
# services/scheduler.py — Background Scheduled Tasks
#
# All periodic jobs for GigaSouk live here.
# Runs inside the same uvicorn process via APScheduler.
# No separate cron process needed — works on Railway out of the box.
#
# TO ADD A NEW JOB:
#   1. Write your async function in the relevant service file.
#   2. Import it here.
#   3. Add one scheduler.add_job(...) line in _register_jobs().
#   4. That's it — it will start on the next server boot.
#
# TO DISABLE A JOB:
#   Comment out its scheduler.add_job(...) line below.
#
# SCHEDULE SYNTAX (interval):
#   hours=1        → every 1 hour
#   minutes=30     → every 30 minutes
#   days=1         → every 24 hours
#
# ════════════════════════════════════════════════════════════════

import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval  import IntervalTrigger
from apscheduler.events import EVENT_JOB_ERROR, EVENT_JOB_EXECUTED

from config import COMMITMENT_SEEK_HOURS

logger = logging.getLogger("gigasouk.scheduler")

# ── Scheduler instance (module-level singleton) ───────────────────
_scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")


# ════════════════════════════════════════════════════════════════
# JOB WRAPPERS
# Thin async wrappers around service functions.
# Catches exceptions so one failing job never crashes the scheduler.
# ════════════════════════════════════════════════════════════════

async def _job_emergency_scan():
    """
    Scans for SEEKING designs that have passed the commitment deadline
    and fires emergency broadcast notifications to nearby manufacturers.
    Runs every COMMITMENT_SEEK_HOURS / 2 so no design ever waits more
    than one extra cycle past its 48-hour deadline.
    """
    try:
        from services.broadcast_service import run_emergency_scan
        result = await run_emergency_scan()
        logger.info(
            f"[emergency_scan] scanned={result.get('scanned', 0)} "
            f"broadcasts_sent={result.get('broadcasts_sent', 0)}"
        )
    except Exception as e:
        logger.error(f"[emergency_scan] FAILED: {e}", exc_info=True)


async def _job_expire_stale_negotiations():
    """
    Marks negotiation rooms as expired after NEGOTIATION_TIMEOUT_HOURS.
    Prevents orders from being stuck in 'negotiating' indefinitely.
    Runs every 2 hours.
    """
    try:
        from datetime import datetime, timezone, timedelta
        from config import NEGOTIATION_TIMEOUT_HOURS, ORDER_STATUS_NEGOTIATING
        from db import db_admin

        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=NEGOTIATION_TIMEOUT_HOURS)
        ).isoformat()

        result = (
            db_admin.table("negotiation_rooms")
            .update({"status": "expired", "expired_at": datetime.now(timezone.utc).isoformat()})
            .eq("status", "open")
            .lt("created_at", cutoff)
            .execute()
        )
        expired = len(result.data) if result.data else 0
        if expired:
            logger.info(f"[expire_negotiations] expired {expired} stale room(s)")
    except Exception as e:
        logger.error(f"[expire_negotiations] FAILED: {e}", exc_info=True)


async def _job_cleanup_unverified_orders():
    """
    Cancels orders that are stuck in ROUTING state for > 24h.
    This prevents ghost orders if the routing engine failed silently.
    Runs every 6 hours.
    """
    try:
        from datetime import datetime, timezone, timedelta
        from config import ORDER_STATUS_ROUTING, ORDER_STATUS_CANCELLED
        from db import db_admin

        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=24)
        ).isoformat()

        result = (
            db_admin.table("orders")
            .update({
                "status":       ORDER_STATUS_CANCELLED,
                "cancel_reason": "Auto-cancelled: stuck in routing for >24h",
                "updated_at":   datetime.now(timezone.utc).isoformat(),
            })
            .eq("status", ORDER_STATUS_ROUTING)
            .lt("created_at", cutoff)
            .execute()
        )
        cancelled = len(result.data) if result.data else 0
        if cancelled:
            logger.info(f"[cleanup_orders] auto-cancelled {cancelled} stuck order(s)")
    except Exception as e:
        logger.error(f"[cleanup_orders] FAILED: {e}", exc_info=True)


# ════════════════════════════════════════════════════════════════
# JOB REGISTRATION
# ════════════════════════════════════════════════════════════════

def _register_jobs():
    """Register all periodic jobs. Called once at startup."""

    # ── Emergency broadcast scan ──────────────────────────────────
    # Fires every (COMMITMENT_SEEK_HOURS / 2) hours so no design
    # waits more than one extra cycle past its deadline.
    _scheduler.add_job(
        _job_emergency_scan,
        trigger=IntervalTrigger(hours=max(1, COMMITMENT_SEEK_HOURS // 2)),
        id="emergency_scan",
        name="Emergency Manufacturer Broadcast",
        replace_existing=True,
        max_instances=1,        # never run two scans in parallel
        misfire_grace_time=300, # if scheduler was paused, run within 5 min
    )

    # ── Expire stale negotiation rooms ───────────────────────────
    _scheduler.add_job(
        _job_expire_stale_negotiations,
        trigger=IntervalTrigger(hours=2),
        id="expire_negotiations",
        name="Expire Stale Negotiations",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=300,
    )

    # ── Clean up ghost orders stuck in routing ────────────────────
    _scheduler.add_job(
        _job_cleanup_unverified_orders,
        trigger=IntervalTrigger(hours=6),
        id="cleanup_orders",
        name="Cleanup Ghost Orders",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=600,
    )


# ════════════════════════════════════════════════════════════════
# EVENT LISTENER — logs job results
# ════════════════════════════════════════════════════════════════

def _on_job_event(event):
    if event.exception:
        logger.error(f"Job {event.job_id} raised an exception: {event.exception}")
    else:
        logger.debug(f"Job {event.job_id} executed successfully")


# ════════════════════════════════════════════════════════════════
# PUBLIC API — called from main.py lifespan
# ════════════════════════════════════════════════════════════════

def start_scheduler():
    """
    Start the background scheduler.
    Call this once from the FastAPI lifespan startup hook.
    """
    _register_jobs()
    _scheduler.add_listener(_on_job_event, EVENT_JOB_ERROR | EVENT_JOB_EXECUTED)
    _scheduler.start()
    logger.info(
        f"Scheduler started — {len(_scheduler.get_jobs())} job(s) registered: "
        + ", ".join(j.name for j in _scheduler.get_jobs())
    )


def stop_scheduler():
    """
    Gracefully shut down the scheduler.
    Call this from the FastAPI lifespan shutdown hook.
    """
    if _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped.")


def get_job_status() -> list[dict]:
    """
    Returns current status of all scheduled jobs.
    Used by the admin health endpoint.
    """
    jobs = []
    for job in _scheduler.get_jobs():
        jobs.append({
            "id":        job.id,
            "name":      job.name,
            "next_run":  job.next_run_time.isoformat() if job.next_run_time else None,
            "trigger":   str(job.trigger),
        })
    return jobs
