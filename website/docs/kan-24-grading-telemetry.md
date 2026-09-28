# KAN-24 — grading job telemetry: saved queries

Every grading job (`lib/domain/grading/orchestrate-grading.ts`) emits exactly
one structured line to stdout via `logGradingJobTelemetry`
(`lib/domain/grading/telemetry.ts`), success or failure. Cloud Run ships
stdout/stderr to Cloud Logging automatically — no extra infrastructure was
stood up for this story, per KAN-24's own scope. Each line's `jsonPayload`
carries:

| field | meaning |
| --- | --- |
| `submissionId` | the essay id — join key to the Postgres ADR-5 persistence (raw prompt/response, structured result) in `grading_jobs` |
| `sessionIdHash` | a one-way, truncated hash of the guest session id — a correlation key across a guest's own jobs, never the raw bearer credential |
| `provider` | `mistral` / `fake`, or `null` if the job never reached a provider call (e.g. `wordCountOutOfBounds`) |
| `latencyMs` | submission (`grading_jobs.created_at`) -> grading complete — BR-5.2's own metric |
| `success` | boolean |
| `errorType` | a `GradingFailureReason` (`lib/contracts/grading.ts`), or `null` on success |
| `spanValidationPassed` | whether every annotation's quote resolved verbatim against the essay (`null` when grading never reached annotation resolution at all) |
| `promptInjectionSuspected` | whether BR-3.5's heuristic fired and the result was capped |
| `tokenCountEstimate` / `costEstimateUsd` | rough, non-billing-accurate estimates (`lib/domain/grading/cost.ts`); `null` (not `0`) when genuinely not known — e.g. `invalidProviderResponse`, where the provider WAS called and billed but no usage figures were surfaced past the thrown error. Only `wordCountOutOfBounds`/`essayMissing` (no provider call at all) log a genuine `0`. |

Never present: essay text, an account email, or a full LLM response body —
see `telemetry.ts`'s own comment for why the interface's shape makes that
true by construction, not by convention alone.

## BR-3.4 — pulling a sample for the pre-launch sanity check

Irina's spot-check needs "a sample of recent gradings... in a single query,
with enough detail for the sanity check, without a one-off engineering
exercise". In Cloud Logging's Log Analytics (SQL over log data) or via
`gcloud logging read`:

```sql
-- Last 50 completed grading jobs, most recent first — Log Analytics SQL
-- (Logs Explorer -> "Analytics" tab, or the BigQuery-backed log sink to the
-- `writewise-468912` project once one is wired).
SELECT
  timestamp,
  json_payload.submissionId,
  json_payload.provider,
  json_payload.latencyMs,
  json_payload.success,
  json_payload.errorType,
  json_payload.spanValidationPassed,
  json_payload.promptInjectionSuspected,
  json_payload.costEstimateUsd
FROM `writewise-468912.global._Default._AllLogs`
WHERE resource.type = "cloud_run_revision"
  AND resource.labels.service_name = "writewise-website"
  AND json_payload.event = "grading_job_completed"
ORDER BY timestamp DESC
LIMIT 50
```

Equivalent one-liner against raw logs (works today, no Log Analytics/BigQuery
sink required — the `gcloud logging read` command CLAUDE.md already
documents for this service, filtered to this story's event):

```bash
gcloud logging read \
  'resource.type=cloud_run_revision AND resource.labels.service_name=writewise-website AND jsonPayload.event="grading_job_completed"' \
  --project=writewise-468912 --limit=50 --format=json
```

Once `submissionId` is joined against `grading_jobs` in Postgres (the same id,
the ADR-5 raw prompt/response and structured result), Irina's spot-check has
both the operational context (latency, provider, validation) and the actual
graded content for a specific job, from two systems, joined by one id.

## BR-5.2 — submission-to-preview latency distribution

```sql
-- Percentile distribution of latencyMs for the last 7 days of successful
-- gradings — the "is this actually inside the 60-second budget" check.
SELECT
  APPROX_QUANTILES(CAST(json_payload.latencyMs AS INT64), 100)[OFFSET(50)] AS p50_ms,
  APPROX_QUANTILES(CAST(json_payload.latencyMs AS INT64), 100)[OFFSET(90)] AS p90_ms,
  APPROX_QUANTILES(CAST(json_payload.latencyMs AS INT64), 100)[OFFSET(99)] AS p99_ms,
  COUNT(*) AS sample_size
FROM `writewise-468912.global._Default._AllLogs`
WHERE resource.type = "cloud_run_revision"
  AND resource.labels.service_name = "writewise-website"
  AND json_payload.event = "grading_job_completed"
  AND json_payload.success = true
  AND timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
```

A "dashboard", concretely, for Phase 1: save either query above as a Log
Analytics saved query (Cloud Console -> Logging -> Log Analytics -> Save
query), or pin the equivalent as a Cloud Monitoring chart backed by a
log-based metric extracted from `jsonPayload.latencyMs` on this same filter.
Neither is built by this story (KAN-24 explicitly scopes out "any user-facing
UI" and this is internal tooling) — the queries above are what a saved
query/chart would run, ready to paste into either surface once someone with
Cloud Console access does so.

## Coverage — "no grading job is silently excluded"

Every `return` inside `runGradingJob` (`orchestrate-grading.ts`) that isn't
one of the two narrow, documented exceptions (the job-row-gone guard, and the
KAN-16 round-1 review finding-13 retry path, which reverts an in-flight job
to `pending` rather than finishing it) is preceded by exactly one
`logGradingJobTelemetry` call. This is now actually enforced, not just
hand-inspected:

- `telemetry.test.ts` pins the exact emitted field set (`Object.keys`,
  sorted) for a success and a failure event directly against
  `logGradingJobTelemetry`, independent of `orchestrate-grading.ts` — plus
  that the logged `sessionIdHash` is never the raw session id (KAN-16 round-1
  review, finding 7 — mutating that one line to log the raw id left the
  whole suite green before this test existed).
- `orchestrate-grading.test.ts` spies `console.log` for every branch
  (`wordCountOutOfBounds`, `providerError`, `invalidProviderResponse`,
  `essayMissing`, both prompt-injection branches, the happy path, the
  idempotent-redelivery case, and the finding-5 concurrent-claim case) and
  asserts EXACTLY one `grading_job_completed` line with the expected
  `success`/`errorType`/`provider`/`spanValidationPassed` shape — including
  `essayMissing`, reproduced deterministically via a partial mock of
  `getEssayByIdUnscoped` — no FK bypass needed, contrary to what
  `orchestrate-grading.test.ts` used to claim in its own comment (this exact
  contradiction was round-1 review's finding 6).

Round-1 review mutation-proved the gap this closes: deleting the telemetry
call from every failure path, and separately from the success path, both
left 454/454 green before these tests existed.

## Carried-over logging (KAN-24 PR notes, fixed alongside this story)

- `POST /api/guest-session`'s two 400 branches (`crossOrigin`,
  `invalidSessionCookie`) now log one `guest_session_rejected` line each —
  `lib/guest-session-rejection-log.ts`.
- `POST /api/essays` now logs one `essay_submission` line per attempt that
  reaches the actual write — `lib/domain/essay-submission-telemetry.ts`.
- `lib/db/essays.ts`'s essay-creation failure message no longer embeds the
  guest session id, and the route (`POST /api/essays`) now catches that
  failure and returns a safe, `reason`-carrying 500 instead of an unguarded
  framework error — see that route's own KAN-24/KAN-36 comment.
