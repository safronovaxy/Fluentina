import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import enMessages from '@/messages/en.json';
import deMessages from '@/messages/de.json';
import { GradingPreview, BAND_STRING_KEYS, type GradingPreviewStrings } from './GradingPreview';
import { GRADING_POLL_INTERVAL_MS } from '@/hooks/use-grading-status';
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
}
const pending: Reply = { body: { status: 'pending', result: null, failureReason: null } };
const processing: Reply = { body: { status: 'processing', result: null, failureReason: null } };
const succeeded = (result: GradingResult): Reply => ({ body: { status: 'succeeded', result, failureReason: null } });
const failed = (failureReason: GradingFailureReason | null): Reply => ({
  body: { status: 'failed', result: null, failureReason },
});

/** Replies in order, repeating the last one forever — a poller keeps asking. */
function stubFetch(...replies: Reply[]) {
  let call = 0;
  const spy = vi.fn(async () => {
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

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

    await act(() => vi.advanceTimersByTimeAsync(1500));
    expect(fetchSpy).toHaveBeenCalledTimes(1); // not sooner than 2 seconds

    await act(() => vi.advanceTimersByTimeAsync(1500)); // 3 seconds in
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
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
    expect(text).not.toMatch(/\b55\b/);
    expect(text).not.toContain(EN.bands.belowTarget);
    expect(screen.queryByTestId('worked-example-highlight')).toBeNull();
    expect(screen.queryByTestId('worked-example-none')).toBeNull();
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
      .mockImplementationOnce(async () => new Response(JSON.stringify(pending.body), { status: 200 }))
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
