# Account setup

Use your **personal** accounts (not FrontierX) for everything. Put secrets straight into `.env.local`, not into chat.

Callback path used below: `/api/auth/callback/google`. `<PROD>` is `movie-mentat.vercel.app`, the stable production domain. Not the per-deployment `movie-mentat-<hash>-…` URLs.

## 1. Neon (Postgres)
1. neon.tech → New project → name `movie-memory`, Postgres 18 (matches local Docker), region **AWS us-east-1** (matches Vercel's default `iad1`).
2. Dashboard → Connect → copy **two** strings:
   - Pooled (host contains `-pooler`) → `DATABASE_URL`. In both strings, change `sslmode=require` to `sslmode=verify-full` (strict certificate checking with the `pg` driver).
   - Direct (pooling off) → `DIRECT_URL` (migrations only)
3. Optional: create a `dev` branch and use its strings locally; keep `main` for production.

## 2. Google OAuth
1. console.cloud.google.com → check the account switcher shows your personal account → New project `movie-memory`.
2. **Google Auth Platform → Get started**: app name, support email, Audience **External**.
3. **Data access**: add only `openid`, `email`, `profile` (non-sensitive, so no verification needed).
4. **Branding**: don't upload a logo. It triggers brand verification.
5. **Clients → Create client → Web application**
   - Authorized JavaScript origins: `http://localhost:3000`, `https://<PROD>`
   - Authorized redirect URIs: `http://localhost:3000/api/auth/callback/google`, `https://<PROD>/api/auth/callback/google`
   - Copy the client ID and secret **immediately**. The secret may only be shown once.
6. **Audience → Publish app** ("In production"). In Testing mode only listed test users can sign in, so reviewers would be locked out.
7. Vercel preview URLs change on every deploy and Google doesn't allow wildcards, so OAuth only works on localhost and `<PROD>`. That's expected.

## 3. Vercel
1. vercel.com → sign in with your **personal** GitHub → Hobby plan.
2. Wait until the repo exists and has been pushed. Then Add New → Project → import it. The framework (Next.js) and pnpm are auto-detected.
3. Settings → Functions → region `iad1`.
4. Settings → Environment Variables (Production): every variable in the table below.
5. Note the production URL (`<PROD>`). Go back to step 2.5 and add it to Google.

## 4. OpenAI
1. platform.openai.com → Settings → Projects → create `movie-memory`.
2. Project → Limits: set a small monthly budget (e.g. $5).
3. Project → API keys → create a key scoped to this project. If offered, use **Restricted** with only model-request permissions.

## 5. TMDB
1. themoviedb.org → sign up → verify email.
2. Settings → API → Create → Developer → accept the terms → fill in the app form (personal or educational project).
3. Copy the **API Read Access Token** (the long v4 bearer token, not the short v3 key).
4. Attribution is required in the UI: the TMDB logo plus "This product uses the TMDB API but is not endorsed or certified by TMDB." (We'll build that in.)

## Environment variables

| Variable | Source | Where |
|---|---|---|
| `DATABASE_URL` | Neon, pooled | local + Vercel |
| `DIRECT_URL` | Neon, direct | local + Vercel (build-time migrations) |
| `GOOGLE_CLIENT_ID` | Google | local + Vercel |
| `GOOGLE_CLIENT_SECRET` | Google | local + Vercel |
| `APP_URL` | `http://localhost:3000` / `https://<PROD>` | local / Vercel |
| `OPENAI_API_KEY` | OpenAI | local + Vercel |
| `TMDB_READ_TOKEN` | TMDB | local + Vercel |

Local tests run against Postgres in Docker, so they need no account.
