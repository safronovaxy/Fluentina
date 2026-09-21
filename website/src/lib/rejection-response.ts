import 'server-only';
import { NextResponse } from 'next/server';
import type { RejectionReason } from './contracts/rejection-reason';

/**
 * KAN-31, round-2 review — moved out of `lib/contracts` into plain
 * adapter-level code (`lib/`, alongside `same-origin.ts` and
 * `guest-session-cookie.ts`, ADR-14's precedent for "shared by more than
 * one adapter but not domain/db/contracts"), not `lib/http/`. Both existing
 * neighbours here are the same shape — framework-touching code shared by
 * exactly `guest-session/route.ts` and `essays/route.ts`, deliberately
 * outside `lib/domain`, `lib/db` and `lib/contracts` — so this follows that
 * precedent rather than starting a second adapter-level convention next to
 * it. It was previously placed in `lib/contracts` itself, which is worse
 * than merely inconsistent: that layer is CONTRIBUTING.md's dependency-free,
 * isomorphic one, and `no-restricted-imports`'s `lib/contracts` block (see
 * `eslint.config.js`) restricted the database, the domain layer and the
 * test helpers, but said nothing about a framework server import — so this
 * file importing `next/server`'s `NextResponse` there passed lint clean.
 * Nothing caught it: a round-2 spike importing this helper into a client
 * component typechecked, linted and built successfully, and `next build`
 * reported that route's page bundle growing from ~7.3kB to ~32kB (First
 * Load JS 149kB → 174kB, ~25kB either way it's read) — see the branch's own
 * PR description for the full before/after. The `import 'server-only'` line
 * above is what actually closes that hole now —
 * the same repo-wide idiom every `lib/db` and `lib/domain` module already
 * uses (see e.g. `lib/domain/guest-session.ts`) — so the identical import
 * from a client component now fails the BUILD, not merely the leak
 * detector's spot check: `server-only`'s package throws unconditionally
 * unless resolved through Next's `react-server` bundler condition, which a
 * client bundle never sets. (Vitest never sets it either — this repo's
 * `server-only` alias, `src/test/server-only-stub.ts`, is what keeps
 * `route.test.ts` running against this file; see `vitest.config.ts`.)
 * `no-restricted-imports`'s `lib/contracts` block now also restricts
 * `next/server` directly, so the layer this file used to sit in can't
 * repeat the mistake either.
 *
 * The only way `POST /api/essays` or `POST /api/guest-session` build a
 * rejection with a `reason` on it — but NOT, contrary to what an earlier
 * revision of this comment claimed, the only way either route can build a
 * *rejection* full stop: both files still import `NextResponse` directly
 * for their success paths, so a branch that calls
 * `NextResponse.json({ error }, { status: 400 })` directly, skipping this
 * function entirely, still compiles — a mutant doing exactly that in both
 * routes was run and confirmed (compiles, lints, passes). What IS still
 * true, and is the enforced guarantee this file provides: a call to THIS
 * function that omits `reason`, or misspells it against the `RejectionReason`
 * union, fails to compile — see `rejection-response.typecheck.ts` for the
 * pinned proof, including the case where a later change loosens the
 * parameter to optional, and the case where a later change widens the
 * parameter's type instead. A `no-restricted-syntax` ESLint rule scoped to
 * these two route files (see `eslint.config.js`'s KAN-31 round-3 note)
 * additionally blocks a literal `status >= 400` inside a direct
 * `NextResponse.json(...)` call in either file, unquoted or quoted key alike
 * — round-2's version only caught the unquoted form and a quoted-key mutant
 * slipped past it, which round-3 closed. That rules out exactly that one
 * construction, not every way a rejection could be built without this
 * helper: a computed status, a cast on the status value, the
 * `new NextResponse(...)` constructor form, and the platform's own
 * `Response.json(...)` all still lint clean — none used anywhere in either
 * route today, so this is a theoretical gap, not a closed one; see
 * `eslint.config.js`'s KAN-31 round-3 note for the full list.
 *
 * The gap the positional-parameter shape itself closes: `reason: 'crossOrigin'
 * satisfies RejectionReason` (the shape both routes used before this
 * refactor) proves the LITERAL, if present, is a valid member of the union —
 * it proves nothing about whether a given call site included `reason` at
 * all. `NextResponse.json({ error: 'nope' }, { status: 400 })`, with no
 * `reason` field whatsoever, compiled, linted and passed just as cleanly,
 * caught only if that branch's own test happened to assert one. KAN-25
 * (rate limiting) is about to add a guard exactly like that. Making `reason`
 * this function's first, required, positional parameter — not a property on
 * an object literal a call site can simply omit — means a call to THIS
 * function that forgets it fails to compile rather than shipping to be
 * caught by inspection or a test someone remembered to write.
 *
 * Still deliberately NOT in `rejection-reason.ts` itself: that module is
 * imported client-side too (`EssayEntryForm`, to narrow the `reason` a
 * rejection body carries), and `next/server`'s `NextResponse` is a
 * server-only API — folding it into that isomorphic module would risk
 * exactly the leak described above. This file is only ever imported from a
 * route handler, now enforced rather than merely intended.
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
