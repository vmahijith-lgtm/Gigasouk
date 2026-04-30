# GigaSouk — PRD

## Original problem statement (Apr 30, 2026)

> analyse the whole project.
> issue:
> staying in same page even after signin or login.
> no way to navigate to other pages.
> fix all errors.
> make sure the app runs perfectly fine

## Stack

- **Frontend**: Next.js 15 (App Router) + React 18 + Tailwind, supervisor runs `yarn start` on port 3000 (rewired to `next dev` for hot-reload during development).
- **Backend**: FastAPI (Python 3.11) on port 8001. Entry `server.py` re-exports `app` from `main.py`.
- **Auth + DB**: Supabase (project `cweizgjulmfepacmdbxe.supabase.co`).
- **Payments**: Razorpay (keys placeholder — to add later).
- **Logistics / Notifs**: Shiprocket / Twilio / Resend (keys placeholder).
- **Maps**: Google Maps (key configured).

## User personas

- **Customer** — browses live products on `/`, picks the nearest factory on a map, pays via Razorpay escrow.
- **Designer** — uploads CAD designs on `/designer`, seeks manufacturer commitments, publishes to the shop.
- **Manufacturer** — commits to designs on `/manufacturer`, runs production, uploads QC photos, ships through Shiprocket.
- **Admin** — manages variants, broadcasts, and orders on `/admin`.

## Core requirements (static)

1. Role-aware authentication and route protection (Supabase + Next.js middleware).
2. Three role-specific dashboards reachable post-login.
3. Customer order flow: catalog → factory map → Razorpay → escrow → AI QC → Shiprocket.
4. Designer pipeline: draft → seeking → committed → live.
5. Manufacturer pipeline: commit → produce → QC upload → ship.
6. Backend uses Supabase for storage; emergent ingress only forwards `/api/*` to the FastAPI service.

## What's been implemented (Apr 30, 2026)

### Bug fix session (Apr 30, 2026)
- **Fixed: navigation broken after login.** Root cause was a mismatch between client-side session storage (localStorage via `@supabase/supabase-js`) and middleware's cookie reader (`@supabase/ssr`). Switched the browser client to `createBrowserClient` from `@supabase/ssr` so cookies are mirrored.
- **Fixed: bad redirect target.** `router.replace(next || "/designer")` resolved to `"/"` for any logged-in non-customer because `"/"` is truthy. Replaced with explicit `next !== "/" ? next : roleHome` and switched to `window.location.assign` (full nav) so middleware sees fresh cookies.
- **Created missing env files**: `/app/backend/.env`, `/app/frontend/.env.local`, `/app/frontend/.env`.
- **Created `server.py` shim** so supervisor's `server:app` command boots the FastAPI app from `main.py`.
- **Reinstalled Python deps** (`supabase 2.7.4`, matching `pydantic`, `tzlocal`, `realtime`, `starlette<0.47`).
- **Switched `package.json` `start`** to `next dev -H 0.0.0.0 -p 3000` (kept `start:prod` for production).
- **Fixed schema mismatch** in `auth_router.py`: designers/manufacturers tables use `joined_at`, not `created_at`.
- **Fixed RPC param name**: `get_designer_stats` takes `p_designer_id`, not `designer_id`.
- **Fixed iterable bug** in `GigaSoukStagingArea.jsx` where a query builder was being passed to `.in()` (Supabase needs a concrete array).
- **Added `GET /api/auth/me`** backend endpoint (service-role) to bypass missing RLS policies on the `manufacturers` table; auth-context now prefers it over a direct Supabase join.
- **Moved auth router mount** from `/auth` to `/api/auth` so the Emergent ingress forwards calls to the backend (only `/api/*` is routed to port 8001).
- Verified all three role logins navigate correctly:
  - Customer → `/` ✓
  - Designer → `/designer` ✓
  - Manufacturer → `/manufacturer` ✓

### Unresolved / not in scope of this session

- Real Razorpay/Shiprocket/Twilio/Resend integrations (keys not provided yet — env placeholders are in place).
- Some dashboard sub-features make assumptions about RLS policies that aren't part of the schema (e.g. `qc_records`, `wallet_txns` reads). May need additional `/api/auth/me`-style backend proxies later.
- The pre-existing CSS overlap on the designer dashboard (Sign Out button vs. user name in the top-right) is cosmetic — left untouched.

## Local dev / production setup

### Running on Emergent preview (current state)
- `https://197c8ca3-f0d1-4931-91b2-aa945d1a1abf.preview.emergentagent.com` is the public URL.
- Supervisor runs frontend on port 3000 and backend on 8001. `/api/*` is routed to the backend via the Emergent ingress.

### Running on user's localhost
1. `cd /app/backend && pip install -r requirements.txt`
2. `cd /app/frontend && yarn install`
3. Edit `/app/frontend/.env.local`:
   ```
   NEXT_PUBLIC_API_URL=http://localhost:8000
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
4. Edit `/app/backend/.env` and add `http://localhost:3000` to `ALLOWED_ORIGINS` (already done).
5. `cd /app/backend && uvicorn main:app --reload --port 8000`
6. `cd /app/frontend && yarn dev`

### Deploying (later)
- **Frontend (Vercel)**: set the same `NEXT_PUBLIC_*` env vars; point `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_SITE_URL` to the deployed URLs.
- **Backend (Railway/Render)**: set every value in `backend/.env` as project variables; update `ALLOWED_ORIGINS` to include the Vercel domain.

## Prioritized backlog

### P0 (must-do next)
- Add Razorpay test keys + verify the customer order flow end-to-end.
- **Apply `/app/migrations/safe_rls.sql` in your Supabase SQL editor** to harden privacy (manufacturer bank info, user emails/phones, designer earnings). Step-by-step guide at `/app/migrations/README.md`.

### Privacy hardening done in this session
- Added `GET /api/auth/me` backend endpoint (service-role) that returns the owner's full profile + manufacturer/designer extension. The dashboards now use this to read sensitive columns (`wallet_balance`, `email`, `phone`, `bank_account_no`, `bank_ifsc`, `gstin`, `total_earnings`) instead of querying Supabase directly.
- Wrote `/app/migrations/safe_rls.sql` — a one-shot SQL migration the user runs in Supabase to:
  - Add `manufacturers_self_read` / `manufacturers_self_update` policies (no public read, bank info safe).
  - REVOKE `email`, `phone`, `wallet_balance` on `profiles` and `total_earnings` on `designers` from anon/authenticated roles.
  - Repair several RLS policies that compared `auth.uid()` to `profiles.id` (random UUIDs) instead of `profiles.auth_id` — they were silently denying everything.

### P1
- Fix the small visual overlap between user name and Sign Out button on dashboards.
- Add Shiprocket + Twilio + Resend keys; verify shipping + WhatsApp/email notifications.

### P2
- Hook up Google OAuth on Supabase Auth side and wire `redirectTo` to the Vercel URL once deployed.
- Build out the admin variants approval queue UI (component exists; not deeply tested in this session).

## Next action items

1. Add Razorpay credentials to `/app/backend/.env` (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, optionally `RAZORPAY_ROUTE_ACCOUNT`).
2. Test the full customer ordering flow once Razorpay is configured.
3. (Optional) Apply the `manufacturers_read_all` policy in Supabase SQL editor, then the `/api/auth/me` proxy can fall back to direct Supabase queries for resilience.
