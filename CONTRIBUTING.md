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
- CI is green (lint, typecheck, unit, integration, e2e)
- The Jira story's acceptance criteria are demonstrably met

The Jira ticket moves to **Done** on merge.

## CI/CD and deployment

**Merging and deploying are two separate actions.** Merging to `main` keeps it
always releasable but does not itself deploy to production.

- Every PR runs the full fast suite (`ci.yml`): install → lint → typecheck →
  unit/integration tests → build → funnel Playwright e2e against a mocked
  grading provider.
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

### CMS (Strapi)
```bash
cd cms
npm install
npm run develop              # http://localhost:1337/admin (SQLite by default)
```

### Local Postgres (product backend — guest sessions, essays, scores, users)
```bash
docker compose up -d db      # Postgres 16 on localhost:5432, repo root
```
This is a local-only database, completely separate from the shared production
Cloud SQL instance — nothing done locally can touch real guest data. See
`docker-compose.yml` and `website/.env.example` (`DATABASE_URL`).

Anyone — including Irina — can check out `main` and run the whole stack
locally this way.

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
