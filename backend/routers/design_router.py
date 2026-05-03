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
    DESIGN_STATUS_LIVE,
    DESIGN_STATUS_SEEKING,
)
from routers.auth_router import verify_jwt   # reuse shared JWT helper

router = APIRouter()

CAD_BUCKET    = "cad-files"
CAD_URL_TTL   = 3600   # 60 minutes
PRODUCT_IMAGES_BUCKET = "product-images"
MEDIA_SIGNED_TTL = 7200  # 2h — full-quality image view/download


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


class DesignGalleryRequest(BaseModel):
    """Storage paths in `product-images` (or legacy https URLs). Paths must be under the uploader's auth folder."""
    designer_id:          str
    gallery_image_urls:   List[str]


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


def _design_visible_in_shop_catalog(design: dict) -> bool:
    """Same visibility rule as homepage catalog (live or at least one commitment)."""
    st = design.get("status")
    if st in (DESIGN_STATUS_DRAFT, DESIGN_STATUS_PAUSED):
        return False
    if st == DESIGN_STATUS_LIVE:
        return True
    return (design.get("active_commit_count") or 0) >= 1


def _sign_bucket_path(bucket: str, path: str) -> str:
    path = (path or "").strip()
    if not path:
        return ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    try:
        response = db_admin.storage.from_(bucket).create_signed_url(path, MEDIA_SIGNED_TTL)
        signed = (
            response.get("signedURL")
            or response.get("signed_url")
            or response.get("data", {}).get("signedURL", "")
        )
        if not signed:
            raise ValueError(f"Empty signed URL: {response}")
        return signed
    except Exception as e:
        raise HTTPException(500, f"Could not sign storage URL: {e}") from e


def _can_access_design_media(design: dict, profile: Optional[dict]) -> bool:
    """Who may fetch signed URLs for gallery + showcase images."""
    if not profile:
        return _design_visible_in_shop_catalog(design)

    role = profile.get("role")
    if role == "admin":
        return True
    if role == "designer" and design.get("designer_id") == profile["id"]:
        return True
    if role == "manufacturer":
        mfr = get_one("manufacturers", {"profile_id": profile["id"]})
        if not mfr:
            return False
        hit = (
            db_admin.table("manufacturer_commitments")
            .select("id")
            .eq("design_id", design["id"])
            .eq("manufacturer_id", mfr["id"])
            .limit(1)
            .execute()
            .data
        )
        if hit:
            return True
        # Commitment board: evaluate specs/photos before opting in (no row yet).
        if design.get("status") == DESIGN_STATUS_SEEKING:
            return True
        # Logged-in manufacturer browsing the shop — same images as public catalog.
        if _design_visible_in_shop_catalog(design):
            return True
        return False
    if role == "customer":
        if _design_visible_in_shop_catalog(design):
            return True
        ord_hit = (
            db_admin.table("orders")
            .select("id")
            .eq("customer_id", profile["id"])
            .eq("design_id", design["id"])
            .limit(1)
            .execute()
            .data
        )
        return bool(ord_hit)
    return False


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
# ENDPOINT: PREVIEW + GALLERY + SHOWCASE IMAGES (signed URLs, full quality)
# GET /api/v1/designs/{design_id}/media
# ════════════════════════════════════════════════════════════════

def _preview_display_url(preview: str) -> str:
    p = (preview or "").strip()
    if not p:
        return ""
    if p.startswith("http://") or p.startswith("https://"):
        return p
    return _sign_bucket_path("design-previews", p)


def _preview_source_bucket(preview_raw: str) -> str:
    """Labels preview provenance for API clients (shop listing = design-previews bucket)."""
    p = (preview_raw or "").strip()
    if not p:
        return ""
    if p.startswith("http://") or p.startswith("https://"):
        if "design-previews" in p:
            return "design-previews"
        return "external"
    return "design-previews"


def _gallery_item_dict(path: str, signed_url: str) -> dict:
    p = (path or "").strip()
    fn = p.rsplit("/", 1)[-1]
    if p.startswith("http://") or p.startswith("https://"):
        return {"path": p, "url": signed_url, "filename": fn, "source_bucket": "external"}
    return {
        "path": p,
        "url": signed_url,
        "filename": fn,
        "source_bucket": PRODUCT_IMAGES_BUCKET,
    }


@router.get("/designs/{design_id}/media")
def get_design_media(
    design_id: str,
    authorization: Optional[str] = Header(None),
):
    """
    Returns full-quality URLs for:
      • Listing preview — stored in ``design-previews`` (same asset as the shop card when applicable).
      • Designer gallery — ``product-images`` paths in ``designs.gallery_image_urls``.
      • Workshop showcases — ``product-images`` paths on commitments.

    Customers see and may download both listing preview and product-images gallery whenever access
    is allowed (same signed URLs as other roles). Access: catalog-visible design, or an existing
    customer order for this design, or designer / manufacturer (committed, seeking-commitment
    board, or catalog-visible) / admin.

    Uses signed URLs for private bucket paths (TTL ``MEDIA_SIGNED_TTL``).
    Anonymous users: only when the design is visible on the public shop catalog.
    """
    design = get_one("designs", {"id": design_id})
    if not design:
        raise HTTPException(404, "Design not found")

    profile: Optional[dict] = None
    if authorization:
        payload = verify_jwt(authorization)
        profile = get_one("profiles", {"auth_id": payload.get("sub")})

    if not _can_access_design_media(design, profile):
        raise HTTPException(403, "Not allowed to view this design's images")

    preview_raw = design.get("preview_image_url") or ""
    gallery_items: list[dict] = []
    for p in (design.get("gallery_image_urls") or []):
        p = (p or "").strip()
        if not p:
            continue
        if p.startswith("http://") or p.startswith("https://"):
            gallery_items.append(_gallery_item_dict(p, p))
        else:
            gallery_items.append(
                _gallery_item_dict(p, _sign_bucket_path(PRODUCT_IMAGES_BUCKET, p))
            )

    showcase_blocks: list[dict] = []
    comm_rows = (
        db_admin.table("manufacturer_commitments")
        .select("id, status, showcase_image_urls")
        .eq("design_id", design_id)
        .execute()
        .data
    ) or []
    for c in comm_rows:
        imgs: list[dict] = []
        for p in (c.get("showcase_image_urls") or []):
            p = (p or "").strip()
            if not p:
                continue
            if p.startswith("http://") or p.startswith("https://"):
                imgs.append(_gallery_item_dict(p, p))
            else:
                imgs.append(
                    _gallery_item_dict(p, _sign_bucket_path(PRODUCT_IMAGES_BUCKET, p))
                )
        if imgs:
            showcase_blocks.append({
                "commitment_id": c["id"],
                "status": c.get("status"),
                "images": imgs,
            })

    pv_url = _preview_display_url(preview_raw)
    return {
        "design_id": design_id,
        "preview": {
            "url": pv_url,
            "filename": (preview_raw.rsplit("/", 1)[-1] if preview_raw else ""),
            "source_bucket": _preview_source_bucket(preview_raw) or None,
        },
        "gallery": gallery_items,
        "commitment_showcases": showcase_blocks,
        "signed_url_ttl_seconds": MEDIA_SIGNED_TTL,
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: DESIGNER UPDATES GALLERY PATHS (after client uploads to Storage)
# PATCH /api/v1/designs/{design_id}/gallery
# ════════════════════════════════════════════════════════════════

@router.patch("/designs/{design_id}/gallery")
def update_design_gallery(
    design_id: str,
    req: DesignGalleryRequest,
    authorization: Optional[str] = Header(None),
):
    payload = verify_jwt(authorization)
    auth_sub = payload.get("sub")
    profile = get_one("profiles", {"auth_id": auth_sub})
    if not profile or profile["id"] != req.designer_id:
        raise HTTPException(403, "You must be signed in as this designer")
    if profile.get("role") != "designer":
        raise HTTPException(403, "Only designers can edit the product gallery")

    design = get_one("designs", {"id": design_id})
    if not design or design["designer_id"] != profile["id"]:
        raise HTTPException(403, "Not your design")

    for p in req.gallery_image_urls:
        p = (p or "").strip()
        if not p:
            continue
        if p.startswith("http://") or p.startswith("https://"):
            continue
        if not auth_sub or not p.startswith(f"{auth_sub}/"):
            raise HTTPException(
                400,
                "Gallery files must be uploaded to your Storage folder (product-images/{your-auth-id}/…).",
            )

    ok, err = safe_update(
        "designs",
        {"id": design_id},
        {
            "gallery_image_urls": req.gallery_image_urls,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        },
    )
    if not ok:
        raise HTTPException(500, f"Update failed: {err}")
    return {"design_id": design_id, "gallery_count": len(req.gallery_image_urls)}


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
