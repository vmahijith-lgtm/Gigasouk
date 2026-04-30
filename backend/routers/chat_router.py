# ════════════════════════════════════════════════════════════════
# routers/chat_router.py — Real-Time Chat and Messaging
# Handles: send message in negotiation room, fetch message history,
#          mark messages as read.
# Real-time delivery uses Supabase Realtime (not this API).
# This API handles persistence only.
# ════════════════════════════════════════════════════════════════

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import db_admin, get_one

router = APIRouter()


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

class SendMessageRequest(BaseModel):
    room_id:    str
    sender_id:  str
    sender_role: str   # "designer", "manufacturer", or "admin"
    content:    str
    message_type: str = "text"   # "text" | "image" | "file"
    file_url:   str = ""


class MarkReadRequest(BaseModel):
    room_id:   str
    reader_id: str


# ════════════════════════════════════════════════════════════════
# ENDPOINT: SEND MESSAGE
# POST /api/v1/messages
# ════════════════════════════════════════════════════════════════

@router.post("/messages")
def send_message(req: SendMessageRequest):
    """
    Persist a message to the negotiation room.
    Supabase Realtime automatically pushes it to all connected
    clients in real time — no polling needed.
    """

    room = get_one("negotiation_rooms", {"id": req.room_id})
    if not room:
        raise HTTPException(404, "Room not found")
    if room["status"] not in ("open",):
        raise HTTPException(400, "Room is not open for messages")
    if not req.content.strip() and not req.file_url:
        raise HTTPException(400, "Message cannot be empty")

    msg_id = str(uuid.uuid4())
    db_admin.table("messages").insert({
        "id":           msg_id,
        "room_id":      req.room_id,
        "sender_id":    req.sender_id,
        "sender_role":  req.sender_role,
        "content":      req.content,
        "message_type": req.message_type,
        "file_url":     req.file_url,
        "is_read":      False,
        "sent_at":      datetime.now(timezone.utc).isoformat(),
    }).execute()

    return {"message_id": msg_id, "sent": True}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET MESSAGE HISTORY FOR A ROOM
# GET /api/v1/messages/{room_id}
# ════════════════════════════════════════════════════════════════

@router.get("/messages/{room_id}")
def get_messages(room_id: str, limit: int = 100):
    """
    Fetch all messages for a negotiation room.
    Ordered oldest to newest.
    """
    messages = (
        db_admin.table("messages")
        .select("*")
        .eq("room_id", room_id)
        .order("sent_at", desc=False)
        .limit(limit)
        .execute()
        .data
    )
    return messages


# ════════════════════════════════════════════════════════════════
# ENDPOINT: MARK MESSAGES AS READ
# POST /api/v1/messages/read
# ════════════════════════════════════════════════════════════════

@router.post("/messages/read")
def mark_messages_read(req: MarkReadRequest):
    """
    Mark all unread messages in a room as read for a given user.
    Called when user opens the chat window.
    """
    db_admin.table("messages").update({
        "is_read": True,
        "read_at": datetime.now(timezone.utc).isoformat(),
    }).eq("room_id", req.room_id).eq("is_read", False).neq(
        "sender_id", req.reader_id
    ).execute()

    return {"marked_read": True}


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET UNREAD COUNT FOR A USER
# GET /api/v1/messages/unread/{user_id}
# ════════════════════════════════════════════════════════════════

@router.get("/messages/unread/{user_id}")
def get_unread_count(user_id: str):
    """
    Get count of unread messages across all rooms for a user.
    Used to show notification badge on dashboard.
    """
    result = (
        db_admin.table("messages")
        .select("id, room_id")
        .eq("is_read", False)
        .neq("sender_id", user_id)
        .execute()
        .data
    )
    return {"unread_count": len(result), "rooms": list({m["room_id"] for m in result})}
