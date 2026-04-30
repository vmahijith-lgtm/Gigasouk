# ════════════════════════════════════════════════════════════════
# services/razorpay_service.py — Payments and Escrow
# Handles: create payment order, verify payment signature,
#          release escrow to manufacturer, refund to customer.
# To swap payment provider: replace this file only.
# Keep the same function signatures and main.py needs no change.
# ════════════════════════════════════════════════════════════════

import hmac
import hashlib
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

import razorpay

from db import db_admin, get_one, safe_update
from config import (
    RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_ROUTE_ACCOUNT,
    RAZORPAY_WEBHOOK_SECRET,
    PLATFORM_FEE_PERCENT, DESIGNER_ROYALTY_PERCENT,
    PAYMENT_STATUS_PENDING, PAYMENT_STATUS_ESCROW,
    PAYMENT_STATUS_RELEASED, PAYMENT_STATUS_REFUNDED,
)
from services.notify_service import notify_payment_received, notify_escrow_released

router    = APIRouter()
_rz_client: razorpay.Client | None = None


def _get_rz() -> razorpay.Client:
    """Return a Razorpay client, creating it lazily on first call."""
    global _rz_client
    if _rz_client is None:
        _rz_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
    return _rz_client


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class CreatePaymentRequest(BaseModel):
    order_id:    str
    customer_id: str


class VerifyPaymentRequest(BaseModel):
    order_id:           str
    razorpay_order_id:  str
    razorpay_payment_id: str
    razorpay_signature: str


class ReleaseEscrowRequest(BaseModel):
    order_id: str
    admin_id: str   # Who triggered the release


class RefundRequest(BaseModel):
    order_id: str
    admin_id: str
    reason:   str = ""


# ════════════════════════════════════════════════════════════════
# ENDPOINT: CREATE RAZORPAY ORDER (payment link)
# POST /api/v1/payments/create
# ════════════════════════════════════════════════════════════════

@router.post("/payments/create")
def create_payment(req: CreatePaymentRequest):
    """
    Called after negotiation room locks a price.
    Creates a Razorpay order. Returns checkout details
    for the frontend to open the UPI payment popup.
    """

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["customer_id"] != req.customer_id:
        raise HTTPException(403, "Not your order")
    if order["payment_status"] != PAYMENT_STATUS_PENDING:
        raise HTTPException(400, "Payment already initiated")

    locked_price = order.get("locked_price")
    if not locked_price:
        raise HTTPException(400, "Price not locked yet. Complete negotiation first.")

    amount_paise = int(locked_price * 100)   # Razorpay uses paise

    rz_order = _get_rz().order.create({
        "amount":   amount_paise,
        "currency": "INR",
        "receipt":  order["order_ref"],
        "notes": {
            "gigasouk_order_id": req.order_id,
            "customer_id":       req.customer_id,
        },
    })

    # Save Razorpay order ID
    safe_update("orders", {"id": req.order_id}, {
        "razorpay_order_id": rz_order["id"],
        "payment_status":    PAYMENT_STATUS_PENDING,
    })

    return {
        "razorpay_order_id": rz_order["id"],
        "razorpay_key":      RAZORPAY_KEY_ID,
        "amount":            amount_paise,
        "currency":          "INR",
        "order_ref":         order["order_ref"],
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: VERIFY PAYMENT SIGNATURE
# POST /api/v1/payments/verify
# ════════════════════════════════════════════════════════════════

@router.post("/payments/verify")
async def verify_payment(req: VerifyPaymentRequest):
    """
    Called by frontend after customer completes UPI payment.
    Verifies Razorpay HMAC-SHA256 signature to prevent fraud.
    On success: money is in escrow, order advances to 'cutting'.
    """

    # Verify signature
    payload = f"{req.razorpay_order_id}|{req.razorpay_payment_id}"
    expected = hmac.new(
        RAZORPAY_KEY_SECRET.encode(), payload.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, req.razorpay_signature):
        raise HTTPException(400, "Payment signature verification failed")

    # Signature valid — money is in escrow
    safe_update("orders", {"id": req.order_id}, {
        "razorpay_payment_id": req.razorpay_payment_id,
        "payment_status":      PAYMENT_STATUS_ESCROW,
        "status":              "cutting",
        "paid_at":             datetime.now(timezone.utc).isoformat(),
    })

    order = get_one("orders", {"id": req.order_id})
    if order:
        await notify_payment_received(order["manufacturer_id"], order["order_ref"])

    return {"verified": True, "status": "in_escrow", "message": "Payment received. Manufacturing can begin."}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: RELEASE ESCROW TO MANUFACTURER
# POST /api/v1/payments/release
# ════════════════════════════════════════════════════════════════

@router.post("/payments/release")
async def release_escrow(req: ReleaseEscrowRequest):
    """
    Called automatically by Shiprocket delivery webhook,
    or manually by admin.
    Splits payment: platform fee → GigaSouk, remainder → manufacturer,
    royalty portion → designer wallet.
    """

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["payment_status"] != PAYMENT_STATUS_ESCROW:
        raise HTTPException(400, "Payment is not in escrow")

    total         = float(order["locked_price"])
    platform_fee  = round(total * PLATFORM_FEE_PERCENT, 2)
    mfr_gross     = round(total - platform_fee, 2)
    designer_royalty = round(mfr_gross * DESIGNER_ROYALTY_PERCENT, 2)
    mfr_net       = round(mfr_gross - designer_royalty, 2)

    # Record payout
    payout_id = str(uuid.uuid4())
    db_admin.table("payouts").insert({
        "id":                payout_id,
        "order_id":          req.order_id,
        "total_amount":      total,
        "platform_fee":      platform_fee,
        "manufacturer_amount": mfr_net,
        "designer_royalty":  designer_royalty,
        "released_by":       req.admin_id,
        "released_at":       datetime.now(timezone.utc).isoformat(),
    }).execute()

    # Update order
    safe_update("orders", {"id": req.order_id}, {
        "payment_status": PAYMENT_STATUS_RELEASED,
        "released_at":    datetime.now(timezone.utc).isoformat(),
    })

    # Add royalty to designer wallet
    design = get_one("designs", {"id": order["design_id"]})
    if design:
        db_admin.rpc("add_to_wallet", {
            "user_id": design["designer_id"],
            "amount":  designer_royalty,
            "source":  order["order_ref"],
        }).execute()

    await notify_escrow_released(order["manufacturer_id"], order["order_ref"], mfr_net)

    return {
        "released":           True,
        "total":              total,
        "platform_fee":       platform_fee,
        "manufacturer_net":   mfr_net,
        "designer_royalty":   designer_royalty,
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: REFUND TO CUSTOMER
# POST /api/v1/payments/refund
# ════════════════════════════════════════════════════════════════

@router.post("/payments/refund")
def refund_payment(req: RefundRequest):
    """
    Admin triggers a full refund to customer.
    Used when: factory goes silent, QC repeatedly fails,
    customer dispute resolved in customer's favour.
    """

    order = get_one("orders", {"id": req.order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    if order["payment_status"] not in (PAYMENT_STATUS_ESCROW,):
        raise HTTPException(400, "Can only refund orders with payment in escrow")

    payment_id = order.get("razorpay_payment_id")
    if not payment_id:
        raise HTTPException(400, "No payment ID found")

    amount_paise = int(float(order["locked_price"]) * 100)
    _get_rz().payment.refund(payment_id, {"amount": amount_paise, "notes": {"reason": req.reason}})

    safe_update("orders", {"id": req.order_id}, {
        "payment_status": PAYMENT_STATUS_REFUNDED,
        "status":         "cancelled",
        "refunded_at":    datetime.now(timezone.utc).isoformat(),
        "refund_reason":  req.reason,
    })

    return {"refunded": True, "amount": order["locked_price"], "reason": req.reason}


# ════════════════════════════════════════════════════════════════
# WEBHOOK: RAZORPAY PAYMENT EVENTS
# POST /webhooks/razorpay
# ════════════════════════════════════════════════════════════════

@router.post("/razorpay")
async def razorpay_webhook(request: Request):
    """
    Razorpay sends events here when payment status changes.
    payment.captured → money confirmed in Razorpay
    refund.processed → refund completed
    """
    body = await request.body()
    sig  = request.headers.get("X-Razorpay-Signature", "")

    # Razorpay signs webhooks with the Webhook Secret (set in Razorpay Dashboard → Webhooks),
    # which is DIFFERENT from the API key secret. Using the wrong key here causes every
    # webhook to return 400, silently breaking all payment confirmations.
    expected = hmac.new(RAZORPAY_WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Invalid webhook signature")

    payload = await request.json()
    event   = payload.get("event")

    if event == "payment.captured":
        notes    = payload["payload"]["payment"]["entity"].get("notes", {})
        order_id = notes.get("gigasouk_order_id")
        if order_id:
            safe_update("orders", {"id": order_id}, {"payment_status": PAYMENT_STATUS_ESCROW})

    return {"received": True}
