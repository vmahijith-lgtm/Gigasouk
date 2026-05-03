# ════════════════════════════════════════════════════════════════
# routers/design_router.py — Designer Design CRUD + CAD URL
#
# Endpoints:
#   GET    /api/v1/designs              — list a designer's designs
#   POST   /api/v1/designs              — create a new design (metadata)
#   PATCH  /api/v1/designs/{id}         — update design metadata
#   DELETE /api/v1/designs/{id}         — delete a draft/paused design
#   GET    /api/v1/designs/{id}/cad-url — return a 60-min signed URL for
#                                         the private CAD file (designer
#                                         or any authenticated manufacturer)
#
# CAD files are uploaded browser-to-Supabase-Storage directly from the
# frontend; only the storage PATH is stored in designs.cad_file_url.
# The backend generates signed URLs on demand so the cad-files bucket
# can stay private with no public access.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from db import db_admin, get_one, safe_update
from config import (
    DESIGN_STATUS_DRAFT,
    DESIGN_STATUS_PAUSED,
)
from routers.auth_router import verify_jwt   # reuse shared JWT helper

router = APIRouter()

CAD_BUCKET    = "cad-files"
CAD_URL_TTL   = 3600   # 60 minutes


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class CreateDesignRequest(BaseModel):
    designer_id:        str
    title:              str
    description:        Optional[str] = ""
    category:           Optional[str] = ""
    base_price:         float
    royalty_percent:    float = 15.0
    required_machines:  List[str] = []
    required_materials: List[str] = []
    cad_file_url:       Optional[str] = ""   # storage path OR signed URL
    preview_image_url:  Optional[str] = ""
    dimensions_mm:      Optional[dict] = None
    tolerance_mm:       float = 0.5


class UpdateDesignRequest(BaseModel):
    designer_id:        str
    title:              Optional[str] = None
    description:        Optional[str] = None
    category:           Optional[str] = None
    base_price:         Optional[float] = None
    royalty_percent:    Optional[float] = None
    required_machines:  Optional[List[str]] = None
    required_materials: Optional[List[str]] = None
    cad_file_url:       Optional[str] = None
    preview_image_url:  Optional[str] = None
    dimensions_mm:      Optional[dict] = None
    tolerance_mm:       Optional[float] = None


# ════════════════════════════════════════════════════════════════
# HELPER: extract storage path from a Supabase Storage URL
# The URL format is:
#   https://<project>.supabase.co/storage/v1/object/public/<bucket>/<path>
# or just the raw path stored by the frontend.
# ════════════════════════════════════════════════════════════════

def _extract_cad_path(cad_file_url: str) -> str:
    """Return the relative path within the cad-files bucket."""
    if not cad_file_url:
        return ""
    # Full Supabase storage URL
    marker = f"/object/public/{CAD_BUCKET}/"
    if marker in cad_file_url:
        return cad_file_url.split(marker, 1)[1]
    # Also handle /object/sign/ style URLs
    marker2 = f"/object/sign/{CAD_BUCKET}/"
    if marker2 in cad_file_url:
        return cad_file_url.split(marker2, 1)[1].split("?")[0]
    # Assume it is already a bare path (our preferred storage convention)
    return cad_file_url


# ════════════════════════════════════════════════════════════════
# ENDPOINT: LIST DESIGNER'S DESIGNS
# GET /api/v1/designs?designer_id=<uuid>
# ════════════════════════════════════════════════════════════════

@router.get("/designs")
def list_designs(
    designer_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Return all designs belonging to a designer, newest first.
    Requires the caller's JWT to match the requested designer_id so
    a designer cannot enumerate another designer's private drafts.
    """
    payload  = verify_jwt(authorization)
    auth_uid = payload.get("sub")

    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile or profile["id"] != designer_id:
        raise HTTPException(403, "designer_id does not match the authenticated user")

    rows = (
        db_admin.table("designs")
        .select("*, manufacturer_commitments(id, status, region_city, committed_price)")
        .eq("designer_id", designer_id)
        .order("created_at", desc=True)
        .execute()
        .data
    )
    return rows or []


# ════════════════════════════════════════════════════════════════
# ENDPOINT: CREATE NEW DESIGN
# POST /api/v1/designs
# ════════════════════════════════════════════════════════════════

@router.post("/designs", status_code=201)
def create_design(
    req: CreateDesignRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Designer creates a new design (starts in DRAFT status).
    CAD file and preview image are uploaded to Supabase Storage by the
    frontend before this call; only the storage paths arrive here.
    """
    payload  = verify_jwt(authorization)
    auth_uid = payload.get("sub")

    # Confirm the caller owns the designer_id they're claiming
    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile or profile["id"] != req.designer_id:
        raise HTTPException(403, "designer_id does not match the authenticated user")

    design_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    db_admin.table("designs").insert({
        "id":                 design_id,
        "designer_id":        req.designer_id,
        "title":              req.title.strip(),
        "description":        req.description or "",
        "category":           req.category or "",
        "base_price":         req.base_price,
        "royalty_percent":    req.royalty_percent,
        "required_machines":  req.required_machines,
        "required_materials": req.required_materials,
        "cad_file_url":       req.cad_file_url or "",
        "preview_image_url":  req.preview_image_url or "",
        "dimensions_mm":      req.dimensions_mm,
        "tolerance_mm":       req.tolerance_mm,
        "status":             DESIGN_STATUS_DRAFT,
        "active_commit_count": 0,
        "total_orders":       0,
        "created_at":         now,
        "updated_at":         now,
    }).execute()

    return {"design_id": design_id, "status": DESIGN_STATUS_DRAFT}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: UPDATE DESIGN METADATA
# PATCH /api/v1/designs/{design_id}
# ════════════════════════════════════════════════════════════════

@router.patch("/designs/{design_id}")
def update_design(
    design_id: str,
    req: UpdateDesignRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Update mutable design fields (title, price, machines, CAD URL, …).
    Only allowed while the design is in draft or paused status.
    """
    payload  = verify_jwt(authorization)
    auth_uid = payload.get("sub")

    design = get_one("designs", {"id": design_id})
    if not design:
        raise HTTPException(404, "Design not found")

    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile or profile["id"] != req.designer_id:
        raise HTTPException(403, "Not your design")
    if design["designer_id"] != req.designer_id:
        raise HTTPException(403, "Not your design")
    if design["status"] not in (DESIGN_STATUS_DRAFT, DESIGN_STATUS_PAUSED):
        raise HTTPException(400,
            f"Design cannot be edited in '{design['status']}' status. "
            "Pause it first, then edit."
        )

    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    for field in (
        "title", "description", "category", "base_price",
        "royalty_percent", "required_machines", "required_materials",
        "cad_file_url", "preview_image_url", "dimensions_mm", "tolerance_mm",
    ):
        val = getattr(req, field)
        if val is not None:
            updates[field] = val

    ok, err = safe_update("designs", {"id": design_id}, updates)
    if not ok:
        raise HTTPException(500, f"Update failed: {err}")

    return {"design_id": design_id, "updated": list(updates.keys())}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: DELETE DESIGN
# DELETE /api/v1/designs/{design_id}?designer_id=<uuid>
# ════════════════════════════════════════════════════════════════

@router.delete("/designs/{design_id}")
def delete_design(
    design_id: str,
    designer_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Hard-delete a design. Only allowed for DRAFT or PAUSED designs
    that have no confirmed orders.
    """
    payload  = verify_jwt(authorization)
    auth_uid = payload.get("sub")

    design = get_one("designs", {"id": design_id})
    if not design:
        raise HTTPException(404, "Design not found")

    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile or profile["id"] != designer_id:
        raise HTTPException(403, "Not your design")
    if design["designer_id"] != designer_id:
        raise HTTPException(403, "Not your design")
    if design["status"] not in (DESIGN_STATUS_DRAFT, DESIGN_STATUS_PAUSED):
        raise HTTPException(400,
            f"Cannot delete a design in '{design['status']}' status. "
            "Only draft or paused designs can be deleted."
        )

    # Guard against designs with active orders.
    # Filter client-side to stay compatible with all supabase-py/postgrest-py versions
    # (the JS-style .not_.in_() builder is not reliably available in Python).
    all_orders = (
        db_admin.table("orders")
        .select("id, status")
        .eq("design_id", design_id)
        .execute()
        .data
    ) or []
    active_orders = [
        o for o in all_orders
        if o.get("status") not in ("cancelled", "refunded")
    ]
    if active_orders:
        raise HTTPException(400, "Cannot delete a design with active orders.")

    db_admin.table("designs").delete().eq("id", design_id).execute()
    return {"deleted": True, "design_id": design_id}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET SIGNED CAD FILE URL
# GET /api/v1/designs/{design_id}/cad-url
#
# Access rules:
#   - The designer who owns the design
#   - Any authenticated manufacturer (to evaluate before committing)
# ════════════════════════════════════════════════════════════════

@router.get("/designs/{design_id}/cad-url")
def get_cad_url(
    design_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Generate a 60-minute signed URL for the private CAD file.
    Only the owning designer or any authenticated manufacturer can call this.
    """
    payload  = verify_jwt(authorization)
    auth_uid = payload.get("sub")

    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile:
        raise HTTPException(403, "Profile not found")

    role = profile.get("role", "")
    if role not in ("designer", "manufacturer", "admin"):
        raise HTTPException(403, "Only designers and manufacturers can access CAD files")

    design = get_one("designs", {"id": design_id})
    if not design:
        raise HTTPException(404, "Design not found")

    # Designers may only access their own designs' CAD files
    if role == "designer" and design["designer_id"] != profile["id"]:
        raise HTTPException(403, "You can only access your own design files")

    cad_url = design.get("cad_file_url", "")
    if not cad_url:
        raise HTTPException(404, "No CAD file has been uploaded for this design yet")

    path = _extract_cad_path(cad_url)
    if not path:
        raise HTTPException(404, "Could not resolve CAD file path")

    try:
        response = db_admin.storage.from_(CAD_BUCKET).create_signed_url(path, CAD_URL_TTL)
        # supabase-py 2.x returns a dict with 'signedURL' key
        signed_url = (
            response.get("signedURL")
            or response.get("signed_url")
            or response.get("data", {}).get("signedURL", "")
        )
        if not signed_url:
            raise ValueError(f"Empty signed URL response: {response}")
    except Exception as e:
        raise HTTPException(500, f"Could not generate signed URL: {e}")

    return {
        "signed_url": signed_url,
        "expires_in_seconds": CAD_URL_TTL,
        "design_id": design_id,
        "file_name": path.rsplit("/", 1)[-1],
    }
