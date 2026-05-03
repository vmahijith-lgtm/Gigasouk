# ════════════════════════════════════════════════════════════════
# routers/qc_router.py — Quality Control Gate
# Handles: manufacturer uploads QC photos, AI validates dimensions,
#          QC pass triggers shipping, QC fail notifies admin.
# AI logic lives in gigasouk_qc.py (services folder).
# To swap AI for manual review: edit gigasouk_qc.py only.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, BackgroundTasks, Header
from pydantic import BaseModel

from db import db_admin, get_one, safe_update
from routers.auth_router import verify_jwt
from config import QC_REQUIRED_PHOTOS, ORDER_STATUS_QC, ORDER_STATUS_SHIPPED
from services.gigasouk_qc    import run_qc_check
from services.shiprocket_service import create_shipment
from services.notify_service import (
    notify_customer_qc_passed,
    notify_admin_qc_failed,
    notify_customer_shipped,
)

router = APIRouter()


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class QCSubmitRequest(BaseModel):
    order_id:   str
    photo_urls: list[str]   # Must be QC_REQUIRED_PHOTOS fetchable URLs (e.g. signed)
    notes:      str = ""


class QCManualReviewRequest(BaseModel):
    qc_record_id:  str
    admin_id:      str
    decision:      str   # "pass" or "fail"
    notes:         str = ""


# ════════════════════════════════════════════════════════════════
# ENDPOINT: MANUFACTURER SUBMITS QC PHOTOS
# POST /api/v1/qc/submit
# ════════════════════════════════════════════════════════════════

@router.post("/qc/submit")
async def submit_qc(
    req: QCSubmitRequest,
    bg: BackgroundTasks,
    authorization: Optional[str] = Header(None),
):
    """
    Manufacturer uploads photos of the finished part.
    AI runs dimension check against the CAD spec.
    PASS → shipping is triggered automatically.
    FAIL → admin is alerted, manufacturer must re-make.

    Caller must be authenticated as the order's manufacturer (JWT — manufacturer_id is not taken from the body).
    """

    payload = verify_jwt(authorization)
    profile = get_one("profiles", {"auth_id": payload.get("sub")})
    if not profile or profile.get("role") != "manufacturer":
        raise HTTPException(403, "Manufacturers only")
    mfr = get_one("manufacturers", {"profile_id": profile["id"]})
    if not mfr:
        raise HTTPException(404, "Manufacturer profile not found")

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["manufacturer_id"] != mfr["id"]:
        raise HTTPException(403, "Not your order")
    # cutting = first attempt; qc_failed = retry after AI/admin failure
    if order["status"] not in ("cutting", "qc_failed"):
        raise HTTPException(
            400,
            f"Order is not ready for QC. Current status: {order['status']}",
        )
    if len(req.photo_urls) < QC_REQUIRED_PHOTOS:
        raise HTTPException(400, f"Please upload all {QC_REQUIRED_PHOTOS} required photos")

    # Advance order to QC review
    safe_update("orders", {"id": req.order_id}, {"status": ORDER_STATUS_QC})

    # Get design for CAD reference
    design = get_one("designs", {"id": order["design_id"]})
    cad_url = design.get("cad_file_url", "") if design else ""

    # Run AI QC check (async — downloads images concurrently)
    qc_result = await run_qc_check(req.photo_urls, cad_url)

    # Record QC attempt (including per-photo breakdown)
    qc_id = str(uuid.uuid4())
    db_admin.table("qc_records").insert({
        "id":              qc_id,
        "order_id":        req.order_id,
        "manufacturer_id": mfr["id"],
        "photo_urls":      req.photo_urls,
        "ai_passed":       qc_result["passed"],
        "ai_score":        qc_result.get("score", 0),
        "ai_notes":        qc_result.get("notes", ""),
        "ai_per_photo":    qc_result.get("per_photo", []),
        "manufacturer_notes": req.notes,
        "reviewed_at":     datetime.now(timezone.utc).isoformat(),
    }).execute()

    if qc_result["passed"]:
        # QC PASS — trigger shipping
        bg.add_task(_trigger_shipping, req.order_id, qc_id)
        return {
            "qc_id":   qc_id,
            "passed":  True,
            "message": "QC passed. Shipping is being arranged automatically.",
        }
    else:
        # QC FAIL — alert admin and manufacturer
        safe_update("orders", {"id": req.order_id}, {"status": "qc_failed"})
        bg.add_task(notify_admin_qc_failed, req.order_id, qc_result.get("notes", ""))
        return {
            "qc_id":   qc_id,
            "passed":  False,
            "reason":  qc_result.get("notes", "Dimensions outside tolerance"),
            "message": "QC failed. Please re-make the part and resubmit.",
        }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: ADMIN MANUAL QC OVERRIDE
# POST /api/v1/qc/manual-review
# ════════════════════════════════════════════════════════════════

@router.post("/qc/manual-review")
async def manual_qc_review(req: QCManualReviewRequest, bg: BackgroundTasks):
    """
    Admin manually passes or fails a QC record.
    Used when AI result is disputed or AI is unavailable.
    To remove AI and use only manual: edit gigasouk_qc.py to
    always return passed=False, forcing all QC through here.
    """

    qc = get_one("qc_records", {"id": req.qc_record_id})
    if not qc:
        raise HTTPException(404, "QC record not found")

    db_admin.table("qc_records").update({
        "manual_decision": req.decision,
        "manual_admin_id": req.admin_id,
        "manual_notes":    req.notes,
        "manually_reviewed_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", req.qc_record_id).execute()

    if req.decision == "pass":
        bg.add_task(_trigger_shipping, qc["order_id"], req.qc_record_id)
        return {"decision": "pass", "message": "Manual pass. Shipping triggered."}
    else:
        safe_update("orders", {"id": qc["order_id"]}, {"status": "qc_failed"})
        return {"decision": "fail", "message": "Manual fail. Manufacturer must re-make."}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET QC HISTORY FOR AN ORDER
# GET /api/v1/qc/{order_id}
# ════════════════════════════════════════════════════════════════

@router.get("/qc/{order_id}")
def get_qc_history(order_id: str):
    """
    All QC attempts for an order. Shows pass/fail history.
    """
    return (
        db_admin.table("qc_records")
        .select("*")
        .eq("order_id", order_id)
        .order("reviewed_at", desc=True)
        .execute()
        .data
    )


# ════════════════════════════════════════════════════════════════
# INTERNAL: TRIGGER SHIPPING AFTER QC PASS
# ════════════════════════════════════════════════════════════════

async def _trigger_shipping(order_id: str, qc_id: str):
    """
    Called automatically after QC passes.
    Creates a Shiprocket shipment and updates order.
    """
    order = get_one("orders", {"id": order_id})
    if not order:
        return

    shipment = await create_shipment(order)
    if shipment.get("awb"):
        safe_update("orders", {"id": order_id}, {
            "status":       ORDER_STATUS_SHIPPED,
            "shiprocket_awb":  shipment["awb"],
            "tracking_url": shipment["tracking_url"],
            "shipped_at":   datetime.now(timezone.utc).isoformat(),
        })
        await notify_customer_shipped(order["customer_id"], order["order_ref"], shipment["tracking_url"])
        await notify_customer_qc_passed(order["customer_id"], order["order_ref"])
