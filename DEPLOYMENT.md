# Deploying GigaSouk (Railway + Vercel)

| Layer | Platform | Guide |
|-------|-----------|--------|
| API | **Railway** | [backend/DEPLOY.md](backend/DEPLOY.md) — **Option A** |
| Web app | **Vercel** | [frontend/DEPLOY.md](frontend/DEPLOY.md) |

**Order:** Deploy the backend first, copy its public URL, then set `NEXT_PUBLIC_API_URL` on Vercel to that URL.

**CORS:** On Railway, `ALLOWED_ORIGINS` must include your Vercel production origin. For preview builds, use `ALLOWED_ORIGIN_REGEX` (documented in `backend/.env.example`).

**Links in emails:** Set Railway variable `APP_URL` to your **frontend** URL (Vercel), not the API URL.
