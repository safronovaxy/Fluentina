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

### Test tiers — smoke and full

Running everything on every push is slow, so there are two tiers. **Only stage 1
exists today** — read "What is live" before relying on anything below.

Sizes, measured at `aa58e70`: Playwright 526 tests (`--list --grep-invert "@cms"`:
202 in `chromium-desktop`, 108 in each of the other three projects); Vitest 1,111
literal `it()`/`test()` calls across 77 files under `website/src/` (a static count —
the suite needs Postgres, so it was not run-counted — plus 42 `.each` tables that
expand to more). Where `ci.yml` and `CONTRIBUTING.md` mention 470 Playwright tests, that
is the KAN-33-era figure and both now say so next to the current one. A `website` run measured
**8m13s**, of which ~160s is prologue any tier pays (setup, containers, `npm ci`,
lint, typecheck, migrate, drift check, build, Playwright install, TLS, app start).

**What is live (stage 1):**

| Tier | `ci.yml` job | Runs | What | Gates merge? |
|------|--------------|------|------|--------------|
| **Full** | `Website — lint, typecheck, test, build, e2e` | every PR push, every push to `main`, daily schedule, manual dispatch | everything: all unit tests, all four Playwright projects, both locales | **Intended to be the required check** (see below: the setting is out of repo, owner Irina, unconfirmed) |
| **Smoke** | `Website smoke — selected tests, chromium-desktop only` | PR pushes only | lint, typecheck, migrations always; plus the unit tests and e2e specs the diff selects, `chromium-desktop` only | **No** |

Smoke is an *additional*, faster signal. It does not replace the full job on
PRs, so there is no wall-clock saving on the merge gate yet — stage 1 costs
extra runner minutes and buys earlier feedback.

**Not live (stage 2):** making the full job conditional on PRs, so the minutes
are actually saved. It needs a branch-protection change that needs repo
Administration, and cannot be done by flipping an `if:`: GitHub reports a job
skipped by `if:` as *success* to a required check, so skipping the full job
without first changing what is required would silently delete the merge gate.
Until that change is made and a follow-up PR lands, the full job runs on every PR.

> ⚠️ **Smoke is not a merge gate.** "CI green" in Ways of Working §5 means the
> **full** job, on the PR's current head. A green smoke run is not a substitute,
> and it is not a merge signal even when it finishes first.

**Pushes to `main` always run full**, and the deploy gate checks for it. `verify-ci`
in `deploy-website.yml` and `deploy-cms.yml` no longer accepts "some successful
`ci.yml` run": it requires the full job, by name, to have succeeded in a `push` or
`workflow_dispatch` run on `main` for that SHA. A smoke run cannot satisfy it, and
neither can the daily scheduled run (its event is neither).

The full job's name is written in **four** places, and a test can see two of them.
`website/scripts/ci-workflows.test.ts` pins `ci.yml` against the `FULL_JOB` constant
in both `verify-ci` scripts, and fails if those disagree. **Branch protection is the
fourth copy, lives in repo settings, and no test in this repo can read it.** Renaming
the job therefore needs a manual, Administration-scoped change to the required check
in the same change; nothing will tell you if it is missed, and the failure mode is a
gate that requires a check name nothing reports any more, so it is either gone or
permanently stuck. As a latch, `.github/required-checks.json` records the names we
intend to require and the test asserts `ci.yml` agrees with it, so a rename has to
touch the file that says so. That proves someone was told, not that the setting was
changed.

What is actually known about that setting: it was **not** configured from any
session here (the automation token has no Administration scope, see
`deploy-website.yml`'s header), so "the full job is the required check" is the
*intended* configuration, not a recorded fact. The one piece of first-hand evidence
is that a merge of PR #33 was refused with *"2 of 2 required status checks are
expected"*, so two required checks exist — almost certainly the website and CMS job
names, but that is inference. Irina has been asked for the exact configured names
(KAN-58); until she answers, treat it as unconfirmed.

**How smoke chooses tests.** The selection is a script, not inline shell:
`website/scripts/test-tiers.ts` (the map and the rules, pure),
`website/scripts/select-tests.ts` (the CLI the job calls), tests in
`website/scripts/test-tiers.test.ts`. It happens *inside* a job that always starts;
`ci.yml` has no `paths:` filter and must not get one (see its own comments for the
two incidents). The rules, in order:

1. **The run-everything set is checked first and is absolute.** If any changed
   path matches it, everything runs — even when an area also claims that path.
2. **Any changed path that matches no area runs everything.** The map is
   hand-maintained and will have gaps; a gap must cost minutes, never coverage.
   There is deliberately no "ignore" list.
3. **An empty diff, or a diff the script cannot compute, runs everything.**
4. Otherwise, the union of the matched areas' unit tests and e2e specs.

All paths in the map are full repo-relative paths (`website/src/...`), because
that is what `git diff --name-only` emits.

The run-everything set: `.github/**`, `docker-compose.yml`, `website/drizzle/**`,
`website/drizzle.config.ts`, `website/src/lib/db/schema.ts`,
`website/src/lib/contracts/**`, `website/src/middleware.ts`,
`website/src/test/**` and `website/tests/helpers/**` (loaded by every test),
`website/vitest.config.ts`, `website/playwright.config.ts`, `website/package.json`,
`website/package-lock.json`, `website/tsconfig.json`, `website/eslint.config.js`,
`website/next.config.ts`, `website/tailwind.config.ts`, `website/postcss.config.js`,
`website/src/components/ui/**`, `website/scripts/**`.

**Areas** are named in `test-tiers.ts`, which is the source of truth for their
globs — not repeated here, because a second copy in prose is how the first
version of this section came to describe paths that do not exist. Each area's
unit tests are the test files its globs match (unit tests sit next to their
source); its e2e specs are listed by name, because Playwright's `testDir` is
`website/tests/` and no path glob can find them.

| Area | Covers | e2e specs |
|------|--------|-----------|
| `guest-funnel` | guest components, `[locale]` pages, essays API, status/elapsed hooks | essay-entry, word-count, grading-preview, guest-flow, guest-flow-i18n, guest-session, registration |
| `grading` | `lib/domain/grading`, grading routes and jobs | grading-preview, essay-entry, registration |
| `auth` | sessions, login, registration, ownership, session cookies | guest-session, registration |
| `api-edge` | every route handler; same-origin, client-ip, rate-limit, request-body, rejection-response | essay-entry, guest-session, registration |
| `data` | `lib/db/**` (not `schema.ts`) | essay-entry, guest-session, registration |
| `i18n` | messages, `i18n/**`, `IntlProvider` | guest-flow-i18n, guest-flow, essay-entry, registration |
| `marketing` | `(marketing)` pages, `page-components`, Strapi, SEO, sitemap | blog, contact-form, navigation, no-console-errors, redirects, routing, seo, sitemap |
| `placement-test` | placement-test components and pages | placement-test, no-console-errors |
| `shell` | layout, providers, global CSS, shared `lib` helpers | navigation, no-console-errors, guest-flow |
| `cms` | `cms/**` | none — on purpose |

`cms/**` selects no website test, and that does **not** mean something else covers
it. Nothing does: `cms/package.json` has no test script at all and no `@cms` spec
runs in CI (there is no CMS in the job), so the `cms` job's `npm ci` + `strapi build`
(every event, tiered or not) is the entire signal that exists for `cms/**`
anywhere. The CORS whitelist and the rate-limit values in `cms/config/middlewares.ts`
and `cms/src/middlewares/rate-limit.ts` are asserted by no test; both are
security-relevant (BR-1.8's per-IP backstop lives CMS-side). This PR documents the
gap; closing it is separate work.

**What the map does not know:** the import graph. `lib/db/**` is used by most of
the domain layer and the map does not follow that; nor does it see a change whose
blast radius is wider than its path. That is the Test Lead's per-story nomination
(below). And smoke runs neither WebKit nor the mobile projects, by design.

**Keeping the map honest.** `test-tiers.test.ts` runs against the real tree and
fails if a spec under `website/tests/` is named by no area, a unit test is
reachable from no area, a glob matches no tracked file, or editing a module
would not select its own co-located test. A story that adds a new area or a new
spec adds its map entry in the same PR — the test will say so.

**The Test Lead nominates for smoke, as advice.** On each story, the Test Lead
notes in the review anything the default selection misses for that diff. The
nomination is **advisory**: it is recorded in the review, and a human acts on it
by editing the map when they next touch it. No file the workflow reads carries
per-PR nominations. See `.claude/agents/test-lead.md`.

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

**The Test Lead flags what smoke would miss, as advice.** Once the smoke tier is
on `main` (it is, from the PR that introduced `website/scripts/test-tiers.ts`),
the Test Lead notes in its review anything the default selection would miss for
that diff — or says in one line that the default is adequate. It is advisory: it
is recorded in the review, it is not a veto, and the full job still gates merge.
The one nomination with a consequence is a map gap — a story that adds an area or
a spec adds its entry in `test-tiers.ts` in the same PR. See Test tiers above and
`.claude/agents/test-lead.md`.

**Escalate to Irina only when a 5th review round is triggered** by either the
Solution Architect or the Test Lead. Four rounds of back-and-forth is the
budget (Ways of Working §4, raised from three by Irina on 2026-09-29); if
agreement has not been reached by then, stop looping and take it to Irina with
the disagreement stated, rather than continuing indefinitely. Rounds 1-4 are
handled autonomously.

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

**Deploy without asking.** Trigger it deliberately, as its own action — a merge
deploys nothing (see the Deployment section). `gh workflow run
deploy-website.yml --ref main` / `deploy-cms.yml`. Then stop: do not monitor the
run, Irina watches deployment status and reports back. `verify-ci` refuses any
commit without a successful `ci.yml` run for that exact SHA, so a commit that
never passed CI cannot ship.

One judgement stays with the deployer rather than being waved through: **do not
deploy a change whose required secrets or cloud resources do not exist yet.**
Shipping code that reads a missing Secret Manager entry, or enqueues to a queue
nobody created, breaks the feature in production while looking like a successful
deploy. That is a blocker to report, not a decision to take.

**Keep Jira and Confluence current without asking.** Jira: transitions, new
stories, acceptance-criteria edits, comments recording what a review found.
Confluence: the BRD, Architecture Decisions, Test Strategy and this process's
own pages — including adding an ADR when an architecture decision surfaces
during implementation. Write what was actually decided and why, and attribute a
decision to whoever made it; never record agreement that was not given.

**Escalate only decisions.** The test is not "is this consequential" but "does
this need a judgement that is not mine to make":

- A genuine product, scope, architecture or security trade-off that the stories
  and ADRs do not already settle — including one surfaced by a reviewer. Where
  an agreed decision already covers it, follow the decision.
- A 5th review round, per above.
- A blocker only Irina can clear: a secret, a cloud resource, IAM, DNS, a
  third-party account, a legal or DPA question.
- Anything irreversible or destructive: force-pushing, rewriting published
  history, deleting a branch or data, anything that discards someone else's
  work.

Where different readings of an ambiguous request would lead to materially
different work, ask. Where they would not, pick the sensible one, say which, and
carry on. Do not ask for permission to do the work; do ask when the work itself
contains a decision.

## Do NOT

- Commit secrets or API keys to the repo
- Run `npm install` at root (no root package.json — run inside `cms/` or `website/`)
- Modify `dist/` directly (build output, gitignored)
- Use `node_modules/` paths for anything
- Assume a merge to `main` deployed anything — it does not, and has not since the CI/CD rework. Deploys are manual `workflow_dispatch` only (see Deployment section above)
- Wait for permission to open a PR, move a Jira ticket, update Confluence, merge a passed review, or deploy — all are standing authorisations (see Delivery Workflow above)
- Deploy a change whose secrets or cloud resources do not exist yet — report it as a blocker instead
- Monitor a GitHub Actions run after triggering a deploy (see Deployment section)
- Merge on a green CI run from an earlier commit, on local checks standing in for CI, or on an approval that was conditional on a change not yet pushed
- Merge on a green **smoke** run — smoke is for iteration speed; the merge gate is the full job on the PR's current head (see Test tiers)
- Fold an unrelated chore into a story's branch — it belongs on its own branch, so the story's PR stays reviewable
