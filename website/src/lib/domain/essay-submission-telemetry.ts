import 'server-only';

/**
 * KAN-24 (carried-over PR note #2) — `POST /api/essays` used to emit nothing
 * at all once a submission passed every guard: no log, no counter. Emitting
 * nothing about the essay CONTENT is correct (and tested — see
 * `route.test.ts`'s own "never logs essay text" assertions); emitting
 * nothing about the endpoint at all was the gap this closes. One structured
 * line per submission attempt that reaches the actual write — a hashed
 * session identifier, the content length, and the outcome. Never the
 * content itself, never an email address (there is no account here to have
 * one yet).
 *
 * `contentLength` is the character count of the already-validated content —
 * safe to log on its own (KAN-15's own 50-300 WORD bound already caps what
 * this number can realistically be; it carries no more information than
 * "roughly how long", the same class of thing `essay-submission.ts`'s own
 * `MAX_ESSAY_CONTENT_CHARS` already treats as non-sensitive), unlike the
 * text it's a length of.
 */
import { createHash } from 'node:crypto';
import type { GuestSessionId } from '@/lib/contracts/actor';

export type EssaySubmissionOutcome = 'created' | 'error';

function hashSessionId(sessionId: GuestSessionId): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12);
}

export function logEssaySubmission(sessionId: GuestSessionId, contentLength: number, outcome: EssaySubmissionOutcome): void {
  console.log(
    JSON.stringify({
      severity: outcome === 'created' ? 'INFO' : 'ERROR',
      event: 'essay_submission',
      sessionIdHash: hashSessionId(sessionId),
      contentLength,
      outcome,
    }),
  );
}
