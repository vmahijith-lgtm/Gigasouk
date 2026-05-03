# ════════════════════════════════════════════════════════════════
# routers/commitment_router.py — Commitment Pipeline (NEW)
# Handles: designer submits design for seeking, manufacturer
#          commits to a design, regional price variants,
#          design advancing to live, admin oversight.
#
# TO REMOVE THIS FEATURE: comment out its line in main.py.
# The rest of the platform continues to work unchanged.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from db import db_admin, get_one, safe_update
from config import (
    MIN_COMMITS_TO_GO_LIVE,
    COMMITMENT_SEEK_HOURS,
    REGIONAL_VARIANT_MAX_MARKUP,
    DESIGN_STATUS_DRAFT,
    DESIGN_STATUS_SEEKING,
    DESIGN_STATUS_COMMITTED,
    DESIGN_STATUS_LIVE,
)
from services.notify_service import (
    notify_manufacturer_commit_invite,
    notify_designer_commitment_received,
    notify_designer_design_live,
    notify_manufacturer_regional_variant_needed,
)

router = APIRouter()


def _norm_tag_set(items: list | None) -> set[str]:
    """Lowercase + strip so designer vs manufacturer tags match reliably."""
    if not items:
        return set()
    return {str(x).strip().lower() for x in items if str(x).strip()}


def _mfr_can_fulfill_design(mfr_machines: set, mfr_materials: set, design: dict) -> bool:
    req_m = _norm_tag_set(design.get("required_machines"))
    req_mat = _norm_tag_set(design.get("required_materials"))
    return req_m.issubset(mfr_machines) and req_mat.issubset(mfr_materials)


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class SeekCommitmentsRequest(BaseModel):
    design_id:  str
    designer_id: str


class CommitRequest(BaseModel):
    design_id:         str
    manufacturer_id:   str
    committed_price:   float   # Price manufacturer will honor
    # Optional: if empty, server uses manufacturers.city / manufacturers.state
    region_city:       str = ""
    region_state:      str = ""
    notes:             str = ""


class RegionalVariantRequest(BaseModel):
    design_id:         str
    manufacturer_id:   str
    designer_id:       str     # Designer must approve
    proposed_price:    float
    region_city:       str
    region_state:      str
    reason:            str     # Why the price differs (material cost, labour etc.)


class ApproveVariantRequest(BaseModel):
    variant_id:  str
    designer_id: str
    approved:    bool
    notes:       str = ""


class PauseDesignRequest(BaseModel):
    design_id:  str
    designer_id: str
    reason:     str = ""


# ════════════════════════════════════════════════════════════════
# ENDPOINT: DESIGNER SUBMITS DESIGN FOR SEEKING
# POST /api/v1/designs/seek
# ════════════════════════════════════════════════════════════════

@router.post("/designs/seek")
async def seek_commitments(req: SeekCommitmentsRequest, bg: BackgroundTasks):
    """
    Designer moves their design from DRAFT to SEEKING.
    Platform alerts all capable manufacturers nationally via WhatsApp + email.
    Design is NOT visible to customers yet.
    """

    design = get_one("designs", {"id": req.design_id})
    if not design:
        raise HTTPException(404, "Design not found")
    if design["designer_id"] != req.designer_id:
        raise HTTPException(403, "Not your design")
    if design["status"] not in (DESIGN_STATUS_DRAFT, DESIGN_STATUS_COMMITTED):
        raise HTTPException(400, f"Design must be in draft or committed state. Current: {design['status']}")

    # Advance to SEEKING
    safe_update("designs", {"id": req.design_id}, {
        "status":     DESIGN_STATUS_SEEKING,
        "seeking_at": datetime.now(timezone.utc).isoformat(),
    })

    # Find capable manufacturers (match machine_types and materials)
    capable_mfrs = _find_capable_manufacturers(design)

    # Alert each manufacturer in background
    for mfr in capable_mfrs:
        bg.add_task(
            notify_manufacturer_commit_invite,
            mfr["id"],
            design["id"],
            design["title"],
            design["base_price"],
        )

    # Log broadcast
    db_admin.table("commitment_broadcasts").insert({
        "id":             str(uuid.uuid4()),
        "design_id":      req.design_id,
        "broadcast_at":   datetime.now(timezone.utc).isoformat(),
        "recipients":     len(capable_mfrs),
        "broadcast_type": "initial_seek",
    }).execute()

    return {
        "design_id":    req.design_id,
        "status":       DESIGN_STATUS_SEEKING,
        "alerted":      len(capable_mfrs),
        "message":      f"{len(capable_mfrs)} manufacturers alerted. Waiting for commitments.",
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: MANUFACTURER COMMITS TO A DESIGN
# POST /api/v1/commitments
# ════════════════════════════════════════════════════════════════

@router.post("/commitments")
async def create_commitment(req: CommitRequest, bg: BackgroundTasks):
    """
    Manufacturer opts in to fulfill a design at a specific price.
    If committed_price matches base_price: instant approval.
    If different: creates a regional variant request for designer approval.
    Once MIN_COMMITS_TO_GO_LIVE commits exist: design advances to COMMITTED.
    Once design is COMMITTED it can be set LIVE.
    """

    design = get_one("designs", {"id": req.design_id})
    if not design:
        raise HTTPException(404, "Design not found")
    if design["status"] not in (DESIGN_STATUS_SEEKING, DESIGN_STATUS_COMMITTED):
        raise HTTPException(400, "Design is not seeking commitments")

    # Check for duplicate commitment
    existing = (
        db_admin.table("manufacturer_commitments")
        .select("id")
        .eq("design_id", req.design_id)
        .eq("manufacturer_id", req.manufacturer_id)
        .execute()
        .data
    )
    if existing:
        raise HTTPException(409, "You have already committed to this design")

    mfr_row = get_one("manufacturers", {"id": req.manufacturer_id})
    if not mfr_row:
        raise HTTPException(404, "Manufacturer not found")

    city = (req.region_city or "").strip() or (mfr_row.get("city") or "").strip()
    state = (req.region_state or "").strip() or (mfr_row.get("state") or "").strip()
    if not city or not state:
        raise HTTPException(
            400,
            "Workshop location incomplete. Set city and state in your manufacturer profile "
            "(Workshop Profile → location) before committing.",
        )

    # Validate regional markup limit
    base = design["base_price"]
    if req.committed_price > base * (1 + REGIONAL_VARIANT_MAX_MARKUP):
        raise HTTPException(400,
            f"Committed price cannot exceed {int(REGIONAL_VARIANT_MAX_MARKUP * 100)}% "
            f"above base price of Rs.{base}"
        )

    # Determine if this needs designer approval (regional variant)
    needs_approval = abs(req.committed_price - base) > 0.01

    commitment_id = str(uuid.uuid4())
    db_admin.table("manufacturer_commitments").insert({
        "id":              commitment_id,
        "design_id":       req.design_id,
        "manufacturer_id": req.manufacturer_id,
        "committed_price": req.committed_price,
        "base_price":      base,
        "region_city":     city,
        "region_state":    state,
        "status":          "pending_approval" if needs_approval else "active",
        "notes":           req.notes,
        "committed_at":    datetime.now(timezone.utc).isoformat(),
    }).execute()

    # If regional variant: create variant request for designer
    if needs_approval:
        variant_id = str(uuid.uuid4())
        db_admin.table("regional_price_variants").insert({
            "id":              variant_id,
            "design_id":       req.design_id,
            "commitment_id":   commitment_id,
            "manufacturer_id": req.manufacturer_id,
            "proposed_price":  req.committed_price,
            "base_price":      base,
            "region_city":     city,
            "region_state":    state,
            "status":          "pending",
            "submitted_at":    datetime.now(timezone.utc).isoformat(),
        }).execute()

        bg.add_task(
            notify_manufacturer_regional_variant_needed,
            design["designer_id"],
            design["title"],
            city,
            req.committed_price,
            variant_id,
        )

        return {
            "commitment_id": commitment_id,
            "status":        "pending_approval",
            "message":       "Regional price variant submitted. Awaiting designer approval.",
        }

    # Notify designer
    bg.add_task(
        notify_designer_commitment_received,
        design["designer_id"],
        design["title"],
        city,
        req.committed_price,
    )

    # Check if design should advance
    bg.add_task(_check_and_advance_design, req.design_id)

    return {
        "commitment_id": commitment_id,
        "status":        "active",
        "message":       "Commitment accepted. You are now a Certified Maker for this design.",
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: DESIGNER APPROVES / REJECTS REGIONAL VARIANT
# POST /api/v1/commitments/variants/review
# ════════════════════════════════════════════════════════════════

@router.post("/commitments/variants/review")
async def review_variant(req: ApproveVariantRequest, bg: BackgroundTasks):
    """
    Designer approves or rejects a regional price variant.
    Approved: manufacturer commitment becomes active.
    Rejected: manufacturer is notified, commitment removed.
    """

    variant = get_one("regional_price_variants", {"id": req.variant_id})
    if not variant:
        raise HTTPException(404, "Variant not found")

    design = get_one("designs", {"id": variant["design_id"]})
    if design["designer_id"] != req.designer_id:
        raise HTTPException(403, "Not your design")

    if req.approved:
        # Activate the commitment
        safe_update("manufacturer_commitments",
            {"id": variant["commitment_id"]},
            {"status": "active", "approved_at": datetime.now(timezone.utc).isoformat()}
        )
        safe_update("regional_price_variants",
            {"id": req.variant_id},
            {"status": "approved", "reviewed_at": datetime.now(timezone.utc).isoformat(),
             "reviewer_notes": req.notes}
        )
        bg.add_task(_check_and_advance_design, variant["design_id"])

        return {"approved": True, "message": "Regional variant approved. Manufacturer is now active."}

    else:
        # Reject and remove commitment
        safe_update("manufacturer_commitments",
            {"id": variant["commitment_id"]}, {"status": "rejected"}
        )
        safe_update("regional_price_variants",
            {"id": req.variant_id},
            {"status": "rejected", "reviewed_at": datetime.now(timezone.utc).isoformat(),
             "reviewer_notes": req.notes}
        )
        return {"approved": False, "message": "Regional variant rejected."}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET DESIGNS SEEKING COMMITMENTS (manufacturer view)
# GET /api/v1/commitments/available
# ════════════════════════════════════════════════════════════════

@router.get("/commitments/available")
def get_available_designs(manufacturer_id: str):
    """
    Manufacturer's jobs board.
    Returns all designs in SEEKING state that match this
    manufacturer's machine capabilities and have not yet been
    committed to by this manufacturer.
    """

    manufacturer = get_one("manufacturers", {"id": manufacturer_id})
    if not manufacturer:
        raise HTTPException(404, "Manufacturer not found")

    # Get all seeking designs
    designs = (
        db_admin.table("designs")
        .select("*")
        .eq("status", DESIGN_STATUS_SEEKING)
        .execute()
        .data
    )

    # Get designs already committed to by this manufacturer
    my_commits = {
        c["design_id"]
        for c in db_admin.table("manufacturer_commitments")
        .select("design_id")
        .eq("manufacturer_id", manufacturer_id)
        .execute()
        .data
    }

    # Filter: exclude already committed, match machine types / materials (normalized)
    mfr_machines   = _norm_tag_set(manufacturer.get("machine_types"))
    mfr_materials  = _norm_tag_set(manufacturer.get("materials"))
    available = []

    for d in designs:
        if d["id"] in my_commits:
            continue
        if _mfr_can_fulfill_design(mfr_machines, mfr_materials, d):
            available.append(d)

    # Enrich for manufacturer UI: designer display name + seeking duration
    designer_ids = list({row["designer_id"] for row in available})
    names: dict[str, str] = {}
    if designer_ids:
        prow = (
            db_admin.table("profiles")
            .select("id, full_name")
            .in_("id", designer_ids)
            .execute()
            .data
        )
        names = {r["id"]: r.get("full_name") or "" for r in (prow or [])}

    now = datetime.now(timezone.utc)
    for row in available:
        row["designer_name"] = names.get(row["designer_id"], "")
        seeking_at = row.get("seeking_at")
        if seeking_at:
            try:
                ts = datetime.fromisoformat(seeking_at.replace("Z", "+00:00"))
                row["days_seeking"] = max(0, (now - ts).days)
            except Exception:
                row["days_seeking"] = 0
        else:
            row["days_seeking"] = 0

    return available


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET MY COMMITMENTS (manufacturer view)
# GET /api/v1/commitments/mine
# ════════════════════════════════════════════════════════════════

@router.get("/commitments/mine")
def get_my_commitments(manufacturer_id: str):
    """
    All active commitments for a manufacturer.
    Shows which designs they are a Certified Maker for.
    """
    return (
        db_admin.table("manufacturer_commitments")
        .select("*, designs(id, title, base_price, status)")
        .eq("manufacturer_id", manufacturer_id)
        .eq("status", "active")
        .execute()
        .data
    )


# ════════════════════════════════════════════════════════════════
# ENDPOINT: DESIGNER SETS DESIGN LIVE
# POST /api/v1/designs/{design_id}/publish
# ════════════════════════════════════════════════════════════════

@router.post("/designs/{design_id}/publish")
async def publish_design(design_id: str, body: dict, bg: BackgroundTasks):
    """
    Designer manually publishes a COMMITTED design to LIVE.
    Only possible once MIN_COMMITS_TO_GO_LIVE are active.
    """
    designer_id = body.get("designer_id")
    design = get_one("designs", {"id": design_id})

    if not design:
        raise HTTPException(404, "Design not found")
    if design["designer_id"] != designer_id:
        raise HTTPException(403, "Not your design")
    if design["status"] != DESIGN_STATUS_COMMITTED:
        raise HTTPException(400,
            f"Design must be in committed state. Current: {design['status']}. "
            f"Need at least {MIN_COMMITS_TO_GO_LIVE} active manufacturer commitments."
        )

    safe_update("designs", {"id": design_id}, {
        "status":      DESIGN_STATUS_LIVE,
        "published_at": datetime.now(timezone.utc).isoformat(),
    })

    bg.add_task(notify_designer_design_live, designer_id, design["title"])

    return {"design_id": design_id, "status": DESIGN_STATUS_LIVE,
            "message": "Design is now live and visible to customers."}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: PAUSE A LIVE DESIGN
# POST /api/v1/designs/{design_id}/pause
# ════════════════════════════════════════════════════════════════

@router.post("/designs/{design_id}/pause")
def pause_design(design_id: str, req: PauseDesignRequest):
    """
    Designer or admin pauses a live design.
    Hides it from the shop without deleting anything.
    To re-activate: publish endpoint above.
    """
    design = get_one("designs", {"id": design_id})
    if not design:
        raise HTTPException(404, "Design not found")

    safe_update("designs", {"id": design_id}, {
        "status":    "paused",
        "paused_at": datetime.now(timezone.utc).isoformat(),
        "pause_reason": req.reason,
    })
    return {"design_id": design_id, "status": "paused"}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: ADMIN — ALL PENDING VARIANTS
# GET /api/v1/admin/variants/pending
# ════════════════════════════════════════════════════════════════

@router.get("/admin/variants/pending")
def admin_pending_variants():
    """
    Admin view of all regional price variants awaiting designer approval.
    To remove admin access: delete this endpoint only.
    """
    return (
        db_admin.table("regional_price_variants")
        .select("*, designs(title), manufacturers(shop_name, city)")
        .eq("status", "pending")
        .execute()
        .data
    )


# ════════════════════════════════════════════════════════════════
# INTERNAL HELPER: CHECK AND ADVANCE DESIGN STATUS
# Called after each new commitment is activated.
# ════════════════════════════════════════════════════════════════

async def _check_and_advance_design(design_id: str):
    """
    After each new active commitment, check if design should
    advance from SEEKING to COMMITTED.
    MIN_COMMITS_TO_GO_LIVE is set in config.py.
    """
    design = get_one("designs", {"id": design_id})
    if not design or design["status"] != DESIGN_STATUS_SEEKING:
        return

    active_count = len(
        db_admin.table("manufacturer_commitments")
        .select("id")
        .eq("design_id", design_id)
        .eq("status", "active")
        .execute()
        .data
    )

    if active_count >= MIN_COMMITS_TO_GO_LIVE:
        safe_update("designs", {"id": design_id}, {
            "status":       DESIGN_STATUS_COMMITTED,
            "committed_at": datetime.now(timezone.utc).isoformat(),
        })


def _find_capable_manufacturers(design: dict) -> list[dict]:
    """
    Find all manufacturers whose machine types and materials
    match the design's requirements. Used when broadcasting
    commit invites.
    """
    all_mfrs = db_admin.table("manufacturers").select("*").eq("is_active", True).execute().data

    capable = []
    for m in all_mfrs:
        mfr_machines = _norm_tag_set(m.get("machine_types"))
        mfr_materials = _norm_tag_set(m.get("materials"))
        if _mfr_can_fulfill_design(mfr_machines, mfr_materials, design):
            capable.append(m)
    return capable
