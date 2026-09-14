import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EssayEntryForm, type EssayEntryFormStrings } from './EssayEntryForm';

const STRINGS: EssayEntryFormStrings = {
  textareaLabel: 'Your essay',
  placeholder: 'Write or paste your essay here...',
  requiredError: 'Please write something before submitting.',
  submitCta: 'Submit essay',
  submittingCta: 'Submitting...',
  successTitle: 'Essay received',
  successBody: "Your essay has been submitted. We're working on the next steps of the guest flow.",
  errorGeneric: 'Something went wrong submitting your essay. Please try again.',
};

function renderForm() {
  // A fresh QueryClient per render — react-query caches mutations/queries
  // on the client instance, and a shared one would leak state (e.g. a
  // mutation still "pending" from a previous test) across these tests.
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <EssayEntryForm strings={STRINGS} />
    </QueryClientProvider>,
  );
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

    const textarea = screen.getByLabelText(STRINGS.textareaLabel);
    fireEvent.change(textarea, { target: { value: '    \n\t  ' } });
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

    fireEvent.change(screen.getByLabelText(STRINGS.textareaLabel), {
      target: { value: 'Ein vollständiger Aufsatz auf B2-Niveau.' },
    });
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(STRINGS.successTitle));

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/essays',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ content: 'Ein vollständiger Aufsatz auf B2-Niveau.' }),
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

    fireEvent.change(screen.getByLabelText(STRINGS.textareaLabel), { target: { value: 'Noch ein Aufsatz.' } });
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

    fireEvent.change(screen.getByLabelText(STRINGS.textareaLabel), { target: { value: 'Ein Aufsatz, der fehlschlägt.' } });
    fireEvent.click(screen.getByRole('button', { name: STRINGS.submitCta }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(STRINGS.errorGeneric));

    // Never lost on failure — the guest should not have to retype a
    // half-written essay just because the request failed once.
    expect(screen.getByLabelText(STRINGS.textareaLabel)).toHaveValue('Ein Aufsatz, der fehlschlägt.');
  });
});
