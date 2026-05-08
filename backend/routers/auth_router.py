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
from fastapi import APIRouter, HTTPException, Header, Query
from fastapi.responses import JSONResponse

from db import db_admin, get_one
from services.activity_audit import audit_user_activity

router = APIRouter()
logger = logging.getLogger(__name__)


def _normalize_email(value: Optional[str]) -> str:
    """Lowercase + strip for comparisons (Supabase auth emails are case-insensitive)."""
    return (value or "").strip().lower()


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

    # Authoritative email comes from Supabase Auth (token), not the client body — prevents
    # spoofing req.email to hijack another user's profile when merging by email.
    jwt_email_raw = (payload.get("email") or "").strip()
    if jwt_email_raw:
        if _normalize_email(req.email) != _normalize_email(jwt_email_raw):
            logger.warning(
                "create_profile: req.email does not match JWT email "
                f"(jwt={jwt_email_raw!r}, req={req.email!r})"
            )
            raise HTTPException(
                403,
                "Email must match the signed-in account. Use the email on your auth session.",
            )
    
    # 2. Check if profile already exists (idempotency)
    existing = get_one("profiles", {"auth_id": auth_uid})
    if existing:
        existing_role = existing.get("role")
        if existing_role == "admin" or existing_role == req.role:
            logger.info(f"Profile already exists for auth_id={auth_uid}")
            audit_user_activity(
                action="profile_create_or_update",
                actor_profile_id=existing["id"],
                actor_role=existing_role,
                entity="profile",
                entity_id=existing["id"],
                status="already_exists",
                metadata={"requested_role": req.role},
            )
            return {
                "profile_id": existing["id"],
                "role": existing_role,
                "message": "profile_already_exists"
            }

        # Role change requested for the same auth user
        if req.role not in ("customer", "designer", "manufacturer"):
            logger.warning(f"Invalid role: {req.role}")
            raise HTTPException(422, f"Invalid role: {req.role}. Must be customer, designer, or manufacturer.")

        if req.role == "manufacturer":
            if not req.shop_name or not req.city or not req.state or not req.pincode:
                logger.warning(
                    f"Manufacturer missing required fields: shop_name={req.shop_name}, city={req.city}, "
                    f"state={req.state}, pincode={req.pincode}"
                )
                raise HTTPException(422, "Manufacturer must provide: shop_name, city, state, pincode")

        try:
            db_admin.table("profiles").update({
                "role": req.role,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", existing["id"]).execute()
            logger.info(f"Updated role for auth_id={auth_uid} to {req.role}")
        except Exception as e:
            logger.error(f"Failed to update role for auth_id={auth_uid}: {e}")
            raise HTTPException(500, f"Role update failed: {str(e)}")

        profile_id = existing["id"]
        if req.role == "designer":
            if not get_one("designers", {"profile_id": profile_id}):
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
                    raise HTTPException(500, f"Designer profile creation failed: {str(e)}")

        elif req.role == "manufacturer":
            if not get_one("manufacturers", {"profile_id": profile_id}):
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
                    raise HTTPException(500, f"Manufacturer profile creation failed: {str(e)}")

        audit_user_activity(
            action="profile_create_or_update",
            actor_profile_id=profile_id,
            actor_role=req.role,
            entity="profile",
            entity_id=profile_id,
            status="role_updated",
            metadata={"auth_id": auth_uid, "requested_role": req.role},
        )
        return {
            "profile_id": profile_id,
            "role": req.role,
            "message": "profile_role_updated"
        }

    # 3. Validate role
    if req.role not in ("customer", "designer", "manufacturer"):
        logger.warning(f"Invalid role: {req.role}")
        raise HTTPException(422, f"Invalid role: {req.role}. Must be customer, designer, or manufacturer.")

    # 4. Validate role-specific required fields
    if req.role == "manufacturer":
        if not req.shop_name or not req.city or not req.state or not req.pincode:
            logger.warning(
                f"Manufacturer missing required fields: shop_name={req.shop_name}, city={req.city}, "
                f"state={req.state}, pincode={req.pincode}"
            )
            raise HTTPException(422, "Manufacturer must provide: shop_name, city, state, pincode")

    # 2b. If email already exists, reuse that profile — only when JWT has a verified email
    # and we looked up by that same email (see validation above). Never reassign auth_id
    # from a forged body email when the row is already linked to another Supabase user.
    existing_email = None
    if jwt_email_raw:
        existing_email = get_one("profiles", {"email": jwt_email_raw})
    if existing_email:
        existing_role = existing_email.get("role")
        if existing_role == "admin":
            return {
                "profile_id": existing_email["id"],
                "role": existing_role,
                "message": "profile_already_exists"
            }

        bound_auth = existing_email.get("auth_id")
        if bound_auth is not None and str(bound_auth).strip() != "":
            if str(bound_auth) != str(auth_uid):
                logger.warning(
                    "create_profile: email merge blocked — profile %s already linked to "
                    "another auth user",
                    existing_email["id"],
                )
                raise HTTPException(
                    409,
                    "This email is already linked to a different sign-in account. "
                    "Sign in with that account or use support to recover access.",
                )

        updates = {}
        # Safe to set auth_id only when row was unclaimed (NULL/empty) or already this user.
        if bound_auth is None or str(bound_auth).strip() == "":
            updates["auth_id"] = auth_uid
        if existing_role != req.role:
            updates["role"] = req.role

        if updates:
            updates["updated_at"] = datetime.now(timezone.utc).isoformat()
            try:
                db_admin.table("profiles").update(updates).eq("id", existing_email["id"]).execute()
                logger.info(
                    f"Updated profile {existing_email['id']} for auth_id={auth_uid}"
                )
            except Exception as e:
                logger.error(f"Failed to update profile by email: {e}")
                raise HTTPException(500, f"Profile relink failed: {str(e)}")

        profile_id = existing_email["id"]

        # Ensure role-specific extension exists
        if req.role == "designer":
            if not get_one("designers", {"profile_id": profile_id}):
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
                    raise HTTPException(500, f"Designer profile creation failed: {str(e)}")

        elif req.role == "manufacturer":
            if not get_one("manufacturers", {"profile_id": profile_id}):
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
                    raise HTTPException(500, f"Manufacturer profile creation failed: {str(e)}")

        audit_user_activity(
            action="profile_create_or_update",
            actor_profile_id=profile_id,
            actor_role=req.role,
            entity="profile",
            entity_id=profile_id,
            status="merged_existing",
            metadata={"auth_id": auth_uid, "requested_role": req.role},
        )
        return {
            "profile_id": profile_id,
            "role": req.role,
            "message": "profile_already_exists"
        }
    
    # 5. Create profiles row
    profile_id = str(uuid.uuid4())
    try:
        db_admin.table("profiles").insert({
            "id": profile_id,
            "auth_id": auth_uid,
            "full_name": req.full_name,
            "email": jwt_email_raw or req.email,
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
    audit_user_activity(
        action="profile_create_or_update",
        actor_profile_id=profile_id,
        actor_role=req.role,
        entity="profile",
        entity_id=profile_id,
        status="created",
        metadata={"auth_id": auth_uid},
    )
    return JSONResponse(status_code=201, content={
        "profile_id": profile_id,
        "role": req.role,
        "message": "profile_created",
    })


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
        return {"profile": None, "manufacturer": None, "designer": None}

    manufacturer = None
    designer = None
    profile_id = profile["id"]
    role = profile.get("role")

    try:
        if role == "manufacturer":
            mfr = (
                db_admin.table("manufacturers")
                .select("*")
                .eq("profile_id", profile_id)
                .limit(1)
                .execute()
            )
            if mfr.data:
                manufacturer = mfr.data[0]
        elif role == "designer":
            des = (
                db_admin.table("designers")
                .select("*")
                .eq("profile_id", profile_id)
                .limit(1)
                .execute()
            )
            if des.data:
                designer = des.data[0]
    except Exception as e:
        logger.warning(f"Extension lookup failed: {e}")

    pref = profile.get("preferred_delivery")
    if pref is None:
        pref = {}

    return {
        # Full profile, including the columns we revoke from the
        # frontend roles in safe_rls.sql (email, phone, wallet_balance).
        # The owner reads them through this endpoint, never directly.
        "profile": {
            "id":                  profile_id,
            "auth_id":             profile.get("auth_id"),
            "full_name":           profile.get("full_name"),
            "email":               profile.get("email"),
            "phone":               profile.get("phone"),
            "role":                role,
            "wallet_balance":      float(profile.get("wallet_balance") or 0),
            "is_active":           profile.get("is_active", True),
            "preferred_delivery":  pref,
        },
        "manufacturer":    manufacturer,
        "designer":        designer,
        # Convenience aliases (old shape kept for backward compatibility)
        "manufacturer_id": manufacturer.get("id") if manufacturer else None,
        "designer_id":     designer.get("id") if designer else None,
    }


@router.get("/me/wallet-transactions")
def get_wallet_transactions(
    authorization: Optional[str] = Header(None),
    limit: int = Query(100, ge=1, le=200),
):
    """Wallet ledger rows for the authenticated profile only (service role)."""
    payload = verify_jwt(authorization)
    auth_uid = payload.get("sub")
    if not auth_uid:
        raise HTTPException(401, "Invalid token")

    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile:
        raise HTTPException(404, "Profile not found")

    lim = min(max(limit, 1), 200)
    res = (
        db_admin.table("wallet_txns")
        .select("id, amount, txn_type, source_ref, balance_after, created_at")
        .eq("profile_id", profile["id"])
        .order("created_at", desc=True)
        .limit(lim)
        .execute()
    )
    return {"transactions": res.data or []}


class PreferredDeliveryBody(BaseModel):
    """Saved delivery / preference used for routing and checkout defaults."""
    line1:   str = ""
    city:    str = ""
    state:   str = ""
    pincode: str = ""
    lat:     float = 0.0
    lng:     float = 0.0


@router.patch("/me/preferred-delivery")
def patch_preferred_delivery(
    body: PreferredDeliveryBody,
    authorization: Optional[str] = Header(None),
):
    """Customers save their usual delivery coordinates & address fields."""
    payload = verify_jwt(authorization)
    auth_uid = payload.get("sub")
    profile = get_one("profiles", {"auth_id": auth_uid})
    if not profile:
        raise HTTPException(404, "Profile not found")
    if profile.get("role") != "customer":
        raise HTTPException(403, "Only customers can set a preferred delivery location")

    data = {
        "line1":   body.line1.strip(),
        "city":    body.city.strip(),
        "state":   body.state.strip(),
        "pincode": body.pincode.strip(),
        "lat":     body.lat,
        "lng":     body.lng,
    }
    db_admin.table("profiles").update({
        "preferred_delivery": data,
        "updated_at":         datetime.now(timezone.utc).isoformat(),
    }).eq("id", profile["id"]).execute()

    return {"ok": True, "preferred_delivery": data}
