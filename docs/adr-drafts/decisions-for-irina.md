# Four decisions the Architect declined to make alone

## 1. Postgres client and migration tool — and it blocks KAN-10

**There is no database client in the repo at all.** No driver, no ORM, no
migration tool. `DATABASE_URL` exists in the example env file and in the CI
service container, and nothing imports it. KAN-10 cannot start until this is
chosen, and it is a separate decision from the layering one.

**Recommendation: Drizzle plus drizzle-kit.** Typed results, composable
`where` fragments — which matters here, because the ownership predicate then
composes cleanly as one reusable piece — migrations as checked-in SQL, and no
separate query-engine binary to carry through a Cloud Run cold start.

Plain `pg` with `node-pg-migrate` is a legitimate lighter alternative if you
would rather hand-write SQL.

Prisma is argued against, on cold-start weight and because its raw-query
escape hatch routes around the boundary ADR-14 depends on.

The same record should settle how Cloud Run reaches Cloud SQL (built-in
connector versus sidecar proxy) and pool sizing against the connection limit
on an instance shared with Strapi.

## 2. Database-enforced ownership now, or later

The draft says application-level first, with database row-level security as a
later hardening step. The reasoning is that row-level security needs
per-transaction session variables, a non-owner database role, and the
discipline of enabling it on every new table — and its own failure mode looks
exactly like the bug it prevents.

If you would rather the database be the backstop from day one, that is
defensible and has a real cost. It changes KAN-10's scope, so it is better
decided now than retrofitted across a dozen tables later.

## 3. Whether to turn on strict type checking

The project currently has TypeScript's strict mode **off**, with only one
sub-option enabled. That weakens the type half of the ownership mechanism.

Turning it on would sharpen it. The bill is whatever the existing marketing
code trips, which nobody has measured. A short spike to count the errors
should come before committing.

## 4. Confirm the numbering before publishing

The drafts assume ADR-13 is the highest in use. Worth checking against the
live page — an earlier sketch collided with an existing number because it was
written from memory.
