/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { UserActor as RegisteredUser } from '@/lib/contracts/actor';

// The registered-session lookup is KAN-20's seam and finds nothing today;
// this lets one test stand a registered session in front of the route, to
// prove the resolution ORDER end to end (see `owner-actor.ts`).
const registeredSession = vi.hoisted(() => ({ current: null as RegisteredUser | null }));
vi.mock('@/lib/domain/registered-session', () => ({
  resolveRegisteredSession: async () => registeredSession.current,
}));

import { GET } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { createEssay } from '@/lib/db/essays';
import { createGradingJob, markGradingJobFailedUnscoped, markGradingJobSucceededUnscoped } from '@/lib/db/grading-jobs';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import { validLengthContent } from '@/test/essay-content-fixtures';
import type { GuestActor, SystemActor, UserActor } from '@/lib/contracts/actor';
import { RUBRIC_DIMENSIONS, type GradingResult } from '@/lib/contracts/grading';
import {
  REPORT_COUNTS_BY_DIMENSION,
  REPORT_ESSAY,
  REPORT_SUMMARY,
  SHOWN_MESSAGE,
  SHOWN_SUGGESTION,
  WITHHELD_SPAN_TEXT,
  reportDimensionComment,
  richResult,
  withheldFromGuest,
} from '@/test/grading-report-fixtures';

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

beforeEach(() => {
  registeredSession.current = null;
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
    expect(body.report).toBeNull();
  });

  // KAN-17: the preview screen bounds its poll, times the wait and decides
  // "taking longer than we aim for" from this one field; without a readable
  // `createdAt` on an unfinished job it renders the poll-error screen. So the
  // field is part of this route's contract, not an incidental extra.
  it('sends the job\'s `createdAt` for a job that has not finished — the guest\'s waiting screen is built on it', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, validLengthContent('Timing matters.'));
    const job = (await createGradingJob(actor, essay.id))!;

    const body = await (await callGet(essay.id, actor.sessionId)).json();

    expect(body.createdAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
    expect(body.createdAt).toBe(job.createdAt.toISOString());
  });

  it('KAN-19 BR-4.2: a guest\'s succeeded job is a LOCKED report — score, band, counts and one example — not the GradingResult', async () => {
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
    expect(body.report.access).toBe('locked');
    expect(body.report.overallScore).toBe(82);
    expect(body.report.overallBand).toBe('B2 (pass)');
    expect(body.report.annotationCount).toBe(1);
    expect(body.result).toBeUndefined();
    expect(body.report.result).toBeUndefined();
    // Never leaks the raw prompt or raw provider response — ADR-5's own
    // requirement that this is Postgres-internal, not part of the public
    // response.
    expect(body.rawInput).toBeUndefined();
    expect(body.rawOutput).toBeUndefined();
  });

  it('carries the fields the browser reads and NO identifiers or provider name — id, essayId, provider and completedAt are off the wire', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    const job = (await createGradingJob(actor, essay.id))!;
    await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
      provider: 'claude',
      rawInput: 'prompt',
      rawOutput: 'raw',
      result: richResult(),
      promptInjectionSuspected: false,
    });

    const body = await (await callGet(essay.id, actor.sessionId)).json();

    expect(Object.keys(body).sort()).toEqual(['createdAt', 'failureReason', 'report', 'status']);
    const wire = JSON.stringify(body);
    // `provider` announced claude-vs-mistral to anyone probing BR-3.5's guard.
    expect(wire).not.toMatch(/claude|mistral|"provider"|"completedAt"|"essayId"/);
    expect(wire).not.toContain(job.id);
    expect(wire).not.toContain(essay.id);
  });

  it('says on the response that it is private and not to be stored — the same URL answers differently depending on who asks', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    await createGradingJob(actor, essay.id);

    const response = await callGet(essay.id, actor.sessionId);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
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
    expect(body.report).toBeNull();
  });

  it('KAN-10 non-negotiable: after conversion, the OLD session id can no longer poll this job at all', async () => {
    // Only the OLD session id's side is exercised here; the NEW user's read
    // of the same job is proved next door (the KAN-19 registered-owner tests,
    // which stand a registered session in front of this route) and at the
    // data layer (`lib/db/grading-jobs.test.ts`).
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

// THE REGRESSION NET (KAN-19). The domain tests pin what `getGradingStatus`
// returns; this pins what actually goes down the wire, as text, so a leak
// added later — a new field on the result, a spread in the wrong place —
// fails here even if it travels through the right function. An allow-list:
// nothing but the strings a guest may see.
describe('GET /api/essays/[id]/grading — a guest\'s serialised response never contains what is locked (KAN-19 BR-4.2)', () => {
  async function succeededFor(actor: GuestActor, result: GradingResult, promptInjectionSuspected = false) {
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    const job = (await createGradingJob(actor, essay.id))!;
    await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
      provider: 'fake',
      rawInput: 'prompt',
      rawOutput: 'raw',
      result,
      promptInjectionSuspected,
    });
    return essay;
  }

  it('contains none of the withheld strings — the summary, each dimension comment, every annotation message but the shown example\'s', async () => {
    const actor = newGuestActor();
    const essay = await succeededFor(actor, richResult());

    const response = await callGet(essay.id, actor.sessionId);
    const wire = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(withheldFromGuest().length).toBeGreaterThan(8);
    for (const withheld of withheldFromGuest()) expect(wire, `leaked: ${withheld}`).not.toContain(withheld);
    expect(wire).not.toContain(REPORT_SUMMARY);
    for (const dimension of RUBRIC_DIMENSIONS) expect(wire).not.toContain(reportDimensionComment(dimension));
    for (const text of WITHHELD_SPAN_TEXT) expect(wire, `leaked span text: ${text}`).not.toContain(text);
    // Every withheld marker in the fixture starts with "HIDDEN-": a truncated
    // or reworded fragment of one is caught here even though it is not the
    // whole string above.
    expect(wire).not.toContain('HIDDEN-');
    expect(wire).not.toMatch(/"start"|"end"|"annotations"|"dimensions"|"summary"|"comment"/);
  });

  it('and does contain what the guest IS shown — so the checks above are not passing on an empty body', async () => {
    const actor = newGuestActor();
    const essay = await succeededFor(actor, richResult());

    const body = await (await callGet(essay.id, actor.sessionId)).json();

    expect(body.report).toEqual({
      access: 'locked',
      overallScore: 82,
      overallBand: 'B2 (pass)',
      annotationCount: 5,
      annotationCountByDimension: REPORT_COUNTS_BY_DIMENSION,
      workedExample: {
        dimension: 'grammarSyntax',
        severity: 'major',
        message: SHOWN_MESSAGE,
        suggestion: SHOWN_SUGGESTION,
        before: 'Gestern ',
        highlighted: 'bin ich zu Hause geblieben',
        after: ', weil es regnete.',
      },
    });
  });

  it('a flagged result is `withheld` on the wire: the flag and nothing else', async () => {
    const actor = newGuestActor();
    const essay = await succeededFor(
      actor,
      richResult({ flaggedForReview: true, overallScore: 55, overallBand: 'B1 (below target)', summary: 'HIDDEN-CLAMPED-SUMMARY' }),
    );

    const body = await (await callGet(essay.id, actor.sessionId)).json();

    expect(body.report).toStrictEqual({ access: 'withheld', reason: 'flaggedForReview' });
    const wire = JSON.stringify(body.report);
    for (const marker of [SHOWN_MESSAGE, SHOWN_SUGGESTION, 'HIDDEN-']) expect(wire).not.toContain(marker);
  });
});

describe('GET /api/essays/[id]/grading — a registered owner, resolved ahead of a stale guest cookie (KAN-19)', () => {
  async function convertedEssay() {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    const job = (await createGradingJob(actor, essay.id))!;
    await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
      provider: 'fake',
      rawInput: 'prompt',
      rawOutput: 'raw',
      result: richResult(),
      promptInjectionSuspected: false,
    });
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);
    return { actor, essay, user };
  }

  it('the converted owner is sent the FULL report even though the browser still holds their old guest cookie', async () => {
    const { actor, essay, user } = await convertedEssay();
    registeredSession.current = user;

    const response = await callGet(essay.id, actor.sessionId); // the stale cookie rides along
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.report.access).toBe('full');
    expect(body.report.result.summary).toBe(REPORT_SUMMARY);
    expect(body.report.result.annotations).toHaveLength(5);
  });

  it('...whereas the same stale cookie alone — no registered session — opens nothing: the old session id stopped authorising', async () => {
    const { actor, essay } = await convertedEssay();

    const response = await callGet(essay.id, actor.sessionId);

    expect(response.status).toBe(404);
  });

  it('a registered owner is not a wildcard: they still cannot read a stranger\'s essay', async () => {
    const { essay } = await convertedEssay();
    registeredSession.current = await newUserActor();

    const response = await callGet(essay.id);

    expect(response.status).toBe(404);
  });

  it('a registered owner with no guest cookie at all is still resolved — the guest cookie is only a fallback', async () => {
    const { essay, user } = await convertedEssay();
    registeredSession.current = user;

    const response = await callGet(essay.id); // no cookie

    expect(response.status).toBe(200);
    expect((await response.json()).report.access).toBe('full');
  });

  it('a flagged result is withheld from the registered owner as well — the flag wins over access level', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    const job = (await createGradingJob(actor, essay.id))!;
    await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
      provider: 'fake',
      rawInput: 'prompt',
      rawOutput: 'raw',
      result: richResult({ flaggedForReview: true }),
      promptInjectionSuspected: true,
    });
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);
    registeredSession.current = user;

    const body = await (await callGet(essay.id)).json();

    expect(body.report).toStrictEqual({ access: 'withheld', reason: 'flaggedForReview' });
  });
});
