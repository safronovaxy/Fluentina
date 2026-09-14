'use client';

import { useEffect, useRef } from 'react';

/**
 * KAN-10 — fires once, client-side, on a guest-flow screen's first paint, so
 * the `guest_sessions` row for whatever cookie `src/middleware.ts` (Edge)
 * already set on this response actually gets created. See that
 * middleware's own comment, and `app/api/guest-session/route.ts`'s, for why
 * that split exists: middleware can mint the id and set the cookie on the
 * very first response, but cannot reach Postgres from the Edge runtime, so
 * a Node-context call has to do the write. This component is the trigger
 * for that call — every guest-flow screen that renders it makes its own
 * session usable, without any of them having to remember the mechanism.
 *
 * Not folded into `GuestFlowShell`: at the time of writing, `/practice` is
 * still the guest flow's only screen, and `GuestFlowShell` currently has no
 * client boundary of its own at all (see `LocaleSwitcher.tsx`'s comment on
 * that). Rendering this from the page that actually needs it keeps that
 * true for now; once a second guest-flow screen exists (KAN-13), promoting
 * this into the shared shell — so every future screen gets it automatically
 * — is worth revisiting, the same "wait for the second use" call
 * `GuestFlowShellProps.backHref`'s own comment makes about a general slot.
 *
 * Renders nothing. The request's own `Set-Cookie` header (issued by the
 * route handler, HttpOnly — never read back here) is the only observable
 * effect, so there is deliberately no loading or error UI: a guest never
 * needs to know this ran.
 *
 * Review correction: a failed attempt does NOT "cost nothing" (an earlier
 * version of this comment said so, and was wrong) — ownership isn't the
 * risk here, the `essays.session_id` foreign key is. If this POST never
 * lands (an ad blocker, disabled JavaScript, a transient server error) the
 * guest has a cookie with no `guest_sessions` row behind it, and their
 * first essay submission dies on a foreign-key violation after they've
 * written up to 300 words. KAN-14's submission path must not assume this
 * component ran; it has to call `resolveGuestSession` itself before
 * inserting an essay — which is safe, because that function is already
 * idempotent (see its own comment in lib/domain/guest-session.ts).
 */
export function GuestSessionBootstrap() {
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    fetch('/api/guest-session', { method: 'POST' }).catch(() => {
      // Best-effort — see the component comment above.
    });
  }, []);

  return null;
}
