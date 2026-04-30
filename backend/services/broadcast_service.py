# ════════════════════════════════════════════════════════════════
# services/broadcast_service.py — Emergency Price Discovery (NEW)
#
# Fires when a design has been in SEEKING state for 48 hours
# with no committed manufacturer in a specific region.
#
# What it does:
#   1. Scans all SEEKING designs that have passed the time limit
#   2. Finds regions with no active commitments
#   3. Broadcasts to ALL capable manufacturers in that region
#   4. Invites them to submit a regional price bid
#
# TO DISABLE EMERGENCY BROADCASTS:
#   Set EMERGENCY_BROADCAST_ENABLED = False below.
#
# TO CHANGE THE 48-HOUR TRIGGER:
#   Update COMMITMENT_SEEK_HOURS in config.py. One line. Done.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter
from pydantic import BaseModel

from db import db_admin, get_one, safe_update
from config import COMMITMENT_SEEK_HOURS, DESIGN_STATUS_SEEKING
from services.notify_service import notify_emergency_bid_invite

router = APIRouter()

# ── Master switch ────────────────────────────────────────────────
EMERGENCY_BROADCAST_ENABLED = True

# Indian states and major cities map
# Used to identify which regions need coverage
INDIA_REGIONS = [
    ("Mumbai",      "Maharashtra"),
    ("Pune",        "Maharashtra"),
    ("Delhi",       "Delhi"),
    ("Bengaluru",   "Karnataka"),
    ("Chennai",     "Tamil Nadu"),
    ("Hyderabad",   "Telangana"),
    ("Ahmedabad",   "Gujarat"),
    ("Rajkot",      "Gujarat"),
    ("Surat",       "Gujarat"),
    ("Kolkata",     "West Bengal"),
    ("Jaipur",      "Rajasthan"),
    ("Ludhiana",    "Punjab"),
    ("Coimbatore",  "Tamil Nadu"),
    ("Nagpur",      "Maharashtra"),
    ("Indore",      "Madhya Pradesh"),
]


# ════════════════════════════════════════════════════════════════
# MAIN FUNCTION: SCAN AND BROADCAST
# Called by a scheduled task or manually by admin.
# ════════════════════════════════════════════════════════════════

async def run_emergency_scan():
    """
    Main emergency broadcast function.
    Scans all SEEKING designs that have passed the time limit.
    For each region with no committed manufacturer, fires a broadcast.

    Returns:
        Summary dict of what was broadcast.
    """
    if not EMERGENCY_BROADCAST_ENABLED:
        return {"enabled": False}

    cutoff_time = datetime.now(timezone.utc) - timedelta(hours=COMMITMENT_SEEK_HOURS)

    # Find designs that have been seeking longer than the limit
    overdue_designs = (
        db_admin.table("designs")
        .select("*")
        .eq("status", DESIGN_STATUS_SEEKING)
        .lt("seeking_at", cutoff_time.isoformat())
        .execute()
        .data
    )

    if not overdue_designs:
        return {"scanned": 0, "broadcasts_sent": 0}

    total_broadcasts = 0

    for design in overdue_designs:
        broadcasts = await _broadcast_for_design(design)
        total_broadcasts += broadcasts

    return {
        "scanned":          len(overdue_designs),
        "broadcasts_sent":  total_broadcasts,
        "run_at":           datetime.now(timezone.utc).isoformat(),
    }


async def _broadcast_for_design(design: dict) -> int:
    """
    For a single design, find regions with no committed manufacturer.
    For each uncovered region, broadcast to all capable local manufacturers.
    Returns number of notifications sent.
    """
    design_id = design["id"]

    # Get regions already covered by active commitments
    covered_cities = {
        c["region_city"].lower()
        for c in db_admin.table("manufacturer_commitments")
        .select("region_city")
        .eq("design_id", design_id)
        .in_("status", ["active", "pending_approval"])
        .execute()
        .data
    }

    # Check if already broadcast to all regions (avoid spam)
    already_broadcast = {
        b["region_city"].lower() if b["region_city"] else "__national__"
        for b in db_admin.table("commitment_broadcasts")
        .select("region_city")
        .eq("design_id", design_id)
        .eq("broadcast_type", "emergency")
        .execute()
        .data
    }

    sent = 0

    for city, state in INDIA_REGIONS:
        if city.lower() in covered_cities:
            continue   # Region already has a committed manufacturer
        if city.lower() in already_broadcast:
            continue   # Already sent emergency broadcast to this region

        # Find capable manufacturers in this city
        capable = _find_capable_local_manufacturers(design, city, state)

        if not capable:
            continue

        # Log broadcast
        broadcast_id = str(uuid.uuid4())
        db_admin.table("commitment_broadcasts").insert({
            "id":            broadcast_id,
            "design_id":     design_id,
            "broadcast_type": "emergency",
            "region_city":   city,
            "region_state":  state,
            "recipients":    len(capable),
            "broadcast_at":  datetime.now(timezone.utc).isoformat(),
        }).execute()

        # Notify each manufacturer
        for mfr in capable:
            await notify_emergency_bid_invite(
                manufacturer_id=mfr["id"],
                design_title=design["title"],
                region_city=city,
                design_id=design_id,
            )
            sent += 1

    return sent


def _find_capable_local_manufacturers(design: dict, city: str, state: str) -> list[dict]:
    """
    Find active manufacturers in a specific city whose capabilities
    match the design requirements.
    """
    req_machines  = set(design.get("required_machines",  []))
    req_materials = set(design.get("required_materials", []))

    local_mfrs = (
        db_admin.table("manufacturers")
        .select("*")
        .ilike("city", f"%{city}%")
        .eq("is_active", True)
        .execute()
        .data
    )

    capable = []
    for m in local_mfrs:
        mfr_machines  = set(m.get("machine_types", []))
        mfr_materials = set(m.get("materials",     []))
        if req_machines.issubset(mfr_machines) and req_materials.issubset(mfr_materials):
            capable.append(m)

    return capable


# ════════════════════════════════════════════════════════════════
# ENDPOINT: ADMIN MANUAL TRIGGER
# POST /api/v1/admin/emergency-scan
# ════════════════════════════════════════════════════════════════

@router.post("/admin/emergency-scan")
async def admin_trigger_emergency_scan():
    """
    Admin can manually trigger the emergency scan at any time.
    Normally this is run automatically on a schedule.
    """
    result = await run_emergency_scan()
    return result


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET BROADCAST HISTORY
# GET /api/v1/admin/broadcasts
# ════════════════════════════════════════════════════════════════

@router.get("/admin/broadcasts")
def get_broadcast_history(design_id: str = None, limit: int = 50):
    """
    Admin view of all commitment broadcasts sent.
    Filter by design_id to see broadcasts for a specific design.
    """
    query = (
        db_admin.table("commitment_broadcasts")
        .select("*, designs(title)")
        .order("broadcast_at", desc=True)
        .limit(limit)
    )
    if design_id:
        query = query.eq("design_id", design_id)
    return query.execute().data
