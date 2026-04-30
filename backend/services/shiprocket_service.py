# ════════════════════════════════════════════════════════════════
# services/shiprocket_service.py — Logistics and Shipping
#
# Handles: get Shiprocket auth token, create shipment after QC,
#          get tracking info, webhook for delivery confirmation.
#
# TO SWAP COURIER PROVIDER:
#   Replace this file with delhivery_service.py or similar.
#   Keep the same function names (create_shipment, get_tracking).
#   Nothing else in the platform needs to change.
# ════════════════════════════════════════════════════════════════

import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, Request, HTTPException

from db import db_admin, get_one, safe_update
from config import SHIPROCKET_EMAIL, SHIPROCKET_PASSWORD, APP_URL
from services.notify_service import notify_escrow_released

router = APIRouter()

# ── Shiprocket API base URL ───────────────────────────────────────
SHIPROCKET_BASE = "https://apiv2.shiprocket.in/v1/external"

# Process-local cache — resets on restart (fine: Shiprocket allows unlimited logins).
# Each Railway worker independently fetches a token on its first request.
_token_cache: dict = {"token": None, "fetched_at": None}

# Refresh after 9 days — tokens expire after 10 days, giving 24h headroom.
_TOKEN_TTL_SECONDS = 9 * 24 * 3600


# ════════════════════════════════════════════════════════════════
# AUTH: GET SHIPROCKET TOKEN
# ════════════════════════════════════════════════════════════════

async def _get_token() -> str:
    """
    Return a valid Shiprocket auth token.
    - Caches the token for 9 days (tokens expire after 10 days).
    - Uses total_seconds() for correct sub-day precision.
    - Raises HTTPException(503) if Shiprocket login fails, so the
      caller gets a clean error instead of an unhandled traceback.
    """
    now = datetime.now(timezone.utc)

    # Cache hit: token exists and is younger than TTL
    if (
        _token_cache["token"]
        and _token_cache["fetched_at"]
        and (now - _token_cache["fetched_at"]).total_seconds() < _TOKEN_TTL_SECONDS
    ):
        return _token_cache["token"]

    # Cache miss or expired: fetch a new token
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.post(
                f"{SHIPROCKET_BASE}/auth/login",
                json={"email": SHIPROCKET_EMAIL, "password": SHIPROCKET_PASSWORD},
            )
            res.raise_for_status()
            data = res.json()

        token = data.get("token")
        if not token:
            raise ValueError(f"No token in Shiprocket response: {data}")

        _token_cache["token"]      = token
        _token_cache["fetched_at"] = now
        return token

    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Shiprocket login failed ({e.response.status_code}): {e.response.text[:200]}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Shiprocket auth error: {str(e)[:200]}",
        )


# ════════════════════════════════════════════════════════════════
# CREATE SHIPMENT (called after QC pass)
# ════════════════════════════════════════════════════════════════

async def create_shipment(order: dict) -> dict:
    """
    Called automatically after QC passes.
    Creates a Shiprocket shipment and returns AWB + tracking URL.

    Returns:
        { "awb": "123456789", "tracking_url": "https://..." }
        or { "awb": None, "error": "..." } on failure
    """
    token   = await _get_token()
    design  = get_one("designs",  {"id": order["design_id"]})
    address = order.get("delivery_address", {})

    payload = {
        "order_id":        order["order_ref"],
        "order_date":      datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M"),
        "pickup_location": "Primary",

        # Customer details
        "billing_customer_name":  address.get("name", "Customer"),
        "billing_address":        address.get("line1", ""),
        "billing_city":           address.get("city", ""),
        "billing_pincode":        address.get("pincode", ""),
        "billing_state":          address.get("state", ""),
        "billing_country":        "India",
        "billing_email":          address.get("email", ""),
        "billing_phone":          address.get("phone", ""),

        # Shipping same as billing
        "shipping_is_billing":    True,

        # Order items
        "order_items": [{
            "name":       design["title"] if design else "Product",
            "sku":        order["design_id"][:8],
            "units":      order.get("quantity", 1),
            "selling_price": str(order.get("locked_price", 0)),
        }],

        # Payment
        "payment_method": "Prepaid",
        "sub_total":      str(order.get("locked_price", 0)),
        "length":         15,   # cm — update when design has dimensions
        "breadth":        10,
        "height":         10,
        "weight":         0.5,  # kg — update when design has weight
    }

    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{SHIPROCKET_BASE}/orders/create/adhoc",
                json=payload,
                headers={"Authorization": f"Bearer {token}"},
                timeout=30,
            )
            data = res.json()

        if data.get("awb_code"):
            return {
                "awb":          data["awb_code"],
                "tracking_url": f"https://shiprocket.co/tracking/{data['awb_code']}",
                "shipment_id":  data.get("shipment_id"),
                "courier":      data.get("courier_name"),
            }
        return {"awb": None, "error": data.get("message", "Unknown error")}

    except Exception as e:
        return {"awb": None, "error": str(e)}


# ════════════════════════════════════════════════════════════════
# GET TRACKING INFO
# ════════════════════════════════════════════════════════════════

async def get_tracking(awb: str) -> dict:
    """
    Fetch live tracking status for a shipment AWB.
    Called by the order tracking page.
    """
    token = await _get_token()
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{SHIPROCKET_BASE}/courier/track/awb/{awb}",
                headers={"Authorization": f"Bearer {token}"},
            )
            data = res.json()
        return data.get("tracking_data", {})
    except Exception as e:
        return {"error": str(e)}


# ════════════════════════════════════════════════════════════════
# WEBHOOK: SHIPROCKET DELIVERY EVENTS
# POST /webhooks/shiprocket
# ════════════════════════════════════════════════════════════════

@router.post("/shiprocket")
async def shiprocket_webhook(request: Request):
    """
    Shiprocket sends delivery updates here.
    On DELIVERED status: triggers escrow release automatically.

    Shiprocket sends these statuses:
      PICKED UP → SHIPPED → OUT FOR DELIVERY → DELIVERED
    """
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON payload")

    awb    = payload.get("awb")
    status = payload.get("current_status", "").upper()

    if not awb:
        return {"received": True}

    # Find the order by AWB
    orders = (
        db_admin.table("orders")
        .select("*")
        .eq("shiprocket_awb", awb)
        .execute()
        .data
    )
    if not orders:
        return {"received": True, "note": "Order not found for this AWB"}

    order = orders[0]

    # Update tracking status
    safe_update("orders", {"id": order["id"]}, {
        "tracking_status": status,
        "updated_at":      datetime.now(timezone.utc).isoformat(),
    })

    # On delivery: advance order status and release escrow
    if status in ("DELIVERED", "DELIVERY DONE"):
        safe_update("orders", {"id": order["id"]}, {
            "status":       "delivered",
            "delivered_at": datetime.now(timezone.utc).isoformat(),
        })

        # Trigger automatic escrow release
        from services.razorpay_service import release_escrow
        from pydantic import BaseModel

        class _Req(BaseModel):
            order_id: str
            admin_id: str

        await release_escrow(_Req(order_id=order["id"], admin_id="system_webhook"))

    return {"received": True, "status": status, "order_ref": order.get("order_ref")}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET TRACKING (for customer dashboard)
# GET /api/v1/track/{awb}
# ════════════════════════════════════════════════════════════════

@router.get("/track/{awb}")
async def track_shipment(awb: str):
    """
    Customer can call this to get live tracking data.
    Returns courier status, location, and expected delivery.
    """
    data = await get_tracking(awb)
    return data
