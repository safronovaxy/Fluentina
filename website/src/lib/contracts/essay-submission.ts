/**
 * KAN-14 — the POST /api/essays request contract.
 *
 * Deliberately narrow: this only validates that some non-empty text was
 * submitted, and guards against a pathologically large payload. It says
 * nothing about what makes a *good* essay — the product's actual
 * word-count rules (a live counter, the 150-200 recommended range, the
 * 201-300 warning, the >300 hard block and the <50 block — BR-1.1) are
 * KAN-15's job, not this story's. `content`'s `.max()` below is the seam
 * that story extends or replaces with the real word-based check; nothing
 * else in this schema should need to change for it to do that. This
 * schema has no `sessionId`/`userId` field, and never should: the actor an
 * essay is stored under comes from the session cookie, resolved
 * server-side, never from anything the request body names — see
 * `src/app/api/essays/route.ts`'s own comment on why, and its test for
 * what a body that tries anyway is proven to do.
 *
 * KAN-15: the `.superRefine` below is exactly that seam, filled. It does
 * NOT replace `.max()` — the character cap stays exactly what it was, a
 * blunt safety limit, not the product rule — it adds the real word-count
 * bounds (50-300, BR-1.4 through BR-1.7) alongside it, reading off
 * `countGermanWords`/`classifyEssayLength` from `lib/contracts/word-count`,
 * the SAME functions `EssayEntryForm`'s live counter calls client-side. One
 * shared implementation is the whole point: a guest the client told "you're
 * fine" must never be rejected by a server running a different rule. Each
 * failure carries a `reason` (`'tooShort'`/`'tooLong'`) in its issue
 * `params`, not just a message string, so a caller (`route.ts`) can build a
 * specific, non-generic response for each case rather than string-matching
 * the message — see this schema's own test for both.
 *
 * `MAX_ESSAY_CONTENT_CHARS` (the cap below, shared by this schema and the
 * client — see `EssayEntryForm`) and `MAX_REQUEST_BODY_BYTES` (the raw-body
 * transport guard `src/app/api/essays/route.ts` checks, against bytes,
 * before the body is even parsed as JSON) are two DIFFERENT limits with two
 * different jobs, not one number enforced twice.
 *
 * Round-1 review (should-fix): they used to be exactly that — a single
 * `MAX_ESSAY_CONTENT_BYTES`, read as characters here and as bytes there,
 * documented as "two independent readings of the one number". That is only
 * true for ASCII. German is this product's entire subject matter, and an
 * umlaut is 2 bytes in UTF-8 but 1 character: 11,000 umlauts is
 * comfortably under a 20,000-*character* cap and yet 22,000 *bytes* — over
 * that same number read as bytes. Not reachable by a real B2 essay (300
 * words is roughly 2,000 characters), but the claimed invariant was false,
 * so the transport guard is now a distinctly larger, separately named
 * number rather than the same one under two units — see
 * `essay-submission.test.ts` for the test pinning both, including that
 * exact German case.
 */
import { z } from 'zod';
import { countGermanWords, classifyEssayLength, isEssayLengthBlocked, MIN_ESSAY_WORDS, MAX_ESSAY_WORDS } from './word-count';

/**
 * The two length-based rejection reasons a caller can distinguish
 * programmatically — see the `.superRefine` below, and this schema's own
 * top-of-file comment on why `reason` travels in `params`, not just prose.
 *
 * Round-2 review (Architect, KAN-15): `route.ts` used to read this reason
 * back off a zod issue with `lengthIssue.params?.reason as 'tooShort' |
 * 'tooLong' | undefined` — a cast, sound only because of a predicate a few
 * lines above it happening to check the same two strings. A third reason
 * (grading, rate limiting) added to that predicate and not the cast would
 * compile cleanly and put a value on the wire neither the route's own type
 * nor `EssayEntryForm`'s narrowing recognised — silently dropped to the
 * generic error client-side, the exact failure round-1 review spent a round
 * removing (see EssayEntryForm.tsx's own history). Exporting the list here,
 * once, and narrowing against it (not casting) in both the route and the
 * client — `isEssayLengthRejectionReason` below — means a reason this array
 * doesn't know about can't compile as one of the two known cases on either
 * side of the wire; it has to be added here first.
 */
export const ESSAY_LENGTH_REJECTION_REASONS = ['tooShort', 'tooLong'] as const;
export type EssayLengthRejectionReason = (typeof ESSAY_LENGTH_REJECTION_REASONS)[number];

/** Narrows `value` to `EssayLengthRejectionReason` — the one place that check happens, shared by the route and the client (see the type's own comment). */
export function isEssayLengthRejectionReason(value: unknown): value is EssayLengthRejectionReason {
  return (ESSAY_LENGTH_REJECTION_REASONS as readonly unknown[]).includes(value);
}

/** Character cap, shared by this schema and the client (`EssayEntryForm`'s `maxLength`). Comfortably above any real essay — 300 words is roughly 2,000 characters. */
export const MAX_ESSAY_CONTENT_CHARS = 20_000;

/**
 * Raw-body transport guard, in bytes — a blunt safety cap, not a product
 * rule. Deliberately larger than `MAX_ESSAY_CONTENT_CHARS` characters could
 * ever cost once actually serialised into the JSON body this guard
 * measures.
 *
 * Round-2 review: the invariant used to be sized against 3 bytes per
 * character — the worst case for a UTF-16 code unit's RAW UTF-8 encoding —
 * which understates the worst case for the JSON-encoded body this guard
 * actually checks. `JSON.stringify` escapes control characters other than
 * the common whitespace ones (`\b \f \n \r \t`) as `\u00XX`: six ASCII
 * bytes for one character. A content string entirely within
 * `MAX_ESSAY_CONTENT_CHARS` can therefore, in the worst case, cost 6 bytes
 * per character once JSON-encoded — not reachable by a real B2 essay
 * (nobody pastes seventeen thousand vertical tabs), but the old 3x
 * invariant was false as written, the same class of bug as the umlaut one
 * above. Sized here against `MAX_ESSAY_CONTENT_CHARS * 6` plus the small
 * JSON envelope `{"content":"..."}` adds, so the claim holds for ANY input,
 * not merely realistic ones — see `essay-submission.test.ts` for the test
 * pinning this exact factor.
 */
export const MAX_REQUEST_BODY_BYTES = 128_000;

export const essaySubmissionRequestSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'essay content must not be empty')
    .max(MAX_ESSAY_CONTENT_CHARS, `essay content exceeds the ${MAX_ESSAY_CONTENT_CHARS}-character safety cap`)
    // KAN-15 (BR-1.4 through BR-1.7) — the real product rule, independent of
    // (and evaluated regardless of) the character-cap check above: zod runs
    // every check in a ZodString's chain and collects all issues, it does
    // not stop at the first failure, so this still runs — and still reports
    // its own specific reason — even when `.max()` above has also failed.
    // `reason` in `params` (not just the message text) is what lets a
    // caller distinguish the two cases programmatically — see route.ts.
    //
    // Round-1 review (consider #6): this used to re-derive the two
    // boundaries directly (`wordCount < MIN_ESSAY_WORDS` / `> MAX_ESSAY_WORDS`)
    // instead of calling `classifyEssayLength`/`isEssayLengthBlocked` — the
    // exact functions `word-count.ts`'s own boundary table exists to be the
    // one place those numbers are expressed. The two agreed today, so this
    // was latent drift, not a live bug, but it's exactly what that file's
    // opening comment says a second implementation risks; `isEssayLengthBlocked`
    // also had no production caller at all until this. Routing through the
    // classifier here means the boundaries are expressed exactly once.
    .superRefine((value, ctx) => {
      const wordCount = countGermanWords(value);
      const status = classifyEssayLength(wordCount);
      if (!isEssayLengthBlocked(status)) return;
      if (status === 'tooShort') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `essay is under the ${MIN_ESSAY_WORDS}-word minimum — too short to grade`,
          params: { reason: 'tooShort' satisfies EssayLengthRejectionReason },
        });
      } else {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `essay exceeds the ${MAX_ESSAY_WORDS}-word maximum`,
          params: { reason: 'tooLong' satisfies EssayLengthRejectionReason },
        });
      }
    }),
});

export type EssaySubmissionRequest = z.infer<typeof essaySubmissionRequestSchema>;
