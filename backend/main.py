# ════════════════════════════════════════════════════════════════
# main.py — GigaSouk API Entry Point
# This file does ONE thing: mount routers and start the app.
# Zero business logic lives here.
# To add a new feature: import its router and add one line below.
# ════════════════════════════════════════════════════════════════

import warnings

# razorpay~=1.4.x imports setuptools.pkg_resources, which emits UserWarning on setuptools≥81.
# Must run before any import that loads razorpay (services.razorpay_service).
warnings.filterwarnings(
    "ignore",
    message=r"^pkg_resources is deprecated as an API\.",
    category=UserWarning,
)
# supabase 2.7 still pulls `gotrue`; upstream recommends supabase_auth (not yet default).
warnings.filterwarnings(
    "ignore",
    message=r"The `gotrue` package is deprecated",
    category=DeprecationWarning,
)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter
from contextlib import asynccontextmanager

from config import APP_URL, ALLOWED_ORIGINS

# ── Feature routers (all served under /api/v1) ───────────────────
from routers.gigasouk_engine   import router as engine_router
from routers.commitment_router import router as commitment_router
from routers.design_router     import router as design_router
from routers.chat_router       import router as chat_router
from routers.qc_router         import router as qc_router

# ── Auth router (user signup & profile creation) ──────────────────
from routers.auth_router import router as auth_router

# ── Service routers (API side only, served under /api/v1) ────────
from services.razorpay_service   import router as razorpay_router
from services.shiprocket_service import router as shiprocket_router
from services.broadcast_service  import router as broadcast_router

# ── Background scheduler ────────────────────────────────────
from services.scheduler import start_scheduler, stop_scheduler, get_job_status

# ── Webhook handler functions (imported directly to avoid
#    mounting the same router twice, which causes duplicate
#    operation-ID warnings in FastAPI's OpenAPI output) ──────────
from services.razorpay_service   import razorpay_webhook   # POST /webhooks/razorpay
from services.shiprocket_service import shiprocket_webhook # POST /webhooks/shiprocket

# ── Build a clean, dedicated webhook router ───────────────────────
# Each handler is registered once under /webhooks, separately from
# the /api/v1 mounts, so there are zero duplicate operation IDs.
webhook_router = APIRouter(tags=["Webhooks"])
webhook_router.add_api_route(
    "/razorpay",
    razorpay_webhook,
    methods=["POST"],
    summary="Razorpay payment webhook",
)
webhook_router.add_api_route(
    "/shiprocket",
    shiprocket_webhook,
    methods=["POST"],
    summary="Shiprocket delivery webhook",
)


# ── Startup / Shutdown ───────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── STARTUP ────────────────────────────────────────────────────
    print(f"GigaSouk API starting — {APP_URL}")
    start_scheduler()   # ← launches all background jobs
    yield
    # ── SHUTDOWN ──────────────────────────────────────────────────
    stop_scheduler()    # ← graceful shutdown
    print("GigaSouk API shutting down")


# ── Create App ───────────────────────────────────────────────────
app = FastAPI(
    title="GigaSouk API",
    description="Manufacturing-as-a-Service Platform — gigasouk.com",
    version="2.0.0",
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── /api/v1 — Feature Routers ────────────────────────────────────
app.include_router(engine_router,     prefix="/api/v1", tags=["Routing & Orders"])
app.include_router(commitment_router, prefix="/api/v1", tags=["Commitment Pipeline"])
app.include_router(design_router,     prefix="/api/v1", tags=["Designs"])
app.include_router(chat_router,       prefix="/api/v1", tags=["Chat & Messaging"])
app.include_router(qc_router,         prefix="/api/v1", tags=["Quality Control"])
app.include_router(broadcast_router,  prefix="/api/v1", tags=["Emergency Broadcast"])

# ── /api/v1 — Service Routers (payments, tracking) ───────────────
app.include_router(razorpay_router,   prefix="/api/v1", tags=["Payments"])
app.include_router(shiprocket_router, prefix="/api/v1", tags=["Shipping & Tracking"])

# ── /api/auth — Authentication & Profile Creation ────────────────
# Mounted under /api/* so the Emergent preview ingress routes it to
# the backend. The frontend calls these via NEXT_PUBLIC_API_URL.
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])

# ── /webhooks — Inbound callbacks from Razorpay & Shiprocket ─────
# Mounted on a separate, dedicated router so there are no duplicate
# operation IDs and the paths are exactly what each provider expects.
app.include_router(webhook_router, prefix="/webhooks")


# ── Health Check ─────────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health():
    """Quick liveness check. Returns 200 when the API is running."""
    return {"status": "ok", "platform": "gigasouk", "version": "2.0.0"}


@app.get("/health/jobs", tags=["System"])
def health_jobs():
    """
    Shows all scheduled background jobs and their next run time.
    Visit /health/jobs to confirm the scheduler is running.
    """
    return {"jobs": get_job_status()}


# ── Root ─────────────────────────────────────────────────────────
@app.get("/", tags=["System"])
def root():
    return {"message": "GigaSouk API is live", "docs": "/docs"}
