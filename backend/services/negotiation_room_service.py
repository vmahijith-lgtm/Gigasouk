# ════════════════════════════════════════════════════════════════
# negotiation_room_service.py — Pre-order designer ↔ manufacturer rooms
# Opens a negotiation room when a commitment becomes active; checkout links order_id.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timedelta, timezone

from db import db_admin

# Longer window before a customer order exists — refreshed at checkout.
PRE_ORDER_ROOM_EXPIRY_DAYS = 30


def ensure_negotiation_room_for_commitment(
    commitment_id: str,
    design_id: str,
    designer_profile_id: str,
    manufacturer_row_id: str,
    base_price: float,
) -> str | None:
    """
    If no negotiation row exists for this commitment, insert one with order_id NULL.
    Returns room id (existing or new), or None if insert fails unexpectedly.
    """
    existing = (
        db_admin.table("negotiation_rooms")
        .select("id")
        .eq("commitment_id", commitment_id)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return existing[0]["id"]

    room_id = str(uuid.uuid4())
    expires = datetime.now(timezone.utc) + timedelta(days=PRE_ORDER_ROOM_EXPIRY_DAYS)
    db_admin.table("negotiation_rooms").insert({
        "id":               room_id,
        "order_id":         None,
        "commitment_id":    commitment_id,
        "designer_id":      designer_profile_id,
        "manufacturer_id":  manufacturer_row_id,
        "base_price":       base_price,
        "locked_price":     None,
        "status":           "open",
        "expires_at":       expires.isoformat(),
    }).execute()
    return room_id
