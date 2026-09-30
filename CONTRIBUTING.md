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
trips per reviewer. If agreement isn't reached after **4 rounds**, it goes to
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
  That is the **full** job, and it still runs **everything** on every PR push
  and every push to `main`; it is the check that gates merge. Alongside it, PRs
  also get a **smoke** job that runs only the tests the diff selects (chromium
  only). Smoke is an earlier signal, not a gate: a green smoke run is not "CI
  is green" for the merge criteria above. Anything the selection does not
  recognise runs everything. See CLAUDE.md's "Test tiers" section, and note that
  only stage 1 of it exists — the full job is not yet conditional on PRs.
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
  `MOCK_GRADING_PROVIDER` now has a real consumer, as of KAN-16:
  `provider-factory.ts`'s `createGradingProvider()` selects the fake,
  zero-network-call `GradingProvider` whenever it's exactly `"1"` — set for
  the built app in `ci.yml`'s "Start built app"/E2E steps, and separately, at
  the config level (`vitest.config.ts`'s own `test.env`), as the Vitest unit
  suite's default. Deliberately not set for Vitest in `ci.yml` itself: that
  would leave local and CI runs able to diverge again depending on whether a
  developer's own gitignored `.env.local` happens to set it too (KAN-16
  round-1 review, finding 1 — this is exactly what let the unit suite depend
  on a file CI doesn't have, undetected, the first time this story landed).
- Specs tagged `@cms` need a reachable Strapi with published content, so CI
  excludes them by tag and they run against a live site via
  `npm run test:e2e:live`. Without that exclusion the suite is red on every PR
  for reasons unrelated to the change under review.
- **WebKit gates every PR as of KAN-30, both desktop (`webkit-desktop`) and,
  as of KAN-33, mobile (`webkit-mobile`, iPhone 13) — alongside
  `chromium-desktop`/`chromium-mobile`, not only via `npm run test:e2e:live`
  as before.** KAN-30 shipped desktop-only deliberately (round-1 review): the
  cookie-storage defect it closes is engine-level and identical on mobile, so
  desktop coverage closed it for that one thing, and a mobile follow-up was
  scoped out as a separate ticket. KAN-33 is that ticket, and covers what
  desktop coverage could never reach: viewport-differential rendering (the
  guest flow's step-label collapse, `tests/guest-flow.spec.ts`) under a real
  Safari layout engine at a real phone width, not Chromium's — the only
  mobile signal in the suite before this was `chromium-mobile`, a different
  engine entirely. WebKit refuses to store any `Secure` cookie — including
  the guest session's `__Host-`-prefixed one — over a plain HTTP connection,
  even on localhost, so `ci.yml` serves the built app through a throwaway
  self-signed TLS proxy (`website/scripts/tls-proxy.mjs` +
  `generate-tls-cert.sh`) rather than plain HTTP; a self-signed certificate
  is sufficient because Safari stores the cookie over an encrypted
  connection even when the certificate itself is untrusted. A local
  plain-HTTP `npm run test:e2e` run still skips the handful of assertions
  that need the cookie actually stored (each spec documents its own — see
  `tests/guest-session.spec.ts`'s own comment for the underlying probe, and
  `tests/helpers/webkit.ts` for the shared `browserName`-derived predicate
  both WebKit projects' skips key off, not a project name); those skips
  don't fire in `ci.yml` because it runs through the TLS proxy, not plain
  HTTP — and in `ci.yml` specifically, an unencrypted `BASE_URL` is now a
  hard failure rather than a silent skip (`playwright.config.ts`), so that
  drift can't recur unnoticed.
  KAN-33 also asserted, for the first time on any project, that the guest
  session cookie's 30-day `maxAge` actually survives the browser round-trip
  rather than being silently shortened (`tests/guest-session.spec.ts`) — the
  one half of that concern an automated run can observe. It cannot observe
  the other half (whether Safari's tracking prevention evicts an established
  cookie after real-world dormancy, the mechanism the 30-day figure is most
  at risk from) — that needs real elapsed time on a real device, out of
  reach for this suite; flagged to Irina rather than guessed at, and the
  30-day figure itself is unchanged.
  Two of the three mobile-Safari divergences KAN-33 set out to cover are
  structurally unobservable here, and are called out rather than left to be
  inferred from "a real Safari project now runs" (round-1 review). **Viewport
  height under iOS Safari's dynamic toolbar:** Playwright's WebKit has no such
  toolbar, and `100dvh` and `100vh` resolve identically in a fixed headless
  viewport, so no browser project can distinguish them — not even a
  computed-`min-height` assertion. What is enforceable is the class itself, so
  `GuestFlowShell`'s `min-h-dvh` is pinned in
  `GuestFlowShell.test.tsx` instead; the e2e suite's only viewport-differential
  assertions are on the width axis (label collapse, horizontal overflow).
  **Paste behaviour:** `fill()` and `execCommand('insertText')` dispatch an
  `input` event but are not a real clipboard paste, so no project exercises a
  `paste` handler. Nothing is attached to `paste` today, so nothing is missed;
  the moment something is (enforcing the 300-word ceiling there would be a
  natural place), it will need coverage no current project provides.
  `tests/essay-entry.spec.ts`'s paste test does at least now assert the live
  word counter rather than the DOM value it just wrote, so it can only pass on
  a value React actually processed through the controlled `onChange` path.
- **Every project's reported test count now means what it says.** `seo.spec.ts`,
  `redirects.spec.ts`, `routing.spec.ts`, and `sitemap.spec.ts` take only the
  `request` fixture and never open a `page`, so Playwright never launches a
  browser engine for them at all — not WebKit, not Chromium, none. They used
  to run once per project anyway (three, then four, redundant, engine-less
  executions of the same pure-HTTP assertions), which is what used to inflate
  `webkit-desktop`'s reported count to 187 when only 93 of those tests ever
  opened a page. KAN-33 fixed this at the source rather than continuing to
  document it: `playwright.config.ts`'s `REQUEST_ONLY_SPECS` list excludes
  those four specs from every project except `chromium-desktop` (the one
  project whose `browserName` they already force via each file's own
  `test.use({ browserName: 'chromium' })`), so each test in them now executes
  exactly once across the whole pipeline, and `routing.spec.ts`'s own "Only
  run in one project" comment is now literally true rather than aspirational.
  The resulting shape, as of KAN-33: `chromium-desktop` 188, and 94 each for
  `chromium-mobile`, `webkit-desktop` and `webkit-mobile` — 470 total, down
  from 561 (187 x 3) while adding a whole engine, because real in-browser
  executions went UP (93 x 3 = 279 to 94 x 4 = 376) and the drop is entirely
  the 188 engine-less duplicates. **Current figure:** 526 (`--list --grep-invert
  "@cms"`, as of `aa58e70`): 202 in `chromium-desktop` and 108 in each of the other
  three projects; the 470 above is the KAN-33 snapshot, before the later specs.
  Treat these as a snapshot, not a contract:
  nothing enforces them, and the first spec anyone adds makes them stale.
  `REQUEST_ONLY_SPECS`'s patterns are anchored to a path separator so a future
  `blog-seo.spec.ts` is not silently swept into the exclusion, but the list
  itself is still hand-maintained -- renaming one of those four specs, or
  adding a fifth request-only one, drifts without anything going red.
  An engine-sensitive assertion added to any of those four specs is still not
  exercised by any gate but `chromium-desktop` — that hasn't changed, only
  which projects redundantly claimed to cover it.
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
  set, once KAN-39 lands that script. Whether it should then run on
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
friction on a first run, not a source of false confidence. The suite also needs
`CREATE DATABASE` on that server: `migration-0006-essay-owner.test.ts` builds a
scratch database to apply the migrations against. The local container and CI's
service container both satisfy this; a restricted role will not.

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

### Running the Playwright suite locally (Chromium projects only)

You can get a real-browser signal on `chromium-desktop` and `chromium-mobile`
before opening a PR, on any machine with a Chromium build Playwright can be
pointed at. **It is not a substitute for CI.** CI's full job is the merge gate
and the **only** signal for `webkit-desktop` and `webkit-mobile`, which are
required projects (see "WebKit gates every PR" above). Nothing below can run
WebKit, and a green local Chromium run says nothing about it.

This is written down because "the e2e suite can't be run outside CI" was
believed for a long time and is **wrong for the Chromium projects**. It
matters in practice: a spec written without ever being run shipped a German
register button (58 unbroken characters on a `whitespace-nowrap` control) that
measured ~480px on a 393px viewport, so it was cropped at the screen edge and
its tap centre fell off the card. CI caught it; a local `chromium-mobile` run
would have, before the PR existed.

**Never run `npx playwright install`** in a restricted environment. It
downloads from `cdn.playwright.dev`, which may be blocked, and it is not
needed: use a Chromium that is already on the machine. Set
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so `npm ci` does not try to fetch one either.

Everything below mirrors `ci.yml`'s "Website" job and was run end to end as
written (x86_64 Linux; see the last section of this recipe for the measured
results). Run it from `website/`, in one shell, since it relies on exported
variables.

**1. Install without downloading a browser**
```bash
cd website
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm ci
```

**2. Point Playwright at the Chromium you have (the "bridge")**

Playwright looks for one exact browser revision, baked into the version this
repo pins. A pre-installed Chromium is usually a different revision, so
Playwright reports "Executable doesn't exist". The fix is a private browsers
directory, created by you in a scratch location, whose entries are symlinks
named for the revision Playwright wants and pointing at the build you have.
Nothing is written into the real browsers directory and nothing into the repo.

```bash
# Revision the pinned Playwright wants (1208 for @playwright/test 1.58.2):
WANT=$(node -p "require('./node_modules/playwright-core/browsers.json').browsers.find(b => b.name === 'chromium').revision")
# Revision you have: `ls "$PLAYWRIGHT_BROWSERS_PATH"` shows chromium-<rev>
# and chromium_headless_shell-<rev> (1194 on the sandbox image, /opt/pw-browsers).
HAVE=1194
REAL=/opt/pw-browsers

PW_BRIDGE=$(mktemp -d)   # scratch, outside the repo
mkdir -p "$PW_BRIDGE/chromium-$WANT/chrome-linux64" \
         "$PW_BRIDGE/chromium_headless_shell-$WANT/chrome-headless-shell-linux64"
ln -s "$REAL/chromium-$HAVE/chrome-linux/chrome" \
      "$PW_BRIDGE/chromium-$WANT/chrome-linux64/chrome"
ln -s "$REAL/chromium_headless_shell-$HAVE/chrome-linux/headless_shell" \
      "$PW_BRIDGE/chromium_headless_shell-$WANT/chrome-headless-shell-linux64/chrome-headless-shell"
export PLAYWRIGHT_BROWSERS_PATH=$PW_BRIDGE
```

The names are not negotiable, and were checked against
`node_modules/playwright-core/lib/server/registry/index.js` for the pinned
version rather than copied from anyone's notes:

- **Directory names:** `chromium-<rev>` and `chromium_headless_shell-<rev>`.
  The headless shell uses an **underscore** (`chromium-headless-shell-<rev>`
  with hyphens is not found: tried, fails with "Executable doesn't exist").
- **Layout inside, on x86_64 Linux:** `chromium-<rev>/chrome-linux64/chrome` and
  `chromium_headless_shell-<rev>/chrome-headless-shell-linux64/chrome-headless-shell`.
  The installed builds use different internal names (`chrome-linux/chrome`,
  `chrome-linux/headless_shell`), which is why the links rename them. (On
  arm64 Linux the registry expects `chrome-linux/chrome` and
  `chrome-linux/headless_shell`.)
- **Both links are required.** Playwright launches the headless shell for
  ordinary headless runs, so a bridge with only the `chromium-<rev>` half fails.
  Each is **one symlink to the real binary**: no per-file symlink farm and no
  marker files (`INSTALLATION_COMPLETE` etc.) are needed. The binaries find their
  resources next to their real path, not next to the link (observed working, not
  looked up in Playwright's source).

The installed build is older than the one Playwright pins (Chromium 141 here,
against 145 in CI). The Playwright protocol tolerated that across the whole
suite, but it is a difference, so a failure that only appears locally is worth
a second look before it is believed, and a pass is not proof CI will pass.

Check the bridge before going further:
```bash
node -e "require('@playwright/test').chromium.launch().then(b => { console.log(b.version()); return b.close(); })"
```

**3. A database of your own, migrated**

Use a database dedicated to the e2e run, not the one your dev server uses: the
suite writes sessions, essays and users.
```bash
docker compose up -d db      # from the repo root; Postgres 16 on localhost:55432
psql postgres://fluentina:fluentina_dev@127.0.0.1:55432/postgres -c "create database fluentina_e2e"
export DATABASE_URL=postgres://fluentina:fluentina_dev@127.0.0.1:55432/fluentina_e2e
npm run db:migrate
```
No Docker (a container sandbox, say)? Any Postgres 16 will do. As root,
`initdb` refuses to run, so create the data directory under a location the
`postgres` user owns (for example `/var/lib/postgresql/<name>`) and start it
with `su postgres -c "pg_ctl ..."` on a spare port. Do not assume something is
already listening on 55432, and do not reuse someone else's server: check.

**4. Build, then serve the build over TLS**
```bash
NEXT_PUBLIC_STRAPI_URL=http://localhost:1337 \
NEXT_PUBLIC_APP_URL=http://localhost:3000 \
NEXT_PUBLIC_API_URL=http://localhost:3000 \
NEXT_PUBLIC_STRIPE_PUBLIC_KEY=pk_test_ci_placeholder \
NEXT_PUBLIC_GROWTHBOOK_CLIENT_KEY= \
npm run build                # needs DATABASE_URL set, or it fails collecting page data

npm run tls:generate-cert -- .tls

# MOCK_GRADING_PROVIDER must be on the SERVER, not just the test runner.
MOCK_GRADING_PROVIDER=1 node_modules/.bin/next start -p 3000 &
APP_PID=$!
TLS_PROXY_PORT=8443 TLS_PROXY_TARGET_PORT=3000 \
TLS_PROXY_CERT=.tls/localhost-cert.pem TLS_PROXY_KEY=.tls/localhost-key.pem \
node scripts/tls-proxy.mjs &
PROXY_PID=$!
```
`next start` is invoked directly, not as `npm run start`, so that `$!` is the
server itself: killing the `npm` wrapper leaves the real `next-server`
orphaned and still holding the port. If 3000 or 8443 are taken, change the
ports here and in `BASE_URL` below.

**5. Run the specs**
```bash
export BASE_URL=https://localhost:8443 PLAYWRIGHT_EXTERNAL_SERVER=1 MOCK_GRADING_PROVIDER=1

# one spec, both Chromium projects:
npx playwright test tests/essay-entry.spec.ts \
  --project=chromium-desktop --project=chromium-mobile

# everything, as CI does, but only the two projects that can run here:
npx playwright test --project=chromium-desktop --project=chromium-mobile --grep-invert "@cms"
```
Do not set `CI`: it turns on retries and four workers, and (correctly) makes
`playwright.config.ts` throw if `BASE_URL` is missing or not HTTPS. Without it a
flaky test is a red test on the first attempt, which is what you want locally.
`BASE_URL` must be the `https://localhost` proxy address for the same reason CI
uses it: a plain-HTTP run silently skips the tests that need the `__Host-`
session cookie stored.

**6. Stop what you started**
```bash
kill "$APP_PID" "$PROXY_PID"
```
(Then drop the scratch database and `$PW_BRIDGE` if you like; both are yours.)

#### Expected noise: 28 failures in the full run, all "zero console errors"

A full run of the two Chromium projects at `6ae3600`, in a sandbox whose
egress is restricted, gave **275 passed, 7 skipped, 28 failed** in about two
minutes (`chromium-desktop`: 184 / 4 / 14, `chromium-mobile`: 91 / 3 / 14). Every
one of the 28 is a "no console errors" assertion, and none is a signal about
your change:

| Spec | Failing test | Per project |
|------|--------------|-------------|
| `tests/no-console-errors.spec.ts` | `T10 — <route> has zero console errors` for `/`, `/pricing`, `/about`, `/blog`, `/contact`, `/for-freelancers`, `/placement-test`, `/placement-test/german`, `/placement-test/english`, `/privacy`, `/terms` | 11 |
| `tests/guest-flow.spec.ts` | `zero console errors` (`/practice` and `/de/practice`) | 2 |
| `tests/contact-form.spec.ts` | `T5.6 — Form renders without console errors` | 1 |

The cause is environmental. The root layout loads two third-party scripts,
`cdn-cookieyes.com` (consent banner) and `www.googletagmanager.com` (GA4),
through `next/script`. Where those hosts are unreachable, the load fails
(`net::ERR_TUNNEL_CONNECTION_FAILED` behind this sandbox's proxy) and
`next/script` logs the failed load's DOM event with `console.error`, whose
text is just `Event`. The shared filter in `tests/helpers/console-errors.ts`
ignores `net::ERR_*` messages, but not a bare `Event`, so the page fails the
assertion. You will see the failure message list `["Event"]` and nothing else.
`localhost:1337` (Strapi) is also refused, since no CMS runs, but its messages
are `net::ERR_*` and are filtered; it is not what fails these tests. On CI
runners both hosts are reachable, so these pass there.

Treat the same 28, and only them, as noise. Anything else red, or these
tests failing for a different message than `["Event"]`, is real. The 7
skipped are blog-post tests that skip themselves when no CMS content is
published (`tests/blog.spec.ts`, and the `/blog/[slug]` JSON-LD test in
`tests/seo.spec.ts`). Do not try to fix the 28 in an unrelated branch; they
are environmental, not a defect in the suite.

The figures are a snapshot of one run at one commit, not a contract. If a
later run shows a different number, check that the failing tests are still this
same family before concluding anything.

#### What this gives you and what it does not

| | Runs here | Signal |
|---|---|---|
| `chromium-desktop` | yes | real, pre-CI |
| `chromium-mobile` (Pixel 5, 393px) | yes | real, pre-CI |
| `webkit-desktop` | **no, no WebKit build available** | CI only |
| `webkit-mobile` | **no, no WebKit build available** | CI only |

The two WebKit projects are not optional extras: `webkit-desktop` is a required
check, WebKit refuses the `__Host-` session cookie over plain HTTP, and twelve
tests are conditioned on that. A local Chromium pass cannot stand in for them,
and it cannot stand in for CI as a whole. CI is the merge gate. This recipe
moves the first real browser signal from "after the PR is open" to "before it".

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
| Scope, architecture, or security trade-offs; unresolved after 4 review rounds | Goes to Irina directly |

Full detail, rationale, and the companion Architecture/Test Strategy pages:
see the [Ways of Working & Delivery Model](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25526274)
page on Confluence.
