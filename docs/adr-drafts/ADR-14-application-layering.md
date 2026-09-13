# ADR-14: Application layering inside the Next.js app

**Status:** Proposed — awaiting Irina's approval
**Date:** 2026-09-13
**Driver:** KAN-10 (guest session tracking and row-level ownership) — the first story that writes to the product database
**Relates to:** ADR-9 (one Next.js app), ADR-1/ADR-6/ADR-10 (Cloud SQL reuse, `fluentina` schema), BRD row-level ownership, BR-1.8, BR-3.5, BR-7.1–7.4

## Context

The thirteen existing ADRs define this system outward — cloud, region, database instance, LLM provider, auth library, deployment. None says how code is organised *inside* the application: where business rules live, how data access is structured, what a route handler may do. The Container diagram fills that silence by implication, drawing "API Routes → Postgres" with nothing in between.

Nothing has been built that way yet. `src/app/` holds one ten-line health route, `src/lib/` holds only CMS and presentation helpers, and there is no Postgres driver in the project at all. So there is no pattern to unwind — but KAN-10 is about to create one, and eleven guest-flow and account stories will copy it.

What makes this a security decision rather than a taste one is the BRD's row-level ownership requirement: every essay, score and report read must be constrained to its owner server-side, including the cutover rule that a guest session identifier stops authorising reads once a record is attached to an account. That is a property of every query in the system, forever, and it is only cheaply verifiable if there is one place queries are written.

One stack detail decides the options below. The App Router has three server entry points, not one: route handlers, server components (every page here renders on the server today), and server actions. "Enforce at the API layer" covers one of the three. Only the data layer sits under all three.

## Options considered

### Layering

1. **No explicit layering** — handlers, server components and actions each query Postgres directly; shared bits get factored out when they hurt. Cheapest per story, and the only one that requires no new files or config. Its cost is that the ownership property becomes unverifiable: proving it holds means reading every handler, every server component and every action, on every PR, forever, and a single `page.tsx` that forgets the `WHERE` is a silent cross-guest data leak with no failing test.
2. **Two layers** — thin adapters plus a data/repository layer that owns SQL and ownership; business rules live wherever they land. Gets the security property. Leaves submission validation, rate limiting, session-to-account conversion and grading orchestration with no agreed home, which means they land in route handlers and cannot be reused by a server action doing the same thing.
3. **Three layers — data access, business logic, thin adapters** *(chosen)*.
4. **Feature slices** — `features/essays/{data,logic,ui}`, `features/sessions/...`. Reads nicely as the app grows. Rejected: the one boundary that has to be machine-enforced (nothing outside the data layer touches the DB client) becomes one lint rule per feature that every new feature must remember to add, which is exactly the class of "remember to" control this ADR exists to remove.
5. **A separate backend service** — closed by ADR-9 (one Next.js app). Listed only so it is on the record as considered and not re-raised.

### Ownership enforcement mechanism

- **A. Check in the route handler.** Fails outright: it does not cover server components or server actions (see Context).
- **B. Check in the business layer.** Better, but leaves the data layer capable of returning any row to anyone, so a single domain function that forgets the check leaks, and the reviewable surface is every domain function rather than one predicate.
- **C. Mandatory actor argument in the data layer** *(chosen)* — every read and write takes the current actor as a required first parameter and applies one shared ownership predicate.
- **D. Postgres row-level security** — the database itself refuses the row, via `SET LOCAL app.current_actor` per transaction and `ENABLE ROW LEVEL SECURITY ... FORCE` per table. Strongest guarantee on paper, and the only one that survives a bug in our own query code. Deferred, not rejected — see Reasoning, and the open question at the end.

## Decision

### The layers

```
website/src/
  app/                     ADAPTERS — pages, layouts, route handlers, server actions
  components/              React. Unchanged by this ADR.
  page-components/         React. Unchanged by this ADR.
  lib/
    contracts/             PURE — types and Zod schemas. Imports nothing of ours.
    domain/                BUSINESS LOGIC — rules, orchestration, the GradingProvider seam
    db/                    DATA ACCESS — the only place SQL and the DB client exist
    strapi.ts, analytics.ts, seo.ts, utils.ts, ...   existing helpers, untouched
```

`lib/` rather than a new `server/` tree because `src/lib/` is already this repo's home for non-React modules and `@/lib/...` is already the idiom in every import.

### What each layer may and may not import

| Layer | May import | May **not** import |
| --- | --- | --- |
| `src/app/**`, `src/components/**`, `src/page-components/**`, `src/hooks/**` | `@/lib/domain/*`, `@/lib/contracts/*`, components, `@/lib/strapi` | `@/lib/db/*`, `pg` (or whichever driver), anything from `node:` used for data access |
| `src/lib/domain/**` | `@/lib/db/*`, `@/lib/contracts/*`, provider SDKs | `next/headers`, `next/navigation`, `@/app/*`, `@/components/*` — the domain must not know it is being called over HTTP |
| `src/lib/db/**` | `@/lib/contracts/*`, the driver (in `db/client.ts` only) | `@/lib/domain/*`, anything above it |
| `src/lib/contracts/**` | nothing of ours | everything of ours |

`lib/db/**` and `lib/domain/**` each start with `import 'server-only';` (new dependency, Vercel's, a few lines) so that a client component importing one of them fails the build with a clear message rather than pulling server code toward the browser bundle.

**This is enforced by ESLint, not by this table.** Add to `website/eslint.config.js`, after the existing `**/*.{ts,tsx}` block (flat config merges later blocks, so no existing rule changes):

```js
{
  files: ['src/app/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}',
          'src/page-components/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': ['error', { patterns: [
      { group: ['@/lib/db', '@/lib/db/*'],
        message: 'ADR-14: data access is reachable only through @/lib/domain/*.' },
      { group: ['pg', 'pg-pool'],
        message: 'ADR-14: only src/lib/db/client.ts may talk to the driver.' },
    ]}],
  },
},
{
  files: ['src/lib/domain/**/*.ts'],
  rules: { 'no-restricted-imports': ['error', { patterns: [
    { group: ['next/headers', 'next/navigation', '@/app/*', '@/components/*'],
      message: 'ADR-14: the domain layer must stay framework-free and unit-testable.' },
  ]}]},
},
```

`no-restricted-imports` is a core ESLint rule, so this needs no new plugin, and `npm run lint` already gates every PR in `ci.yml`. Honest limit: it catches static imports only, not `require()` or dynamic `import()`. That is acceptable — this is a guardrail against absent-mindedness, not against a determined bypass.

### What a route handler, server component or server action may do

Parse and validate input against a `lib/contracts` schema; resolve the current actor; call **one** domain function; shape the response or render. No SQL, no ownership logic, no business rules, no direct provider calls. If a handler needs two domain calls to do its job, that is a missing domain function, not a licence.

Server components read through the domain layer like everything else. This costs a one-line pass-through for reads that have no rule beyond ownership, and that cost is accepted deliberately: the alternative — "simple reads may go straight to `lib/db`" — is fine until the first rule is added to the domain function (say, "don't show the score until consent is recorded") and the page that bypassed it keeps showing the old behaviour, silently.

### The ownership mechanism

**The actor.** In `lib/contracts/actor.ts`:

```ts
export type GuestSessionId = string & { readonly __brand: 'GuestSessionId' };
export type UserId         = string & { readonly __brand: 'UserId' };

export type Actor =
  | { kind: 'guest';  sessionId: GuestSessionId }
  | { kind: 'user';   userId: UserId }
  | { kind: 'system'; job: 'grading-callback' | 'retention-cleanup' };
```

Every function in `lib/db` that reads or writes an owned row takes `actor: Actor` as its first parameter. Required, never optional, never defaulted. `lib/db` exports no generic `query()` / `sql()` escape hatch — if it did, the whole mechanism would be one import away from irrelevant.

**The predicate.** One function, `lib/db/ownership.ts`, is the only place the ownership rule is expressed:

> Guest: owns the row only while it is still unattached. The `user_id IS NULL` conjunct **is** the post-conversion cutover rule — once conversion sets `user_id`, the old session cookie stops authorising reads of this row, permanently. User: owns rows attached to their account.

That conjunct is also what the 30-day retention job selects on ("unconverted guest essays"), so conversion and retention agree by construction rather than by two developers reading the same BRD paragraph.

Its test file is the single security test of record for this property, and the Test Lead should treat it as such: guest reads own row; guest cannot read another session's row; guest cannot read their *own* row after conversion; converted user can; a second user cannot.

**The system actor** exists because the Cloud Tasks grading callback writes a score for an essay that no request actor owns, and Cloud Scheduler's cleanup deletes rows nobody owns. Without it, the first developer to meet that problem will either pass a fabricated guest actor or make the parameter optional, and an optional parameter ends this mechanism. Constraints on it:

- constructible only inside `lib/domain/system-jobs.ts`, added to the lint restrictions so any other import is an error;
- a route handler that acts as a system actor **must** verify the Cloud Tasks / Scheduler OIDC token first. An unauthenticated endpoint that runs as `system` is an open write to every essay and score in the database;
- every `system` query still names its tables explicitly — `system` means "ownership does not apply here", not "no `WHERE` clause".

**Resolving the actor.** Cookies are a framework concern and must not leak into the domain, so the split is: the adapter reads the session cookie value and the Auth.js session, passes both as plain values to `domain.resolveActor(...)`, and gets back an actor plus, on first visit, a new session to set. The adapter sets the cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. The guest session id is a bearer credential — it must be 128 bits of CSPRNG output (`crypto.randomUUID()` is fine), never sequential, never derived from anything about the visitor, and never readable by JavaScript.

### Where the recurring BRD requirements live

| Requirement | Home |
| --- | --- |
| Essay length floor/ceiling (~50 / 300 words) | One Zod schema in `lib/contracts/essay.ts`, imported by the React Hook Form resolver **and** by the domain function. One definition, so client and server cannot drift. This is how "enforced on both client and server" is satisfied without writing it twice. |
| Rate limiting, BR-1.8 (5 per session per hour, per-IP backstop) | Decision in `lib/domain`, counters in `lib/db`. **Not** in-memory and **not** in middleware: Cloud Run runs 0–5 instances, so an in-process counter gives each instance its own budget and the real limit silently becomes 5 × instances per hour. |
| Prompt-injection mitigation, BR-3.5 | `lib/domain/grading/` — it is part of prompt construction, which is a domain rule, not a provider detail. Every `GradingProvider` implementation gets the same treatment for free. |
| `GradingProvider` seam (Mistral primary, Claude fallback) | Interface in `lib/domain/grading/provider.ts`; implementations beside it. Unchanged from the existing grading Component diagram; this ADR only fixes its address. |
| Consent records (versioned, timestamped; marketing opt-in separate) | `lib/db/consent.ts` + `lib/domain/consent.ts`. Append-only: the data layer exposes an insert and reads, no update. |
| Observability, BR-7.1–7.4 | One typed log-event shape in `lib/contracts/telemetry.ts` with a closed field set — latency, provider, outcome, cost estimate, ids. No `meta: Record<string, unknown>` and no free-form message argument, so "essay text ended up in a log line" stops being a thing a reviewer has to catch by eye. The data layer never logs row contents. |

### Carve-outs, stated so the rule stays honest

- **Auth.js owns its own tables.** Its Postgres adapter will read and write `users`, `accounts`, `sessions`, `verification_tokens` directly, and that is correct — those are the library's tables, not ours. Our repositories reference `users.id` by foreign key and never write those tables. This is the one sanctioned path from outside `lib/db` to Postgres.
- **Strapi is not this.** `lib/strapi.ts` is an HTTP client for the CMS, and marketing pages will keep calling it straight from server components, as they do today. This ADR governs the product Postgres. Do not read it as "every fetch now needs a domain function" — that would be busywork for content that has no owner and no rules.

## Reasoning

**Why the data layer holds ownership, not the business layer or the handler.** Three server entry points, one common floor. Putting the check at the entry points means the property must be re-proved at every entry point that is ever added, including ones added by a hurried story on a Friday. Putting it at the floor means a new query that forgets the actor does not compile, because the parameter is required — and that is true regardless of `strict` mode. Be precise about how strong that is, though: `website/tsconfig.json` has `"strict": false` (only `strictNullChecks` is on) and `website/eslint.config.js` disables `no-explicit-any`, so the *branding* on the id types is a hint that `as any` defeats. What genuinely cannot be skipped is passing *an* actor. The combination of required argument + single predicate + lint boundary + one dedicated test file is what carries the property; no one of those does it alone.

**Why not Postgres RLS now.** It is a real guarantee where ours is a strong convention, and it belongs on the record as the eventual answer if this ever grows a second writer against the `fluentina` schema — an analytics job, a jobs service, a psql session during an incident. Against it today: it needs a per-transaction `SET LOCAL` on a connection that is guaranteed not to be handed to another request mid-transaction, a non-owner role (a table owner bypasses RLS unless `FORCE` is set, which is exactly the silent failure this is meant to prevent), and a discipline of enabling it on every new table. On a shared Cloud SQL instance that also carries Strapi, with one or two developers and no DB client chosen yet, that is a meaningful amount of machinery whose own failure mode is indistinguishable from the bug it prevents. Application-level first, RLS as a later hardening step, is the order that gets the property shipped in KAN-10.

**Why three layers is not over-engineering at this team size.** Because in practice it is one boundary — `lib/db` — plus a place to put rules so they can be tested without a request. The domain layer is not ceremony: submission validation, the conversion cutover, rate limiting and grading orchestration are the four things most likely to be wrong, and all four are far easier to test as plain functions than through an HTTP round trip. If this were left as a convention in a document it would not be worth writing down; it is worth writing down because it comes with a lint rule that fails CI.

**Why server components don't change the answer.** They change which alternatives are viable, not which choice is right. They rule out "enforce at the API layer" and they make `server-only` worth the dependency, because in this app the line between server and client code is a per-file directive rather than a folder, and an accidental crossing is otherwise found at runtime.

### What this costs

Stated plainly, because a reader in six months should see the bill as well as the goods:

- **Three files for a trivial endpoint.** A one-line read becomes a repository function, a domain function and a handler. At roughly a dozen endpoints across the remaining stories, that is real typing for little apparent gain on the simple ones.
- **Pass-through domain functions** for reads with no rules, as argued above.
- **A Vitest config change.** `website/vitest.config.ts` sets `environment: 'jsdom'` for everything under `src/`. Data-layer tests need Node plus the Postgres already provisioned in `ci.yml`. Either add `environmentMatchGlobs: [['src/lib/db/**', 'node'], ['src/lib/domain/**', 'node']]` or put `// @vitest-environment node` at the top of those files. Whoever does KAN-10 pays this once.
- **Two new ESLint blocks** and one new dependency (`server-only`).
- **A type guarantee that is weaker than "compile error" suggests** — see above. Reviewers should not switch off on the strength of it.
- **A boundary that will be argued with.** The first time someone wants a five-line read in a server component and has to write three files, they will ask whether it is worth it. The answer is that the boundary is only worth anything if it holds for the boring cases too, since a single exception re-opens the audit surface it exists to close.

### Open questions this ADR deliberately does not answer

- **Which Postgres client and migration tool.** There is none in the repo. KAN-10 cannot start without it. Proposed as a separate ADR-16.
- **Postgres RLS as a second line of defence** — deferred, with the trigger for revisiting named above.
- **Whether to raise `tsconfig.json` to full `strict`** — it would sharpen the type half of this mechanism, and it would mean fixing whatever the existing marketing code trips.
