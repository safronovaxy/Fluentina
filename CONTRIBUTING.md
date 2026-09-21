# Contributing to Fluentina

This is a condensed, practical version of the
[Ways of Working & Delivery Model](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25526274)
page on Confluence (space **MFS**) — that page is the source of truth; read it
for the full reasoning. This file exists so anyone working directly in the
code has the process at hand without leaving the repo.

## Roles

| Role | Owns |
| --- | --- |
| Product Owner | Backlog, prioritization, acceptance criteria, Jira/BRD sync |
| Solution Architect | Technical direction, architecture decisions, design/performance/security review |
| Senior Developer | Implementation — code and its tests, together, per Jira story |
| Test Lead | Test strategy, coverage review, CI pipeline honesty |
| Irina (CTO) | Final call on scope/architecture/security trade-offs; personally owns the pre-launch AI-grading sanity check |

## Backlog

Everything lives in Jira project **KAN**. Stories are labelled `must-have` or
`should-have`, plus a `seq-N` label marking build-dependency order across
epics. Work the backlog in that priority order (must-have first, respecting
`seq-N`) unless the Product Owner has re-sequenced it.

## Development workflow

1. Pick the next story in priority order. Branch from `main`, named after the
   ticket: `feature/KAN-14-essay-entry`.
2. **Implement the code and its tests together, as one unit of work** — tests
   are not a later phase. Acceptance criteria should be directly demonstrated
   by the tests.
3. Open a PR referencing the Jira ticket, and move the ticket to **In Review**.

## Review process

The Solution Architect and Test Lead review the **same PR in parallel** (not
sequentially):

- **Solution Architect:** architecture fit, development/performance/security
  practice — checked against the story's actual acceptance criteria.
- **Test Lead:** test coverage and quality against the
  [Test Strategy](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25427970)
  — right things automated, AI-grading validation approach followed where
  relevant, security/edge cases from the ACs covered.

Address all feedback in **one consolidated revision**, not separate round
trips per reviewer. If agreement isn't reached after **3 rounds**, it goes to
Irina directly rather than looping indefinitely.

## Merge criteria

A PR merges once all of the following are true (the Developer merges it — no
separate merge-approver role):

- Solution Architect has approved
- Test Lead has approved
- CI is green — and a run actually exists. A PR with no `ci.yml` run at all
  satisfies "nothing is red" without having tested anything; that is not green.
- The Jira story's acceptance criteria are demonstrably met

The Jira ticket moves to **Done** on merge.

## CI/CD and deployment

**Merging and deploying are two separate actions.** Merging to `main` keeps it
always releasable but does not itself deploy to production.

- Every PR runs `ci.yml`: install → lint → typecheck → apply database
  migrations → confirm migrations match the schema → Vitest → build →
  Playwright against the locally built app, served through a self-signed
  TLS proxy (`website/scripts/tls-proxy.mjs`) as of KAN-30 — see below.
- **What that covers today is narrower than it sounds, but less narrow than
  it used to be.** The Playwright suite used to be the marketing regression
  suite only, with no funnel specs — KAN-14 added the first one
  (`tests/essay-entry.spec.ts`, guest essay entry end to end), which this
  same round of review also confirmed makes viewport-differential assertions
  of its own, not just piggybacking on two viewport projects. KAN-15 added a
  second: `tests/word-count.spec.ts`, the live word-count guidance/warning/
  block states end to end (`ci.yml`'s own E2E step comment names both).
  Vitest, though,
  is no longer only component tests: KAN-10 added the data-layer integration
  suite (session/essay row-level ownership, the conversion cutover, the
  Postgres major-version guard) that runs against the real `postgres` service
  container defined below, not a mock — that container is genuinely consumed
  now, by roughly twenty tests, and removing it from CI would silently drop
  that whole suite rather than just tidying up an unused fixture.
  `MOCK_GRADING_PROVIDER` remains provisioned ahead of the story that will
  use it and is not consumed by anything yet.
- Specs tagged `@cms` need a reachable Strapi with published content, so CI
  excludes them by tag and they run against a live site via
  `npm run test:e2e:live`. Without that exclusion the suite is red on every PR
  for reasons unrelated to the change under review.
- **WebKit (`webkit-desktop` — Safari's engine) gates every PR as of KAN-30,
  alongside `chromium-desktop`/`chromium-mobile`, not only via
  `npm run test:e2e:live` as before. This is desktop Safari only — Mobile
  Safari has no project and is not covered by this gate**, deliberately
  (round-1 review): the defect this story closes is engine-level and
  identical on both, so desktop coverage closes it; a mobile follow-up is a
  separate ticket. WebKit refuses to store any `Secure` cookie — including
  the guest session's `__Host-`-prefixed one — over a plain HTTP connection,
  even on localhost, so `ci.yml` serves the built app through a throwaway
  self-signed TLS proxy (`website/scripts/tls-proxy.mjs` +
  `generate-tls-cert.sh`) rather than plain HTTP; a self-signed certificate
  is sufficient because Safari stores the cookie over an encrypted
  connection even when the certificate itself is untrusted. A local
  plain-HTTP `npm run test:e2e` run still skips the handful of assertions
  that need the cookie actually stored (each spec documents its own — see
  `tests/guest-session.spec.ts`'s own comment for the underlying probe);
  those skips don't fire in `ci.yml` because it runs through the TLS proxy,
  not plain HTTP — and in `ci.yml` specifically, an unencrypted `BASE_URL`
  is now a hard failure rather than a silent skip (`playwright.config.ts`),
  so that drift can't recur unnoticed.
- `website/src/**/*.typecheck.{ts,tsx}` files (introduced in KAN-27, first
  non-`.tsx` example added in KAN-10) are a third test category alongside
  Vitest and Playwright, with `tsc --noEmit` — the `typecheck` step above —
  as their only runner: they render nothing and assert nothing at runtime,
  only `@ts-expect-error` lines that fail the build if a generic type stops
  rejecting what it should. Neither Vitest's `include` glob nor Playwright's
  `testDir` picks them up on purpose. Anyone narrowing `tsconfig.json`'s
  `include`, or excluding this pattern from it, should know that is the only
  thing exercising these files at all — nothing else in the pipeline would
  catch the regression or even go red.
- `grading-regression.yml` is a **placeholder today — it does not validate
  anything.** It runs on every PR as part of `ci.yml`, finds no
  `test:grading-regression` script, prints a notice saying so, and passes.
  Do not read a passing CI run as evidence that grading output is sound.
  It becomes a real check, calling the live provider against a golden essay
  set, once KAN-4 and KAN-16 land that script. Whether it should then run on
  every PR or only when the prompt template or a `GradingProvider`
  implementation changes is **deliberately undecided** — that choice only has
  a cost (live API spend and time on each run) once the check does real work,
  so it is deferred until then.
- Deployment (`deploy-website.yml` / `deploy-cms.yml`) is a separate,
  deliberate, manually-triggered action gated on `ci.yml` having passed for
  the commit being deployed — not automatic on every merge.

## Local development setup

### Website (Next.js)
```bash
cd website
npm install
cp .env.example .env.local   # fill in as needed
npm run dev                  # http://localhost:3000
```
As of KAN-10, `npm run test` includes a data-layer suite that needs a real
Postgres — start the container below and set `DATABASE_URL` in `.env.local`
first (`npm run db:migrate` to apply migrations), or the suite fails outright
rather than skipping quietly. Both failure modes (no `DATABASE_URL`, or a
database with no schema) throw immediately and say what's missing, so this is
friction on a first run, not a source of false confidence.

### CMS (Strapi)
```bash
cd cms
npm install
npm run develop              # http://localhost:1337/admin (SQLite by default)
```

### Local Postgres (product backend — guest sessions, essays, scores, users)
```bash
docker compose up -d db      # Postgres 16 on localhost:55432, repo root
```
This is a local-only database, completely separate from the shared production
Cloud SQL instance — nothing done locally can touch real guest data. See
`docker-compose.yml` and `website/.env.example` (`DATABASE_URL`).

Anyone — including Irina — can check out `main` and run the whole stack
locally this way.

## Code layering (`website/src`, KAN-10)

Several comments in `website/src` point here for "the layering rule" —
this is that rule, written down once instead of only in code comments and
`eslint.config.js`:

- `lib/contracts` — types, Zod schemas, and dependency-free, isomorphic
  validation rules (e.g. the word-count bounds in `word-count.ts`, shared
  verbatim by the browser and the server so the two can never quietly
  disagree). "Business logic" here means anything that needs a database, an
  `Actor`, or has a side effect — none of which belongs in this layer. A
  rule that's pure, needs nothing of ours to run, and must hold identically
  on both sides of the wire is not that, even though it encodes a product
  rule; it stays here because `lib/domain` is server-only by convention (see
  that layer's own entry below) and this needs to run in the browser too.
  Depends on nothing else of ours: no SQL, no client, no database, no actor,
  no side effects.
- `lib/domain` — business rules (e.g. how a guest session id is generated).
  May call `lib/db` repository functions, never the raw client
  (`lib/db/client`) or the driver/query-builder directly — that bypasses the
  row-level ownership boundary the same way importing the client would.
- `lib/db` — the only place SQL, the Postgres driver (`pg`) and the query
  builder (`drizzle-orm`) exist. Every function that reads or writes an
  owned row (essay, session, score, report) takes the caller's `Actor` and
  enforces ownership through `lib/db/ownership.ts`'s `ownedBy()` — never a
  hand-rolled filter. A deliberate, ownership-bypassing read for a system
  job is named `*Unscoped` so every bypass is findable by grepping that
  string.
- `src/test` — test-only fixtures (e.g. the raw `TRUNCATE` in
  `resetDatabase`). Importable only from test files; production code
  (including `lib/domain`) must never reach it — see the `@/test` group in
  `eslint.config.js`.
- Everything else ("adapters" — routes, components, hooks) imports
  `lib/domain`, never `lib/db`, `pg`, or `drizzle-orm` directly.

`eslint.config.js`'s `no-restricted-imports` blocks enforce all of the above
at lint time; that lint is what "the convention is worthless without these"
(in that file) refers to.

## Decision governance

| Change type | Process |
| --- | --- |
| Jira updates (new stories, ACs, re-prioritization) | Proceed freely |
| Confluence updates (BRD, architecture, strategy docs) | Reviewed with Irina before publishing |
| Routine implementation within agreed architecture/strategy | Standard PR review applies |
| Real architecture decisions surfacing during implementation | Solution Architect adds them to [Architecture Decisions](https://safronov.atlassian.net/wiki/spaces/MFS/pages/24838145) |
| Scope, architecture, or security trade-offs; unresolved after 3 review rounds | Goes to Irina directly |

Full detail, rationale, and the companion Architecture/Test Strategy pages:
see the [Ways of Working & Delivery Model](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25526274)
page on Confluence.
