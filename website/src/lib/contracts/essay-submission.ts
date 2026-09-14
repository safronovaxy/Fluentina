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
    .max(MAX_ESSAY_CONTENT_CHARS, `essay content exceeds the ${MAX_ESSAY_CONTENT_CHARS}-character safety cap`),
});

export type EssaySubmissionRequest = z.infer<typeof essaySubmissionRequestSchema>;
