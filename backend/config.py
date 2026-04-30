# ════════════════════════════════════════════════════════════════
# config.py — GigaSouk Platform Configuration
# ALL environment variables and ALL platform constants live here.
# To change any value platform-wide: change it once in this file.
# ════════════════════════════════════════════════════════════════

import os
from dotenv import load_dotenv

load_dotenv()

# ── Supabase ─────────────────────────────────────────────────────
SUPABASE_URL          = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY     = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY  = os.getenv("SUPABASE_SERVICE_KEY", "")
SUPABASE_JWT_SECRET   = os.getenv("SUPABASE_JWT_SECRET", "")

# ── Razorpay (Payments + Escrow) ─────────────────────────────────
RAZORPAY_KEY_ID        = os.getenv("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET    = os.getenv("RAZORPAY_KEY_SECRET", "")
RAZORPAY_ROUTE_ACCOUNT = os.getenv("RAZORPAY_ROUTE_ACCOUNT", "")
# Webhook Secret — set in Razorpay Dashboard → Webhooks → Secret.
# DIFFERENT from the API key secret. Used only for HMAC-SHA256
# verification of inbound /webhooks/razorpay POST requests.
RAZORPAY_WEBHOOK_SECRET = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")

# ── Shiprocket (Logistics) ───────────────────────────────────────
SHIPROCKET_EMAIL    = os.getenv("SHIPROCKET_EMAIL", "")
SHIPROCKET_PASSWORD = os.getenv("SHIPROCKET_PASSWORD", "")

# ── Twilio (WhatsApp) ────────────────────────────────────────────
TWILIO_ACCOUNT_SID   = os.getenv("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN    = os.getenv("TWILIO_AUTH_TOKEN", "")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886")

# ── Resend (Email) ───────────────────────────────────────────────
RESEND_API_KEY    = os.getenv("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.getenv("RESEND_FROM_EMAIL", "noreply@gigasouk.com")

# ── App ──────────────────────────────────────────────────────────
APP_URL         = os.getenv("APP_URL", "https://gigasouk.com")
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "https://gigasouk.com").split(",")

# ── Google Maps (Backend geocoding fallback) ─────────────────────────
# Used to geocode pincode → lat/lng when the frontend sends lat=0, lng=0.
# Without this key, routing still works but falls back to manual review.
GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

# ════════════════════════════════════════════════════════════════
# PLATFORM CONSTANTS
# Change any value here — it takes effect platform-wide.
# ════════════════════════════════════════════════════════════════

# ── Commission and Royalties ─────────────────────────────────────
PLATFORM_FEE_PERCENT        = 0.05   # 5%  → GigaSouk per completed order
DESIGNER_ROYALTY_PERCENT    = 0.15   # 15% → Designer per unit sold
PREMIUM_LISTING_MONTHLY_INR = 999    # Certified Maker badge monthly fee

# ── Routing Engine Weights (must sum to 1.0) ─────────────────────
ROUTING_WEIGHT_DISTANCE = 0.60   # 60% — closest factory wins
ROUTING_WEIGHT_RATING   = 0.30   # 30% — higher rated factory wins
ROUTING_WEIGHT_QUEUE    = 0.10   # 10% — less busy factory wins
ROUTING_MAX_DISTANCE_KM = 500    # Factories beyond this are excluded

# ── Commitment Pipeline ──────────────────────────────────────────
MIN_COMMITS_TO_GO_LIVE      = 2     # Commits needed before design goes live
COMMITMENT_SEEK_HOURS       = 48    # Hours before emergency broadcast fires
REGIONAL_VARIANT_MAX_MARKUP = 0.50  # Regional price max 50% above base

# ── Negotiation Room ─────────────────────────────────────────────
NEGOTIATION_TIMEOUT_HOURS = 24   # Room expires after this
MAX_BID_ROUNDS            = 20   # Max counter-offers allowed

# ── QC Gate ──────────────────────────────────────────────────────
QC_SCALE_MM_PER_PX  = float(os.getenv("QC_SCALE_MM_PER_PX", "0.1"))
QC_TOLERANCE_MM     = float(os.getenv("QC_TOLERANCE_MM", "0.5"))
QC_REQUIRED_PHOTOS  = 5   # Manufacturer must upload exactly this many

# ── Order Status Values ──────────────────────────────────────────
# Must match the order_status enum in gigasouk_schema.sql
ORDER_STATUS_ROUTING     = "routing"
ORDER_STATUS_NEGOTIATING = "negotiating"
ORDER_STATUS_CONFIRMED   = "confirmed"
ORDER_STATUS_CUTTING     = "cutting"
ORDER_STATUS_QC          = "qc_review"
ORDER_STATUS_SHIPPED     = "shipped"
ORDER_STATUS_DELIVERED   = "delivered"
ORDER_STATUS_CANCELLED   = "cancelled"

# ── Design Status Values ─────────────────────────────────────────
# Must match the design_status enum in gigasouk_schema.sql
DESIGN_STATUS_DRAFT     = "draft"
DESIGN_STATUS_SEEKING   = "seeking"
DESIGN_STATUS_COMMITTED = "committed"
DESIGN_STATUS_LIVE      = "live"
DESIGN_STATUS_PAUSED    = "paused"

# ── Payment Status Values ────────────────────────────────────────
PAYMENT_STATUS_PENDING  = "pending"
PAYMENT_STATUS_ESCROW   = "in_escrow"
PAYMENT_STATUS_RELEASED = "released"
PAYMENT_STATUS_REFUNDED = "refunded"
