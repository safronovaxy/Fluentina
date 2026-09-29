/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as essayRead from '@/lib/domain/essay-read';
import { getGradingStatus } from './grading-status';
import { createEssay } from '@/lib/db/essays';
import { convertGuestSessionToUser, createGuestSession } from '@/lib/db/guest-sessions';
import {
  createGradingJob,
  markGradingJobFailedUnscoped,
  markGradingJobProcessingUnscoped,
  markGradingJobSucceededUnscoped,
} from '@/lib/db/grading-jobs';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { closePool, createTestUser, resetDatabase } from '@/test/db-fixtures';
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
import { RUBRIC_DIMENSIONS, type GradingAnnotation, type GradingResult } from '@/lib/contracts/grading';
import type { GuestActor, SystemActor, UserActor } from '@/lib/contracts/actor';

const SYSTEM_ACTOR: SystemActor = { kind: 'system', job: 'test' };

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

/** A guest with an essay and a job that has finished with `result`. */
async function gradedEssay(result: GradingResult, options: { promptInjectionSuspected?: boolean; content?: string } = {}) {
  const actor = newGuestActor();
  await createGuestSession(actor);
  const essay = await createEssay(actor, options.content ?? REPORT_ESSAY);
  const job = (await createGradingJob(actor, essay.id))!;
  await markGradingJobSucceededUnscoped(SYSTEM_ACTOR, job.id, {
    provider: 'fake',
    rawInput: 'RAW-PROMPT',
    rawOutput: 'RAW-OUTPUT',
    result,
    promptInjectionSuspected: options.promptInjectionSuspected ?? result.flaggedForReview,
  });
  return { actor, essay, job };
}

beforeAll(async () => {
  await resetDatabase();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetDatabase();
});
afterAll(async () => {
  await closePool();
});

describe('getGradingStatus — a guest gets the locked teaser (KAN-19 BR-4.2)', () => {
  it('carries the score, the band, the counts and one worked example — and says the report is locked', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const job = await getGradingStatus(actor, essay.id);

    expect(job?.status).toBe('succeeded');
    expect(job?.report).toEqual({
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

  it('the locked variant has no `result` key at all — structurally absent, not undefined', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const report = (await getGradingStatus(actor, essay.id))!.report!;

    expect(Object.keys(report).sort()).toEqual(
      ['access', 'annotationCount', 'annotationCountByDimension', 'overallBand', 'overallScore', 'workedExample'].sort(),
    );
    expect('result' in report).toBe(false);
  });

  it('never carries the summary, in any form, or any dimension score or comment', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const report = (await getGradingStatus(actor, essay.id))!.report!;
    const wire = JSON.stringify(report);

    expect(wire).not.toContain(REPORT_SUMMARY);
    // Not truncated, not a first sentence, not a length — no fragment of it.
    expect(wire).not.toContain('HIDDEN-SUMMARY');
    expect(wire).not.toContain('Zusammenfassung');
    expect(wire).not.toMatch(/summary/i);
    for (const dimension of RUBRIC_DIMENSIONS) expect(wire).not.toContain(reportDimensionComment(dimension));
    expect(wire).not.toMatch(/comment/i);
    expect(wire).not.toMatch(/"dimensions"/);
    // The four dimension scores (70..73 in the fixture) are not sent either.
    expect(wire).not.toMatch(/"score"/);
  });

  it('never carries a withheld annotation — its message, its suggestion, its text, or its span', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const wire = JSON.stringify((await getGradingStatus(actor, essay.id))!.report);

    for (const withheld of withheldFromGuest()) expect(wire).not.toContain(withheld);
    // The essay's own words at the other annotated places are not sent.
    for (const text of WITHHELD_SPAN_TEXT) expect(wire).not.toContain(text);
    // Not even the offsets with the text stripped: a list of WHERE the essay
    // went wrong is the most self-diagnosable part of the report.
    expect(wire).not.toMatch(/"start"|"end"|"annotations"/);
  });

  it('the shown example carries no offsets either — only the sentence, already cut', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const example = (await getGradingStatus(actor, essay.id))!.report as unknown as { workedExample: Record<string, unknown> };

    expect(Object.keys(example.workedExample).sort()).toEqual(
      ['after', 'before', 'dimension', 'highlighted', 'message', 'severity', 'suggestion'].sort(),
    );
  });

  // Guards the tests above from passing on an empty fixture: everything they
  // say is absent is really present in the stored result, and the `full` test
  // below reads it all back.
  it('the fixture really has something to leak: every withheld marker is in the stored result', () => {
    const stored = JSON.stringify(richResult());

    expect(withheldFromGuest().length).toBeGreaterThan(8);
    for (const marker of withheldFromGuest()) expect(stored).toContain(marker);
    for (const text of WITHHELD_SPAN_TEXT) expect(REPORT_ESSAY).toContain(text);
  });

  it('counts every annotation including the one shown, with all four dimension keys present, zeros included', async () => {
    const onlyGrammar: GradingAnnotation[] = richResult().annotations.filter((a) => a.dimension === 'grammarSyntax');
    const { actor, essay } = await gradedEssay(richResult({ annotations: onlyGrammar }));

    const report = (await getGradingStatus(actor, essay.id))!.report!;

    expect(report).toMatchObject({
      annotationCount: 2,
      annotationCountByDimension: {
        textStructureCohesion: 0,
        vocabularyLexicalDensity: 0,
        grammarSyntax: 2,
        topicRelevanceContentCoverage: 0,
      },
    });
    if (report.access !== 'locked') throw new Error('expected a locked report');
    expect(Object.keys(report.annotationCountByDimension).sort()).toEqual([...RUBRIC_DIMENSIONS].sort());
    expect(Object.values(report.annotationCountByDimension).reduce((a, b) => a + b, 0)).toBe(report.annotationCount);
  });

  it('has no per-severity counts and no completeness flags — the summary always exists, so a flag would be a constant', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const { workedExample, ...rest } = (await getGradingStatus(actor, essay.id))!.report as { workedExample: unknown };

    // (The shown example has its own `severity`; the counts must not.)
    expect(workedExample).not.toBeNull();
    expect(JSON.stringify(rest)).not.toMatch(/severity|"minor"|"moderate"|"major"|hasSummary|hasDimensions|has[A-Z]/);
  });

  it('an essay with no annotations is still a locked report, with a zero total and no example', async () => {
    const { actor, essay } = await gradedEssay(richResult({ annotations: [] }));

    expect((await getGradingStatus(actor, essay.id))!.report).toMatchObject({
      access: 'locked',
      annotationCount: 0,
      workedExample: null,
    });
  });
});

// KAN-18's picking rules, exercised through the real path: the server holds
// the whole annotation list, so ranking and the fall-through both still work.
describe('getGradingStatus — the worked example is picked from ALL the annotations (not a one-element list)', () => {
  it('picks the most serious annotation, not the first or the last', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const report = (await getGradingStatus(actor, essay.id))!.report as { workedExample: { message: string } };

    expect(report.workedExample.message).toBe(SHOWN_MESSAGE);
  });

  it('falls back to the next usable annotation when the best-ranked span does not fit the essay text', async () => {
    const annotations = [
      { ...richResult().annotations[1], start: 900, end: 930 }, // the major one — no longer inside the essay
      ...richResult().annotations.filter((a) => a.message !== SHOWN_MESSAGE),
    ];
    const { actor, essay } = await gradedEssay(richResult({ annotations }));

    const report = (await getGradingStatus(actor, essay.id))!.report as { workedExample: { message: string } | null; annotationCount: number };

    // The moderate one, with its own sentence — not `null`.
    expect(report.workedExample?.message).toBe('HIDDEN-MESSAGE-2');
    expect(report.annotationCount).toBe(5);
  });

  it('is null — no example invented — when no annotation fits the essay, but the counts stay honest', async () => {
    const unfit = richResult().annotations.map((a) => ({ ...a, start: 900, end: 930 }));
    const { actor, essay } = await gradedEssay(richResult({ annotations: unfit }));

    const report = (await getGradingStatus(actor, essay.id))!.report;

    expect(report).toMatchObject({ access: 'locked', workedExample: null, annotationCount: 5 });
  });
});

describe('getGradingStatus — a flagged result withholds everything, at every access level', () => {
  const flagged = () =>
    richResult({
      flaggedForReview: true,
      overallScore: 55,
      overallBand: 'B1 (below target)',
      summary: 'HIDDEN-CLAMPED-SUMMARY capped because the essay tried to influence grading',
    });

  it('a guest gets the flag and nothing else — no score, band, counts or example', async () => {
    const { actor, essay } = await gradedEssay(flagged());

    const job = await getGradingStatus(actor, essay.id);

    expect(job?.report).toStrictEqual({ access: 'withheld', reason: 'flaggedForReview' });
  });

  it('nothing from the distrusted model reaches the wire: the clamp leaves annotations untouched, so they are the leak', async () => {
    const { actor, essay } = await gradedEssay(flagged());

    // The report alone: the job's own `createdAt` timestamp is allowed to contain "55".
    const wire = JSON.stringify((await getGradingStatus(actor, essay.id))!.report);

    for (const marker of [SHOWN_MESSAGE, SHOWN_SUGGESTION, 'HIDDEN-MESSAGE', 'HIDDEN-SUGGESTION', 'HIDDEN-CLAMPED', 'HIDDEN-COMMENT']) {
      expect(wire).not.toContain(marker);
    }
    expect(wire).not.toContain('55');
    expect(wire).not.toMatch(/"start"|"end"|"annotations"|"dimensions"|overallScore/);
  });

  it('flagged wins over access level: a registered owner does not get the full payload either', async () => {
    const { actor, essay } = await gradedEssay(flagged());
    const user: UserActor = { kind: 'user', userId: await createTestUser() };
    await convertGuestSessionToUser(actor, user.userId);

    const job = await getGradingStatus(user, essay.id);

    expect(job?.report).toStrictEqual({ access: 'withheld', reason: 'flaggedForReview' });
  });

  it('is withheld when the JOB ROW says injection was suspected even if the stored result does not carry the flag — the gate fails closed', async () => {
    const { actor, essay } = await gradedEssay(richResult({ flaggedForReview: false }), { promptInjectionSuspected: true });

    expect((await getGradingStatus(actor, essay.id))!.report).toStrictEqual({ access: 'withheld', reason: 'flaggedForReview' });
  });

  it('does not even read the essay text for a flagged result — there is no example to cut', async () => {
    const { actor, essay } = await gradedEssay(flagged());
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    await getGradingStatus(actor, essay.id);

    expect(read).not.toHaveBeenCalled();
  });
});

// THE REGISTRATION SEAM, exercised against real rows: a real `users` row, a
// real conversion, the real ownership predicate. Not a stub.
describe('getGradingStatus — after registration (KAN-19 seam; KAN-10 cutover)', () => {
  it('the converted owner receives the FULL report — every annotation, the summary, the dimension scores', async () => {
    const { actor, essay } = await gradedEssay(richResult());
    const user: UserActor = { kind: 'user', userId: await createTestUser() };
    await convertGuestSessionToUser(actor, user.userId);

    const job = await getGradingStatus(user, essay.id);

    expect(job?.status).toBe('succeeded');
    const report = job!.report!;
    expect(report.access).toBe('full');
    if (report.access !== 'full') throw new Error('expected a full report');
    expect(report.result.summary).toBe(REPORT_SUMMARY);
    expect(report.result.annotations).toHaveLength(5);
    expect(report.result.annotations.map((a) => a.message)).toContain('HIDDEN-MESSAGE-4');
    expect(report.result.dimensions).toHaveLength(4);
    expect(report.result.dimensions.map((d) => d.score)).toEqual([70, 71, 72, 73]);
    expect(report.result.dimensions.map((d) => d.comment)).toEqual(RUBRIC_DIMENSIONS.map(reportDimensionComment));
    // The owner gets the worked example too, cut from their own essay.
    expect(report.workedExample).toMatchObject({ highlighted: 'bin ich zu Hause geblieben' });
  });

  it('and the OLD guest session id then reads nothing at all — the cutover rule', async () => {
    const { actor, essay } = await gradedEssay(richResult());
    const user: UserActor = { kind: 'user', userId: await createTestUser() };
    await convertGuestSessionToUser(actor, user.userId);

    expect(await getGradingStatus(actor, essay.id)).toBeNull();
  });

  it("a registered user cannot read someone else's grade — a full report is still row-level owned", async () => {
    const { essay } = await gradedEssay(richResult());
    const stranger: UserActor = { kind: 'user', userId: await createTestUser() };

    expect(await getGradingStatus(stranger, essay.id)).toBeNull();
  });
});

describe('getGradingStatus — the rest of the job', () => {
  it('is null for an essay that does not exist, or is not the caller\'s', async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);
    const essay = await createEssay(owner, REPORT_ESSAY);
    await createGradingJob(owner, essay.id);

    expect(await getGradingStatus(stranger, essay.id)).toBeNull();
    expect(await getGradingStatus(owner, randomUUID())).toBeNull();
  });

  it('the job carries exactly status, createdAt, failureReason and report — no ids, no provider, no completedAt', async () => {
    const { actor, essay } = await gradedEssay(richResult());

    const job = (await getGradingStatus(actor, essay.id))!;

    expect(Object.keys(job).sort()).toEqual(['createdAt', 'failureReason', 'report', 'status']);
    expect(JSON.stringify(job)).not.toMatch(/RAW-PROMPT|RAW-OUTPUT|fake|essayId|provider|completedAt|rawInput|rawOutput/);
  });

  it('a pending job has no report and reads no essay text', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    await createGradingJob(actor, essay.id);
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    const job = await getGradingStatus(actor, essay.id);

    expect(job).toMatchObject({ status: 'pending', report: null, failureReason: null });
    expect(job?.createdAt).toBeInstanceOf(Date);
    expect(read).not.toHaveBeenCalled();
  });

  it('a processing job has no report and reads no essay text', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    const created = (await createGradingJob(actor, essay.id))!;
    await markGradingJobProcessingUnscoped(SYSTEM_ACTOR, created.id);
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    expect(await getGradingStatus(actor, essay.id)).toMatchObject({ status: 'processing', report: null });
    expect(read).not.toHaveBeenCalled();
  });

  it('a failed job carries its reason and no report, and reads no essay text', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, REPORT_ESSAY);
    const created = (await createGradingJob(actor, essay.id))!;
    await markGradingJobFailedUnscoped(SYSTEM_ACTOR, created.id, 'providerError', 'mistral');
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    expect(await getGradingStatus(actor, essay.id)).toMatchObject({ status: 'failed', failureReason: 'providerError', report: null });
    expect(read).not.toHaveBeenCalled();
  });

  it('a succeeded job reads the essay exactly once, through the ownership-scoped read, as the same actor', async () => {
    const { actor, essay } = await gradedEssay(richResult());
    const read = vi.spyOn(essayRead, 'getOwnedEssay');

    await getGradingStatus(actor, essay.id);

    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(actor, essay.id);
  });

  it('an essay deleted between the two reads gives no example — the existing "no example" state, not an error', async () => {
    const { actor, essay } = await gradedEssay(richResult());
    vi.spyOn(essayRead, 'getOwnedEssay').mockResolvedValueOnce(null);

    const job = await getGradingStatus(actor, essay.id);

    expect(job?.report).toMatchObject({ access: 'locked', overallScore: 82, annotationCount: 5, workedExample: null });
  });

  // Essay text and the sentence cut from it must never reach a log line, and
  // this path is polled ~48 times per essay: it logs nothing at all.
  it('writes nothing to any console stream, for any outcome', async () => {
    const streams = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const { actor, essay } = await gradedEssay(richResult());
    const flagged = await gradedEssay(richResult({ flaggedForReview: true }));
    const user: UserActor = { kind: 'user', userId: await createTestUser() };
    await convertGuestSessionToUser(actor, user.userId);

    await getGradingStatus(user, essay.id);
    await getGradingStatus(flagged.actor, flagged.essay.id);
    await getGradingStatus(flagged.actor, randomUUID());

    for (const stream of streams) expect(stream).not.toHaveBeenCalled();
  });
});
