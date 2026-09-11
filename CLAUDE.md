# Fluentina Website — Claude Code Guide

## Project Overview

Marketing website + headless CMS for Fluentina (German language learning SaaS).
- **Domain**: fluentina.com | cms.fluentina.com | app.fluentina.com
- **GCP Project**: writewise-468912 | Region: europe-west10
- **GitHub**: https://github.com/safronovaxy/Fluentina

## Structure

```
/
├── website/          # React 18 + Vite 5 + TypeScript + Tailwind + shadcn/ui
├── cms/              # Strapi v5 + PostgreSQL + Node.js 20
└── .github/workflows/
    ├── deploy-website.yml
    └── deploy-cms.yml
```

## Key Commands

### Website
```bash
cd website && npm run dev        # Dev server (localhost:3000, Next.js)
cd website && npm run build      # Production build
cd website && npm run lint       # ESLint
cd website && npm run typecheck  # tsc --noEmit
cd website && npm run test       # Vitest unit/integration tests
cd website && npm run test:e2e   # Playwright e2e
```

### CMS
```bash
cd cms && npm run develop        # Dev server with SQLite (localhost:1337/admin)
cd cms && npm run build          # Production build
```

### Local Postgres (product backend, guest essay flow)
```bash
docker compose up -d db          # Postgres 16 on localhost:5432 (repo root)
```
Local-only, isolated from the shared production Cloud SQL instance — see
`CONTRIBUTING.md` and Architecture Decisions ADR-1/ADR-10 on Confluence.

### Deployment (CI/CD via GitHub Actions)
```bash
git push origin main             # Auto-deploys changed service
gh run list --limit 5            # Check deployment status
gh run view <run-id>             # Watch a specific run
```

> ⚠️ **NEVER run `gh workflow run` after a `git push origin main`.**
> Both workflows trigger automatically on every push to `main`.
> Running `gh workflow run` on top of an already-triggered push causes a **concurrent
> double deployment** which races on the same Cloud Run revision and **fails**.
> Only use `gh workflow run` when you need to re-deploy **without** a new commit
> (e.g. to pick up a Secret Manager change), and only when no push-triggered run
> is already in progress.
>
> ℹ️ **Never monitor GitHub Actions runs.** After pushing, stop — the user monitors
> deployment status themselves and will report the outcome if action is needed.

### Logs & Monitoring
```bash
# CMS logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=writewise-cms" --project=writewise-468912 --limit=50

# Website logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=writewise-website" --project=writewise-468912 --limit=50
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15 (App Router), React 18, TypeScript, Tailwind CSS 3, shadcn/ui (Radix) |
| Forms | React Hook Form + Zod |
| Data fetching | TanStack React Query |
| CMS | Strapi v5 |
| Database | PostgreSQL (Cloud SQL) — schema: `cms` |
| Storage | Google Cloud Storage (strapi-provider-upload-google-cloud-storage) |
| Email | Mailjet (node-mailjet) |
| Payments | Stripe |
| Container | Docker + Cloud Run (europe-west10) |
| CI/CD | GitHub Actions |
| Security | Google Cloud Armor WAF + Strapi rate-limiting middleware |

## Infrastructure

**Cloud Run Services:**
- `writewise-website`: 0-5 instances, 1 CPU, 512Mi, port 8080 (nginx)
- `writewise-cms`: 0-2 instances, 1 CPU, 512Mi, port 1337

**Load Balancer:** Static IP `34.160.140.247`
**SSL:** `writewise-ssl-cert-v2` (auto-renewal, covers all 3 domains)

**Secrets (all in Google Secret Manager):**
- `db-password`, `app-keys`, `api-token-salt`, `admin-jwt-secret`, `transfer-token-salt`, `jwt-secret`
- `mailjet-api-key`, `mailjet-secret-key`
- `stripe-secret-key`, `stripe-publishable-key`
- `gcs-service-account` (mounted as file at `/secrets/gcs-service-account`)

## CMS Content Types

`BlogPost`, `Feature`, `Testimonial`, `Resource`, `PricingPlan`, `Page`, `Contact`, `FAQ`

## Important File Paths

| Purpose | Path |
|---------|------|
| CORS + middleware config | `cms/config/middlewares.ts` |
| Rate limiting middleware | `cms/src/middlewares/rate-limit.ts` |
| GCS storage plugin | `cms/config/plugins.ts` |
| Database config | `cms/config/database.ts` |
| Next.js config | `website/next.config.ts` |
| Pricing page (unlinked from nav — ADR-8) | `website/src/page-components/Pricing.tsx` |
| Contact page | `website/src/page-components/Contact.tsx` |
| Local dev Postgres | `docker-compose.yml` (repo root) |

## Website Build-Time Env Vars (Vite)

These are baked in at build time (Docker build args in `deploy-website.yml`,
set from GitHub Secrets):
- `NEXT_PUBLIC_STRAPI_URL` — CMS Cloud Run URL
- `NEXT_PUBLIC_APP_URL` — https://fluentina.com
- `NEXT_PUBLIC_API_URL` — https://app.fluentina.com
- `NEXT_PUBLIC_STRIPE_PUBLIC_KEY`
- `NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY`

See `website/.env.example` for local development.

## Security Architecture

**Rate limits (Strapi middleware):**
- Login routes: 5 req/min per IP
- Admin routes: 200 req/min per IP
- API routes: 100 req/min per IP

**Cloud Armor rules:**
- Rule 1000: Rate-based ban (100 req/min → 10min ban)
- Rule 2000: SQL injection (sqli-v33-stable)
- Rule 3000: XSS (xss-v33-stable)
- Rule 4000: LFI (lfi-v33-stable)

**CORS whitelist** (cms/config/middlewares.ts):
- localhost:8081, localhost:5173
- https://fluentina.com, https://www.fluentina.com
- Cloud Run service URLs

## Blog Content

Blog posts use **GitHub Flavored Markdown (GFM)**.
Rendered with `react-markdown` + `remark-gfm` + custom Tailwind Typography components.
Images: Upload to Strapi media library → GCS → reference URL in markdown.

## Coding Conventions

- TypeScript strict mode on both website and CMS
- ESLint 9 on website
- shadcn/ui components in `website/src/components/ui/`
- Custom hooks in `website/src/hooks/`
- Strapi API types in `website/src/types/`

## Common Issues & Fixes

| Issue | Fix |
|-------|-----|
| CMS admin blocked by rate limit | It's 200 req/min now; if hit, wait 1 min |
| Website shows old content | Hard refresh; Vite env vars are build-time |
| GCS images not in Strapi admin | CSP allows `storage.googleapis.com` |
| Pricing not showing | Check `VITE_STRIPE_PUBLIC_KEY` is live key |
| DNS issues | All domains → `34.160.140.247` |

## Do NOT

- Commit secrets or API keys to the repo
- Run `npm install` at root (no root package.json — run inside `cms/` or `website/`)
- Modify `dist/` directly (build output, gitignored)
- Use `node_modules/` paths for anything
- Run `gh workflow run deploy-*.yml` immediately after a `git push origin main` — the push already triggers both workflows; a manual trigger on top causes a concurrent double deployment that fails (see Deployment section above)
