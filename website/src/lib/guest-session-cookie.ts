/**
 * The guest session cookie's name and Set-Cookie attributes, in the one
 * place both adapters that touch it need to agree: `src/middleware.ts`
 * (Edge — mints the id and sets this cookie on the very first response) and
 * `src/app/api/guest-session/route.ts` (Node — creates the session's row,
 * and re-sets this cookie only when it had to replace a missing/invalid
 * value). Neither of those two files is `lib/domain`, `lib/db` or
 * `lib/contracts` — this is plain adapter-level code, deliberately outside
 * all three, per ADR-14: cookies are a framework concern, and nothing under
 * `lib/domain` may know one exists (see that layer's own KAN-10 comments).
 *
 * KAN-10 design decision, per the story's own non-negotiable: the session
 * id is a bearer credential.
 * - `httpOnly: true` — never readable from `document.cookie`; a stolen
 *   token here means a stolen guest session, so nothing in the guest flow's
 *   client-side JavaScript needs (or gets) read access to it.
 * - `secure: true` — never sent over a plain HTTP connection. (Browsers
 *   still honour this on `localhost` over plain HTTP for local dev, so it
 *   is not gated on `NODE_ENV`.)
 * - `sameSite: 'lax'` — not sent on a cross-site request, other than a
 *   top-level GET navigation (e.g. an incoming link), which is what lets a
 *   guest arrive at `/practice` from an external link without losing their
 *   session while still refusing it on a cross-site POST/fetch.
 * - `path: '/'` — valid across the whole app, not only `/practice`: a
 *   converted session (see `lib/db/guest-sessions.ts::convertGuestSessionToUser`)
 *   may need to be read from a non-guest route later, and scoping the
 *   cookie to `/practice` now would silently stop it being sent there.
 *
 * No `maxAge`/`expires` here on purpose — this is a true session cookie,
 * cleared when the browser session ends. A longer-lived guest cookie is a
 * retention-policy decision (see `lib/db/schema.ts`'s note on the
 * still-unwritten retention sweep for guest_sessions rows); nothing in this
 * story's acceptance criteria asks for one, so a duration isn't invented
 * here.
 */
export const GUEST_SESSION_COOKIE_NAME = 'fluentina_guest_session';

export const GUEST_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;
