import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional

logger = logging.getLogger("gigasouk.activity_audit")


def audit_user_activity(
    *,
    action: str,
    actor_profile_id: Optional[str],
    actor_role: Optional[str],
    entity: str,
    entity_id: Optional[str],
    status: str,
    metadata: Optional[dict[str, Any]] = None,
) -> None:
    """
    Lightweight immutable audit trail in application logs.
    Keeps per-user attribution for sensitive activities without DB migrations.
    """
    payload = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "actor_profile_id": actor_profile_id,
        "actor_role": actor_role,
        "entity": entity,
        "entity_id": entity_id,
        "status": status,
        "metadata": metadata or {},
    }
    logger.info(json.dumps(payload, separators=(",", ":"), sort_keys=True))

