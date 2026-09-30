import 'server-only';

/**
 * KAN-24 (carried-over PR note #2) — `POST /api/essays` used to emit nothing
 * at all once a submission passed every guard: no log, no counter. Emitting
 * nothing about the essay CONTENT is correct (and tested — see
 * `route.test.ts`'s own "never logs essay text" assertions); emitting
 * nothing about the endpoint at all was the gap this closes. One structured
 * line per submission attempt that reaches the actual write — a hashed
 * identity, the content length, and the outcome. Never the content itself,
 * never an email address.
 *
 * KAN-52: the identity is the submitter's `OwnerActor` — a guest's session id
 * OR a registered user's id — because a registered submission that logged no
 * correlatable identity would reopen the gap KAN-24 closed for guests. Each is
 * hashed and truncated the same way, and both are HIGH-entropy (128 bits of
 * session id; a random UUID), so the truncation is a genuinely one-way
 * correlation key, not the low-entropy case `hashAndTruncate` in
 * `rate-limit.ts` warns about for an address. A guest line keeps its
 * `sessionIdHash` field; a registered line carries `userIdHash` instead. The
 * two never appear together, so one query per field still selects one kind of
 * submitter.
 *
 * `contentLength` is the character count of the already-validated content —
 * safe to log on its own (KAN-15's own 50-300 WORD bound already caps what
 * this number can realistically be; it carries no more information than
 * "roughly how long", the same class of thing `essay-submission.ts`'s own
 * `MAX_ESSAY_CONTENT_CHARS` already treats as non-sensitive), unlike the
 * text it's a length of.
 */
import { createHash } from 'node:crypto';
import type { OwnerActor } from '@/lib/contracts/actor';

export type EssaySubmissionOutcome = 'created' | 'error';

function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function logEssaySubmission(actor: OwnerActor, contentLength: number, outcome: EssaySubmissionOutcome): void {
  console.log(
    JSON.stringify({
      severity: outcome === 'created' ? 'INFO' : 'ERROR',
      event: 'essay_submission',
      ...(actor.kind === 'guest'
        ? { sessionIdHash: hashIdentity(actor.sessionId) }
        : { userIdHash: hashIdentity(actor.userId) }),
      contentLength,
      outcome,
    }),
  );
}
