import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import { EssayEntryForm, type EssayEntryFormStrings } from './EssayEntryForm';
import { MAX_ESSAY_CONTENT_CHARS } from '@/lib/contracts/essay-submission';
import { MIN_ESSAY_WORDS, RECOMMENDED_MIN_WORDS, RECOMMENDED_MAX_WORDS, MAX_ESSAY_WORDS } from '@/lib/contracts/word-count';

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
};

/** `n` distinct, single-space-separated tokens — countGermanWords(words(n)) === n. */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `Wort${i}`).join(' ');
}

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
    // not merely the browser's maxLength attribute. A single giant token
    // (no whitespace) also trips the KAN-15 word-count check (it's one
    // "word"), but the char-cap message still takes precedence — see
    // EssayEntryForm's own comment on why.
    const overCapContent = 'a'.repeat(MAX_ESSAY_CONTENT_CHARS + 1);

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
});

/**
 * KAN-15 (BR-1.4) — the live counter itself. Deliberately never asserts
 * against an empty textarea (the story's own warning against a test that
 * "asserts some number appears on screen while the page is empty proves
 * nothing") — every assertion below drives real content through the
 * textarea first and checks the counter tracks it.
 */
describe('EssayEntryForm — the live word counter (KAN-15)', () => {
  it('shows "0 words" before anything is typed', () => {
    renderForm();
    expect(screen.getByText('0 words')).toBeInTheDocument();
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

  it('allows submission at exactly 300 words — the hard ceiling itself is not blocked', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderForm();

    fillEssay(words(MAX_ESSAY_WORDS));
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(screen.queryByText(STRINGS.tooLongError)).toBeNull();
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
