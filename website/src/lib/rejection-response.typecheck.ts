/**
 * KAN-31 round-2 review — compile-time half of `rejectionResponse`'s own
 * guarantee. Deliberately named so it matches neither vitest's
 * `src/**\/*.{test,spec}.{ts,tsx}` include glob (vitest.config.ts) nor
 * playwright's `tests/**` — see StepIndicator.typecheck.tsx (KAN-27) and
 * ownership.typecheck.ts (KAN-10) for the established idiom this follows;
 * `tsc --noEmit` (the `typecheck` npm script) is its only runner.
 *
 * The Test Lead's finding this exists to close: the guarantee holds today —
 * `rejectionResponse(400, 'oops')` (no `reason`) fails to compile — but
 * nothing PINS it. Loosening `reason` to optional, or folding `status` and
 * `message` into an options object with `reason` as one more optional
 * property on it, would leave every one of this repo's 279 unit tests and
 * 366 browser tests green, because none of them calls `rejectionResponse`
 * with `reason` omitted — they all assert what a full, correct call
 * produces, never that an incomplete one is rejected. Only a compile-time
 * check can prove the omission itself is impossible. This file is that
 * check: the `@ts-expect-error` line below only keeps compiling as long as
 * a call that omits `reason` entirely genuinely fails to typecheck — loosen
 * the signature either way described above and the same call starts
 * compiling cleanly, which turns the `@ts-expect-error` into an "unused
 * directive" error (TS2578) and fails `tsc --noEmit`, exactly like every
 * other `@ts-expect-error` regression guard in this codebase.
 *
 * Verified directly against both mutations named above: reason made the
 * third, optional parameter (`(status, message, reason?)`), and reason
 * folded into an optional options object (`(status, message, options?: {
 * reason?: RejectionReason })`) — both let `rejectionResponse(400, 'oops')`
 * compile, and both made this file fail `tsc --noEmit` as a result. Reverted
 * after confirming.
 */
import { rejectionResponse } from './rejection-response';

// --- Valid usage: must compile ---
rejectionResponse('crossOrigin', 400, 'cross-origin request rejected');

// --- Invalid usage: must NOT compile ---
// The exact regression this file exists to catch: a call that supplies
// `status` and `message` but omits `reason` — the one shape every runtime
// test in this repo never exercises, because they all call the function
// correctly. If a later change makes `reason` optional, in any position, or
// folds it into an options object, this line starts compiling and the
// `@ts-expect-error` below goes unused, failing `tsc --noEmit`.
// @ts-expect-error — `reason` omitted entirely; must not compile.
rejectionResponse(400, 'cross-origin request rejected');
