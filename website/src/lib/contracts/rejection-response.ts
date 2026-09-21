import { NextResponse } from 'next/server';
import type { RejectionReason } from './rejection-reason';

/**
 * KAN-31, round-1 review — the only way `POST /api/essays` or
 * `POST /api/guest-session` build a rejection response.
 *
 * The gap this closes: `reason: 'crossOrigin' satisfies RejectionReason`
 * (the shape both routes used before this refactor) proves the LITERAL, if
 * present, is a valid member of the union — it proves nothing about
 * whether a given call site included `reason` at all.
 * `NextResponse.json({ error: 'nope' }, { status: 400 })`, with no `reason`
 * field whatsoever, compiled, linted and passed just as cleanly, caught
 * only if that branch's own test happened to assert one. KAN-25 (rate
 * limiting) is about to add a guard exactly like that. Making `reason` this
 * function's first, required, positional parameter — not a property on an
 * object literal a call site can simply omit — means a new rejection with
 * no reason fails to compile rather than shipping to be caught by
 * inspection or a test someone remembered to write.
 *
 * Deliberately NOT in `rejection-reason.ts` itself: that module is
 * imported client-side too (`EssayEntryForm`, to narrow the `reason` a
 * rejection body carries), and `next/server`'s `NextResponse` is a
 * server-only API — folding it into that isomorphic module would risk
 * pulling a server-only dependency into the client bundle. This file is
 * only ever imported from a route handler.
 *
 * `status` and `message` are unchanged from what each call site passed
 * before this refactor — see each route's own comments for why each one is
 * what it is; this changes only HOW the three are assembled into a
 * response, never what they are. Confirmed directly: both routes'
 * ordered sequence of statuses and messages is identical to `main` with
 * comments stripped (see the branch's own PR description).
 */
export function rejectionResponse(reason: RejectionReason, status: number, message: string) {
  return NextResponse.json({ error: message, reason }, { status });
}
