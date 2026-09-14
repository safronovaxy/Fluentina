'use client';

/**
 * KAN-14 — the guest essay text box. Text entry only: no file upload,
 * camera capture or OCR anywhere in this component or the endpoint it
 * talks to (`POST /api/essays`) — that is Phase 1's whole scope, not
 * something left off by omission.
 *
 * Deliberately NOT under `components/guest/chrome/` and so cannot import
 * `next-intl` (see the `no-restricted-imports` override in
 * eslint.config.js and its own comment on why `chrome/` specifically is
 * allow-listed and this directory is not: essay content must go through
 * `GradingProvider`, never this catalogue, and a non-chrome guest
 * component is exactly where that boundary matters). All user-visible
 * chrome text is passed in as `strings`, translated by the Server
 * Component page that renders this (see `(guest)/practice/write/page.tsx`)
 * — this component itself is locale-agnostic.
 *
 * Plain `useState`, not React Hook Form: the only field here is the essay
 * text itself, and KAN-15's live word counter needs that raw string on
 * every keystroke — a controlled `value`/`onChange` is the natural fit for
 * that, and RHF's uncontrolled-by-default model would add friction for it
 * rather than remove any. `essaySubmissionRequestSchema` (lib/contracts,
 * shared with the server) is still the single source of truth for what
 * counts as valid, so client and server can never quietly disagree.
 */
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { essaySubmissionRequestSchema } from '@/lib/contracts/essay-submission';

export interface EssayEntryFormStrings {
  readonly textareaLabel: string;
  readonly placeholder: string;
  readonly requiredError: string;
  readonly submitCta: string;
  readonly submittingCta: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly errorGeneric: string;
}

export interface EssayEntryFormProps {
  readonly strings: EssayEntryFormStrings;
}

interface SubmitEssayResponse {
  readonly id: string;
}

async function postEssay(content: string): Promise<SubmitEssayResponse> {
  const response = await fetch('/api/essays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    // Never the response body in the thrown error — nothing here is
    // guaranteed not to echo something server-side validation rejected,
    // and this message only ever reaches `strings.errorGeneric` below, not
    // the console or any log.
    throw new Error(`essay submission failed with status ${response.status}`);
  }
  return response.json();
}

export function EssayEntryForm({ strings }: EssayEntryFormProps) {
  const [content, setContent] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useMutation({ mutationFn: postEssay });

  // KAN-14 scope only: presence, nothing about length — see
  // essaySubmissionRequestSchema's own comment for the seam KAN-15 extends.
  const isValid = essaySubmissionRequestSchema.safeParse({ content }).success;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!isValid) return;
    mutation.mutate(content);
  }

  if (mutation.isSuccess) {
    return (
      <div role="status" className="rounded-lg border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold">{strings.successTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{strings.successBody}</p>
      </div>
    );
  }

  const showRequiredError = touched && !isValid;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor="essay-content" className="text-sm font-medium">
        {strings.textareaLabel}
      </label>
      <Textarea
        id="essay-content"
        name="content"
        value={content}
        onChange={(event) => setContent(event.target.value)}
        placeholder={strings.placeholder}
        rows={14}
        className="mt-2"
        aria-invalid={showRequiredError}
        aria-describedby={showRequiredError ? 'essay-content-error' : undefined}
      />
      {showRequiredError && (
        <p id="essay-content-error" role="alert" className="mt-1 text-sm text-destructive">
          {strings.requiredError}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {strings.errorGeneric}
        </p>
      )}
      <Button type="submit" className="mt-4" disabled={mutation.isPending}>
        {mutation.isPending ? strings.submittingCta : strings.submitCta}
      </Button>
    </form>
  );
}
