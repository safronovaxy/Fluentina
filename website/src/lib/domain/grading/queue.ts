import 'server-only';

/**
 * KAN-16 / ADR-2 — the Cloud Tasks enqueue seam. "Essay submission returns
 * immediately; a Cloud Task is enqueued invoking a protected HTTP endpoint"
 * is the ADR's own framing; this file is the only place that decision is
 * made, so `start-grading.ts` (the one caller) never has to know whether a
 * job actually went through Cloud Tasks or ran in-process.
 *
 * Two implementations:
 *
 * - `enqueueGradingJobInline` — runs the job directly, in the SAME process,
 *   without the caller awaiting it (`void runGradingJob(...)`, caught so an
 *   unhandled rejection never crashes the dev/test process). This is what
 *   `npm run test` and `npm run test:e2e` exercise, per this story's own
 *   constraint ("a local/test path that invokes the grading job directly...
 *   exercise the real pipeline without GCP") — no HTTP round trip, no
 *   Cloud Tasks REST call, nothing to fake. Selected whenever
 *   `GRADING_QUEUE_MODE` is unset or `'inline'` — the default, so a bare
 *   `npm run dev`/`npm run test` needs no extra configuration to see a
 *   submitted essay actually get graded moments later.
 * - `enqueueGradingJobCloudTasks` — the production path. Makes an
 *   authenticated REST call to the Cloud Tasks API to create a task
 *   targeting this same app's own protected internal processing route
 *   (`POST /api/internal/grading-jobs/process`). Selected only when
 *   `GRADING_QUEUE_MODE=cloud-tasks` is set (deploy-website.yml's job, once
 *   wired — see this story's own handover for what that still needs: the
 *   queue itself, IAM, and `GRADING_TASK_SECRET` in Secret Manager). Never
 *   exercised by this repo's own test suite — there is no GCP credential in
 *   this environment to exercise it against, and none should be faked here;
 *   see this module's own tests for what IS asserted about it (the request
 *   shape it builds), without ever making the call.
 * - `enqueueGradingJobOff` — KAN-16 round-1 review, finding 16. Records the
 *   job id and runs NOTHING. Selected only when `GRADING_QUEUE_MODE=off`,
 *   which `vitest.config.ts` sets as the Vitest suite's own default (never
 *   the inline mode's default, and never set anywhere outside test config).
 *   Measured: one run of `essays/route.test.ts` alone fires close to 300
 *   unawaited, auto-running `enqueueGradingJobInline` calls via its own
 *   rate-limit fixtures — almost none of which have any interest in grading
 *   at all — each racing every OTHER test's own `afterEach` TRUNCATE
 *   (`db-fixtures.ts`). The reviewer reproduced a leaked job logging
 *   `essayMissing` during a completely unrelated test as a direct result.
 *   'off' mode makes that impossible by construction: nothing runs unless a
 *   test explicitly calls `drainGradingQueueForTests()` — see its own
 *   comment — which only `essays/route.test.ts`'s own KAN-16 "starts grading"
 *   tests do.
 */
import { runGradingJob } from './orchestrate-grading';

const CLOUD_TASKS_API_BASE = 'https://cloudtasks.googleapis.com/v2';
const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

function queueMode(): 'inline' | 'cloud-tasks' | 'off' {
  if (process.env.GRADING_QUEUE_MODE === 'cloud-tasks') return 'cloud-tasks';
  if (process.env.GRADING_QUEUE_MODE === 'off') return 'off';
  return 'inline';
}

/**
 * Jobs enqueued while `GRADING_QUEUE_MODE=off`, awaiting an explicit
 * `drainGradingQueueForTests()` call — see that function's own comment.
 * Module-scoped, so it only ever accumulates within a single test FILE's own
 * run (Vitest isolates module state per file by default); safe to leave
 * undrained entries in here indefinitely, since `runGradingJob` itself is a
 * documented no-op for a job id whose row is already gone (e.g. TRUNCATEd by
 * a later test's own `afterEach`) — see that function's own top comment.
 */
const pendingOffModeJobIds: string[] = [];

async function enqueueGradingJobOff(jobId: string): Promise<void> {
  pendingOffModeJobIds.push(jobId);
}

/**
 * Test-only escape hatch for `GRADING_QUEUE_MODE=off`. Runs every job
 * currently queued, in submission order, awaiting each to completion before
 * returning — deterministic, unlike the fixed-count polling loop this
 * replaced in `essays/route.test.ts`. Only the tests that genuinely want to
 * observe a job reach a terminal status call this; every other test in the
 * suite submits essays whose grading jobs are recorded and never run at all.
 */
export async function drainGradingQueueForTests(): Promise<void> {
  const jobIds = pendingOffModeJobIds.splice(0, pendingOffModeJobIds.length);
  for (const jobId of jobIds) {
    await runGradingJob(jobId);
  }
}

async function enqueueGradingJobInline(jobId: string): Promise<void> {
  // Deliberately not awaited by the caller (`start-grading.ts`) — this
  // function itself resolves as soon as the job is SCHEDULED, not once
  // grading finishes, which is what "essay submission returns immediately"
  // (ADR-2) requires even in the inline/test path. Errors are caught here,
  // not left to become an unhandled promise rejection: `runGradingJob`
  // itself already catches everything it can classify and persists a
  // `failed` job row for it (see that module's own comment) — this catch is
  // only a last-resort backstop for something escaping that, logged rather
  // than silently swallowed.
  queueMicrotask(() => {
    void runGradingJob(jobId).catch((err) => {
      console.error(
        JSON.stringify({
          severity: 'ERROR',
          event: 'grading_job_inline_dispatch_failed',
          message: err instanceof Error ? err.message : 'unknown error',
        }),
      );
    });
  });
}

/**
 * Obtains an OAuth2 access token for THIS Cloud Run service's own attached
 * service account, from the metadata server — the standard GCP workload-
 * identity pattern, needing no secret of its own (unlike `MISTRAL_API_KEY`):
 * the token is scoped to whatever IAM roles the deployed service account
 * already has, which must include Cloud Tasks Enqueuer on the grading queue
 * — a deploy-time IAM grant, not something this code can arrange for itself.
 * Throws in any environment without that metadata server (i.e. everywhere
 * except a real Cloud Run/GCE instance) — never reached outside
 * `GRADING_QUEUE_MODE=cloud-tasks`, which nothing in this repo's own dev/CI
 * configuration ever sets.
 */
async function fetchMetadataAccessToken(): Promise<string> {
  const response = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!response.ok) {
    throw new Error(`failed to obtain metadata server access token (${response.status})`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) {
    throw new Error('metadata server token response carried no access_token');
  }
  return body.access_token;
}

/**
 * Creates a Cloud Tasks task targeting this app's own internal processing
 * route, with an OIDC token Cloud Tasks itself attaches on delivery (so the
 * processing route can, in principle, verify the caller's identity via IAM)
 * PLUS a shared-secret header (`GRADING_TASK_SECRET`) the processing route
 * actually checks today — see that route's own comment for why the secret,
 * not full OIDC verification, is what Phase 1 relies on, and what upgrading
 * that would take.
 *
 * Every piece of configuration this needs (`GCP_PROJECT_ID`,
 * `GRADING_TASKS_QUEUE_LOCATION`, `GRADING_TASKS_QUEUE_NAME`,
 * `GRADING_TASKS_TARGET_URL`, `GRADING_TASKS_SERVICE_ACCOUNT_EMAIL`,
 * `GRADING_TASK_SECRET`) is a deploy-time value, not committed — see
 * `.env.example`'s own comment block for this story, and this story's own
 * handover for the GCP resources (the queue itself, its IAM bindings) a
 * human still needs to provision before this path can run for real.
 */
async function enqueueGradingJobCloudTasks(jobId: string): Promise<void> {
  const projectId = requireEnv('GCP_PROJECT_ID');
  const location = requireEnv('GRADING_TASKS_QUEUE_LOCATION');
  const queueName = requireEnv('GRADING_TASKS_QUEUE_NAME');
  const targetUrl = requireEnv('GRADING_TASKS_TARGET_URL');
  const serviceAccountEmail = requireEnv('GRADING_TASKS_SERVICE_ACCOUNT_EMAIL');
  const taskSecret = requireEnv('GRADING_TASK_SECRET');

  const accessToken = await fetchMetadataAccessToken();
  const queuePath = `projects/${projectId}/locations/${location}/queues/${queueName}`;

  const response = await fetch(`${CLOUD_TASKS_API_BASE}/${queuePath}/tasks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      task: {
        httpRequest: {
          httpMethod: 'POST',
          url: targetUrl,
          headers: {
            'Content-Type': 'application/json',
            'X-Grading-Task-Secret': taskSecret,
          },
          body: Buffer.from(JSON.stringify({ jobId })).toString('base64'),
          oidcToken: { serviceAccountEmail },
        },
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Cloud Tasks enqueue failed (${response.status}): ${body}`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — required when GRADING_QUEUE_MODE=cloud-tasks`);
  return value;
}

export async function enqueueGradingJob(jobId: string): Promise<void> {
  const mode = queueMode();
  if (mode === 'cloud-tasks') {
    return enqueueGradingJobCloudTasks(jobId);
  }
  if (mode === 'off') {
    return enqueueGradingJobOff(jobId);
  }
  return enqueueGradingJobInline(jobId);
}
