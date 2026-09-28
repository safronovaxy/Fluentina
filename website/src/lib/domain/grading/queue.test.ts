/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';

const runGradingJobMock = vi.fn().mockResolvedValue(undefined);
vi.mock('./orchestrate-grading', () => ({ runGradingJob: runGradingJobMock }));

describe('enqueueGradingJob — ADR-2 queue seam', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    // `.mockReset()`, not just `.mockClear()`: the finding-16 'off'-mode
    // tests below set a custom `.mockImplementation` to observe call order,
    // which a bare `mockClear()` (call history only) would otherwise leak
    // into every test running after them in this file.
    runGradingJobMock.mockReset().mockResolvedValue(undefined);
    vi.unstubAllGlobals();
  });

  it('ADR-2: "essay submission returns immediately" — enqueueGradingJob resolves without waiting for the job itself to finish', async () => {
    delete process.env.GRADING_QUEUE_MODE;
    const { enqueueGradingJob } = await import('./queue');

    // A deferred that only WE resolve, later — if `enqueueGradingJob`
    // secretly awaited `runGradingJob` to completion, awaiting it below
    // would hang until `resolveJob()` is called, which it isn't before the
    // race. This is the actual guarantee ADR-2 needs ("returns immediately",
    // i.e. never blocks on grading finishing), independent of exactly how
    // many microtask ticks the scheduling itself takes.
    let resolveJob!: () => void;
    const jobPromise = new Promise<void>((resolve) => {
      resolveJob = resolve;
    });
    runGradingJobMock.mockReturnValueOnce(jobPromise);

    const outcome = await Promise.race([
      enqueueGradingJob('job-1').then(() => 'enqueue-resolved' as const),
      new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 50)),
    ]);

    expect(outcome).toBe('enqueue-resolved');
    resolveJob(); // let the still-pending job settle so it doesn't leak into the next test
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runGradingJobMock).toHaveBeenCalledWith('job-1');
  });

  it('a job that throws during inline dispatch is caught, not left as an unhandled rejection', async () => {
    delete process.env.GRADING_QUEUE_MODE;
    const { enqueueGradingJob } = await import('./queue');
    runGradingJobMock.mockRejectedValueOnce(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await enqueueGradingJob('job-2');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('GRADING_QUEUE_MODE=cloud-tasks fails loudly on missing configuration rather than silently no-op enqueueing', async () => {
    process.env.GRADING_QUEUE_MODE = 'cloud-tasks';
    delete process.env.GCP_PROJECT_ID;
    const { enqueueGradingJob } = await import('./queue');

    await expect(enqueueGradingJob('job-3')).rejects.toThrow(/GCP_PROJECT_ID/);
  });

  // KAN-16 round-1 review, finding 16. Every test here drains at its own
  // START, before asserting or clearing anything — this module-scoped queue
  // is, by design, shared across every test in this FILE (not just this
  // describe block), so a leftover, never-drained job from a PRECEDING test
  // is expected and must not leak into what THIS test asserts about its own
  // jobs.
  describe('GRADING_QUEUE_MODE=off — records the job and runs nothing until explicitly drained', () => {
    it('does not invoke runGradingJob at all while queued', async () => {
      process.env.GRADING_QUEUE_MODE = 'off';
      const { enqueueGradingJob, drainGradingQueueForTests } = await import('./queue');
      await drainGradingQueueForTests();
      runGradingJobMock.mockClear();

      await enqueueGradingJob('off-job-1');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(runGradingJobMock).not.toHaveBeenCalled();
    });

    it('drainGradingQueueForTests runs every queued job, in order, and awaits each to completion', async () => {
      process.env.GRADING_QUEUE_MODE = 'off';
      const { enqueueGradingJob, drainGradingQueueForTests } = await import('./queue');
      await drainGradingQueueForTests();
      runGradingJobMock.mockClear();
      const callOrder: string[] = [];
      runGradingJobMock.mockImplementation(async (jobId: string) => {
        callOrder.push(jobId);
      });

      await enqueueGradingJob('off-job-2');
      await enqueueGradingJob('off-job-3');
      expect(runGradingJobMock).not.toHaveBeenCalled();

      await drainGradingQueueForTests();

      expect(callOrder).toEqual(['off-job-2', 'off-job-3']);
    });

    it('draining an empty queue is a no-op, not an error', async () => {
      process.env.GRADING_QUEUE_MODE = 'off';
      const { drainGradingQueueForTests } = await import('./queue');
      await drainGradingQueueForTests(); // flush any leftover from a preceding test
      runGradingJobMock.mockClear();

      await expect(drainGradingQueueForTests()).resolves.toBeUndefined();

      expect(runGradingJobMock).not.toHaveBeenCalled();
    });

    it('draining twice in a row only runs each job once — the queue is consumed, not re-read', async () => {
      process.env.GRADING_QUEUE_MODE = 'off';
      const { enqueueGradingJob, drainGradingQueueForTests } = await import('./queue');
      await drainGradingQueueForTests();
      runGradingJobMock.mockClear();

      await enqueueGradingJob('off-job-4');
      await drainGradingQueueForTests();
      await drainGradingQueueForTests();

      expect(runGradingJobMock).toHaveBeenCalledTimes(1);
    });
  });

  it('GRADING_QUEUE_MODE=cloud-tasks builds the expected Cloud Tasks request shape once fully configured', async () => {
    process.env.GRADING_QUEUE_MODE = 'cloud-tasks';
    process.env.GCP_PROJECT_ID = 'writewise-468912';
    process.env.GRADING_TASKS_QUEUE_LOCATION = 'europe-west10';
    process.env.GRADING_TASKS_QUEUE_NAME = 'grading-jobs';
    process.env.GRADING_TASKS_TARGET_URL = 'https://example.run.app/api/internal/grading-jobs/process';
    process.env.GRADING_TASKS_SERVICE_ACCOUNT_EMAIL = 'grading@example.iam.gserviceaccount.com';
    process.env.GRADING_TASK_SECRET = 'shh';
    const { enqueueGradingJob } = await import('./queue');

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fake-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    await enqueueGradingJob('job-4');

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const [metadataUrl, metadataInit] = fetchSpy.mock.calls[0];
    expect(metadataUrl).toContain('metadata.google.internal');
    expect(metadataInit.headers['Metadata-Flavor']).toBe('Google');

    const [cloudTasksUrl, cloudTasksInit] = fetchSpy.mock.calls[1];
    expect(cloudTasksUrl).toContain('cloudtasks.googleapis.com');
    expect(cloudTasksUrl).toContain('writewise-468912');
    expect(cloudTasksInit.headers.Authorization).toBe('Bearer fake-token');
    const body = JSON.parse(cloudTasksInit.body);
    expect(body.task.httpRequest.url).toBe('https://example.run.app/api/internal/grading-jobs/process');
    expect(body.task.httpRequest.headers['X-Grading-Task-Secret']).toBe('shh');
    expect(body.task.httpRequest.oidcToken.serviceAccountEmail).toBe('grading@example.iam.gserviceaccount.com');
    const decodedBody = JSON.parse(Buffer.from(body.task.httpRequest.body, 'base64').toString('utf8'));
    expect(decodedBody).toEqual({ jobId: 'job-4' });
  });
});
