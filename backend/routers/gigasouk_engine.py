# ════════════════════════════════════════════════════════════════
# routers/gigasouk_engine.py — Routing Engine + Order Management
# Handles: place order, route to committed factory, negotiation,
#          order status updates, admin order management.
# ════════════════════════════════════════════════════════════════

import math
import uuid
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from db import db_admin, get_one, safe_update
from config import (
    ROUTING_WEIGHT_DISTANCE, ROUTING_WEIGHT_RATING, ROUTING_WEIGHT_QUEUE,
    ROUTING_MAX_DISTANCE_KM, MIN_COMMITS_TO_GO_LIVE,
    NEGOTIATION_TIMEOUT_HOURS, MAX_BID_ROUNDS,
    ORDER_STATUS_ROUTING, ORDER_STATUS_NEGOTIATING,
    ORDER_STATUS_CONFIRMED, ORDER_STATUS_CUTTING,
    ORDER_STATUS_CANCELLED, DESIGN_STATUS_LIVE,
    GOOGLE_MAPS_API_KEY,
)
from services.notify_service import (
    notify_manufacturer_new_order,
    notify_customer_order_confirmed,
    notify_designer_order_placed,
)

router = APIRouter()


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class PlaceOrderRequest(BaseModel):
    design_id:        str
    customer_id:      str
    quantity:         int
    delivery_address: dict   # {line1, city, state, pincode, lat, lng}
    notes:            str = ""
    # Optional: customer's chosen factory from FactoryFinderMap.
    # If set, skips AI scoring and uses this commitment directly.
    commitment_id:    str = ""


class BidRequest(BaseModel):
    negotiation_room_id: str
    bidder_id:           str
    bidder_role:         str   # "designer" or "manufacturer"
    amount:              float


class AcceptBidRequest(BaseModel):
    negotiation_room_id: str
    accepted_by_id:      str
    bid_id:              str


# ════════════════════════════════════════════════════════════════
# HELPERS
# ════════════════════════════════════════════════════════════════
async def geocode_pincode(pincode: str) -> tuple[float, float]:
    """
    Convert an Indian pincode to (lat, lng) using Google Geocoding API.
    Called when the frontend sends lat=0, lng=0 (no coordinates).
    Returns (0.0, 0.0) if geocoding fails or API key is not set.
    """
    if not GOOGLE_MAPS_API_KEY or not pincode:
        return 0.0, 0.0
    try:
        import httpx
        async with httpx.AsyncClient(timeout=5) as client:
            r = await client.get(
                "https://maps.googleapis.com/maps/api/geocode/json",
                params={"address": f"{pincode}, India", "key": GOOGLE_MAPS_API_KEY},
            )
        results = r.json().get("results", [])
        if results:
            loc = results[0]["geometry"]["location"]
            return float(loc["lat"]), float(loc["lng"])
    except Exception:
        pass
    return 0.0, 0.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate straight-line distance in km between two coordinates.
    Used to find the closest committed factory to the customer.
    """
    R = 6371
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) *
         math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
    return R * 2 * math.asin(math.sqrt(a))



def score_factory(distance_km: float, rating: float, queue_depth: int) -> float:
    """
    Composite score for a factory. Lower score = better match.
    Weights are set in config.py.
    """
    max_dist  = ROUTING_MAX_DISTANCE_KM
    max_queue = 20
    dist_score  = distance_km / max_dist
    rating_score = 1 - (rating / 5.0)
    queue_score  = min(queue_depth, max_queue) / max_queue
    return (
        ROUTING_WEIGHT_DISTANCE * dist_score +
        ROUTING_WEIGHT_RATING   * rating_score +
        ROUTING_WEIGHT_QUEUE    * queue_score
    )


def get_committed_pool(design_id: str, customer_lat: float, customer_lng: float) -> list[dict]:
    """
    Fetch all active manufacturer commitments for a design.
    Score each by distance, rating, and queue depth.
    Return sorted list (best first).
    """
    commits = (
        db_admin.table("manufacturer_commitments")
        .select("*, manufacturers(id, lat, lng, rating, queue_depth, city)")
        .eq("design_id", design_id)
        .eq("status", "active")
        .execute()
        .data
    )

    scored = []
    for c in commits:
        mfr = c.get("manufacturers", {})
        if not mfr:
            continue
        dist = haversine_km(customer_lat, customer_lng, mfr["lat"], mfr["lng"])
        if dist > ROUTING_MAX_DISTANCE_KM:
            continue
        c["distance_km"] = round(dist, 1)
        c["score"] = score_factory(dist, mfr.get("rating", 3.0), mfr.get("queue_depth", 0))
        scored.append(c)

    return sorted(scored, key=lambda x: x["score"])


# ════════════════════════════════════════════════════════════════
# ENDPOINT: LIST AVAILABLE FACTORIES (privacy-safe)
# GET /api/v1/available-factories?design_id=&lat=&lng=&pincode=&city=
#
# Called by FactoryFinderMap before customer places order.
# Returns scored factory list with city-level location only.
# NEVER returns exact factory lat/lng or address — only city name
# + distance_km so customers can make an informed choice without
# exposing manufacturer locations.
# ════════════════════════════════════════════════════════════════

@router.get("/available-factories")
async def available_factories(
    design_id: str,
    lat:     float = 0.0,
    lng:     float = 0.0,
    pincode: str   = "",
    city:    str   = "",
):
    """
    Returns all committed factories for a design, scored by proximity.
    Factory pins are placed at the CITY CENTROID (geocoded from city name),
    not the exact factory GPS — preserving manufacturer privacy.
    """
    # Resolve customer coordinates
    c_lat, c_lng = lat, lng
    if c_lat == 0 and c_lng == 0:
        query = pincode or city
        if query:
            c_lat, c_lng = await geocode_pincode(query)

    if c_lat == 0 and c_lng == 0:
        raise HTTPException(400, "Could not determine location. Provide lat/lng or pincode.")

    pool = get_committed_pool(design_id, c_lat, c_lng)
    if not pool:
        return []

    # For each factory, geocode city name → city centroid for the map pin
    # This is privacy-safe: customers see "Mumbai" on the map, not the factory's exact GPS.
    result = []
    for c in pool:
        mfr = c.get("manufacturers", {}) or {}
        factory_city  = mfr.get("city", "")
        factory_state = mfr.get("state", "")
        city_lat, city_lng = await geocode_pincode(f"{factory_city}, {factory_state}")
        result.append({
            "commitment_id":   c["id"],
            "manufacturer_id": c["manufacturer_id"],
            "city":            factory_city,
            "state":           factory_state,
            "distance_km":     c["distance_km"],
            "rating":          mfr.get("rating", 0),
            "queue_depth":     mfr.get("queue_depth", 0),
            "committed_price": c.get("committed_price", 0),
            "score":           c["score"],
            # City centroid — NOT exact factory GPS
            "city_lat":        city_lat,
            "city_lng":        city_lng,
        })

    return result


# ════════════════════════════════════════════════════════════════
# ENDPOINT: PLACE ORDER
# POST /api/v1/orders
# ════════════════════════════════════════════════════════════════

@router.post("/orders")
async def place_order(req: PlaceOrderRequest, bg: BackgroundTasks):
    """
    Customer places an order for a live design.
    1. Validates design is live (committed supply exists)
    2. Finds best committed factory near customer
    3. Creates order + negotiation room
    4. Sends notifications
    """

    # ── Validate design is live ──────────────────────────────────
    design = get_one("designs", {"id": req.design_id})
    if not design:
        raise HTTPException(404, "Design not found")
    if design["status"] != DESIGN_STATUS_LIVE:
        raise HTTPException(400, "Design is not available for ordering yet")

    # ── Find best factory from committed pool ────────────────────
    c_lat = req.delivery_address.get("lat", 0)
    c_lng = req.delivery_address.get("lng", 0)

    # Geocoding fallback — if the frontend didn't send coordinates
    # (e.g. form used only pincode), look them up via Google Geocoding API.
    if c_lat == 0 and c_lng == 0:
        pincode = req.delivery_address.get("pincode", "")
        city    = req.delivery_address.get("city", "")
        query   = pincode or city
        if query:
            c_lat, c_lng = await geocode_pincode(query)

    pool = get_committed_pool(req.design_id, c_lat, c_lng)
    if not pool:
        raise HTTPException(503, "No committed manufacturer available in your region right now")

    # Honour the customer's explicit factory choice from FactoryFinderMap.
    # If no choice was made, use the AI-recommended factory (pool[0] = lowest score).
    if req.commitment_id:
        chosen = next((c for c in pool if c["id"] == req.commitment_id), None)
        if not chosen:
            raise HTTPException(400, "Chosen factory is no longer available. Please select another.")
        best = chosen
    else:
        best = pool[0]   # AI recommendation

    manufacturer_id = best["manufacturer_id"]


    # ── Create order ─────────────────────────────────────────────
    order_id  = str(uuid.uuid4())
    order_ref = f"GS-{order_id[:6].upper()}"

    order_data = {
        "id":               order_id,
        "order_ref":        order_ref,
        "design_id":        req.design_id,
        "customer_id":      req.customer_id,
        "manufacturer_id":  manufacturer_id,
        "commitment_id":    best["id"],
        "quantity":         req.quantity,
        "delivery_address": req.delivery_address,
        "committed_price":  best["committed_price"],
        "distance_km":      best["distance_km"],
        "status":           ORDER_STATUS_NEGOTIATING,
        "payment_status":   "pending",
        "notes":            req.notes,
        "created_at":       datetime.now(timezone.utc).isoformat(),
    }
    db_admin.table("orders").insert(order_data).execute()

    # ── Create negotiation room ──────────────────────────────────
    room_id = str(uuid.uuid4())
    expires = datetime.now(timezone.utc) + timedelta(hours=NEGOTIATION_TIMEOUT_HOURS)
    db_admin.table("negotiation_rooms").insert({
        "id":              room_id,
        "order_id":        order_id,
        "designer_id":     design["designer_id"],
        "manufacturer_id": manufacturer_id,
        "base_price":      best["committed_price"],
        "locked_price":    None,
        "status":          "open",
        "expires_at":      expires.isoformat(),
    }).execute()

    # ── Link room back to order ───────────────────────────────────
    # Needed so queries like get_one("orders", {"negotiation_room_id": room_id}) work.
    db_admin.table("orders").update({"negotiation_room_id": room_id}).eq("id", order_id).execute()

    # ── Fire notifications in background ─────────────────────────
    bg.add_task(notify_manufacturer_new_order, manufacturer_id, order_ref, design["title"])
    bg.add_task(notify_designer_order_placed,  design["designer_id"], order_ref)
    bg.add_task(notify_customer_order_confirmed, req.customer_id, order_ref, best["distance_km"])

    return {
        "order_id":     order_id,
        "order_ref":    order_ref,
        "room_id":      room_id,
        "manufacturer": manufacturer_id,
        "distance_km":  best["distance_km"],
        "status":       ORDER_STATUS_NEGOTIATING,
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: SUBMIT BID IN NEGOTIATION ROOM
# POST /api/v1/bids
# ════════════════════════════════════════════════════════════════

@router.post("/bids")
async def submit_bid(req: BidRequest):
    """
    Designer or manufacturer submits a price offer in the
    negotiation room. Previous active bid is marked 'countered'.
    """

    room = get_one("negotiation_rooms", {"id": req.negotiation_room_id})
    if not room:
        raise HTTPException(404, "Negotiation room not found")
    if room["status"] != "open":
        raise HTTPException(400, "Negotiation room is not open")
    if datetime.fromisoformat(room["expires_at"]) < datetime.now(timezone.utc):
        raise HTTPException(400, "Negotiation room has expired")

    # Count existing bids to enforce max rounds
    existing = (
        db_admin.table("bids")
        .select("id")
        .eq("negotiation_room_id", req.negotiation_room_id)
        .execute()
        .data
    )
    if len(existing) >= MAX_BID_ROUNDS:
        raise HTTPException(400, "Maximum bid rounds reached")

    # Mark previous active bids as countered
    db_admin.table("bids").update({"status": "countered"}).eq(
        "negotiation_room_id", req.negotiation_room_id
    ).eq("status", "active").execute()

    # Insert new bid
    bid_id = str(uuid.uuid4())
    db_admin.table("bids").insert({
        "id":                   bid_id,
        "negotiation_room_id":  req.negotiation_room_id,
        "bidder_id":            req.bidder_id,
        "bidder_role":          req.bidder_role,
        "amount":               req.amount,
        "status":               "active",
        "created_at":           datetime.now(timezone.utc).isoformat(),
    }).execute()

    return {"bid_id": bid_id, "status": "active", "amount": req.amount}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: ACCEPT BID — LOCK DEAL
# POST /api/v1/bids/accept
# ════════════════════════════════════════════════════════════════

@router.post("/bids/accept")
async def accept_bid(req: AcceptBidRequest, bg: BackgroundTasks):
    """
    One party accepts the active bid.
    Locks the negotiation room. Advances order to 'confirmed'.
    Customer is sent a payment link.
    """

    bid  = get_one("bids", {"id": req.bid_id})
    room = get_one("negotiation_rooms", {"id": req.negotiation_room_id})

    if not bid or not room:
        raise HTTPException(404, "Bid or room not found")
    if bid["status"] != "active":
        raise HTTPException(400, "Bid is no longer active")

    locked_price = bid["amount"]

    # Lock room
    db_admin.table("negotiation_rooms").update({
        "status":       "locked",
        "locked_price": locked_price,
        "locked_at":    datetime.now(timezone.utc).isoformat(),
    }).eq("id", req.negotiation_room_id).execute()

    # Mark bid accepted
    db_admin.table("bids").update({"status": "accepted"}).eq("id", req.bid_id).execute()

    # Advance order
    order = get_one("orders", {"negotiation_room_id": req.negotiation_room_id})
    if order:
        safe_update("orders", {"id": order["id"]}, {
            "status":        ORDER_STATUS_CONFIRMED,
            "locked_price":  locked_price,
            "confirmed_at":  datetime.now(timezone.utc).isoformat(),
        })

    return {
        "locked":       True,
        "locked_price": locked_price,
        "order_status": ORDER_STATUS_CONFIRMED,
    }


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET ORDER STATUS
# GET /api/v1/orders/{order_id}
# ════════════════════════════════════════════════════════════════

@router.get("/orders/{order_id}")
def get_order(order_id: str):
    order = get_one("orders", {"id": order_id})
    if not order:
        raise HTTPException(404, "Order not found")
    return order


# ════════════════════════════════════════════════════════════════
# ENDPOINT: UPDATE ORDER STATUS (manufacturer / admin)
# PATCH /api/v1/orders/{order_id}/status
# ════════════════════════════════════════════════════════════════

@router.patch("/orders/{order_id}/status")
def update_order_status(order_id: str, body: dict):
    """
    Manufacturer updates order to 'cutting'.
    Admin can override to any status.
    """
    new_status = body.get("status")
    if not new_status:
        raise HTTPException(400, "status field required")

    ok, err = safe_update("orders", {"id": order_id}, {
        "status":     new_status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    })
    if not ok:
        raise HTTPException(500, f"Update failed: {err}")

    return {"order_id": order_id, "status": new_status}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: LIST ALL ORDERS (admin)
# GET /api/v1/admin/orders
# ════════════════════════════════════════════════════════════════

@router.get("/admin/orders")
def admin_list_orders(status: str = None, limit: int = 50):
    """
    Admin: fetch all orders, optionally filtered by status.
    To remove admin access: delete this endpoint only.
    """
    query = db_admin.table("orders").select("*").limit(limit).order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    return query.execute().data
