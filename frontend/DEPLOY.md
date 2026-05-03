# GigaSouk Frontend — Vercel

## 1. Create project

1. [vercel.com](https://vercel.com) → **Add New… → Project**
2. Import the **Gigasouk** Git repository
3. Under **Configure Project**:
   - **Root Directory**: `frontend` (required if the repo contains `backend/` too)
   - Framework Preset: **Next.js** (auto-detected)
4. Deploy

## 2. Environment variables

In **Project → Settings → Environment Variables**, add for **Production** (and **Preview** if you test PRs):

| Name | Value |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `NEXT_PUBLIC_API_URL` | Your Railway API URL, e.g. `https://your-service.up.railway.app` (no trailing slash) |
| `NEXT_PUBLIC_GOOGLE_MAPS_KEY` | Google Maps JavaScript API key (Places / Maps as needed) |

Redeploy after changing variables (`NEXT_PUBLIC_*` are inlined at build time).

## 3. Supabase Auth redirects

Supabase Dashboard → **Authentication → URL configuration**:

- **Site URL**: your Vercel production URL (e.g. `https://your-app.vercel.app`)
- **Redirect URLs**: add the same URL plus `http://localhost:3000` for local dev, and wildcard `https://your-app.vercel.app/**` if prompted.

## 4. Backend CORS (Railway)

On the API service, set `ALLOWED_ORIGINS` to include your Vercel production URL.

For **preview deployments** (`*.vercel.app`), either:

- Add each preview URL manually, or  
- Set `ALLOWED_ORIGIN_REGEX` to `^https://.*\.vercel\.app$` (see `backend/.env.example`).

## 5. Production smoke test

- Open the deployed homepage and catalog
- Sign in as each role and confirm dashboards load (`NEXT_PUBLIC_API_URL` must match a live Railway backend)

See also: [backend/DEPLOY.md](../backend/DEPLOY.md) for Railway API deploy and webhooks.
