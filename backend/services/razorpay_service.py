# ════════════════════════════════════════════════════════════════
# services/razorpay_service.py — Payments and Escrow
# Handles: create payment order, verify payment signature,
#          release escrow to manufacturer, refund to customer.
# All customer payment endpoints require a valid Supabase JWT;
# admin release/refund require role=admin. Secrets never leave the server.
# ════════════════════════════════════════════════════════════════

import hmac
import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import razorpay
from fastapi import APIRouter, HTTPException, Request, Header
from pydantic import BaseModel

from db import db_admin, get_one, safe_update
from config import (
    RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET,
    RAZORPAY_WEBHOOK_SECRET,
    PLATFORM_FEE_PERCENT, DESIGNER_ROYALTY_PERCENT,
    PAYMENT_STATUS_PENDING, PAYMENT_STATUS_ESCROW,
    PAYMENT_STATUS_RELEASED, PAYMENT_STATUS_REFUNDED,
    ORDER_STATUS_CUTTING,
)
from services.notify_service import notify_payment_received, notify_escrow_released
from routers.auth_router import verify_jwt

router = APIRouter()
_rz_client: razorpay.Client | None = None


def _ensure_razorpay_configured() -> None:
    if not (RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET):
        raise HTTPException(
            503,
            "Payment service is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the server environment.",
        )


def _get_rz() -> razorpay.Client:
    _ensure_razorpay_configured()
    global _rz_client
    if _rz_client is None:
        _rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    return _rz_client


def _profile_from_jwt(authorization: Optional[str]):
    payload = verify_jwt(authorization)
    uid = payload.get("sub")
    if not uid:
        raise HTTPException(401, "Invalid token")
    profile = get_one("profiles", {"auth_id": uid})
    if not profile:
        raise HTTPException(404, "Profile not found")
    return profile


def _require_customer(profile: dict) -> None:
    if profile.get("role") != "customer":
        raise HTTPException(403, "Only customers can use payment endpoints")


def _order_amount_paise(order: dict) -> int:
    return int(round(float(order["locked_price"]) * 100))


def _order_by_razorpay_order_id(rz_order_id: str) -> Optional[dict]:
    rows = (
        db_admin.table("orders")
        .select("*")
        .eq("razorpay_order_id", rz_order_id)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class CreatePaymentRequest(BaseModel):
    order_id: str


class VerifyPaymentRequest(BaseModel):
    order_id: str
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


class ReleaseEscrowRequest(BaseModel):
    order_id: str


class RefundRequest(BaseModel):
    order_id: str
    reason: str = ""


# ════════════════════════════════════════════════════════════════
# CORE: release escrow (HTTP admin, Shiprocket webhook, or internal)
# ════════════════════════════════════════════════════════════════

async def release_escrow_core(
    order_id: str,
    released_by_profile_id: Optional[str],
) -> dict:
    """
    Split escrow: platform fee, manufacturer net, designer royalty.
    released_by_profile_id may be None (e.g. Shiprocket webhook).
    """
    order = get_one("orders", {"id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")

    payout_rows = (
        db_admin.table("payouts")
        .select("*")
        .eq("order_id", order_id)
        .limit(1)
        .execute()
        .data
    )
    existing = payout_rows[0] if payout_rows else None
    if existing:
        total = float(existing["total_amount"])
        return {
            "released": True,
            "idempotent": True,
            "total": total,
            "platform_fee": float(existing["platform_fee"]),
            "manufacturer_net": float(existing["manufacturer_amount"]),
            "designer_royalty": float(existing["designer_royalty"]),
        }

    if order["payment_status"] != PAYMENT_STATUS_ESCROW:
        raise HTTPException(400, "Payment is not in escrow")

    total = float(order["locked_price"])
    platform_fee = round(total * PLATFORM_FEE_PERCENT, 2)
    mfr_gross = round(total - platform_fee, 2)
    designer_royalty = round(mfr_gross * DESIGNER_ROYALTY_PERCENT, 2)
    mfr_net = round(mfr_gross - designer_royalty, 2)

    payout_id = str(uuid.uuid4())
    insert_row = {
        "id": payout_id,
        "order_id": order_id,
        "total_amount": total,
        "platform_fee": platform_fee,
        "manufacturer_amount": mfr_net,
        "designer_royalty": designer_royalty,
        "released_by": released_by_profile_id,
        "released_at": datetime.now(timezone.utc).isoformat(),
    }

    db_admin.table("payouts").insert(insert_row).execute()

    safe_update("orders", {"id": order_id}, {
        "payment_status": PAYMENT_STATUS_RELEASED,
        "released_at": datetime.now(timezone.utc).isoformat(),
    })

    design = get_one("designs", {"id": order["design_id"]})
    if design:
        db_admin.rpc("add_to_wallet", {
            "user_id": design["designer_id"],
            "amount": designer_royalty,
            "source": order["order_ref"],
        }).execute()

    await notify_escrow_released(order["manufacturer_id"], order["order_ref"], mfr_net)

    return {
        "released": True,
        "total": total,
        "platform_fee": platform_fee,
        "manufacturer_net": mfr_net,
        "designer_royalty": designer_royalty,
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: CREATE RAZORPAY ORDER (payment link)
# POST /api/v1/payments/create
# ════════════════════════════════════════════════════════════════

@router.post("/payments/create")
def create_payment(
    req: CreatePaymentRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Creates a Razorpay order. Caller must be the order's customer (JWT).
    """
    profile = _profile_from_jwt(authorization)
    _require_customer(profile)
    _ensure_razorpay_configured()

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["customer_id"] != profile["id"]:
        raise HTTPException(403, "Not your order")
    if order["payment_status"] != PAYMENT_STATUS_PENDING:
        raise HTTPException(400, "Payment already initiated or completed")

    locked_price = order.get("locked_price")
    if not locked_price:
        raise HTTPException(400, "Price not locked yet. Complete negotiation first.")

    amount_paise = _order_amount_paise(order)

    # Reuse the active Razorpay order when the client retries checkout (avoids orphan orders).
    existing_rz = order.get("razorpay_order_id")
    if existing_rz:
        return {
            "razorpay_order_id": existing_rz,
            "razorpay_key": RAZORPAY_KEY_ID,
            "amount": amount_paise,
            "currency": "INR",
            "order_ref": order["order_ref"],
        }

    rz_order = _get_rz().order.create({
        "amount": amount_paise,
        "currency": "INR",
        "receipt": order["order_ref"],
        "notes": {
            "gigasouk_order_id": req.order_id,
            "customer_id": profile["id"],
        },
    })

    safe_update("orders", {"id": req.order_id}, {
        "razorpay_order_id": rz_order["id"],
        "payment_status": PAYMENT_STATUS_PENDING,
    })

    return {
        "razorpay_order_id": rz_order["id"],
        "razorpay_key": RAZORPAY_KEY_ID,
        "amount": amount_paise,
        "currency": "INR",
        "order_ref": order["order_ref"],
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: VERIFY PAYMENT SIGNATURE
# POST /api/v1/payments/verify
# ════════════════════════════════════════════════════════════════

@router.post("/payments/verify")
async def verify_payment(
    req: VerifyPaymentRequest,
    authorization: Optional[str] = Header(None),
):
    """Verifies checkout session + HMAC, confirms payment with Razorpay API, then credits escrow."""
    profile = _profile_from_jwt(authorization)
    _require_customer(profile)
    _ensure_razorpay_configured()

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["customer_id"] != profile["id"]:
        raise HTTPException(403, "Not your order")

    stored_rz_order = order.get("razorpay_order_id")
    if not stored_rz_order:
        raise HTTPException(400, "No checkout session for this order. Use Pay again.")
    if req.razorpay_order_id != stored_rz_order:
        raise HTTPException(400, "Payment session does not match this order")

    payload = f"{req.razorpay_order_id}|{req.razorpay_payment_id}"
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, req.razorpay_signature):
        raise HTTPException(400, "Payment signature verification failed")

    if order["payment_status"] == PAYMENT_STATUS_ESCROW:
        if order.get("razorpay_payment_id") == req.razorpay_payment_id:
            return {
                "verified": True,
                "status": "in_escrow",
                "message": "Payment already recorded.",
            }
        raise HTTPException(409, "This order was already paid with a different transaction")

    if order["payment_status"] != PAYMENT_STATUS_PENDING:
        raise HTTPException(
            400,
            f"Order is not awaiting payment confirmation (status: {order['payment_status']})",
        )

    if not order.get("locked_price"):
        raise HTTPException(400, "Price not locked on this order")

    expected_paise = _order_amount_paise(order)

    try:
        rz_pay = _get_rz().payment.fetch(req.razorpay_payment_id)
    except Exception:
        raise HTTPException(
            502,
            "Could not confirm payment with Razorpay. If money was debited, wait a minute and try again or contact support.",
        )

    if rz_pay.get("order_id") != req.razorpay_order_id:
        raise HTTPException(400, "Razorpay payment does not match this checkout session")

    rz_amount = int(rz_pay.get("amount") or 0)
    if rz_amount != expected_paise:
        raise HTTPException(400, "Paid amount does not match the locked order price")

    if rz_pay.get("status") != "captured":
        raise HTTPException(
            400,
            f"Payment is not complete (Razorpay status: {rz_pay.get('status')})",
        )

    paid_at = datetime.now(timezone.utc).isoformat()
    res = (
        db_admin.table("orders")
        .update({
            "razorpay_payment_id": req.razorpay_payment_id,
            "payment_status": PAYMENT_STATUS_ESCROW,
            "status": ORDER_STATUS_CUTTING,
            "paid_at": paid_at,
        })
        .eq("id", req.order_id)
        .eq("payment_status", PAYMENT_STATUS_PENDING)
        .select("id,manufacturer_id,order_ref")
        .execute()
    )
    updated_rows = getattr(res, "data", None) or []
    if not updated_rows:
        order2 = get_one("orders", {"id": req.order_id})
        if (
            order2
            and order2.get("payment_status") == PAYMENT_STATUS_ESCROW
            and order2.get("razorpay_payment_id") == req.razorpay_payment_id
        ):
            return {
                "verified": True,
                "status": "in_escrow",
                "message": "Payment already recorded.",
            }
        raise HTTPException(
            409,
            "Payment state changed while confirming. Refresh your orders and try again if needed.",
        )

    row = updated_rows[0]
    await notify_payment_received(row["manufacturer_id"], row["order_ref"])

    return {"verified": True, "status": "in_escrow", "message": "Payment received. Manufacturing can begin."}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: RELEASE ESCROW TO MANUFACTURER (admin only)
# POST /api/v1/payments/release
# ════════════════════════════════════════════════════════════════

@router.post("/payments/release")
async def release_escrow_http(
    req: ReleaseEscrowRequest,
    authorization: Optional[str] = Header(None),
):
    profile = _profile_from_jwt(authorization)
    if profile.get("role") != "admin":
        raise HTTPException(403, "Admin only")

    return await release_escrow_core(req.order_id, profile["id"])


# ════════════════════════════════════════════════════════════════
# ENDPOINT: REFUND TO CUSTOMER (admin only)
# POST /api/v1/payments/refund
# ════════════════════════════════════════════════════════════════

@router.post("/payments/refund")
def refund_payment(
    req: RefundRequest,
    authorization: Optional[str] = Header(None),
):
    profile = _profile_from_jwt(authorization)
    if profile.get("role") != "admin":
        raise HTTPException(403, "Admin only")

    _ensure_razorpay_configured()

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")

    if order["payment_status"] == PAYMENT_STATUS_REFUNDED:
        return {
            "refunded": True,
            "idempotent": True,
            "amount": order.get("locked_price"),
            "reason": req.reason,
        }

    if order["payment_status"] not in (PAYMENT_STATUS_ESCROW,):
        raise HTTPException(400, "Can only refund orders with payment in escrow")

    payment_id = order.get("razorpay_payment_id")
    if not payment_id:
        raise HTTPException(400, "No payment ID found")

    amount_paise = _order_amount_paise(order)
    try:
        _get_rz().payment.refund(
            payment_id, {"amount": amount_paise, "notes": {"reason": req.reason or "admin_refund"}}
        )
    except Exception as e:
        msg = str(e) or "Razorpay refund failed"
        raise HTTPException(502, f"Refund could not be completed: {msg}")

    safe_update("orders", {"id": req.order_id}, {
        "payment_status": PAYMENT_STATUS_REFUNDED,
        "status": "cancelled",
        "refunded_at": datetime.now(timezone.utc).isoformat(),
        "refund_reason": req.reason,
    })

    return {"refunded": True, "amount": order["locked_price"], "reason": req.reason}


# ════════════════════════════════════════════════════════════════
# WEBHOOK: RAZORPAY PAYMENT EVENTS
# POST /webhooks/razorpay
# ════════════════════════════════════════════════════════════════

@router.post("/razorpay")
async def razorpay_webhook(request: Request):
    body = await request.body()
    sig = request.headers.get("X-Razorpay-Signature", "")

    if not RAZORPAY_WEBHOOK_SECRET:
        raise HTTPException(503, "RAZORPAY_WEBHOOK_SECRET is not configured")

    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Invalid webhook signature")

    try:
        payload = json.loads(body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise HTTPException(400, "Invalid JSON payload")

    event = payload.get("event")

    if event == "payment.captured":
        pay_ent = (payload.get("payload") or {}).get("payment", {}).get("entity") or {}
        rz_order_id = pay_ent.get("order_id")
        payment_id = pay_ent.get("id")
        amount = pay_ent.get("amount")
        if not rz_order_id or not payment_id or amount is None:
            return {"received": True}

        order = _order_by_razorpay_order_id(rz_order_id)
        if not order or not order.get("locked_price"):
            return {"received": True}

        if int(amount) != _order_amount_paise(order):
            return {"received": True}

        paid_at = datetime.now(timezone.utc).isoformat()
        res = (
            db_admin.table("orders")
            .update({
                "razorpay_payment_id": payment_id,
                "payment_status": PAYMENT_STATUS_ESCROW,
                "status": ORDER_STATUS_CUTTING,
                "paid_at": paid_at,
            })
            .eq("id", order["id"])
            .eq("payment_status", PAYMENT_STATUS_PENDING)
            .select("id")
            .execute()
        )
        updated_rows = getattr(res, "data", None) or []
        if updated_rows:
            await notify_payment_received(order["manufacturer_id"], order["order_ref"])

    return {"received": True}
