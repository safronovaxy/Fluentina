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
 * — this component itself is locale-agnostic. The one exception is the
 * live word count itself (KAN-15), which needs next-intl's ICU `plural`
 * support (see `WordCountLabel`'s own comment) — that lives in its own
 * `chrome/` component, imported here and handed only the resulting
 * NUMBER, never the essay text, so this file's own restriction stays true.
 *
 * Plain `useState`, not React Hook Form: the only field here is the essay
 * text itself, and KAN-15's live word counter needs that raw string on
 * every keystroke — a controlled `value`/`onChange` is the natural fit for
 * that, and RHF's uncontrolled-by-default model would add friction for it
 * rather than remove any. `essaySubmissionRequestSchema` (lib/contracts,
 * shared with the server) is still the single source of truth for what
 * counts as valid, so client and server can never quietly disagree.
 *
 * KAN-15 (BR-1.4 through BR-1.7): the word-count guidance/warning/block
 * states below all read off `countGermanWords`/`classifyEssayLength`
 * (`lib/contracts/word-count.ts`) — the SAME functions
 * `essaySubmissionRequestSchema`'s `.superRefine` calls server-side. One
 * shared implementation is what makes "never blocked here, never blocked
 * there either" actually true, rather than two rules that happen to agree
 * today.
 */
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { WordCountLabel } from '@/components/guest/chrome/WordCountLabel';
import {
  essaySubmissionRequestSchema,
  MAX_ESSAY_CONTENT_CHARS,
  isEssayLengthRejectionReason,
  type EssayLengthRejectionReason,
} from '@/lib/contracts/essay-submission';
import { countGermanWords, classifyEssayLength } from '@/lib/contracts/word-count';

export interface EssayEntryFormStrings {
  readonly textareaLabel: string;
  readonly placeholder: string;
  readonly requiredError: string;
  readonly recommendedRangeGuidance: string;
  readonly lengthWarning: string;
  readonly tooShortError: string;
  readonly tooLongError: string;
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

/**
 * Round-1 review (should-fix #3): `POST /api/essays` returns a structured
 * `reason` (`'tooShort'`/`'tooLong'`) alongside its English `message` for
 * exactly this reason — so a caller that bypassed the client-side check
 * below (the only real way this branch is ever reached — EssayEntryForm
 * blocks first) can still be told why in the guest's own language, by
 * mapping `reason` onto the already-translated string this component
 * already holds, rather than rendering the route's English prose directly
 * (which the old `errorGeneric`-only path also correctly never did — see
 * that history below). Only `reason` is read out of the body, and only if
 * it's one of the two known values — the raw `error` message string itself
 * is still never surfaced, matching the rule this route is built against
 * (nothing server-side validation rejected is guaranteed safe to echo
 * verbatim).
 *
 * Round-2 review (Architect, blocking): `EssayLengthRejectionReason` used to
 * be redeclared locally here (`'tooShort' | 'tooLong'`), a second copy of
 * the exact type `route.ts` also redeclared, agreeing only because both
 * were hand-typed to the same two strings today — a third reason added to
 * one and not the other would compile cleanly on both sides and desync
 * silently. Both now import the same type (and the same
 * `isEssayLengthRejectionReason` narrowing function) from
 * `lib/contracts/essay-submission` — the layer this pair of literals always
 * actually belonged to, being the schema's own `reason` values.
 */
class EssaySubmissionError extends Error {
  readonly reason: EssayLengthRejectionReason | undefined;

  constructor(status: number, reason: EssayLengthRejectionReason | undefined) {
    super(`essay submission failed with status ${status}`);
    this.reason = reason;
  }
}

async function postEssay(content: string): Promise<SubmitEssayResponse> {
  const response = await fetch('/api/essays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    // Read only the structured `reason` field, never the `error` message
    // text — the response body may not be JSON at all (a proxy error page,
    // for instance), so this is deliberately best-effort and swallows a
    // parse failure rather than letting it replace the real HTTP-status
    // error below.
    let reason: EssayLengthRejectionReason | undefined;
    try {
      const body: unknown = await response.json();
      const candidate = (body as { reason?: unknown } | null)?.reason;
      if (isEssayLengthRejectionReason(candidate)) reason = candidate;
    } catch {
      // Not JSON, or no body at all — reason stays undefined and the
      // generic error message is shown, same as before this reason-mapping
      // existed.
    }
    throw new EssaySubmissionError(response.status, reason);
  }
  return response.json();
}

export function EssayEntryForm({ strings }: EssayEntryFormProps) {
  const [content, setContent] = useState('');
  const [touched, setTouched] = useState(false);
  const mutation = useMutation({ mutationFn: postEssay });

  // Single source of truth for whether this is submittable at all — the
  // exact schema `POST /api/essays` re-checks server-side, character cap
  // AND (KAN-15) word-count bounds included. Everything below this line
  // only decides WHICH message to show for a `false` here; it never
  // decides validity on its own.
  const isValid = essaySubmissionRequestSchema.safeParse({ content }).success;

  const trimmedContent = content.trim();
  const isEmpty = trimmedContent === '';
  const isOverCharCap = trimmedContent.length > MAX_ESSAY_CONTENT_CHARS;
  const wordCount = countGermanWords(content);
  const lengthStatus = classifyEssayLength(wordCount);

  // Precedence mirrors the schema's own check order (empty -> character cap
  // -> word count — see essaySubmissionRequestSchema): an empty box or a
  // scripted over-cap paste keeps the existing KAN-14 message, and only a
  // content that clears BOTH of those but still fails on word count gets
  // one of the two new KAN-15 messages.
  //
  // Round-2 review (Architect, blocking): this comment used to claim
  // "`isValid` gates all three" — it gates two. `showRequiredError` and
  // `showTooShortError` both check `!isValid` explicitly; `showTooLongError`
  // (below) does not, and was never meant to: it needs no gate of its own
  // because `lengthStatus === 'tooLong'` and `!isValid` are the SAME
  // computation once content is non-empty and under the character cap —
  // both `classifyEssayLength` here and `essaySubmissionRequestSchema`'s
  // `.superRefine` server-side read off `word-count.ts`'s one shared
  // boundary table, so a `tooLong` classification and a failed schema parse
  // can never disagree for that content. Checking `!isValid` there too would
  // be a second way of asking the same question, not a safety property this
  // component would otherwise lack.
  //
  // Round-1 review (should-fix): showTooLongError used to be `touched`-gated
  // the same way the other two are. That meant the ONLY signal a guest
  // typing past 300 words had was the warning (`showLengthWarning`, below)
  // going false the instant they crossed the ceiling — the warning is gated
  // on `overRecommended`, which stops being true at exactly the word count
  // where `tooLong` starts, so it disappears with nothing replacing it until
  // they pressed submit and were told for the first time. Live is the right
  // default for a state that's getting WORSE, not better, as they keep
  // typing — the opposite of `showRequiredError`/`showTooShortError`, which
  // stay `touched`-gated deliberately: a freshly empty box (the state every
  // guest starts in) must not shout at them before they've done anything.
  const showRequiredError = touched && !isValid && (isEmpty || isOverCharCap);
  const showTooShortError = touched && !isValid && !isEmpty && !isOverCharCap && lengthStatus === 'tooShort';
  const showTooLongError = !isEmpty && !isOverCharCap && lengthStatus === 'tooLong';

  // Guidance/warning are non-blocking and live — shown while typing, not
  // gated behind a submit attempt the way the three blocking messages
  // above are (BR-1.5/BR-1.6: "guidance only" / "non-blocking warning").
  const showRecommendedGuidance = lengthStatus === 'recommended';
  const showLengthWarning = lengthStatus === 'overRecommended';

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

  const isInvalid = showRequiredError || showTooShortError || showTooLongError;
  const errorId = showRequiredError
    ? 'essay-content-error'
    : showTooShortError
      ? 'essay-content-too-short'
      : showTooLongError
        ? 'essay-content-too-long'
        : undefined;

  // Round-1 review (should-fix #3): maps the server's structured `reason`
  // (see postEssay/EssaySubmissionError above) onto the SAME translated
  // strings the live client-side check already uses — a guest who somehow
  // bypassed that check and reached the server's independent enforcement
  // now sees the specific, correctly-localised reason rather than the
  // generic fallback every server rejection used to render regardless of
  // why. Anything else (a 500, a network failure, a body with no
  // recognised `reason`) still falls back to `errorGeneric`.
  const submissionError = mutation.error instanceof EssaySubmissionError ? mutation.error : undefined;
  const submissionErrorMessage =
    submissionError?.reason === 'tooShort'
      ? strings.tooShortError
      : submissionError?.reason === 'tooLong'
        ? strings.tooLongError
        : strings.errorGeneric;

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
        // The browser's own defence against a huge paste — the client-side
        // half of `essaySubmissionRequestSchema`'s `.max()`, so they can
        // never quietly disagree. A native `maxLength` only constrains user
        // input (typing/pasting), not a scripted `.value` assignment, which
        // is why `isValid` below still checks the schema itself rather than
        // relying on this alone.
        maxLength={MAX_ESSAY_CONTENT_CHARS}
        aria-invalid={isInvalid}
        aria-describedby={errorId}
      />
      <div className="mt-1 text-sm text-muted-foreground">
        <WordCountLabel count={wordCount} />
      </div>
      {showRecommendedGuidance && <p className="mt-1 text-sm text-muted-foreground">{strings.recommendedRangeGuidance}</p>}
      {showLengthWarning && <p className="mt-1 text-sm text-amber-600">{strings.lengthWarning}</p>}
      {showRequiredError && (
        <p id="essay-content-error" role="alert" className="mt-1 text-sm text-destructive">
          {strings.requiredError}
        </p>
      )}
      {showTooShortError && (
        <p id="essay-content-too-short" role="alert" className="mt-1 text-sm text-destructive">
          {strings.tooShortError}
        </p>
      )}
      {showTooLongError && (
        <p id="essay-content-too-long" role="alert" className="mt-1 text-sm text-destructive">
          {strings.tooLongError}
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {submissionErrorMessage}
        </p>
      )}
      <Button type="submit" className="mt-4" disabled={mutation.isPending}>
        {mutation.isPending ? strings.submittingCta : strings.submitCta}
      </Button>
    </form>
  );
}
