/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { createEssay } from '@/lib/db/essays';
import { createGradingJob, getGradingJobByIdUnscoped } from '@/lib/db/grading-jobs';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import { validLengthContent } from '@/test/essay-content-fixtures';
import type { GuestActor, SystemActor } from '@/lib/contracts/actor';

const SYSTEM_ACTOR: SystemActor = { kind: 'system', job: 'test' };

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

function processRequest(body: unknown, secretHeader?: string): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/internal/grading-jobs/process'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(secretHeader !== undefined ? { 'x-grading-task-secret': secretHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
  vi.unstubAllEnvs();
  delete process.env.GRADING_TASK_SECRET;
});

afterAll(async () => {
  await closePool();
});

describe('POST /api/internal/grading-jobs/process — the Cloud Tasks target (production only)', () => {
  it('rejects a request with no GRADING_TASK_SECRET configured at all', async () => {
    delete process.env.GRADING_TASK_SECRET;
    const response = await POST(processRequest({ jobId: 'x' }, 'anything'));
    expect(response.status).toBe(401);
  });

  it('rejects a request presenting the wrong secret', async () => {
    process.env.GRADING_TASK_SECRET = 'correct-secret';
    const response = await POST(processRequest({ jobId: 'x' }, 'wrong-secret'));
    expect(response.status).toBe(401);
  });

  it('rejects a request with no secret header at all', async () => {
    process.env.GRADING_TASK_SECRET = 'correct-secret';
    const response = await POST(processRequest({ jobId: 'x' }));
    expect(response.status).toBe(401);
  });

  it('rejects a malformed JSON body', async () => {
    process.env.GRADING_TASK_SECRET = 'correct-secret';
    const req = new NextRequest(new URL('http://localhost:3000/api/internal/grading-jobs/process'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-grading-task-secret': 'correct-secret' },
      body: '{not json',
    });
    const response = await POST(req);
    expect(response.status).toBe(400);
  });

  it('rejects a body with no jobId', async () => {
    process.env.GRADING_TASK_SECRET = 'correct-secret';
    const response = await POST(processRequest({}, 'correct-secret'));
    expect(response.status).toBe(400);
  });

  it('with the correct secret, actually runs the grading job and returns 200', async () => {
    process.env.GRADING_TASK_SECRET = 'correct-secret';
    process.env.MOCK_GRADING_PROVIDER = '1';
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, validLengthContent('Processed via the internal route.'));
    const job = await createGradingJob(actor, essay.id);

    const response = await POST(processRequest({ jobId: job.id }, 'correct-secret'));

    expect(response.status).toBe(200);
    const stored = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
    expect(stored?.status).toBe('succeeded');
  });

  it('returns 200 even for a jobId that does not exist — Cloud Tasks should not retry a job that will never exist', async () => {
    process.env.GRADING_TASK_SECRET = 'correct-secret';
    const response = await POST(processRequest({ jobId: 'nonexistent-job-id' }, 'correct-secret'));
    expect(response.status).toBe(200);
  });
});
