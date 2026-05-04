# ════════════════════════════════════════════════════════════════
# commitment_negotiation_room.py — Pre-order chat per manufacturer commitment
# One open negotiation room per active commitment (designer + that manufacturer).
# ════════════════════════════════════════════════════════════════

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from config import PRE_ORDER_NEGOTIATION_TIMEOUT_HOURS
from db import db_admin, get_one

logger = logging.getLogger(__name__)


def ensure_negotiation_room_for_active_commitment(commitment_id: str) -> Optional[str]:
    """
    When a manufacturer commitment becomes active, create a negotiation room
    (if missing) linking designer_id + manufacturer_id + commitment_id.
    order_id stays NULL until a customer checkout attaches an order.
    Returns room id or None if commitment is missing / not active.
    """
    c = get_one("manufacturer_commitments", {"id": commitment_id})
    if not c:
        logger.warning("ensure_negotiation_room: commitment %s not found", commitment_id)
        return None
    if c.get("status") != "active":
        return None

    existing = (
        db_admin.table("negotiation_rooms")
        .select("id")
        .eq("commitment_id", commitment_id)
        .execute()
        .data
    )
    if existing:
        return existing[0]["id"]

    design = get_one("designs", {"id": c["design_id"]})
    if not design:
        logger.warning("ensure_negotiation_room: design %s not found", c["design_id"])
        return None

    room_id = str(uuid.uuid4())
    expires = datetime.now(timezone.utc) + timedelta(hours=PRE_ORDER_NEGOTIATION_TIMEOUT_HOURS)
    row = {
        "id": room_id,
        # order_id omitted → NULL (post-migration); links at checkout.
        "commitment_id": commitment_id,
        "designer_id": design["designer_id"],
        "manufacturer_id": c["manufacturer_id"],
        "base_price": float(c["committed_price"]),
        "locked_price": None,
        "status": "open",
        "expires_at": expires.isoformat(),
    }
    db_admin.table("negotiation_rooms").insert(row).execute()
    return room_id
