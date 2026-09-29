import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enMessages from '@/messages/en.json';
import deMessages from '@/messages/de.json';
import { GradingPreview, BAND_STRING_KEYS, type GradingPreviewStrings } from './GradingPreview';
import { GRADING_POLL_INTERVAL_MS, GRADING_POLL_MAX_AGE_MS, GRADING_SLOW_AFTER_MS } from '@/hooks/use-grading-status';
import {
  bandForScore,
  GRADING_FAILURE_REASONS,
  RUBRIC_DIMENSIONS,
  type GradingAnnotation,
  type GradingFailureReason,
  type GradingResult,
} from '@/lib/contracts/grading';
import { buildGradingResult, clampForSuspectedInjection } from '@/lib/domain/grading/result';

// The REAL catalogues, not hand-written stand-ins: a key missing from the
// `preview` block is a compile error in the page that builds `strings` and
// an `undefined` here, and the German test below exercises the German copy.
const EN = enMessages.chrome.guest.preview as GradingPreviewStrings;
const DE = deMessages.chrome.guest.preview as GradingPreviewStrings;

const ESSAY_ID = 'a6afa382-8223-4b5d-b4ea-d5a7f0694211';
const ESSAY = 'Ich gehe heute ins Kino. Gestern bin ich zu Hause geblieben, weil es regnete. Morgen fahre ich nach Berlin.';
const ERROR_QUOTE = 'bin ich zu Hause geblieben';

function annotation(quote: string, overrides: Partial<GradingAnnotation> = {}): GradingAnnotation {
  const start = ESSAY.indexOf(quote);
  return {
    start,
    end: start + quote.length,
    dimension: 'grammarSyntax',
    severity: 'major',
    message: 'Nach "Gestern" steht das Verb an zweiter Stelle.',
    suggestion: 'Gestern bin ich zu Hause geblieben',
    ...overrides,
  };
}

function gradingResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return {
    overallScore: 80,
    overallBand: bandForScore(80),
    dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score: 80, comment: 'Ein echter Kommentar.' })),
    annotations: [annotation(ERROR_QUOTE)],
    summary: 'Eine echte Zusammenfassung.',
    flaggedForReview: false,
    ...overrides,
  };
}

interface Reply {
  readonly status?: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}
const pending: Reply = { body: { status: 'pending', result: null, failureReason: null } };
const processing: Reply = { body: { status: 'processing', result: null, failureReason: null } };
const succeeded = (result: GradingResult): Reply => ({ body: { status: 'succeeded', result, failureReason: null } });
const failed = (failureReason: GradingFailureReason | null): Reply => ({
  body: { status: 'failed', result: null, failureReason },
});

/**
 * Replies in order, repeating the last one forever — a poller keeps asking.
 *
 * An unfinished job's reply is given the `createdAt` the real endpoint always
 * sends (the poll is bounded on it), fixed when this is called — under fake
 * timers, "now" is the test's clock, so the job ages as the test advances
 * time. `jobAgeMs` is how old the job already is at that moment. A body that
 * sets `createdAt` itself (even to null) is left exactly as written.
 */
function stubFetchForJobAged(jobAgeMs: number, ...replies: Reply[]) {
  const createdAt = new Date(Date.now() - jobAgeMs).toISOString();
  let call = 0;
  const spy = vi.fn(async () => {
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    const body = reply.body as { status?: string } | null;
    const unfinished = body?.status === 'pending' || body?.status === 'processing';
    const withCreatedAt = unfinished && !('createdAt' in body!) ? { ...body, createdAt } : reply.body;
    return new Response(JSON.stringify(withCreatedAt), { status: reply.status ?? 200, headers: reply.headers });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
const stubFetch = (...replies: Reply[]) => stubFetchForJobAged(0, ...replies);

const TRY_AGAIN = <a href="/practice/write">try again slot</a>;

function renderPreview(strings: GradingPreviewStrings = EN) {
  // retryDelay 0: the hook decides WHETHER to retry; how long to wait is
  // TanStack's default backoff, which would only slow these tests down.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <GradingPreview essayId={ESSAY_ID} essayContent={ESSAY} strings={strings} tryAgainAction={TRY_AGAIN} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('GradingPreview — pending: a plain, honest waiting state', () => {
  it('says the essay is being graded, marks the region busy, and shows no score', async () => {
    stubFetch(pending);
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pendingTitle })).toBeInTheDocument();
    expect(screen.getByText(EN.pendingBody)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: EN.pendingTitle })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('overall-score')).toBeNull();
  });

  it('polls the essay\'s own grading status endpoint, with the id encoded into the path', async () => {
    const fetchSpy = stubFetch(pending);
    renderPreview();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(`/api/essays/${ESSAY_ID}/grading`);
  });

  it('a `processing` job is still waiting, not a result', async () => {
    stubFetch(processing);
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pendingTitle })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('overall-score')).toBeNull());
  });
});

describe('GradingPreview — polling (ADR-2: every 2-3 seconds until the job is ready)', () => {
  it('asks again after 2-3 seconds, keeps asking while pending, and shows the score the moment the job succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetch(pending, processing, succeeded(gradingResult()));
    renderPreview();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(GRADING_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
    expect(GRADING_POLL_INTERVAL_MS).toBeLessThanOrEqual(3000);

    await act(() => vi.advanceTimersByTimeAsync(1900));
    expect(fetchSpy).toHaveBeenCalledTimes(1); // not sooner than 2 seconds

    await act(() => vi.advanceTimersByTimeAsync(1200)); // 3.1 seconds in
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2)); // and not later than 3
    expect(screen.queryByTestId('overall-score')).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS));
    await waitFor(() => expect(screen.getByTestId('overall-score')).toHaveTextContent('80'));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['succeeded', succeeded(gradingResult())],
    ['failed', failed('providerError')],
  ])('stops polling once the job has %s', async (_name, terminal) => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetch(terminal);
    renderPreview();

    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-phase', expect.stringMatching(/complete|failed/)));
    const callsWhenDone = fetchSpy.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 6));
    expect(fetchSpy).toHaveBeenCalledTimes(callsWhenDone);
  });

  // The app's shared QueryClient (components/Providers.tsx) sets a
  // 5-minute staleTime for CMS content; a `pending` answer is stale at once.
  it('coming back to a screen whose cached answer was still pending asks again immediately, even under the app\'s 5-minute staleTime', async () => {
    const fetchSpy = stubFetch(pending, succeeded(gradingResult()));
    const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, staleTime: 5 * 60 * 1000 } } });
    const ui = (
      <QueryClientProvider client={client}>
        <GradingPreview essayId={ESSAY_ID} essayContent={ESSAY} strings={EN} tryAgainAction={TRY_AGAIN} />
      </QueryClientProvider>
    );
    const first = render(ui);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    first.unmount();

    render(ui);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('overall-score')).toBeInTheDocument();
  });

  // The bound is on the JOB's age (`createdAt`), not on a timer started at
  // mount, so a reload does not restart it. See the hook's file comment for
  // why a job stuck `pending` is an accepted, documented failure mode.
  it('pins the cap at two minutes — about 48 polls, well past any real grading latency', () => {
    expect(GRADING_POLL_MAX_AGE_MS).toBe(120_000);
    expect(GRADING_POLL_MAX_AGE_MS / GRADING_POLL_INTERVAL_MS).toBeCloseTo(48, 0);
  });

  it('keeps polling for the whole window, then gives up: a job that stays pending is not polled forever', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetch(pending);
    renderPreview();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_MAX_AGE_MS - GRADING_POLL_INTERVAL_MS));
    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'pending');
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(46);

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 3));
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'stalled'));
    const callsWhenGivenUp = fetchSpy.mock.calls.length;
    expect(callsWhenGivenUp).toBeLessThanOrEqual(51);

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 10));
    expect(fetchSpy).toHaveBeenCalledTimes(callsWhenGivenUp);
  });

  it('a `processing` job that never finishes is given up on in the same way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS - 1000, processing);
    renderPreview();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'pending');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'stalled'));
    const callsWhenGivenUp = fetchSpy.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 5));
    expect(fetchSpy).toHaveBeenCalledTimes(callsWhenGivenUp);
  });

  it('a job just inside the cap is still waiting, and still polled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS - 60_000, pending);
    renderPreview();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 4));

    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'pending');
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('a reload does not restart the clock: a job already older than the cap is given up on after one request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS + 30_000, pending);
    renderPreview(); // a fresh mount, as after a reload

    await waitFor(() => expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'stalled'));
    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 5));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('measures the job\'s age on the server\'s clock (the Date header), so a guest whose own clock is hours fast does not see every job as stalled', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const serverNow = Date.now() - 3 * 60 * 60 * 1000; // this browser's clock is three hours ahead of the server's
    const body = { status: 'pending', result: null, failureReason: null, createdAt: new Date(serverNow - 5000).toISOString() };
    stubFetch({ body, headers: { date: new Date(serverNow).toUTCString() } });
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pendingTitle })).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'pending');
  });

  it('an unfinished job with no readable `createdAt` cannot be bounded, so it is a failed poll, not an endless wait', async () => {
    stubFetch({ body: { status: 'pending', result: null, failureReason: null, createdAt: null } });
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pollErrorTitle })).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'pollError');
  });

  it('stops polling on unmount', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetch(pending);
    const { unmount } = renderPreview();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    unmount();
    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 4));

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('GradingPreview — complete (KAN-18 AC: overall band score and at least one fully worked example)', () => {
  it('shows the overall score and the band', async () => {
    stubFetch(succeeded(gradingResult({ overallScore: 80, overallBand: bandForScore(80) })));
    renderPreview();

    expect(await screen.findByTestId('overall-score')).toHaveTextContent('80');
    expect(screen.getByText(EN.scoreOutOf)).toBeInTheDocument();
    expect(screen.getByTestId('overall-band')).toHaveTextContent(EN.bands.pass);
    expect(screen.getByRole('heading', { name: EN.completeTitle })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: EN.pendingTitle })).toBeNull();
  });

  it('shows a real sentence from the guest\'s own essay with the error highlighted', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    const sentence = await screen.findByTestId('worked-example-sentence');
    // The whole sentence — not the whole essay, and not a paraphrase.
    const visibleText = sentence.textContent!.replace(EN.errorMarkerStart, '').replace(EN.errorMarkerEnd, '').replace(/\s+/g, ' ').replace(/\s([,.])/g, '$1');
    expect(visibleText.trim()).toBe('Gestern bin ich zu Hause geblieben, weil es regnete.');
    expect(sentence.textContent).not.toContain('Ich gehe heute ins Kino');
    expect(sentence.textContent).not.toContain('Morgen fahre ich nach Berlin');

    const mark = within(sentence).getByTestId('worked-example-highlight');
    expect(mark.tagName).toBe('MARK');
    // Exactly the annotated span of the essay text (ignoring the screen-reader-only markers).
    expect(mark).toHaveTextContent(new RegExp(`${EN.errorMarkerStart}\\s*${ERROR_QUOTE}\\s*${EN.errorMarkerEnd}`));
    expect(mark.querySelectorAll('.sr-only')).toHaveLength(2);
    expect(mark.textContent!.replace(EN.errorMarkerStart, '').replace(EN.errorMarkerEnd, '').trim()).toBe(ERROR_QUOTE);
  });

  it('explains the error, and offers the suggested fix', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    const explanation = await screen.findByTestId('worked-example-explanation');
    expect(explanation).toHaveTextContent('Nach "Gestern" steht das Verb an zweiter Stelle.');
    expect(explanation).toHaveTextContent(`${EN.suggestionLabel}: Gestern bin ich zu Hause geblieben`);
  });

  it('omits the suggestion line when the annotation has none, rather than printing an empty label', async () => {
    stubFetch(succeeded(gradingResult({ annotations: [annotation(ERROR_QUOTE, { suggestion: null })] })));
    renderPreview();

    const explanation = await screen.findByTestId('worked-example-explanation');
    expect(explanation).not.toHaveTextContent(EN.suggestionLabel);
  });

  it('renders annotation text as text, never as markup — it is model output', async () => {
    stubFetch(succeeded(gradingResult({ annotations: [annotation(ERROR_QUOTE, { message: '<img src=x onerror=alert(1)>Fehler' })] })));
    const { container } = renderPreview();

    const explanation = await screen.findByTestId('worked-example-explanation');
    expect(explanation).toHaveTextContent('<img src=x onerror=alert(1)>Fehler');
    expect(container.querySelector('img')).toBeNull();
  });

  it('marks the sentence as German so a screen reader pronounces it correctly in an English page', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    expect(await screen.findByTestId('worked-example-sentence')).toHaveAttribute('lang', 'de');
  });

  it('uses the most serious annotation as the example when there are several', async () => {
    stubFetch(
      succeeded(
        gradingResult({
          annotations: [
            annotation('heute', { severity: 'minor', message: 'Kleinigkeit.' }),
            annotation(ERROR_QUOTE, { severity: 'major' }),
          ],
        }),
      ),
    );
    renderPreview();

    const mark = await screen.findByTestId('worked-example-highlight');
    expect(mark).toHaveTextContent(ERROR_QUOTE);
    expect(screen.queryByText('Kleinigkeit.')).toBeNull();
  });

  it('is honest when no annotation can be anchored: the score still shows, no example is invented', async () => {
    stubFetch(succeeded(gradingResult({ annotations: [] })));
    renderPreview();

    expect(await screen.findByTestId('overall-score')).toHaveTextContent('80');
    expect(screen.getByTestId('worked-example-none')).toHaveTextContent(EN.noExample);
    expect(screen.queryByTestId('worked-example-highlight')).toBeNull();
    expect(screen.queryByTestId('worked-example-explanation')).toBeNull();
  });

  it('does not highlight anything when the only annotation\'s offsets do not fit the essay text', async () => {
    stubFetch(succeeded(gradingResult({ annotations: [annotation(ERROR_QUOTE, { start: 400, end: 430 })] })));
    renderPreview();

    expect(await screen.findByTestId('overall-score')).toBeInTheDocument();
    expect(screen.getByTestId('worked-example-none')).toBeInTheDocument();
    expect(screen.queryByTestId('worked-example-highlight')).toBeNull();
  });

  it('is KAN-6\'s to show the rest: no summary, dimension comments or extra annotations appear here', async () => {
    stubFetch(
      succeeded(
        gradingResult({
          annotations: [annotation(ERROR_QUOTE), annotation('regnete', { severity: 'minor', message: 'Zweiter Fehler.' })],
        }),
      ),
    );
    renderPreview();

    await screen.findByTestId('overall-score');
    expect(screen.queryByText('Eine echte Zusammenfassung.')).toBeNull();
    expect(screen.queryByText('Ein echter Kommentar.')).toBeNull();
    expect(screen.queryByText('Zweiter Fehler.')).toBeNull();
  });
});

describe('GradingPreview — accessibility of the result (a result arriving after a poll is a live region)', () => {
  it('announces completion, with the score and band, through exactly one polite status region', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    await screen.findByTestId('overall-score');
    const status = screen.getByRole('status');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(`${EN.completeAnnouncement} 80 ${EN.scoreOutOf}, ${EN.bands.pass}.`);
  });

  it('the region is busy only while waiting: aria-busy is "false" once the result arrives, so a screen reader does not treat it as still changing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(pending, succeeded(gradingResult()));
    renderPreview();
    expect(await screen.findByRole('region', { name: EN.pendingTitle })).toHaveAttribute('aria-busy', 'true');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await screen.findByTestId('overall-score');

    expect(screen.getByRole('region', { name: EN.completeTitle })).toHaveAttribute('aria-busy', 'false');
  });

  it('the announcement is visually hidden — otherwise its sentence would print on screen next to the score', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    await screen.findByTestId('overall-score');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
  });

  it('the live region already exists, empty, while waiting — a region added together with its text is not reliably announced', async () => {
    stubFetch(pending);
    renderPreview();

    await screen.findByRole('heading', { name: EN.pendingTitle });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('the same live-region node carries the announcement when the result arrives, rather than a new one being added', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(pending, succeeded(gradingResult()));
    renderPreview();
    const regionWhileWaiting = await screen.findByRole('status');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await screen.findByTestId('overall-score');

    expect(screen.getByRole('status')).toBe(regionWhileWaiting);
    expect(regionWhileWaiting).toHaveTextContent(EN.completeAnnouncement);
  });

  it('associates the explanation with the highlighted words, not merely places it beside them', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    const mark = await screen.findByTestId('worked-example-highlight');
    const explanation = screen.getByTestId('worked-example-explanation');

    expect(mark.getAttribute('aria-describedby')).toBe(explanation.id);
    expect(mark.getAttribute('aria-details')).toBe(explanation.id);
    expect(explanation.id).not.toBe('');
    // What assistive technology computes from that reference.
    expect(mark).toHaveAccessibleDescription(/Nach "Gestern" steht das Verb an zweiter Stelle\./);
  });

  it('does not rely on colour alone: the highlighted span carries a non-colour cue and screen-reader boundary markers', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    const mark = await screen.findByTestId('worked-example-highlight');
    expect(mark.className).toMatch(/underline/);
    expect(mark.className).toMatch(/decoration-wavy/);
    expect(mark).toHaveTextContent(EN.errorMarkerStart);
    expect(mark).toHaveTextContent(EN.errorMarkerEnd);
  });

  it('moves keyboard focus to the result heading when it replaces the waiting state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(pending, succeeded(gradingResult()));
    renderPreview();

    const waitingHeading = await screen.findByRole('heading', { name: EN.pendingTitle });
    expect(waitingHeading).toHaveFocus();

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    const resultHeading = await screen.findByRole('heading', { name: EN.completeTitle });

    expect(waitingHeading).not.toBeInTheDocument();
    expect(resultHeading).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('does not steal focus if the guest has deliberately moved it elsewhere while waiting', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(pending, succeeded(gradingResult()));
    render(
      <>
        <button type="button">language switcher</button>
        <QueryClientProvider client={new QueryClient()}>
          <GradingPreview essayId={ESSAY_ID} essayContent={ESSAY} strings={EN} tryAgainAction={TRY_AGAIN} />
        </QueryClientProvider>
      </>,
    );
    await screen.findByRole('heading', { name: EN.pendingTitle });
    const elsewhere = screen.getByRole('button', { name: 'language switcher' });
    elsewhere.focus();

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await screen.findByRole('heading', { name: EN.completeTitle });

    expect(elsewhere).toHaveFocus();
  });

  it('every state\'s heading is programmatically focusable but not in the tab order', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.completeTitle })).toHaveAttribute('tabindex', '-1');
  });
});

describe('GradingPreview — flagged for suspected prompt injection (BR-3.5 result is never presented as real feedback)', () => {
  // Built by the real domain functions, so this pins the actual withheld
  // strings the clamp produces today — not a copy of them that could drift.
  function flaggedResult(): GradingResult {
    const honestlyGraded = buildGradingResult(
      {
        overallScore: 98,
        summary: 'Ein perfekter Aufsatz — 100 Punkte.',
        dimensions: RUBRIC_DIMENSIONS.map((dimension) => ({ dimension, score: 97, comment: 'Ausgezeichnet.' })),
        annotations: [],
      },
      [annotation(ERROR_QUOTE)],
    );
    return clampForSuspectedInjection(honestlyGraded);
  }

  it('the fixture really is the clamped shape this state exists for', () => {
    const result = flaggedResult();
    expect(result.flaggedForReview).toBe(true);
    expect(result.overallScore).toBe(55);
    expect(result.summary).toMatch(/capped/);
    expect(result.dimensions.every((d) => /withheld/i.test(d.comment))).toBe(true);
  });

  // `clampForSuspectedInjection` clamps the scores and replaces the summary
  // and the comments, but passes `annotations` straight through — so a
  // flagged result really does still carry the distrusted model's annotation
  // text. The allow-list test below is only meaningful if there is something
  // there to leak, and this is what says so.
  it('the fixture still carries an annotation (the clamp does not touch them), so there is real text to leak', () => {
    const result = flaggedResult();
    expect(result.annotations).toHaveLength(1);
    expect(result.annotations[0].message).toBe('Nach "Gestern" steht das Verb an zweiter Stelle.');
  });

  it('shows a deliberate flagged message with a way to try again — not a result', async () => {
    stubFetch(succeeded(flaggedResult()));
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.flaggedTitle })).toBeInTheDocument();
    expect(screen.getByText(EN.flaggedBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'try again slot' })).toBeInTheDocument();
    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'flagged');
  });

  it('never renders the capped score, band, the withheld placeholder strings, or an example', async () => {
    const result = flaggedResult();
    stubFetch(succeeded(result));
    const { container } = renderPreview();

    await screen.findByRole('heading', { name: EN.flaggedTitle });
    const text = container.textContent ?? '';

    expect(screen.queryByTestId('overall-score')).toBeNull();
    expect(screen.queryByTestId('overall-band')).toBeNull();
    expect(text).not.toContain(result.summary);
    for (const dimension of result.dimensions) expect(text).not.toContain(dimension.comment);
    expect(text).not.toContain('withheld');
    expect(text).not.toContain(String(result.overallScore));
    expect(text).not.toContain(EN.bands.belowTarget);
    expect(screen.queryByTestId('worked-example-highlight')).toBeNull();
    expect(screen.queryByTestId('worked-example-none')).toBeNull();
  });

  // The deny-list above names what someone thought of. This is the assertion
  // the claim "no capped score, no placeholders, no example" actually rests
  // on: the panel's own text must be EXACTLY its title, its body and the
  // try-again action, so any leak fails — named or not. It replaced a
  // `not.toMatch(/\b55\b/)` that a leaked "55" slipped past, because
  // adjacent elements' text concatenates with no separator ("...again.55try
  // again slot") and `\b` does not match between a digit and a letter.
  // Whitespace is collapsed on both sides for the same reason: element text
  // runs together, so the comparison cannot depend on separators.
  it('renders nothing but the flagged title, the flagged body and the try-again action — an allow-list, so any leak fails, named or not', async () => {
    stubFetch(succeeded(flaggedResult()));
    const { container } = renderPreview();

    const region = await screen.findByRole('region', { name: EN.flaggedTitle });
    const collapse = (text: string | null) => (text ?? '').replace(/\s+/g, '');

    expect(collapse(region.textContent)).toBe(collapse(`${EN.flaggedTitle}${EN.flaggedBody}try again slot`));
    expect(collapse(screen.getByRole('status').textContent)).toBe(collapse(EN.flaggedTitle));
    // ...and the wrapper around both holds nothing else either.
    expect(collapse(container.textContent)).toBe(
      collapse(`${EN.flaggedTitle}${EN.flaggedTitle}${EN.flaggedBody}try again slot`),
    );
    expect(region.querySelector('mark')).toBeNull();
  });

  it('the flagged copy names the shape of what tripped the check, not a place in the essay — it cannot know one', () => {
    // No "reword that part": nothing can tell the guest which part.
    expect(EN.flaggedBody).not.toMatch(/that part|which part|that sentence/i);
    expect(DE.flaggedBody).not.toMatch(/diesen Teil|diese Stelle|diesen Satz/i);
    expect(EN.flaggedBody).toMatch(/instruction about how to grade/i);
    expect(EN.flaggedBody).toMatch(/check can be wrong/i);
    // Truer than "we haven't given it a score" — a score was produced, and is not shown.
    expect(EN.flaggedBody).toMatch(/not showing you a score/i);
    expect(EN.flaggedBody).not.toMatch(/haven't given/i);
    expect(DE.flaggedBody).toMatch(/Anweisung/);
    expect(DE.flaggedBody).toMatch(/Prüfung kann sich irren/);
    expect(DE.flaggedBody).toMatch(/zeigen dir keine Punktzahl/);
  });

  it('announces the flagged outcome, not a score', async () => {
    stubFetch(succeeded(flaggedResult()));
    renderPreview();

    await screen.findByRole('heading', { name: EN.flaggedTitle });
    expect(screen.getByRole('status')).toHaveTextContent(EN.flaggedTitle);
    expect(screen.getByRole('status')).not.toHaveTextContent(EN.completeAnnouncement);
  });

  it('makes no promise of human review — none exists', async () => {
    stubFetch(succeeded(flaggedResult()));
    renderPreview();

    await screen.findByRole('heading', { name: EN.flaggedTitle });
    expect(screen.getByRole('region').textContent).not.toMatch(/review(ed)? by|our team|we will (look|check|review)/i);
  });
});

describe('GradingPreview — stalled: a job that never finishes has a way out', () => {
  it('says grading did not finish, offers to submit again, and is not busy, and shows no score', async () => {
    stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS + 1000, pending);
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.stalledTitle })).toBeInTheDocument();
    expect(screen.getByText(EN.stalledBody)).toBeInTheDocument();
    // The CTA pending never had — the whole point of this state.
    expect(screen.getByRole('link', { name: 'try again slot' })).toBeInTheDocument();
    const region = screen.getByRole('region', { name: EN.stalledTitle });
    expect(region).toHaveAttribute('data-phase', 'stalled');
    expect(region).toHaveAttribute('aria-busy', 'false');
    expect(screen.queryByRole('heading', { name: EN.pendingTitle })).toBeNull();
    expect(screen.queryByTestId('overall-score')).toBeNull();
    expect(screen.queryByTestId('overall-band')).toBeNull();
  });

  it('is not presented as a failed job, and makes no claim that grading failed', async () => {
    stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS + 1000, pending);
    renderPreview();

    await screen.findByRole('heading', { name: EN.stalledTitle });
    expect(screen.queryByText(EN.failedTitle)).toBeNull();
    expect(screen.getByRole('region').textContent).not.toMatch(/review(ed)? by|our team|we will (look|check|review)/i);
  });

  it('announces the state through the one live region', async () => {
    stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS + 1000, pending);
    renderPreview();

    await screen.findByRole('heading', { name: EN.stalledTitle });
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(EN.stalledTitle);
  });

  it('moves focus to its heading, replacing the waiting one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS - 1000, pending);
    renderPreview();
    const waiting = await screen.findByRole('heading', { name: EN.pendingTitle });
    expect(waiting).toHaveFocus();

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    const stalled = await screen.findByRole('heading', { name: EN.stalledTitle });

    expect(stalled).toHaveFocus();
  });

  it('has distinct copy in both languages', () => {
    for (const strings of [EN, DE]) {
      expect(strings.stalledTitle.length).toBeGreaterThan(0);
      expect(strings.stalledBody.length).toBeGreaterThan(0);
      expect(strings.stalledBody).not.toBe(strings.pendingBody);
      expect(strings.stalledTitle).not.toBe(strings.pendingTitle);
    }
  });

  it('renders in German from the German catalogue', async () => {
    stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS + 1000, pending);
    renderPreview(DE);

    expect(await screen.findByRole('heading', { name: DE.stalledTitle })).toBeInTheDocument();
    expect(screen.getByText(DE.stalledBody)).toBeInTheDocument();
  });
});

describe('GradingPreview — failed: honest, never a fake score', () => {
  it.each(GRADING_FAILURE_REASONS)('shows the specific message for failure reason "%s", no score, and a way to try again', async (reason) => {
    stubFetch(failed(reason));
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.failedTitle })).toBeInTheDocument();
    expect(screen.getByText(EN.failedReasons[reason])).toBeInTheDocument();
    expect(screen.getByText(EN.failedBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'try again slot' })).toBeInTheDocument();
    expect(screen.queryByTestId('overall-score')).toBeNull();
    expect(screen.queryByTestId('overall-band')).toBeNull();
  });

  it('every failure reason has its own distinct copy in both languages, so none silently falls back to another\'s', () => {
    for (const strings of [EN, DE]) {
      const texts = GRADING_FAILURE_REASONS.map((reason) => strings.failedReasons[reason]);
      expect(texts.every((t) => typeof t === 'string' && t.length > 0)).toBe(true);
      expect(new Set(texts).size).toBe(GRADING_FAILURE_REASONS.length);
    }
  });

  it('falls back to the generic message when the server names no reason it recognises', async () => {
    stubFetch({ body: { status: 'failed', result: null, failureReason: 'someReasonFromTheFuture' } });
    renderPreview();

    expect(await screen.findByText(EN.failedReasons.unknown)).toBeInTheDocument();
  });

  it('announces the failure through the live region', async () => {
    stubFetch(failed('providerError'));
    renderPreview();

    await screen.findByRole('heading', { name: EN.failedTitle });
    expect(screen.getByRole('status')).toHaveTextContent(EN.failedTitle);
  });
});

describe('GradingPreview — the status request itself fails (not the same as grading failing)', () => {
  it('a 404 (not found, or not this guest\'s) is definitive: no retries, a not-found message, and a way to submit again', async () => {
    const fetchSpy = stubFetch({ status: 404, body: { error: 'no grading job found for this essay', reason: 'gradingJobNotFound' } });
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pollErrorTitle })).toBeInTheDocument();
    expect(screen.getByText(EN.pollErrorNotFoundBody)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'try again slot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN.retryCta })).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('a server error is retried a few times, then surfaces a retry button rather than waiting forever', async () => {
    const fetchSpy = stubFetch({ status: 500, body: {} });
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pollErrorTitle })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(4); // the first try plus three retries
    expect(screen.getByText(EN.pollErrorBody)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: EN.retryCta })).toBeInTheDocument();
  });

  it('stops polling once it has given up — a dead poll is not left ticking in the background', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetch({ status: 404, body: { reason: 'gradingJobNotFound' } });
    renderPreview();
    await screen.findByRole('heading', { name: EN.pollErrorTitle });
    const callsWhenGivenUp = fetchSpy.mock.calls.length;

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS * 4));

    expect(fetchSpy).toHaveBeenCalledTimes(callsWhenGivenUp);
  });

  it('a dropped connection is treated the same way', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderPreview();

    expect(await screen.findByRole('button', { name: EN.retryCta })).toBeInTheDocument();
  });

  it('"succeeded" with no result is not shown as a grade', async () => {
    stubFetch({ body: { status: 'succeeded', result: null, failureReason: null } });
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pollErrorTitle })).toBeInTheDocument();
    expect(screen.queryByTestId('overall-score')).toBeNull();
  });

  it('an unrecognised status is not treated as pending or as a result', async () => {
    stubFetch({ body: { status: 'exploded', result: null, failureReason: null } });
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pollErrorTitle })).toBeInTheDocument();
  });

  it('the retry button asks again and, when grading has finished, shows the result', async () => {
    stubFetch({ status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }, { status: 500, body: {} }, succeeded(gradingResult()));
    renderPreview();

    fireEvent.click(await screen.findByRole('button', { name: EN.retryCta }));

    expect(await screen.findByTestId('overall-score')).toHaveTextContent('80');
  });

  // The case where it matters: an answer (`pending`) is already on screen
  // when a later poll fails for good, so the error screen appears WITH data
  // behind it and a retry refetches without dropping back to the waiting
  // state — the button stays put and must not accept a second click.
  it('the retry button is disabled while its request is in flight, so it cannot be hammered', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = vi
      .fn()
      .mockImplementationOnce(async () => new Response(JSON.stringify({ ...(pending.body as object), createdAt: new Date().toISOString() }), { status: 200 }))
      .mockImplementationOnce(async () => new Response('{}', { status: 500 }))
      .mockImplementationOnce(async () => new Response('{}', { status: 500 }))
      .mockImplementationOnce(async () => new Response('{}', { status: 500 }))
      .mockImplementationOnce(async () => new Response('{}', { status: 500 }))
      .mockImplementation(() => new Promise<Response>(() => {})); // the manual retry never answers
    vi.stubGlobal('fetch', fetchSpy);
    renderPreview();
    await screen.findByRole('heading', { name: EN.pendingTitle });
    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    const retry = await screen.findByRole('button', { name: EN.retryCta });
    expect(retry).toBeEnabled();

    fireEvent.click(retry);

    await waitFor(() => expect(screen.getByRole('button', { name: EN.retryCta })).toBeDisabled());
  });

  it('announces the failure through the live region', async () => {
    stubFetch({ status: 404, body: { reason: 'gradingJobNotFound' } });
    renderPreview();

    await screen.findByRole('heading', { name: EN.pollErrorTitle });
    expect(screen.getByRole('status')).toHaveTextContent(EN.pollErrorTitle);
  });
});

describe('GradingPreview — progress while pending (KAN-17 BR-5.3: communicate progress, not just a static spinner)', () => {
  const progress = () => screen.getByTestId('pending-progress');

  it('says nothing about the job before the first answer arrives — there is nothing true to say yet', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderPreview();

    expect(await screen.findByRole('heading', { name: EN.pendingTitle })).toBeInTheDocument();
    expect(screen.queryByTestId('pending-progress')).toBeNull();
  });

  it('shows the stage the job is really in: queued while `pending`, picked up once `processing`', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(pending, processing);
    renderPreview();

    const stage = await screen.findByTestId('grading-stage');
    expect(stage).toHaveTextContent(EN.stageQueued);
    expect(stage).toHaveAttribute('data-stage', 'pending');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await waitFor(() => expect(screen.getByTestId('grading-stage')).toHaveTextContent(EN.stageProcessing));
    expect(screen.getByTestId('grading-stage')).toHaveAttribute('data-stage', 'processing');
  });

  it('is not a one-way tracker: a job the server reverts to `pending` for a retry is shown as queued again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(processing, pending);
    renderPreview();
    await waitFor(() => expect(screen.getByTestId('grading-stage')).toHaveTextContent(EN.stageProcessing));

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));

    await waitFor(() => expect(screen.getByTestId('grading-stage')).toHaveTextContent(EN.stageQueued));
  });

  it('invents no percentage and no progress bar — nothing tells us how far along a grading call is', async () => {
    stubFetch(processing);
    renderPreview();

    await screen.findByTestId('grading-stage');
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(progress().textContent).not.toMatch(/%|\d\s*of\s*\d/);
  });

  it('shows how long the job has really been waiting, from its own createdAt', async () => {
    stubFetchForJobAged(20_000, pending);
    renderPreview();

    expect(await screen.findByTestId('grading-elapsed')).toHaveTextContent('0:20');
    expect(screen.getByText(EN.elapsedLabel)).toBeInTheDocument();
  });

  it('formats minutes and zero-pads seconds', async () => {
    stubFetchForJobAged(65_000, pending);
    renderPreview();

    expect(await screen.findByTestId('grading-elapsed')).toHaveTextContent('1:05');
    expect(screen.getByTestId('grading-elapsed').querySelector('time')).toHaveAttribute('datetime', 'PT1M5S');
  });

  it('keeps counting between polls, so the page visibly moves while the job is unfinished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(10_000, pending);
    renderPreview();
    expect(await screen.findByTestId('grading-elapsed')).toHaveTextContent('0:10');

    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(screen.getByTestId('grading-elapsed')).toHaveTextContent('0:11'));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    await waitFor(() => expect(screen.getByTestId('grading-elapsed')).toHaveTextContent('0:12'));
  });

  it('reads the age off the server\'s clock, so a guest whose own clock is hours fast is not shown hours', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Whole seconds: an HTTP `Date` header has no milliseconds.
    const serverNow = Math.floor(Date.now() / 1000) * 1000 - 3 * 60 * 60 * 1000;
    const body = { status: 'pending', result: null, failureReason: null, createdAt: new Date(serverNow - 7000).toISOString() };
    stubFetch({ body, headers: { date: new Date(serverNow).toUTCString() } });
    renderPreview();

    expect(await screen.findByTestId('grading-elapsed')).toHaveTextContent('0:07');
  });

  it('never steps backwards: an answer that reports a slightly younger job than the count already shown does not rewind it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // The second answer says the job is 1s younger than the first plus the time that has passed.
    const createdAt = new Date(Date.now() - 30_000).toISOString();
    const later = new Date(Date.now() + GRADING_POLL_INTERVAL_MS - 1500).toUTCString();
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        const headers = call === 1 ? undefined : { date: later };
        return new Response(JSON.stringify({ status: 'pending', result: null, failureReason: null, createdAt }), { headers });
      }),
    );
    renderPreview();
    await screen.findByTestId('grading-elapsed');

    const seen: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      await act(() => vi.advanceTimersByTimeAsync(1000));
      const [m, s] = screen.getByTestId('grading-elapsed').textContent!.split(':').map(Number);
      seen.push(m * 60 + s);
    }
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('is gone once the job has finished — the result replaces the waiting state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetch(pending, succeeded(gradingResult()));
    renderPreview();
    await screen.findByTestId('pending-progress');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await screen.findByTestId('overall-score');

    expect(screen.queryByTestId('pending-progress')).toBeNull();
  });
});

describe('GradingPreview — past the target: the state says so, without a static spinner (KAN-17 AC 3)', () => {
  const slowNotice = () => screen.queryByTestId('slow-notice');

  it('pins the slow mark to the AC\'s one minute, inside the two-minute bound that ends the wait', () => {
    // The AC's number, not a measured one — see GRADING_SLOW_AFTER_MS.
    expect(GRADING_SLOW_AFTER_MS).toBe(60_000);
    expect(GRADING_SLOW_AFTER_MS).toBeLessThan(GRADING_POLL_MAX_AGE_MS);
    // The copy promises both numbers in words.
    expect(EN.slowNotice).toMatch(/\bminute\b/);
    expect(EN.slowKeepChecking).toMatch(/two minutes/);
    expect(GRADING_POLL_MAX_AGE_MS).toBe(2 * 60 * 1000);
  });

  it('shows no slow notice while the job is inside the target', async () => {
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS - 5000, processing);
    renderPreview();

    await screen.findByTestId('pending-progress');
    expect(slowNotice()).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows it for a job already past the target when the page opens, and says what is true about it', async () => {
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS + 5000, processing);
    renderPreview();

    const notice = await screen.findByTestId('slow-notice');
    expect(notice).toHaveTextContent(EN.slowNotice);
    expect(notice).toHaveTextContent(EN.slowKeepChecking);
    // Still the waiting screen — the job has not failed and is not given up on.
    expect(screen.getByRole('region')).toHaveAttribute('data-phase', 'pending');
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('grading-stage')).toHaveTextContent(EN.stageProcessing);
    expect(screen.getByTestId('grading-elapsed')).toHaveTextContent('1:05');
    expect(screen.queryByTestId('overall-score')).toBeNull();
    expect(screen.queryByRole('link', { name: 'try again slot' })).toBeNull();
  });

  it('appears by itself as a waiting job crosses the target', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS - 30_000, pending);
    renderPreview();
    await screen.findByTestId('pending-progress');
    expect(slowNotice()).toBeNull();

    await act(() => vi.advanceTimersByTimeAsync(30_000 + GRADING_POLL_INTERVAL_MS * 2));

    await waitFor(() => expect(slowNotice()).not.toBeNull());
  });

  it('is still shown just inside the two-minute bound, and gives way to the stalled state past it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(GRADING_POLL_MAX_AGE_MS - 1000, pending);
    renderPreview();
    await screen.findByTestId('slow-notice');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await screen.findByRole('heading', { name: EN.stalledTitle });

    expect(slowNotice()).toBeNull();
    expect(screen.queryByTestId('pending-progress')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(EN.stalledTitle);
  });

  it('does not remount the heading or move focus: it is the same phase with more said under it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS - 10_000, pending);
    renderPreview();
    const heading = await screen.findByRole('heading', { name: EN.pendingTitle });
    expect(heading).toHaveFocus();

    await act(() => vi.advanceTimersByTimeAsync(10_000 + GRADING_POLL_INTERVAL_MS * 2));
    await screen.findByTestId('slow-notice');

    expect(screen.getByRole('heading', { name: EN.pendingTitle })).toBe(heading);
    expect(heading).toHaveFocus();
  });

  it('does not pull focus back from wherever the guest has moved it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS - 10_000, pending);
    render(
      <>
        <button type="button">language switcher</button>
        <QueryClientProvider client={new QueryClient()}>
          <GradingPreview essayId={ESSAY_ID} essayContent={ESSAY} strings={EN} tryAgainAction={TRY_AGAIN} />
        </QueryClientProvider>
      </>,
    );
    await screen.findByRole('heading', { name: EN.pendingTitle });
    const elsewhere = screen.getByRole('button', { name: 'language switcher' });
    elsewhere.focus();

    await act(() => vi.advanceTimersByTimeAsync(10_000 + GRADING_POLL_INTERVAL_MS * 2));
    await screen.findByTestId('slow-notice');

    expect(elsewhere).toHaveFocus();
  });

  it('is announced once, through the one status region that was there all along', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS - 10_000, pending);
    renderPreview();
    const announcer = await screen.findByRole('status');
    expect(announcer).toHaveTextContent('');

    await act(() => vi.advanceTimersByTimeAsync(10_000 + GRADING_POLL_INTERVAL_MS * 2));
    await screen.findByTestId('slow-notice');

    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toBe(announcer);
    expect(announcer).toHaveTextContent(EN.slowAnnouncement);
    expect(document.querySelectorAll('[aria-live], [role="alert"], [role="status"]')).toHaveLength(1);
  });

  it('does not turn the announcer into a stream: after that one message, seconds ticking and polls arriving change it not at all', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchSpy = stubFetchForJobAged(GRADING_SLOW_AFTER_MS + 5000, pending, processing, pending, processing);
    renderPreview();
    const announcer = await screen.findByRole('status');
    await screen.findByTestId('slow-notice');
    await waitFor(() => expect(announcer).toHaveTextContent(EN.slowAnnouncement));
    const clockBefore = screen.getByTestId('grading-elapsed').textContent;

    const observer = new MutationObserver(() => {});
    observer.observe(announcer, { childList: true, characterData: true, subtree: true, attributes: true });
    const callsBefore = fetchSpy.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    const records = observer.takeRecords();
    observer.disconnect();

    // Not vacuous: the clock moved and polls (with a stage flip) really arrived.
    expect(screen.getByTestId('grading-elapsed').textContent).not.toBe(clockBefore);
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore + 3);
    expect(records).toHaveLength(0);
  });

  it('keeps the ticking clock and the stage out of any live region', async () => {
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS + 5000, processing);
    renderPreview();
    const block = await screen.findByTestId('pending-progress');

    expect(block.querySelector('[aria-live], [role="status"], [role="alert"], [role="log"], [role="timer"]')).toBeNull();
    expect(screen.getByRole('status')).not.toContainElement(block);
  });

  it('renders in German from the German catalogue', async () => {
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS + 5000, processing);
    renderPreview(DE);

    expect(await screen.findByTestId('slow-notice')).toHaveTextContent(DE.slowNotice);
    expect(screen.getByTestId('grading-stage')).toHaveTextContent(DE.stageProcessing);
    expect(screen.getByText(DE.elapsedLabel)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(DE.slowAnnouncement);
  });

  it('has its own, non-empty, translated copy in both languages', () => {
    const keys = ['stageLabel', 'stageQueued', 'stageProcessing', 'elapsedLabel', 'slowNotice', 'slowKeepChecking', 'slowAnnouncement'] as const;
    for (const key of keys) {
      expect(EN[key].length, `en ${key}`).toBeGreaterThan(0);
      expect(DE[key].length, `de ${key}`).toBeGreaterThan(0);
      // "Status" is the same word in German.
      if (key !== 'stageLabel') expect(DE[key], `${key} is translated, not copied`).not.toBe(EN[key]);
    }
    expect(EN.stageQueued).not.toBe(EN.stageProcessing);
    expect(DE.stageQueued).not.toBe(DE.stageProcessing);
  });

  it('a flagged result that follows a slow wait still renders nothing from the result', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const flagged = gradingResult({ flaggedForReview: true, overallScore: 55, overallBand: bandForScore(55) });
    stubFetchForJobAged(GRADING_SLOW_AFTER_MS + 5000, pending, succeeded(flagged));
    renderPreview();
    await screen.findByTestId('slow-notice');

    await act(() => vi.advanceTimersByTimeAsync(GRADING_POLL_INTERVAL_MS + 500));
    await screen.findByRole('heading', { name: EN.flaggedTitle });

    expect(screen.queryByTestId('overall-score')).toBeNull();
    expect(screen.queryByTestId('slow-notice')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(EN.flaggedTitle);
  });
});

describe('GradingPreview — localisation', () => {
  it('renders the German copy, including a German band label, from the German catalogue', async () => {
    stubFetch(succeeded(gradingResult()));
    renderPreview(DE);

    expect(await screen.findByRole('heading', { name: DE.completeTitle })).toBeInTheDocument();
    expect(screen.getByTestId('overall-band')).toHaveTextContent('B2 (bestanden)');
    expect(screen.getByRole('status')).toHaveTextContent(`${DE.completeAnnouncement} 80 ${DE.scoreOutOf}, ${DE.bands.pass}.`);
    expect(screen.getByText(DE.scoreOutOf)).toBeInTheDocument();
    // The English band label the domain returns is never shown to a German guest.
    expect(screen.queryByText(bandForScore(80))).toBeNull();
  });

  it('every label `bandForScore` can return has a translation key, so no score 0-100 falls through to untranslated English', () => {
    const labels = new Set(Array.from({ length: 101 }, (_, score) => bandForScore(score)));

    for (const label of labels) {
      expect(Object.keys(BAND_STRING_KEYS), `no translation key for band "${label}"`).toContain(label);
    }
    // ...and nothing in the map is stale.
    for (const label of Object.keys(BAND_STRING_KEYS)) expect(labels).toContain(label);
  });

  it('every band key exists in both catalogues', () => {
    for (const strings of [EN, DE]) {
      for (const key of Object.values(BAND_STRING_KEYS)) expect(strings.bands[key], key).toBeTruthy();
    }
  });
});
