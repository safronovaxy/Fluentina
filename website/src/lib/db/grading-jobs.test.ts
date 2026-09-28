/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEssay } from './essays';
import { createGuestSession, convertGuestSessionToUser } from './guest-sessions';
import {
  createGradingJob,
  getGradingJobByEssayId,
  getGradingJobByIdUnscoped,
  markGradingJobFailed,
  markGradingJobProcessing,
  markGradingJobSucceeded,
  toPublicGradingJob,
} from './grading-jobs';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestActor, SystemActor, UserActor } from '@/lib/contracts/actor';
import type { GradingResult } from '@/lib/contracts/grading';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

async function newUserActor(): Promise<UserActor> {
  return { kind: 'user', userId: await createTestUser() };
}

const SYSTEM_ACTOR: SystemActor = { kind: 'system', job: 'test' };

function sampleResult(): GradingResult {
  return {
    overallScore: 70,
    overallBand: 'B2 (pass)',
    dimensions: [
      { dimension: 'textStructureCohesion', score: 70, comment: 'c' },
      { dimension: 'vocabularyLexicalDensity', score: 70, comment: 'c' },
      { dimension: 'grammarSyntax', score: 70, comment: 'c' },
      { dimension: 'topicRelevanceContentCoverage', score: 70, comment: 'c' },
    ],
    annotations: [],
    summary: 'Summary.',
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

describe('createGradingJob / getGradingJobByEssayId — ownership joins through essays', () => {
  it('a freshly created job is pending, with no provider or result yet', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'An essay awaiting grading.');

    const job = await createGradingJob(actor, essay.id);

    expect(job.status).toBe('pending');
    expect(job.provider).toBeNull();
    expect(job.result).toBeNull();
  });

  it('the owning guest can read their own job by essay id', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Essay content.');
    await createGradingJob(actor, essay.id);

    const job = await getGradingJobByEssayId(actor, essay.id);

    expect(job).not.toBeNull();
    expect(job?.essayId).toBe(essay.id);
  });

  it('returns null — the same as "not found" — for a stranger reading someone else\'s job', async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);
    const essay = await createEssay(owner, 'Owned by one guest only.');
    await createGradingJob(owner, essay.id);

    const asStranger = await getGradingJobByEssayId(stranger, essay.id);
    const notFoundAtAll = await getGradingJobByEssayId(stranger, randomUUID());

    expect(asStranger).toBeNull();
    expect(notFoundAtAll).toBeNull();
  });

  it('KAN-10 non-negotiable: after the owning session converts, the OLD session id stops authorising reads of its job', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Essay content.');
    await createGradingJob(actor, essay.id);
    const user = await newUserActor();
    await convertGuestSessionToUser(actor, user.userId);

    const asOldSession = await getGradingJobByEssayId(actor, essay.id);
    const asNewUser = await getGradingJobByEssayId(user, essay.id);

    expect(asOldSession).toBeNull();
    expect(asNewUser).not.toBeNull();
  });

  it('returns null when no job was ever created for an essay the caller does own', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'No job created for this one.');

    const job = await getGradingJobByEssayId(actor, essay.id);

    expect(job).toBeNull();
  });
});

describe('markGradingJobProcessing / markGradingJobSucceeded / markGradingJobFailed', () => {
  it('transitions pending -> processing -> succeeded, and the public view exposes the result only once succeeded', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Essay content.');
    const job = await createGradingJob(actor, essay.id);

    await markGradingJobProcessing(SYSTEM_ACTOR, job.id);
    const processing = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
    expect(processing?.status).toBe('processing');

    await markGradingJobSucceeded(SYSTEM_ACTOR, job.id, {
      provider: 'fake',
      rawInput: 'the prompt',
      rawOutput: 'the raw response',
      result: sampleResult(),
      promptInjectionSuspected: false,
    });

    const succeeded = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
    expect(succeeded?.status).toBe('succeeded');
    expect(succeeded?.result?.overallScore).toBe(70);
    expect(succeeded?.rawInput).toBe('the prompt');

    const publicView = toPublicGradingJob(succeeded!);
    expect(publicView.result?.overallScore).toBe(70);
    expect((publicView as unknown as Record<string, unknown>).rawInput).toBeUndefined();
    expect((publicView as unknown as Record<string, unknown>).rawOutput).toBeUndefined();
  });

  it('a failed job carries a failure reason in the public view, and no result', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Essay content.');
    const job = await createGradingJob(actor, essay.id);

    await markGradingJobFailed(SYSTEM_ACTOR, job.id, 'providerError', 'mistral');

    const failed = await getGradingJobByIdUnscoped(SYSTEM_ACTOR, job.id);
    const publicView = toPublicGradingJob(failed!);

    expect(publicView.status).toBe('failed');
    expect(publicView.failureReason).toBe('providerError');
    expect(publicView.result).toBeNull();
  });
});
