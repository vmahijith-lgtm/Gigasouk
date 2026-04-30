# ════════════════════════════════════════════════════════════════
# routers/auth_router.py — User Profile Creation (Server-Side)
# Handles: profile creation for new users after Supabase auth signup.
# All profile writes bypass RLS using the admin/service-role client.
# This ensures RLS policy violations never occur during signup.
# ════════════════════════════════════════════════════════════════

import uuid
import logging
from typing import Optional, List
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header

from db import db_admin, get_one

router = APIRouter()
logger = logging.getLogger(__name__)


# ════════════════════════════════════════════════════════════════
# MODELS
# ════════════════════════════════════════════════════════════════

from pydantic import BaseModel

class CreateProfileRequest(BaseModel):
    full_name: str
    email: str
    role: str  # "customer" | "designer" | "manufacturer"
    phone: Optional[str] = None
    
    # Designer fields
    portfolio_url: Optional[str] = None
    specialisation: List[str] = []
    
    # Manufacturer fields
    shop_name: Optional[str] = None
    gstin: Optional[str] = None
    address_line1: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    pincode: Optional[str] = None
    lat: Optional[float] = 0.0
    lng: Optional[float] = 0.0
    machine_types: List[str] = []
    materials: List[str] = []
    capacity_units_per_day: Optional[int] = 10
    bank_account_no: Optional[str] = None
    bank_ifsc: Optional[str] = None


# ════════════════════════════════════════════════════════════════
# HELPER: VERIFY JWT via Supabase Auth API
# ════════════════════════════════════════════════════════════════

def verify_jwt(authorization: Optional[str]) -> dict:
    """
    Verify a Supabase JWT by calling auth.get_user() on the admin client.

    This approach works regardless of the signing algorithm Supabase uses
    (HS256, ES256, RS256, etc.) because Supabase verifies its own tokens.
    Returns a dict with 'sub' (user UUID) and 'email' from the Supabase user.
    Raises HTTPException on invalid/missing/expired token.
    """
    if not authorization:
        logger.error("Missing Authorization header")
        raise HTTPException(401, "Missing Authorization header")

    if not authorization.startswith("Bearer "):
        logger.error("Authorization header is not a Bearer token")
        raise HTTPException(401, "Invalid Authorization format — expected 'Bearer <token>'")

    token = authorization[7:]  # Strip "Bearer "
    logger.debug(f"Verifying token via Supabase auth.get_user(): {token[:30]}...")

    try:
        # ── Delegate verification to Supabase ──────────────────────
        # Works with HS256, ES256, RS256 — no local key handling needed.
        response = db_admin.auth.get_user(token)
        user = response.user

        if not user:
            logger.error("auth.get_user() returned no user")
            raise HTTPException(401, "Invalid or expired token")

        logger.info(f"JWT verified via Supabase. User: {user.id} ({user.email})")

        # Return a payload-like dict so callers can use payload['sub']
        return {
            "sub": user.id,
            "email": user.email,
            "role": (user.user_metadata or {}).get("role", ""),
        }

    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e).lower()
        if "invalid" in err_str or "expired" in err_str or "unauthorized" in err_str:
            logger.error(f"Token rejected by Supabase: {e}")
            raise HTTPException(401, f"Invalid or expired token: {e}")
        logger.error(f"Unexpected error verifying token: {type(e).__name__}: {e}")
        raise HTTPException(401, "Token verification failed")


# ════════════════════════════════════════════════════════════════
# ENDPOINT: CREATE PROFILE (IDEMPOTENT)
# POST /auth/create-profile
# ════════════════════════════════════════════════════════════════

@router.post("/create-profile")
def create_profile(
    req: CreateProfileRequest,
    authorization: Optional[str] = Header(None)
):
    """
    Server-side profile creation. Fully idempotent.
    
    1. Verify JWT from Authorization header
    2. Extract auth_id from JWT 'sub' claim
    3. Check if profile already exists → return existing
    4. Create profiles row
    5. If role-specific, create extension row (designers or manufacturers)
    6. Return profile with 201 on success, 409 if already exists, 500 on error
    
    On extension insert failure: manually delete the profiles row (rollback).
    """
    
    # 1. Verify JWT and extract auth_id
    try:
        payload = verify_jwt(authorization)
        auth_uid = payload.get("sub")
        
        if not auth_uid:
            logger.warning("JWT missing 'sub' claim")
            raise HTTPException(401, "Invalid token: missing 'sub' claim")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"JWT processing error: {e}")
        raise HTTPException(401, "Token validation failed")
    
    # 2. Check if profile already exists (idempotency)
    existing = get_one("profiles", {"auth_id": auth_uid})
    if existing:
        logger.info(f"Profile already exists for auth_id={auth_uid}")
        return {
            "profile_id": existing["id"],
            "role": existing["role"],
            "message": "profile_already_exists"
        }
    
    # 3. Validate role
    if req.role not in ("customer", "designer", "manufacturer"):
        logger.warning(f"Invalid role: {req.role}")
        raise HTTPException(422, f"Invalid role: {req.role}. Must be customer, designer, or manufacturer.")
    
    # 4. Validate role-specific required fields
    if req.role == "manufacturer":
        if not req.shop_name or not req.city or not req.state or not req.pincode:
            logger.warning(f"Manufacturer missing required fields: shop_name={req.shop_name}, city={req.city}, state={req.state}, pincode={req.pincode}")
            raise HTTPException(422, "Manufacturer must provide: shop_name, city, state, pincode")
    
    # 5. Create profiles row
    profile_id = str(uuid.uuid4())
    try:
        db_admin.table("profiles").insert({
            "id": profile_id,
            "auth_id": auth_uid,
            "full_name": req.full_name,
            "email": req.email,
            "phone": req.phone,
            "role": req.role,
            "is_active": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
        logger.info(f"Created profile {profile_id} for auth_id={auth_uid}, role={req.role}")
    except Exception as e:
        logger.error(f"Failed to create profiles row: {e}")
        raise HTTPException(500, f"Profile creation failed: {str(e)}")
    
    # 6. Create role-specific extension row (if needed)
    if req.role == "designer":
        try:
            db_admin.table("designers").insert({
                "id": str(uuid.uuid4()),
                "profile_id": profile_id,
                "portfolio_url": req.portfolio_url,
                "specialisation": req.specialisation or [],
                "total_designs": 0,
                "total_earnings": 0,
                "joined_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            logger.info(f"Created designer extension for profile {profile_id}")
        except Exception as e:
            logger.error(f"Failed to create designers row for profile {profile_id}: {e}")
            # Rollback: delete the profiles row
            try:
                db_admin.table("profiles").delete().eq("id", profile_id).execute()
                logger.info(f"Rolled back profiles row {profile_id}")
            except Exception as rollback_err:
                logger.error(f"Rollback failed: {rollback_err}")
            raise HTTPException(500, f"Designer profile creation failed: {str(e)}")
    
    elif req.role == "manufacturer":
        try:
            db_admin.table("manufacturers").insert({
                "id": str(uuid.uuid4()),
                "profile_id": profile_id,
                "shop_name": req.shop_name,
                "gstin": req.gstin,
                "address_line1": req.address_line1,
                "city": req.city,
                "state": req.state,
                "pincode": req.pincode,
                "lat": req.lat or 0.0,
                "lng": req.lng or 0.0,
                "machine_types": req.machine_types or [],
                "materials": req.materials or [],
                "capacity_units_per_day": req.capacity_units_per_day or 10,
                "bank_account_no": req.bank_account_no,
                "bank_ifsc": req.bank_ifsc,
                "is_active": True,
                "rating": 0,
                "queue_depth": 0,
                "total_jobs": 0,
                "qc_pass_rate": 0,
                "joined_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).execute()
            logger.info(f"Created manufacturer extension for profile {profile_id}")
        except Exception as e:
            logger.error(f"Failed to create manufacturers row for profile {profile_id}: {e}")
            # Rollback: delete the profiles row
            try:
                db_admin.table("profiles").delete().eq("id", profile_id).execute()
                logger.info(f"Rolled back profiles row {profile_id}")
            except Exception as rollback_err:
                logger.error(f"Rollback failed: {rollback_err}")
            raise HTTPException(500, f"Manufacturer profile creation failed: {str(e)}")
    
    # 7. Return success
    return {
        "profile_id": profile_id,
        "role": req.role,
        "message": "profile_created"
    }, 201


# ════════════════════════════════════════════════════════════════
# ENDPOINT: GET CURRENT USER PROFILE
# GET /auth/me
# Returns the authenticated user's profile + (if applicable) the
# manufacturer / designer extension. Uses the service-role client so
# we don't depend on per-table RLS policies that may not exist in
# the user's Supabase project.
# ════════════════════════════════════════════════════════════════

@router.get("/me")
def get_me(authorization: Optional[str] = Header(None)):
    """Return the logged-in user's full profile + role-specific extension."""
    payload = verify_jwt(authorization)
    auth_uid = payload.get("sub")
    if not auth_uid:
        raise HTTPException(401, "Invalid token: missing 'sub' claim")

    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile:
        return {"profile": None, "manufacturer_id": None, "designer_id": None}

    manufacturer_id = None
    designer_id = None
    profile_id = profile["id"]
    role = profile.get("role")

    try:
        if role == "manufacturer":
            mfr = (
                db_admin.table("manufacturers")
                .select("id")
                .eq("profile_id", profile_id)
                .limit(1)
                .execute()
            )
            if mfr.data:
                manufacturer_id = mfr.data[0]["id"]
        elif role == "designer":
            des = (
                db_admin.table("designers")
                .select("id")
                .eq("profile_id", profile_id)
                .limit(1)
                .execute()
            )
            if des.data:
                designer_id = des.data[0]["id"]
    except Exception as e:
        logger.warning(f"Extension lookup failed: {e}")

    return {
        "profile": {
            "id":        profile_id,
            "auth_id":   profile.get("auth_id"),
            "full_name": profile.get("full_name"),
            "email":     profile.get("email"),
            "role":      role,
        },
        "manufacturer_id": manufacturer_id,
        "designer_id":     designer_id,
    }
