# GigaSouk Backend — Deployment Guide

Step-by-step instructions for deploying the FastAPI backend to **Railway** and **Render**.

---

## Before You Start

Make sure you have:
- [ ] Your Supabase project URL and keys (Settings → API)
- [ ] Razorpay API keys and webhook secret (live or test)
- [ ] Twilio Account SID and Auth Token
- [ ] Resend API key
- [ ] Shiprocket credentials
- [ ] Your frontend URL (e.g. `https://gigasouk.com`)

---

## Option A — Railway

### Step 1 — Push to GitHub

The code must be on GitHub (or GitLab). Railway pulls directly from your repo.

```bash
git add .
git commit -m "chore: add railway deployment config"
git push origin main
```

### Step 2 — Create a Railway Project

1. Go to [railway.app](https://railway.app) → **New Project**
2. Choose **Deploy from GitHub repo**
3. Select your repository (`Gigasouk`)
4. Railway will detect the `backend/` subdirectory — you must tell it the root:
   - Go to **Service → Settings → Source**
   - Set **Root Directory** to `backend`
5. Click **Deploy**

> Railway reads `backend/railway.toml` and `backend/nixpacks.toml` automatically.
> Nixpacks installs `libGL` and `glib` (required by OpenCV) before running `pip install`.

### Step 3 — Set Environment Variables

In Railway: **Service → Variables → Add Variable**

Add every key from `.env.example`. The most critical ones:

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API → anon key |
| `SUPABASE_SERVICE_KEY` | Supabase → Settings → API → service_role key |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay Dashboard → Settings → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks → Secret |
| `TWILIO_ACCOUNT_SID` | Twilio Console → Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console → Account Info |
| `TWILIO_WHATSAPP_FROM` | `whatsapp:+14155238886` (sandbox) or your approved number |
| `RESEND_API_KEY` | Resend Dashboard → API Keys |
| `RESEND_FROM_EMAIL` | `noreply@gigasouk.com` (after domain verification) |
| `SHIPROCKET_EMAIL` | Your Shiprocket login email |
| `SHIPROCKET_PASSWORD` | Your Shiprocket login password |
| `APP_URL` | Your frontend URL e.g. `https://gigasouk.com` |
| `ALLOWED_ORIGINS` | `https://gigasouk.com,https://www.gigasouk.com` |

> **Never** paste secrets into `railway.toml`. Always use the Variables panel.

### Step 4 — Configure Razorpay Webhook

1. Razorpay Dashboard → **Settings → Webhooks → Add New Webhook**
2. **URL**: `https://your-railway-service.up.railway.app/webhooks/razorpay`
3. **Events to enable**: `payment.captured`, `refund.processed`
4. Copy the **Webhook Secret** → paste it into your Railway env as `RAZORPAY_WEBHOOK_SECRET`

### Step 5 — Configure Shiprocket Webhook

1. Shiprocket Dashboard → **Settings → Webhooks**
2. **URL**: `https://your-railway-service.up.railway.app/webhooks/shiprocket`
3. Enable delivery status events

### Step 6 — Verify Deployment

After Railway deploys, open:

| URL | Expected result |
|---|---|
| `https://your-service.up.railway.app/` | `{"message":"GigaSouk API is live","docs":"/docs"}` |
| `https://your-service.up.railway.app/health` | `{"status":"ok","platform":"gigasouk","version":"2.0.0"}` |
| `https://your-service.up.railway.app/health/jobs` | JSON list of 3 scheduled background jobs |
| `https://your-service.up.railway.app/docs` | Swagger UI with all endpoints |

### Step 7 — Set Frontend API URL

In your frontend (Vercel/Netlify), add:

```
NEXT_PUBLIC_API_URL=https://your-service.up.railway.app
```

---

## Option B — Render

### Step 1 — Push to GitHub

```bash
git add .
git commit -m "chore: add render deployment config"
git push origin main
```

### Step 2 — Create a Render Service

#### Option B-1: Using the Blueprint (recommended)

1. Go to [render.com](https://render.com) → **New → Blueprint**
2. Connect your GitHub repo
3. Render reads `backend/render.yaml` automatically and creates the service
4. Proceed to Step 3 to add secrets

#### Option B-2: Manual Setup

1. **New → Web Service**
2. Connect your GitHub repo
3. Fill in:

| Field | Value |
|---|---|
| **Name** | `gigasouk-api` |
| **Region** | Singapore (closest to India) |
| **Root Directory** | `backend` |
| **Runtime** | Python 3 |
| **Build Command** | `apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0 && pip install --upgrade pip && pip install -r requirements.txt` |
| **Start Command** | `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1 --log-level info --timeout-keep-alive 75` |
| **Health Check Path** | `/health` |

> The `apt-get` install step is required for OpenCV (`cv2`) to work on Render's Linux containers.

### Step 3 — Set Environment Variables

**Service → Environment → Add Environment Variable**

Add the same variables as the Railway table above.

> Variables marked `sync: false` in `render.yaml` will appear as empty placeholders —
> click each one and paste the real value.

### Step 4 — Configure Webhooks

Same as Railway Steps 4 and 5, but use your Render URL:

```
https://gigasouk-api.onrender.com/webhooks/razorpay
https://gigasouk-api.onrender.com/webhooks/shiprocket
```

### Step 5 — Verify Deployment

Same health check URLs as Railway, substituting your Render domain.

### Step 6 — Upgrade Plan (avoid spin-down)

Render's free **Starter** plan spins down after 15 minutes of inactivity.
The first request after a spin-down takes ~30 seconds to boot.

For production, upgrade to the **Standard** plan ($7/mo) to keep the service always-on.

---

## Common Issues

### `cv2` ImportError on deploy

**Symptom**: `ImportError: libGL.so.1: cannot open shared object file`

**Fix (Railway)**: Confirm `backend/nixpacks.toml` contains `nixPkgs = ["libGL", "glib"]`.

**Fix (Render)**: Confirm the Build Command includes:
```
apt-get update && apt-get install -y libgl1-mesa-glx libglib2.0-0
```

### Health check fails / deployment rolls back

**Symptom**: Railway/Render marks the deploy as failed after 30 seconds.

**Checks**:
1. Confirm `SUPABASE_URL` is set (the app boots fine without it but the `/health` endpoint response is still `200 OK`)
2. View the deploy logs in Railway/Render for the actual Python error
3. Confirm the start command binds to `0.0.0.0` and reads `$PORT`

### CORS errors in browser

**Symptom**: `Access-Control-Allow-Origin` blocked in browser console.

**Fix**: Set `ALLOWED_ORIGINS` in your env vars to your exact frontend URL:
```
ALLOWED_ORIGINS=https://gigasouk.com,https://www.gigasouk.com
```
No trailing slash. No wildcard in production.

### Duplicate notifications / duplicate DB writes

**Symptom**: Every order gets two emails, two WhatsApp messages, or escrow is released twice.

**Root cause**: You scaled to 2+ workers while APScheduler is still running inside the uvicorn process.

**Fix**: Keep `--workers 1` in the start command until the scheduler is moved to a separate Railway/Render service.

### Shiprocket 401 / authentication failure

**Symptom**: Shipments fail to create. Logs show `Shiprocket login failed (401)`.

**Fix**: Confirm `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD` are the credentials you use to log in to the Shiprocket dashboard, not an API key.

---

## Environment Variables Reference

Full list with all required and optional variables:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `SUPABASE_URL` | ✅ | — | `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | ✅ | — | Public anon key |
| `SUPABASE_SERVICE_KEY` | ✅ | — | **Secret** — server only |
| `RAZORPAY_KEY_ID` | ✅ | — | `rzp_test_...` or `rzp_live_...` |
| `RAZORPAY_KEY_SECRET` | ✅ | — | **Secret** |
| `RAZORPAY_ROUTE_ACCOUNT` | ✅ | — | Linked account ID |
| `RAZORPAY_WEBHOOK_SECRET` | ✅ | — | **Secret** — for HMAC verification |
| `SHIPROCKET_EMAIL` | ✅ | — | Login email |
| `SHIPROCKET_PASSWORD` | ✅ | — | **Secret** |
| `TWILIO_ACCOUNT_SID` | ✅ | — | Starts with `AC` |
| `TWILIO_AUTH_TOKEN` | ✅ | — | **Secret** |
| `TWILIO_WHATSAPP_FROM` | ✅ | `whatsapp:+14155238886` | Sandbox or approved number |
| `RESEND_API_KEY` | ✅ | — | Starts with `re_` |
| `RESEND_FROM_EMAIL` | ✅ | `noreply@gigasouk.com` | Must be verified on Resend |
| `APP_URL` | ✅ | `https://gigasouk.com` | Frontend URL (used in notification links) |
| `ALLOWED_ORIGINS` | ✅ | `https://gigasouk.com,...` | Comma-separated frontend origins |
| `GOOGLE_MAPS_API_KEY` | ⬜ | — | Optional geocoding fallback |
| `QC_SCALE_MM_PER_PX` | ⬜ | `0.1` | mm per pixel for QC engine |
| `QC_TOLERANCE_MM` | ⬜ | `0.5` | Max allowed deviation in mm |

---

## Architecture Note — 1 Worker

Both config files pin `--workers 1`. This is **intentional and required**.

APScheduler runs **inside the uvicorn process**. With multiple workers:
- Each worker spawns its own scheduler instance
- Every scheduled job runs N times (once per worker)
- Result: duplicate emergency broadcasts, duplicate notifications, duplicate DB writes

**To scale horizontally in future:**
1. Move `services/scheduler.py` to a dedicated Railway/Render cron service
2. Then increase workers freely in the main web service

---

*Last updated: 2026-04-30*
