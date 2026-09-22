/**
 * KAN-31 — the stable reason code every rejection from a first-party API
 * route carries, alongside its (unchanged) status code and message.
 *
 * The problem this exists to solve: a rejection test that asserts only an
 * HTTP status is fragile by construction. Any later guard that returns the
 * same status ahead of an existing one makes that existing test's assertion
 * pass for the wrong reason, silently — exactly what happened across
 * roughly 39 tests when KAN-15's 50-word floor started firing ahead of
 * `POST /api/essays`'s cookie guard: two tests pinning "no cookie -> 400"
 * used seven-word sample essays, so the floor rejected them first with the
 * same status, and neither test would have noticed the cookie guard being
 * disabled entirely. `reason` is what a test (and, eventually, a caller)
 * checks instead of the status alone — it survives a later guard reusing
 * the same status code, and survives the message being reworded or
 * translated, which a plain string-match on `error` would not.
 *
 * Two families make up the union below:
 *
 * - `GUARD_REJECTION_REASONS`: produced by a guard that runs ahead of, and
 *   independently of, `essaySubmissionRequestSchema` — cross-origin, a
 *   missing/malformed session cookie, an oversized request body, malformed
 *   JSON, and the schema's own generic failure (a shape zod rejects for a
 *   reason that isn't one of the two length ones below, e.g. a missing
 *   `content` field entirely). `POST /api/guest-session` only ever produces
 *   the first two of these — it has no body to be oversized, malformed, or
 *   schema-invalid — but the reasons live in one shared list rather than
 *   two, since both routes' cross-origin and cookie guards are the exact
 *   same check (`lib/same-origin.ts`, `guestSessionIdSchema`), not two
 *   independent ones that happen to agree today.
 *
 * - The two length reasons (`tooShort`/`tooLong`) KAN-15 already
 *   established, at the schema level (`essay-submission.ts`) — re-exported
 *   here, not redefined, so there is exactly one place either list is
 *   spelled out, and one type guard that recognises the union of both.
 *
 * KAN-25: `rateLimited` added. One reason, not two, for the same collapsing
 * reason `bodyTooLarge` already documents above — a caller cannot act
 * differently on "your session hit its cap" versus "your IP hit its cap"
 * (or, on `/api/guest-session`, which of ITS two caps), only that it should
 * slow down, so a second or fourth code would carry no information a client
 * could use. Shared by both routes for the same reason `crossOrigin` and
 * `invalidSessionCookie` already are: `/api/essays` and `/api/guest-session`
 * each run their own two-cap check (`lib/domain/rate-limit.ts`), not one
 * check reused verbatim, but the reason either produces is the same.
 * Adding this member is what makes `EssayEntryForm`'s exhaustive
 * `reasonMessages` map (`Record<RejectionReason, string>`) fail to compile
 * until a guest-facing message exists for it, in both languages — the
 * mechanism that module's own comment describes for exactly this case.
 */
import { ESSAY_LENGTH_REJECTION_REASONS, type EssayLengthRejectionReason } from './essay-submission';

/**
 * Reasons produced by a guard ahead of (or independent of) the essay-content
 * schema — shared by both `POST /api/essays` and `POST /api/guest-session`,
 * neither of which is specific to essay content itself.
 *
 * `bodyTooLarge` deliberately covers BOTH places `POST /api/essays` rejects
 * an oversized body — the `Content-Length` pre-check and the streaming
 * byte-count guard below it (see that route's own comments) — under the one
 * code, not two: a caller cannot act differently on "your Content-Length
 * header was honest and too big" versus "we stopped reading your stream
 * once it got too big", so a second code would carry no information a
 * client could use. The route's own tests keep proving each guard fires
 * independently (see route.test.ts) — this union collapsing them into one
 * reason does not collapse that coverage.
 */
export const GUARD_REJECTION_REASONS = [
  'crossOrigin',
  'invalidSessionCookie',
  'rateLimited',
  'bodyTooLarge',
  'invalidJson',
  'invalidSubmission',
] as const;
export type GuardRejectionReason = (typeof GUARD_REJECTION_REASONS)[number];

/** The full set of reason codes a rejection from either route can carry. */
export const REJECTION_REASONS = [...GUARD_REJECTION_REASONS, ...ESSAY_LENGTH_REJECTION_REASONS] as const;
export type RejectionReason = GuardRejectionReason | EssayLengthRejectionReason;

/** Narrows `value` to `RejectionReason` — the one place that check happens, shared by both routes and the client. */
export function isRejectionReason(value: unknown): value is RejectionReason {
  return (REJECTION_REASONS as readonly unknown[]).includes(value);
}
