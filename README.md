<div align="center">

# ⚙️ GigaSouk

**Cloud Factory Infrastructure for India**

*AI-powered Manufacturing-as-a-Service — connecting designers, MSME factories, and customers through intelligent routing, escrow payments, and computer-vision quality control.*

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ECF8E?logo=supabase)](https://supabase.com/)
[![Python](https://img.shields.io/badge/Python-3.11%2B-3776AB?logo=python)](https://python.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)](https://typescriptlang.org/)
[![License](https://img.shields.io/badge/License-All%20Rights%20Reserved-red)](#license)

</div>

---

## What is GigaSouk?

GigaSouk is a **Manufacturing-as-a-Service (MaaS)** platform that acts as the *operating system* for India's 63 million MSMEs. Just as AWS virtualises physical servers, GigaSouk virtualises physical factories — filling idle machine capacity by connecting three stakeholders:

| Stakeholder | Role |
|---|---|
| 🎨 **Designer** | Uploads a CAD file, sets a royalty %, and earns passively on every unit sold |
| 🏭 **Manufacturer** | Browses a jobs board, commits to designs that suit their margins, and gets paid on delivery |
| 🛍️ **Customer** | Buys engineered, made-to-order products at a transparent price — manufactured by the nearest committed factory |

---

## The 8-Stage Order Journey

```
  DESIGNER                     PLATFORM                    MANUFACTURER            CUSTOMER
     │                             │                             │                     │
     │── Upload CAD + set price ──►│                             │                     │
     │                             │── Alert capable factories ──►                     │
     │                             │                             │── Review + Commit ──►│
     │◄────────────── Negotiation Room (24-hr timer) ───────────►│                     │
     │                             │                             │                     │
     │                             │◄──── Product goes LIVE in shop ─────────────────►│
     │                             │                             │                     │
     │                             │◄──────────── Order + Razorpay Escrow ────────────│
     │                             │── Assign nearest factory ──►│                     │
     │                             │                             │── Manufacture ──────►│
     │                             │◄── Upload 5 QC photos ──────│                     │
     │                             │── OpenCV QC (±0.5mm) ───────►                     │
     │                             │── QC pass → Shiprocket AWB ─►                     │
     │                             │                             │                     │◄── Delivery
     │◄── Royalty released ────────│◄── Factory paid ────────────│                     │
```

> Every product visible in the shop already has a **committed manufacturer** before the customer ever sees it.

---

## Core Technical Differentiators

| Component | Implementation | Advantage |
|---|---|---|
| **AI Routing Engine** | FastAPI + PostGIS · Haversine distance | Price-commitment filter runs before proximity sort — stable consumer prices |
| **QC Gate** | OpenCV computer vision | CAD wireframe vs. 5 photos at ±0.5mm tolerance — eliminates human QC |
| **Escrow Layer** | Razorpay + HMAC-SHA256 | Funds locked until QC passes and delivery confirmed; auto-split on delivery |
| **Logistics Bridge** | Shiprocket multi-courier API | AWB auto-generated on QC pass; webhooks update order status in real time |
| **Data Layer** | Supabase Postgres + JSONB | Machine capabilities stored as queryable JSON — instant capability matching |
| **Notifications** | WhatsApp Business API + Resend email | Non-blocking background tasks with retry-on-failure |

### Routing Scoring Formula

```
 ┌───────────────────────────────────────────────────────────────┐
 │  STEP 1 — Capability filter   (hard binary — can they make it?) │
 │  STEP 2 — Price commitment    (hard binary — did they commit?)   │
 │  STEP 3 — Proximity sort      60% weight (Haversine km)          │
 │           + Factory rating    30% weight (1–5 stars)             │
 │           + Queue depth       10% weight (active jobs count)     │
 └───────────────────────────────────────────────────────────────┘
```

If no factory exists within a viable radius → **Emergency Bid Broadcast** triggers regional factories to submit a price.

---

## Tech Stack

| Layer | Technologies |
|---|---|
| **Frontend** | Next.js 15 (App Router) · React 18 · TypeScript · Supabase JS client |
| **Backend API** | FastAPI (Python 3.11+) · Uvicorn · APScheduler |
| **Database & Auth** | Supabase (Postgres · RLS · Auth · Storage) |
| **Payments** | Razorpay Escrow · HMAC-SHA256 webhook verification |
| **QC / Vision** | OpenCV · NumPy |
| **Logistics** | Shiprocket API |
| **Notifications** | Twilio WhatsApp Business API · Resend (email) |

---

## Repository Layout

```
Gigasouk/
├── frontend/                  # Next.js 15 — all role dashboards
│   └── src/app/
│       ├── page.tsx           # Public product catalog (homepage)
│       ├── auth/              # Login · Signup · Verify
│       ├── designer/          # Designer dashboard
│       ├── manufacturer/      # Manufacturer jobs board & QC upload
│       ├── admin/             # Admin control panel
│       ├── negotiate/         # Live negotiation room
│       └── track/             # Customer order tracking
│
├── backend/                   # FastAPI service
│   ├── main.py                # App entry point + router registration
│   ├── config.py              # Environment config (Pydantic settings)
│   ├── db.py                  # Supabase client + helper queries
│   ├── routers/
│   │   ├── gigasouk_engine.py # Core routing engine (capability + proximity + scoring)
│   │   ├── commitment_router.py # Commit / negotiate / price-lock flows
│   │   ├── qc_router.py       # QC photo upload + OpenCV comparison
│   │   └── chat_router.py     # Real-time negotiation chat
│   └── services/
│       ├── razorpay_service.py  # Escrow create / release / refund
│       ├── shiprocket_service.py# AWB generation + tracking webhooks
│       ├── notify_service.py    # WhatsApp + email notification dispatch
│       ├── gigasouk_qc.py       # OpenCV CAD vs. photo comparison logic
│       ├── broadcast_service.py # Emergency bid broadcast to local factories
│       └── scheduler.py         # APScheduler jobs (expiry, auto-reassign)
│
├── gigasouk_schema.sql        # Full idempotent Postgres schema
├── context/                   # Product & engineering notes (not required to run)
│   ├── context.md             # Founder's deck & platform deep-dive
│   └── checklist.md           # Build checklist & progress tracking
└── README.md
```

---

## Prerequisites

- **Node.js** 20 LTS
- **Python** 3.11+
- A **Supabase** project (free tier works for local dev)
- API keys for any integrations you want to test (Razorpay, Twilio, Resend, Shiprocket)

---

## Quick Start

### 1. Clone

```bash
git clone <your-repo-url> gigasouk
cd gigasouk
```

### 2. Database

Run the schema against your Supabase project (SQL Editor or `psql`):

```bash
psql "$DATABASE_URL" < gigasouk_schema.sql
```

### 3. Backend (FastAPI)

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt

cp backend/.env.example backend/.env
# Fill in backend/.env with your Supabase service key,
# Razorpay, Twilio, Resend, and Shiprocket credentials.

cd backend
uvicorn main:app --reload
```

| URL | Purpose |
|---|---|
| `http://127.0.0.1:8000` | API base |
| `http://127.0.0.1:8000/docs` | Interactive Swagger UI |

### 4. Frontend (Next.js)

```bash
cd frontend
npm install

cp .env.local.example .env.local
# At minimum set:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_ANON_KEY
#   NEXT_PUBLIC_API_URL=http://127.0.0.1:8000

npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Useful Commands

| Command | Directory | Purpose |
|---|---|---|
| `npm run dev` | `frontend/` | Development server (HMR) |
| `npm run build` | `frontend/` | Production build |
| `npm run lint` | `frontend/` | ESLint |
| `uvicorn main:app --reload` | `backend/` | API dev server with auto-reload |
| `uvicorn main:app` | `backend/` | API production-like server |

---

## Environment Variables

> ⚠️ **Never commit real secrets.** Copy the example files and fill in values from each provider's dashboard.

### `backend/.env`

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase Project Settings → API |
| `SUPABASE_SERVICE_KEY` | Supabase Project Settings → API (service role) |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay Dashboard |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Webhook settings |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Twilio Console |
| `TWILIO_WHATSAPP_FROM` | Twilio WhatsApp Sandbox / approved number |
| `RESEND_API_KEY` | Resend Dashboard |
| `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` | Shiprocket credentials |

### `frontend/.env.local`

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Project Settings → API (anon/public) |
| `NEXT_PUBLIC_API_URL` | Your running FastAPI base URL |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google Cloud Console (optional — for map views) |

---

## Financial Architecture

```
CUSTOMER PAYS (e.g. ₹12,000)
        ↓
RAZORPAY ESCROW  ← held until delivery confirmed
        ↓
SHIPROCKET WEBHOOK: DELIVERED
        ↓
FUNDS RELEASED:
  ├── ₹600    → GigaSouk platform fee (5%)
  ├── ₹11,400 → Manufacturer payment (95% of order)
  └── ₹1,800  → Designer royalty (~15% deducted from manufacturer share)
```

| Condition | Action |
|---|---|
| QC passes + shipment dispatched | Escrow moves to *release pending* |
| Delivery webhook fires | Full escrow released — fee, factory, designer paid instantly |
| QC fails (out of tolerance) | Manufacturer must re-make; escrow locked |
| Customer dispute | Admin manually reviews; can trigger Razorpay refund |
| Factory silent (no QC upload) | Scheduler flags order; admin can reassign or refund |

---

## Security

- **Service role keys** must stay **server-only** in `backend/.env` — never in a `NEXT_PUBLIC_*` variable.
- **Row Level Security (RLS)** is enforced on every Supabase table exposed to the anon key.
- **Razorpay webhooks** are verified with HMAC-SHA256 before any state mutation.
- Run dependency audits periodically:
  ```bash
  npm audit              # in frontend/
  pip-audit              # in backend/ (install pip-audit first)
  ```

---

## Roadmap

| Phase | Timeline | Milestones |
|---|---|---|
| **Phase 1 — MVP** | *In Progress* | Core platform · AI routing engine · Escrow integration · Initial factory onboarding |
| **Phase 2 — Scale** | 0–6 months | 500 committed factories across 6 cities · Mobile app · OpenCV QC fully automated |
| **Phase 3 — Expand** | 6–18 months | National coverage · 5,000 factories · B2B bulk procurement portal · D2C brand API |
| **Phase 4 — Moat** | 18–36 months | Proprietary QC dataset · Predictive routing · Factory financing products · Export capability |

---

## Market

| Segment | Size |
|---|---|
| TAM — India MSME Manufacturing Output | $700B+ |
| SAM — Custom + Made-to-Order | $45B |
| SOM — Platform-addressable (3-year target) | $2B |

---

## Author

**Anirudh S Raj** — Architect & Founder  
📧 anirudhsraj11@gmail.com · 🌐 [gigasouk.in](https://gigasouk.in)

---

## License

© 2026 GigaSouk. All rights reserved unless a separate `LICENSE` file is added to this repository.
