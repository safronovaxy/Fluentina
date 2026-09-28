/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { createEssay } from '@/lib/db/essays';
import { createGradingJob, markGradingJobFailedUnscoped, markGradingJobSucceededUnscoped } from '@/lib/db/grading-jobs';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import { validLengthContent } from '@/test/essay-content-fixtures';
import type { GuestActor, SystemActor, UserActor } from '@/lib/contracts/actor';
import type { GradingResult } from '@/lib/contracts/grading';

const SYSTEM_ACTOR: SystemActor = { kind: 'system', job: 'test' };

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

async function newUserActor(): Promise<UserActor> {
  return { kind: 'user', userId: await createTestUser() };
}

function getGrading(essayId: string, cookieValue?: string): NextRequest {
  const cookieHeader = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL(`http://localhost:3000/api/essays/${essayId}/grading`), {
    method: 'GET',
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...cookieHeader,
    },
  });
}

function callGet(essayId: string, cookieValue?: string) {
  return GET(getGrading(essayId, cookieValue), { params: Promise.resolve({ id: essayId }) });
}

function sampleResult(): GradingResult {
  return {
    overallScore: 82,
    overallBand: 'B2 (pass)',
    dimensions: [
      { dimension: 'textStructureCohesion', score: 82, comment: 'c' },
      { dimension: 'vocabularyLexicalDensity', score: 82, comment: 'c' },
      { dimension: 'grammarSyntax', score: 82, comment: 'c' },
      { dimension: 'topicRelevanceContentCoverage', score: 82, comment: 'c' },
    ],
    annotations: [{ start: 0, end: 4, dimension: 'grammarSyntax', severity: 'minor', message: 'm', suggestion: null }],
    summary: 'Good work overall.',
    flaggedForReview: false,
  };
}

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('GET /api/essays/[id]/grading — ADR-2 status polling', () => {
  it('rejects a cross-origin request', async () => {
    const req = new NextRequest(new URL('http://localhost:3000/api/essays/x/grading'), {
      headers: { origin: 'https://evil.example', host: 'localhost:3000' },
    });
    const response = await GET(req, { params: Promise.resolve({ id: 'x' }) });
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe('crossOrigin');
  });

  it('rejects a missing/invalid session cookie', async () => {
    const response = await callGet(randomUUID());
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toBe('invalidSessionCookie');
  });

  it('returns 404 gradingJobNotFound for an essay id that does not exist', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);

    const response = await callGet(randomUUID(), actor.sessionId);

    expect(response.status).toBe(404);
    expect((await response.json()).reason).toBe('gradingJobNotFound');
  });

  it('returns the same 404 for an essay that exists but belongs to someone else — not found and not yours are indistinguishable', async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);
    const essay = await createEssay(owner, validLengthContent('Owned by someone else.'));
    await createGradingJob(owner, essay.id);

    const response = await callGet(essay.id, stranger.sessionId);

    expect(response.status).toBe(404);
    expect((await response.json()).reason).toBe('gradingJobNotFound');
  });

  it('reports "pending" while the job has not been marked succeeded/failed yet', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, validLengthContent('Still grading.'));
    await createGradingJob(actor, essay.id);

    const response = await callGet(essay.id, actor.sessionId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('pending');
    expect(body.result).toBeNull();
  });

  it('BR-3.1/BR-3.2/BR-3.3: returns the full GradingResult — rubric dimensions, overall score, and span-anchored annotations — once succeeded', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, validLengthContent('Graded already.'));
    const job = (await createGradingJob(actor, essay.id))!;
    await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
      provider: 'fake',
      rawInput: 'prompt',
      rawOutput: 'raw',
      result: sampleResult(),
      promptInjectionSuspected: false,
    });

    const response = await callGet(essay.id, actor.sessionId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('succeeded');
    expect(body.result.overallScore).toBe(82);
    expect(body.result.dimensions).toHaveLength(4);
    expect(body.result.annotations[0]).toMatchObject({ start: 0, end: 4 });
    // Never leaks the raw prompt or raw provider response — ADR-5's own
    // requirement that this is Postgres-internal, not part of the public
    // response.
    expect(body.rawInput).toBeUndefined();
    expect(body.rawOutput).toBeUndefined();
  });

  it('returns a stable failureReason, not a generic error, once the job failed', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, validLengthContent('Grading failed.'));
    const job = (await createGradingJob(actor, essay.id))!;
    await markGradingJobFailedUnscoped(SYSTEM_ACTOR, job.id, 'providerError', 'mistral');

    const response = await callGet(essay.id, actor.sessionId);
    const body = await response.json();

    expect(body.status).toBe('failed');
    expect(body.failureReason).toBe('providerError');
    expect(body.result).toBeNull();
  });

  it('KAN-10 non-negotiable: after conversion, the OLD session id can no longer poll this job at all', async () => {
    // Only the OLD session id's side is exercised through this HTTP route —
    // there is no "registered-user session cookie" shape built yet
    // (registration is a future story), so the NEW user id's ability to
    // read the same job is proved instead at the data layer
    // (`lib/db/grading-jobs.test.ts`'s own conversion test), not re-proved
    // here through a cookie shape that doesn't exist.
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, validLengthContent('Will be converted.'));
    await createGradingJob(actor, essay.id);
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);

    const asOldSession = await callGet(essay.id, actor.sessionId);
    expect(asOldSession.status).toBe(404);
  });
});
