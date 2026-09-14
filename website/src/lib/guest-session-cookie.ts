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
 * - `__Host-` name prefix — review's answer to session fixation, not
 *   signing. An attacker doesn't need to forge an id; they can visit the
 *   site themselves, get a legitimately minted one, and plant that in a
 *   victim's browser instead — a signature would verify it just fine. What
 *   actually matters is whether a cookie can be planted into the victim's
 *   browser at all. `cms.` (Strapi, a sibling subdomain of this app) could,
 *   in principle, set a cookie scoped to the shared parent domain via a
 *   content injection there; this app's own cookie is host-only, so the
 *   browser would then hold two cookies under one name and send both,
 *   picked apart by an order nobody controls. `__Host-` makes the browser
 *   refuse to store any cookie under this name that isn't `Secure`, has a
 *   `Domain` attribute at all, or isn't scoped to `Path=/` — exactly the
 *   three preconditions below already meet, so this is a rename, not a
 *   behaviour change for a legitimate response. See
 *   `tests/guest-session.spec.ts` for the WebKit-specific note on this.
 * - `httpOnly: true` — never readable from `document.cookie`; a stolen
 *   token here means a stolen guest session, so nothing in the guest flow's
 *   client-side JavaScript needs (or gets) read access to it.
 * - `secure: true` — never sent over a plain HTTP connection. (Browsers
 *   still honour this on `localhost` over plain HTTP for local dev, so it
 *   is not gated on `NODE_ENV`.) Also one of `__Host-`'s own preconditions —
 *   a browser drops a `__Host-`-prefixed cookie outright without this.
 * - `sameSite: 'lax'` — not sent on a cross-site request, other than a
 *   top-level GET navigation (e.g. an incoming link), which is what lets a
 *   guest arrive at `/practice` from an external link without losing their
 *   session while still refusing it on a cross-site POST/fetch.
 * - `path: '/'` — valid across the whole app, not only `/practice`: a
 *   converted session (see `lib/db/guest-sessions.ts::convertGuestSessionToUser`)
 *   may need to be read from a non-guest route later, and scoping the
 *   cookie to `/practice` now would silently stop it being sent there. Also
 *   `__Host-`'s other precondition — it refuses any narrower path.
 * - `maxAge: THIRTY_DAYS_IN_SECONDS` — matches the retention window already
 *   decided for guest essays (see `lib/db/schema.ts`). Grading is
 *   asynchronous, so a guest who submits, closes the tab, and comes back
 *   needs the key to their own result to still be in their browser; a
 *   session-only cookie (cleared when the browser closes) would lose that
 *   route while the row itself survives as an orphan nothing can read for
 *   the full 30 days — inflating storage and miscounting an interrupted
 *   guest as an abandoned one. The privacy argument for a browser-session
 *   cookie is real, but it's in direct tension with a 30-day data-retention
 *   promise, and retention wins here. Clearing the cookie explicitly at
 *   conversion is registration's job, not this file's.
 */
export const GUEST_SESSION_COOKIE_NAME = '__Host-fluentina_guest_session';

const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60;

export const GUEST_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: THIRTY_DAYS_IN_SECONDS,
} as const;
