/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { createEssay } from '@/lib/db/essays';
import { createGradingJob, getGradingJobByIdUnscoped } from '@/lib/db/grading-jobs';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import { validLengthContent } from '@/test/essay-content-fixtures';
import { createFakeGradingProvider } from '@/lib/domain/grading/providers/fake-provider';
import { GradingProviderError } from '@/lib/domain/grading/provider';
import type { GuestActor, SystemActor } from '@/lib/contracts/actor';

// Provider-factory mocked for the whole file (KAN-16 round-1 review, finding
// 13's retry tests need to control WHICH classified error the route sees) —
// same idiom `orchestrate-grading.test.ts` already established. Defaults to
// the real fake provider in `beforeEach` so every other test in this file
// exercises the real success path exactly as before.
const createGradingProviderMock = vi.fn();
vi.mock('@/lib/domain/grading/provider-factory', () => ({ createGradingProvider: () => createGradingProviderMock() }));

// Imported AFTER the mock is registered, per Vitest's hoisting contract —
// see `orchestrate-grading.test.ts`'s own comment on why this has to be a
// dynamic import here rather than a static one.
const { POST } = await import('./route');

const SYSTEM_ACTOR: SystemActor = { kind: 'system', job: 'test' };

// >= 32 chars — KAN-16 round-1 review, finding 15 refuses to serve the route
// at all under that, so every test below that wants a VALID secret needs one
// this long, not the 14-character 'correct-secret' the file used before.
const VALID_SECRET = 'a-valid-grading-task-secret-32+chars';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

function processRequest(body: unknown, secretHeader?: string, extraHeaders: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/internal/grading-jobs/process'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secretHeader !== undefined ? { 'x-grading-task-secret': secretHeader } : {}),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await resetDatabase();
});

beforeEach(() => {
  createGradingProviderMock.mockReset();
  createGradingProviderMock.mockImplementation(() => createFakeGradingProvider());
});

afterEach(async () => {
  await resetDatabase();
  vi.unstubAllEnvs();
  delete process.env.GRADING_TASK_SECRET;
});

afterAll(async () => {
  await closePool();
});

async function seedJob() {
  const actor = newGuestActor();
  await createGuestSession(actor);
  const essay = await createEssay(actor, validLengthContent('Processed via the internal route.'));
  const job = await createGradingJob(actor, essay.id);
  return job!;
}

describe('POST /api/internal/grading-jobs/process — the Cloud Tasks target (production only)', () => {
  // KAN-16 round-1 review, finding 15: a missing OR too-short secret now
  // refuses to SERVE the route at all (500), distinct from a wrong secret
  // being presented against a properly configured one (401) — previously
  // both were the same 401, which is what let an empty/misconfigured
  // GRADING_TASK_SECRET silently authorise anything that presented no
  // header at all (`!secret` alone is falsy either way).
  it('refuses to serve the route at all with no GRADING_TASK_SECRET configured', async () => {
    delete process.env.GRADING_TASK_SECRET;
    const response = await POST(processRequest({ jobId: 'x' }, 'anything'));
    expect(response.status).toBe(500);
  });

  it('refuses to serve the route with a secret shorter than 32 characters, even if it matches exactly', async () => {
    process.env.GRADING_TASK_SECRET = 'short-secret';
    const response = await POST(processRequest({ jobId: 'x' }, 'short-secret'));
    expect(response.status).toBe(500);
  });

  it('logs a rejection for a misconfigured secret, metadata only', async () => {
    delete process.env.GRADING_TASK_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await POST(processRequest({ jobId: 'x' }, 'anything'));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(warnSpy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ event: 'grading_task_process_rejected', reason: 'misconfiguredSecret' });
    warnSpy.mockRestore();
  });

  it('rejects a request presenting the wrong secret', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const response = await POST(processRequest({ jobId: 'x' }, 'wrong-secret-of-a-totally-different-length'));
    expect(response.status).toBe(401);
  });

  it('rejects a request presenting a secret of the SAME length but different content', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const sameLengthWrongSecret = 'b'.repeat(VALID_SECRET.length);
    const response = await POST(processRequest({ jobId: 'x' }, sameLengthWrongSecret));
    expect(response.status).toBe(401);
  });

  it('rejects a request with no secret header at all', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const response = await POST(processRequest({ jobId: 'x' }));
    expect(response.status).toBe(401);
  });

  it('logs a rejection for a wrong secret, without ever logging the secret value itself', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const wrongSecret = 'this-is-definitely-the-wrong-secret';

    await POST(processRequest({ jobId: 'x' }, wrongSecret));

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const rawLine = warnSpy.mock.calls[0][0] as string;
    const line = JSON.parse(rawLine);
    expect(line).toMatchObject({ event: 'grading_task_process_rejected', reason: 'badSecret' });
    expect(rawLine).not.toContain(wrongSecret);
    expect(rawLine).not.toContain(VALID_SECRET);
    warnSpy.mockRestore();
  });

  it('rejects a malformed JSON body', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const req = new NextRequest(new URL('http://localhost:3000/api/internal/grading-jobs/process'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-grading-task-secret': VALID_SECRET },
      body: '{not json',
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it('rejects a body with no jobId', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const response = await POST(processRequest({}, VALID_SECRET));
    expect(response.status).toBe(400);
  });

  // KAN-16 round-1 review, finding 15's 4th point: a non-UUID jobId used to
  // reach a `uuid` column, Postgres would raise, and the route swallowed it
  // into a 200 — indistinguishable from a job that ran and succeeded.
  it('rejects a jobId that is not a UUID, rather than letting it reach the database as one', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const response = await POST(processRequest({ jobId: 'not-a-uuid' }, VALID_SECRET));
    expect(response.status).toBe(400);
  });

  it('with the correct secret, actually runs the grading job and returns 200', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const job = await seedJob();

    const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET));

    expect(response.status).toBe(200);
    const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
    expect(stored?.status).toBe('succeeded');
  });

  it('returns 200 even for a well-formed jobId that does not exist — Cloud Tasks should not retry a job that will never exist', async () => {
    process.env.GRADING_TASK_SECRET = VALID_SECRET;
    const response = await POST(processRequest({ jobId: '00000000-0000-4000-8000-000000000000' }, VALID_SECRET));
    expect(response.status).toBe(200);
  });

  // KAN-16 round-1 review, finding 13 — the retry contract.
  describe('finding 13 — a transient providerError is retried up to a capped number of attempts', () => {
    it('a providerError on an early attempt (low X-CloudTasks-TaskRetryCount) is reverted to pending and answered 503, not recorded as a terminal failure', async () => {
      process.env.GRADING_TASK_SECRET = VALID_SECRET;
      createGradingProviderMock.mockReturnValue(createFakeGradingProvider({ throws: new GradingProviderError('Mistral responded 503') }));
      const job = await seedJob();

      const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET, { 'x-cloudtasks-taskretrycount': '0' }));

      expect(response.status).toBe(503);
      const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
      expect(stored?.status).toBe('pending'); // reverted, not `failed` — see orchestrate-grading.ts's own comment
    });

    it('a providerError once the retry budget is exhausted is recorded as a terminal failure and answered 200', async () => {
      process.env.GRADING_TASK_SECRET = VALID_SECRET;
      createGradingProviderMock.mockReturnValue(createFakeGradingProvider({ throws: new GradingProviderError('Mistral responded 503') }));
      const job = await seedJob();

      const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET, { 'x-cloudtasks-taskretrycount': '99' }));

      expect(response.status).toBe(200);
      const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.errorType).toBe('providerError');
    });

    it('with no X-CloudTasks-TaskRetryCount header at all (a hand-crafted request, not a real Cloud Tasks delivery), a providerError is treated as final rather than silently retried forever', async () => {
      process.env.GRADING_TASK_SECRET = VALID_SECRET;
      createGradingProviderMock.mockReturnValue(createFakeGradingProvider({ throws: new GradingProviderError('down') }));
      const job = await seedJob();

      const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET));

      expect(response.status).toBe(200);
      const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
      expect(stored?.status).toBe('failed');
    });

    // Round-2 review — `retryCount` is zero-based (Cloud Tasks attaches 0 on
    // the FIRST delivery), so the budget has to be compared against
    // `MAX_PROVIDER_RETRY_ATTEMPTS - 1`, not the raw constant. Getting that
    // wrong (as the pre-fix arithmetic did) meant deliveries 0, 1 AND 2 all
    // answered 503 for a budget of 3, so a queue configured with
    // `maxAttempts: 3` (KAN-38) gave up after its third delivery with the
    // job left `pending` forever — no terminal row, no telemetry line.
    // These two pin the exact boundary the constant (currently 3) promises:
    // the second-to-last delivery is still retryable, the last is final.
    it('pins the boundary: retryCount one below the last allowed delivery is still retryable (503, reverted to pending)', async () => {
      process.env.GRADING_TASK_SECRET = VALID_SECRET;
      createGradingProviderMock.mockReturnValue(createFakeGradingProvider({ throws: new GradingProviderError('Mistral responded 503') }));
      const job = await seedJob();

      const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET, { 'x-cloudtasks-taskretrycount': '1' }));

      expect(response.status).toBe(503);
      const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
      expect(stored?.status).toBe('pending');
    });

    it('pins the boundary: retryCount at the last allowed delivery is final (200, recorded failed) — the exact off-by-one round-2 review measured', async () => {
      process.env.GRADING_TASK_SECRET = VALID_SECRET;
      createGradingProviderMock.mockReturnValue(createFakeGradingProvider({ throws: new GradingProviderError('Mistral responded 503') }));
      const job = await seedJob();

      const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET, { 'x-cloudtasks-taskretrycount': '2' }));

      expect(response.status).toBe(200);
      const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.errorType).toBe('providerError');
    });

    it('an invalidProviderResponse is never retried, regardless of the retry-count header, and is recorded failed immediately', async () => {
      process.env.GRADING_TASK_SECRET = VALID_SECRET;
      createGradingProviderMock.mockReturnValue({
        name: 'fake',
        grade: async () => {
          const { providerGradingResponseSchema } = await import('@/lib/contracts/grading');
          providerGradingResponseSchema.parse({ nope: true }); // throws a ZodError
          throw new Error('unreachable');
        },
      });
      const job = await seedJob();

      const response = await POST(processRequest({ jobId: job.id }, VALID_SECRET, { 'x-cloudtasks-taskretrycount': '0' }));

      expect(response.status).toBe(200);
      const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
      expect(stored?.status).toBe('failed');
      expect(stored?.errorType).toBe('invalidProviderResponse');
    });
  });
});
