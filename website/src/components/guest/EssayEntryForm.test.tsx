import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import { EssayEntryForm, type EssayEntryFormStrings } from './EssayEntryForm';
import { MAX_ESSAY_CONTENT_CHARS } from '@/lib/contracts/essay-submission';
import { MIN_ESSAY_WORDS, RECOMMENDED_MIN_WORDS, RECOMMENDED_MAX_WORDS, MAX_ESSAY_WORDS } from '@/lib/contracts/word-count';
import {
  wordsContent as words,
  mixedWhitespaceContent as mixedWhitespaceWords,
  contentOfExactLength,
} from '@/test/essay-content-fixtures';

const STRINGS: EssayEntryFormStrings = {
  textareaLabel: 'Your essay',
  placeholder: 'Write or paste your essay here...',
  requiredError: 'Please write something before submitting.',
  recommendedRangeGuidance: '150–200 words is the recommended length for a B2 essay.',
  lengthWarning: "That's longer than the recommended range, but you can still submit it.",
  tooShortError: 'Your essay is too short to grade — write at least 50 words.',
  tooLongError: 'Your essay is too long — keep it to 300 words or fewer.',
  submitCta: 'Submit essay',
  submittingCta: 'Submitting...',
  successTitle: 'Essay received',
  successBody: "Your essay has been submitted. We're working on the next steps of the guest flow.",
  errorGeneric: 'Something went wrong submitting your essay. Please try again.',
  rateLimitedError: "You've reached the submission limit for now — please wait a bit before submitting another essay.",
};

function renderForm() {
  // A fresh QueryClient per render — react-query caches mutations/queries
  // on the client instance, and a shared one would leak state (e.g. a
  // mutation still "pending" from a previous test) across these tests.
  //
  // Wrapped in IntlProvider (KAN-15): EssayEntryForm now renders
  // WordCountLabel, a chrome/ component that calls useTranslations — with
  // no provider that throws "No intl context found" the moment any test
  // renders the form at all. The REAL catalogue (en.json), not a stub: a
  // typo in wordCount's ICU string would still pass against a hand-rolled
  // stub, the same reasoning renderWithIntl's own comment gives.
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={enMessages}>
        <EssayEntryForm strings={STRINGS} />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

function fillEssay(text: string) {
  fireEvent.change(screen.getByLabelText(STRINGS.textareaLabel), { target: { value: text } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EssayEntryForm — text entry (KAN-14 AC: "accepts typed or pasted text; no account or login required")', () => {
  it('accepts typed text', () => {
    renderForm();

    const textarea = screen.getByLabelText(STRINGS.textareaLabel);
    fireEvent.change(textarea, { target: { value: 'Ich schreibe einen Aufsatz.' } });

    expect(textarea).toHaveValue('Ich schreibe einen Aufsatz.');
  });

  it('does not block pasting into the textarea', () => {
    renderForm();

    const textarea = screen.getByLabelText(STRINGS.textareaLabel);
    const pasteEvent = createEvent.paste(textarea, {
      clipboardData: { getData: () => 'Ein eingefügter Aufsatztext.' },
    });

    fireEvent(textarea, pasteEvent);

    // If a handler ever called preventDefault() on paste, the browser's own
    // paste-then-insert behaviour would be suppressed and nothing would
    // reach the textarea's value — this is what would actually break the
    // acceptance criterion; asserting the event was never cancelled is
    // what pins that no such handler exists.
    expect(pasteEvent.defaultPrevented).toBe(false);
  });

  it('sets a maxLength on the textarea matching the character safety cap — the client-side half of essaySubmissionRequestSchema\'s own cap, so they can never quietly disagree', () => {
    renderForm();

    expect(screen.getByLabelText(STRINGS.textareaLabel)).toHaveAttribute('maxlength', String(MAX_ESSAY_CONTENT_CHARS));
  });

  it('never renders any file, camera or upload control — text entry only (KAN-14 AC)', () => {
    const { container } = renderForm();

    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('[capture]')).toBeNull();
  });

  it('requires no account or login to render or use the form — no auth-related field anywhere in it', () => {
    renderForm();

    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
  });
});

describe('EssayEntryForm — submitting without content', () => {
  // Round-2 review (Test Lead, blocking): the required-field message's
  // `touched` gate (see EssayEntryForm.tsx's own comment on why an empty
  // box — the state every guest starts in — must not shout at them before
  // they've done anything) was asserted only in a comment, never in a test.
  // Removing `touched &&` from `showRequiredError`'s definition survived
  // every other test in this file, because none of them render the form and
  // then check for ABSENCE of this message before any interaction — this is
  // that missing case, the same shape as its too-short sibling below
  // ("does not show the too-short error before a submit attempt").
  it('does not show the required-field error before any submit attempt — the empty box every guest starts in must not be shown it unprompted', () => {
    renderForm();

    expect(screen.queryByText(STRINGS.requiredError)).toBeNull();
  });

  it('shows the required-field error and never calls the API', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.requiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the same required-field error appears for whitespace-only content', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay('    \n\t  ');
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.requiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('EssayEntryForm — content over the character safety cap (round-1 review: previously untested client-side)', () => {
  it('refuses to submit content over the character cap and never calls the API — proven with a scripted over-cap value, which bypasses the native maxLength the way a determined caller could', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();
    // fireEvent.change sets the textarea's value directly, the same way a
    // native maxLength constrains user typing/pasting but not a scripted
    // assignment — this is what proves the JS-level check (isValid, via
    // essaySubmissionRequestSchema) still blocks submission on its own,
    // not merely the browser's maxLength attribute.
    //
    // Round-3 review (Test Lead, blocking): this used to be a single
    // `'a'.repeat(MAX_ESSAY_CONTENT_CHARS + 1)` token — invalid on TWO axes,
    // not one: the character cap, and the 50-word floor, since one
    // unbroken token is one "word" by countGermanWords' own rule. The
    // assertion below can't tell which axis fired, because both failures
    // render the same `requiredError` string. Proven live: deleting the
    // `.max()` character-cap check from the schema left this test (and
    // 258 others) green — only the contract-level cap test died. Fixed by
    // pinning the word count to 250 (comfortably inside 50-300) via the
    // shared `contentOfExactLength` builder, so only the character-cap
    // axis is being exercised and this test can no longer pass for the
    // wrong reason.
    const overCapContent = contentOfExactLength(MAX_ESSAY_CONTENT_CHARS + 1, 250);

    fillEssay(overCapContent);
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.requiredError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('EssayEntryForm — successful submission', () => {
  it('POSTs the typed content to /api/essays and shows the success confirmation', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'a6afa382-8223-4b5d-b4ea-d5a7f0694211' }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    const content = words(60);
    fillEssay(content);
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(STRINGS.successTitle));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/essays',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content }),
      }),
    );
  });

  it('the submit button shows the submitting label and is disabled while the request is in flight', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchSpy = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(60));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    const pendingButton = await screen.findByRole('button', { name: STRINGS.submittingCta });
    expect(pendingButton).toBeDisabled();

    resolveFetch(new Response(JSON.stringify({ id: 'a6afa382-8223-4b5d-b4ea-d5a7f0694211' }), { status: 201 }));
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
  });
});

describe('EssayEntryForm — a failed submission', () => {
  it('shows the generic error message and lets the guest retry, without losing what they wrote', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    const content = words(60);
    fillEssay(content);
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.errorGeneric));

    // Never lost on failure — the guest should not have to retype a
    // half-written essay just because the request failed once.
    expect(screen.getByLabelText(STRINGS.textareaLabel)).toHaveValue(content);
  });

  // Round-1 review (should-fix #3): the server's rejection reason used to
  // die at the HTTP boundary — every server-side rejection rendered
  // `errorGeneric`, regardless of why, because the response body was
  // discarded entirely. Content here clears every CLIENT-side check (60
  // words, well within bounds) specifically so the request is actually
  // sent — this proves the MAPPING (server `reason` -> the already-
  // translated string), not the client-side block, which is covered
  // elsewhere and would prevent this fetch from ever firing.
  it('shows the specific too-short message, not the generic one, when the server rejects with reason "tooShort" — the bypass case', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'essay is under the 50-word minimum — too short to grade', reason: 'tooShort' }), {
        status: 400,
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(60));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooShortError));
    expect(screen.queryByText(STRINGS.errorGeneric)).toBeNull();
  });

  it('shows the specific too-long message, not the generic one, when the server rejects with reason "tooLong" — the bypass case', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'essay exceeds the 300-word maximum', reason: 'tooLong' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(60));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooLongError));
    expect(screen.queryByText(STRINGS.errorGeneric)).toBeNull();
  });

  // KAN-31: the exhaustive `reasonMessages` map (EssayEntryForm.tsx) now
  // covers every `RejectionReason`, not just the two length ones. KAN-25
  // (below, its own describe block) carves `rateLimited` out into its own
  // dedicated message; the remaining four guard-level reasons (cross-origin,
  // an invalid session cookie, an oversized body, malformed JSON, the
  // schema's own generic failure) map to `strings.errorGeneric`,
  // deliberately. Three of those four (everything but `invalidSessionCookie`)
  // are not reachable by this component going through the real flow — see
  // EssayEntryForm.tsx's own comment on the map for `invalidSessionCookie`'s
  // exception (round-1 review: a comment here used to claim all five were
  // unreachable on the grounds the cookie is "mandatory and
  // browser-attached", which the submission route's own comment already
  // contradicts — KAN-32 is the guest-facing fix, out of scope here). Either
  // way this is the SAME `errorGeneric` text a reason-less failure already
  // showed before this story, reached by an additional path, not a new
  // message. Any one of these is enough to prove the map resolves them at
  // all rather than throwing or rendering `undefined` — a mutant that
  // dropped a key back out of the object literal fails to compile (verified
  // directly against `tsc --noEmit`, not asserted at runtime here), so this
  // only needs to prove the RUNTIME behaviour for the reasons that do exist
  // in the map today.
  it('shows the generic error message, not a blank one, when the server rejects with a guard-level reason (e.g. "invalidSubmission") the client never triggers on its own', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'invalid essay submission', reason: 'invalidSubmission' }), { status: 400 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(60));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.errorGeneric));
  });

  // Round-1 review (should-fix #3, still true after KAN-31 widened the
  // union): a body with no recognised `reason` at all (a 500, a reason this
  // union doesn't know about, or no JSON body) still falls back to
  // `errorGeneric` via `isRejectionReason` rejecting it — proven already by
  // the very first test in this describe block (a bare 500, no body). This
  // test adds the one shape that test doesn't cover: a 400 WITH a JSON body,
  // but naming a reason string outside the known union entirely — the exact
  // "server and client silently disagree" shape the round-2/round-3 review
  // history on EssaySubmissionError/reasonMessages above both exist to
  // prevent from resolving to anything OTHER than the generic fallback.
  //
  // KAN-25: this used to use `'rateLimited'` as its own example of a
  // recognised-looking-but-unknown reason — true only until this story added
  // it to the union for real (see rejection-reason.ts). Left in place it
  // would have started asserting `errorGeneric`, silently, for a reason that
  // now has its own dedicated message (below) — the exact "start passing for
  // the wrong reason" failure mode this codebase's testing standard exists
  // to catch, caught here by the story that caused it rather than by a later
  // one. Swapped for a reason string no story has claimed.
  it('falls back to the generic message for an unrecognised reason string, rather than rendering it or throwing', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'grading failed', reason: 'gradingFailed' }), { status: 502 }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(60));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.errorGeneric));
  });
});

/**
 * KAN-25 — the client-side half of "a guest who exceeds either cap sees a
 * clear, non-cryptic message". `POST /api/essays` returns 429 with reason
 * `rateLimited` for both the per-session and per-IP caps (route.test.ts
 * proves the server side); this only needs to prove THIS component maps
 * that reason onto its own dedicated string, not `errorGeneric` — the same
 * "bypass case" shape the `tooShort`/`tooLong` tests above already
 * establish for the two length reasons.
 */
describe('EssayEntryForm — KAN-25: the rate-limit rejection gets its own message, not the generic one', () => {
  it('shows the rate-limit message, not the generic one, when the server rejects with reason "rateLimited"', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'too many essay submissions — try again later', reason: 'rateLimited' }), {
        status: 429,
      }),
    );
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(60));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.rateLimitedError));
    expect(screen.queryByText(STRINGS.errorGeneric)).toBeNull();
  });
});

/**
 * KAN-15 (BR-1.4) — the live counter itself. Round-1 review (item #12): this
 * comment used to claim the block "deliberately never asserts against an
 * empty textarea", which its own first test below contradicts — it does,
 * on purpose, to pin the starting state a guest actually sees. What the
 * suite genuinely avoids is stopping there: the story's own warning is
 * against a test that "asserts some number appears on screen while the page
 * is empty proves nothing" as its ONLY evidence the counter is live — every
 * test after the first one drives real content through the textarea and
 * checks the counter tracks it, which is what actually proves "live".
 */
describe('EssayEntryForm — the live word counter (KAN-15)', () => {
  it('shows "0 words" before anything is typed', () => {
    renderForm();
    expect(screen.getByText('0 words')).toBeInTheDocument();
  });

  // Round-4 review: the counter's wrapper carries data-testid="essay-word-count"
  // solely so tests/helpers/essay-fill.ts's ensureEssayFormHydrated can locate
  // it reliably (see that file's own comment on liveWordCountLocator) -- but
  // it's referenced nowhere else, so nothing at the unit level failed if a
  // future edit renamed or dropped it. This pins it as an enforced contract,
  // not a decorative attribute: a mutant that drops or renames the testid now
  // fails here, at the unit level, instead of surfacing later as every e2e
  // test's hydration-guard timeout.
  it('carries the essay-word-count testid the e2e hydration guard depends on to locate this element', () => {
    renderForm();
    expect(screen.getByTestId('essay-word-count')).toBeInTheDocument();
  });

  it('updates live as the guest types, with no submit attempt needed', () => {
    renderForm();

    fillEssay(words(12));
    expect(screen.getByText('12 words')).toBeInTheDocument();

    fillEssay(words(13));
    expect(screen.queryByText('12 words')).toBeNull();
    expect(screen.getByText('13 words')).toBeInTheDocument();
  });

  it('counts a German compound as one word — the counter reflects the SAME rule the server enforces, not a naive character count', () => {
    renderForm();

    fillEssay('Die Rechtsschutzversicherungsgesellschaft ist wichtig.');
    expect(screen.getByText('4 words')).toBeInTheDocument();
  });
});

/**
 * KAN-15 (BR-1.5/BR-1.6) — the guidance/warning banners. Boundaries only
 * (50, 150, 200, 201, 300), per the story's own instruction.
 */
describe('EssayEntryForm — recommended-range guidance and the over-range warning (KAN-15)', () => {
  it('shows no guidance or warning between 50 and 150 words (BR-1.5: "no warning shown")', () => {
    renderForm();

    fillEssay(words(MIN_ESSAY_WORDS));
    expect(screen.queryByText(STRINGS.recommendedRangeGuidance)).toBeNull();
    expect(screen.queryByText(STRINGS.lengthWarning)).toBeNull();

    fillEssay(words(RECOMMENDED_MIN_WORDS - 1));
    expect(screen.queryByText(STRINGS.recommendedRangeGuidance)).toBeNull();
    expect(screen.queryByText(STRINGS.lengthWarning)).toBeNull();
  });

  it('shows the recommended-range guidance starting exactly at 150 words, live, with no submit attempt needed', () => {
    renderForm();

    fillEssay(words(RECOMMENDED_MIN_WORDS));

    expect(screen.getByText(STRINGS.recommendedRangeGuidance)).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.lengthWarning)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows the recommended-range guidance at exactly 200 words — the range is inclusive on both ends', () => {
    renderForm();

    fillEssay(words(RECOMMENDED_MAX_WORDS));

    expect(screen.getByText(STRINGS.recommendedRangeGuidance)).toBeInTheDocument();
  });

  it('switches to the non-blocking warning at exactly 201 words, one over the recommended range', () => {
    renderForm();

    fillEssay(words(RECOMMENDED_MAX_WORDS + 1));

    expect(screen.getByText(STRINGS.lengthWarning)).toBeInTheDocument();
    expect(screen.queryByText(STRINGS.recommendedRangeGuidance)).toBeNull();
    // Non-blocking: no alert role, and (proven in the next describe block)
    // submission is still allowed.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows only the non-blocking warning at exactly 300 words — the hard ceiling itself is not a block', () => {
    renderForm();

    fillEssay(words(MAX_ESSAY_WORDS));

    expect(screen.getByText(STRINGS.lengthWarning)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a 220-word essay — the story\'s own "never blocked" verification case — shows the non-blocking warning, never a block', () => {
    renderForm();

    fillEssay(words(220));

    expect(screen.getByText(STRINGS.lengthWarning)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * KAN-15 (BR-1.7) — the two hard blocks. Boundaries only (49/50, 300/301),
 * and the story's own 1000-word verification case.
 */
describe('EssayEntryForm — the two hard blocks (KAN-15, BR-1.7)', () => {
  it('does not show the too-short error before a submit attempt — blocking messages are touched-gated, like the existing required-field error', () => {
    renderForm();

    fillEssay(words(MIN_ESSAY_WORDS - 1));

    expect(screen.queryByText(STRINGS.tooShortError)).toBeNull();
  });

  it('blocks submission at 49 words with the too-short message, and never calls the API', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(MIN_ESSAY_WORDS - 1));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooShortError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows submission at exactly 50 words — the minimum itself is not blocked', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(MIN_ESSAY_WORDS));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    // react-query's mutate() dispatches asynchronously — the other
    // successful-submission tests in this file already wait for the
    // resulting UI change; here there's no success banner to wait for
    // without letting the mock resolve first, so waitFor on the spy itself.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByText(STRINGS.tooShortError)).toBeNull();
  });

  // Round-1 review (should-fix #2): every other fixture in this file (and
  // in word-count.test.ts, essay-submission.test.ts) is single-space
  // tokens. The Test Lead proved that's load-bearing, not incidental —
  // swapping this component's own countGermanWords call for a naive
  // `content.split(' ').filter(Boolean).length` left all 150 tests across
  // three suites green. Real pasted-essay content has paragraph breaks and
  // sentences with two spaces after the full stop, both of which a naive
  // split miscounts; this fixture is built the same mixed-whitespace way
  // essay-submission.test.ts's server-side counterpart is, so the two sides
  // are proven against the SAME kind of input, not just the same number —
  // see `@/test/essay-content-fixtures`'s own comment for why this builder
  // (`mixedWhitespaceContent` there) lives there now, shared verbatim with
  // essay-submission.test.ts.
  it('blocks 49 words built with newlines, tabs and double spaces (real pasted-essay whitespace) with the too-short message', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(mixedWhitespaceWords(MIN_ESSAY_WORDS - 1));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooShortError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows submission at exactly 50 words built with the same mixed whitespace — the client counts it the same way the server does', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(mixedWhitespaceWords(MIN_ESSAY_WORDS));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByText(STRINGS.tooShortError)).toBeNull();
  });

  it('allows submission at exactly 300 words — the hard ceiling itself is not blocked', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(MAX_ESSAY_WORDS));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByText(STRINGS.tooLongError)).toBeNull();
  });

  it('round-1 review: shows the too-long block live, with no submit attempt needed — unlike too-short, this one must not wait for touch, because the warning it replaces has already gone false', () => {
    renderForm();

    // 305, not the 301 boundary the next test pins — this is specifically
    // the "already well past the ceiling, still typing" case the review
    // named: at 305 words `showLengthWarning` (overRecommended) is already
    // false, so the block message is the ONLY signal a guest still typing
    // gets. Before this fix that message was `touched`-gated, so nothing
    // was shown here at all until they pressed submit.
    fillEssay(words(305));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooLongError);
    expect(screen.queryByText(STRINGS.lengthWarning)).toBeNull();
  });

  it('blocks submission at 301 words with the too-long message, distinct from the too-short one, and never calls the API', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(MAX_ESSAY_WORDS + 1));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooLongError);
    expect(screen.queryByText(STRINGS.tooShortError)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a 1000-word essay — the story\'s own "blocked" verification case — is blocked client-side with the too-long message, and never calls the API', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(1000));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.tooLongError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
