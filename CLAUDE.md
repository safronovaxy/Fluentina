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
docker compose up -d db          # Postgres 16 on localhost:55432 (repo root)
```
Local-only, isolated from the shared production Cloud SQL instance — see
`CONTRIBUTING.md` and Architecture Decisions ADR-1/ADR-10 on Confluence.

### Deployment (CI/CD via GitHub Actions)

> ⚠️ **Merging does not deploy.** Pushing or merging to `main` runs `ci.yml`
> and nothing else. `main` is kept always-releasable; shipping it is a separate,
> deliberate action (Ways of Working §6). This changed in the CI/CD rework —
> it used to auto-deploy on every push, and a lot of older notes still say so.

```bash
git push origin main                        # Runs ci.yml only. Does NOT deploy.
gh workflow run deploy-website.yml --ref main   # Deploy the website, deliberately
gh workflow run deploy-cms.yml --ref main       # Deploy the CMS, deliberately
gh run list --limit 5                       # Check run status
gh run view <run-id>                        # Watch a specific run
```

`gh workflow run` is now the **only** way to deploy — both deploy workflows are
`workflow_dispatch` only. There is no push trigger left to race against, so the
old "never run it after a push" warning no longer applies.

Each deploy workflow starts with a `verify-ci` job that refuses to deploy a
commit unless `ci.yml` has already recorded a successful run for that exact SHA.
A commit that never passed CI cannot be shipped, whoever triggers it.

> ℹ️ **Never monitor GitHub Actions runs.** After triggering a deploy, stop — the
> user monitors deployment status themselves and will report the outcome if action
> is needed.

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
**SSL:** `writewise-ssl-cert-v2` (auto-renewal, covers the three `write-wise.com`
names only — a managed cert's domain list is immutable, so `fluentina.com` needs
a **new** certificate provisioned before DNS cutover; see `CUSTOM_DOMAIN_SETUP.md`)

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

## Delivery Workflow — Standing Authorisations

Granted by Irina, 2026-09-28. These are standing: act on them without asking
each time. They implement Ways of Working §3-§5 rather than replacing it —
where this section is silent, that page governs.

**Branch naming.** One story per branch, named for the ticket:
`feature/KAN-NN-short-slug` (e.g. `feature/KAN-16-ai-grading`). This is the
repo convention and applies even when a session is otherwise told to work on
a generated branch name. Unrelated chores go on their own branch, never
folded into a story's branch, so a story's PR contains only that story.

**Open the PR without asking.** Once a story is implemented — code and its
tests together, the fast checks run — push the branch and open the PR against
`main`. Do not wait for permission. Reference the ticket in the title
(`KAN-NN: ...`). State plainly in the body what was verified and how, what was
deliberately left out, and anything that still needs a human (secrets, cloud
resources, a decision the story escalates). An unrun suite is said to be
unrun; never imply coverage that does not exist.

**Move the ticket to *In Review* without asking.** On PR open, transition the
Jira ticket. Same for *In Progress* when work starts, and *Done* on merge.
Jira updates need no confirmation (Ways of Working §7).

**Run both reviews without asking.** Solution Architect and Test Lead review
in parallel, every PR. Address all findings in ONE consolidated revision, not
a round trip per reviewer. Disagreeing with a finding is fine — say why rather
than silently complying or silently ignoring it.

**Escalate to Irina only when a 4th review round is triggered** by either the
Solution Architect or the Test Lead. Three rounds of back-and-forth is the
budget (Ways of Working §4); if agreement has not been reached by then, stop
looping and take it to Irina with the disagreement stated, rather than
continuing indefinitely. Rounds 1-3 are handled autonomously.

**Merge without asking once the review has actually passed.** All four Ways of
Working §5 criteria must hold: Solution Architect approved, Test Lead approved,
CI green, and the story's acceptance criteria demonstrably met. Then merge, and
move the ticket to *Done*. "CI green" means a real CI run on the PR's current
head — not local checks standing in for it, and not a green run on an earlier
commit. Local checks are never a substitute, particularly where they could not
run at all: a browser suite that no local environment could execute is unrun,
not passed, and CI is its first real signal.

If any of the four is missing, do not merge — say which one and what it needs.
An approval conditional on a change is not an approval until that change is
pushed. Merging is still not deploying: `main` is kept releasable, and shipping
is a separate deliberate `workflow_dispatch` (see the Deployment section).

**Still needs Irina, regardless of the above:**

- Deploying. Always a separate, deliberate `workflow_dispatch` — see the
  Deployment section above, and never assume a merge deployed anything.
- Force-pushing or rewriting published history, on any branch.
- Scope, architecture, or security trade-offs the stories do not already
  settle; and any new Architecture Decision, which goes on the Confluence
  Architecture Decisions page.
- Confluence edits (BRD, architecture, strategy pages) — reviewed with Irina
  before publishing. Jira is the exception, per above.

## Do NOT

- Commit secrets or API keys to the repo
- Run `npm install` at root (no root package.json — run inside `cms/` or `website/`)
- Modify `dist/` directly (build output, gitignored)
- Use `node_modules/` paths for anything
- Assume a merge to `main` deployed anything — it does not, and has not since the CI/CD rework. Deploys are manual `workflow_dispatch` only (see Deployment section above)
- Wait for permission to open a PR, or to move a Jira ticket — both are standing authorisations (see Delivery Workflow above)
- Merge on a green CI run from an earlier commit, on local checks standing in for CI, or on an approval that was conditional on a change not yet pushed
- Fold an unrelated chore into a story's branch — it belongs on its own branch, so the story's PR stays reviewable
