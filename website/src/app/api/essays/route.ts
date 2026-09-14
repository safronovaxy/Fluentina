import { NextRequest, NextResponse } from 'next/server';
import { submitEssay } from '@/lib/domain/essay-submission';
import { essaySubmissionRequestSchema, MAX_ESSAY_CONTENT_BYTES } from '@/lib/contracts/essay-submission';
import { GUEST_SESSION_COOKIE_NAME, GUEST_SESSION_COOKIE_OPTIONS } from '@/lib/guest-session-cookie';
import { isCrossOriginRequest } from '@/lib/same-origin';

/**
 * POST /api/essays — KAN-14, guest essay submission. Storage only: this
 * route persists the essay and reports its id back, nothing more. Grading
 * (KAN-16) and the recommended-length/word-count UI and its server-side
 * counterpart (KAN-15) are both separate stories that build on this
 * endpoint rather than being part of it — see `essaySubmissionRequestSchema`'s
 * own comment for the one seam KAN-15 extends here.
 *
 * Never logs the request body — see the `never log essay text` rule this
 * route is built against; nothing in this file (or anything it calls)
 * writes `content` anywhere but the one `createEssay` insert.
 *
 * Same cross-origin guard as `src/app/api/guest-session/route.ts`, and the
 * same reasoning: `SameSite=Lax` on the guest session cookie is what
 * actually stops a cross-site browser call reaching this route at all
 * (this cookie is the only thing that authorises a write here), and this
 * `Origin`/forwarded-host check is defence in depth against the narrower
 * case that guard doesn't cover — see `lib/same-origin.ts` for exactly
 * what it does and doesn't guarantee. Extracted there rather than
 * duplicated, once this became the second route that needed it, which is
 * exactly what that module's own KAN-10 review note said would happen.
 *
 * This route calls `resolveGuestSession` itself (via `submitEssay`), the
 * same as `/api/guest-session` does, rather than trusting that
 * `GuestSessionBootstrap` already ran — see that component's own comment:
 * an ad blocker, disabled JavaScript, or a request that simply beat the
 * bootstrap call here would otherwise leave a cookie with no
 * `guest_sessions` row behind it, and the essay insert would fail on the
 * foreign key after a guest has already written up to 300 words.
 *
 * Trap this route exists to close (the Architect's own framing): if this
 * inserted the essay under whatever session id the browser's cookie
 * presented, rather than under the id `resolveGuestSession` actually
 * resolved to, a guest whose presented id named an unavailable session
 * (most often, one that already converted to a registered account) would
 * have their essay stored under an id their own browser is never told
 * about — unreadable by them, forever, until retention deletes it. Setting
 * the cookie below whenever `reissued` is true, to the exact id the essay
 * was actually stored under, is what avoids that; see `submitEssay`'s own
 * comment (lib/domain/essay-submission.ts) for the rest of this reasoning.
 */
export async function POST(request: NextRequest) {
  if (isCrossOriginRequest(request)) {
    return NextResponse.json({ error: 'cross-origin request rejected' }, { status: 400 });
  }

  // A single, blunt safety cap on the raw request body — checked here,
  // against bytes, before the body is even parsed as JSON, specifically so
  // a pathologically large payload never reaches JSON.parse or the
  // database. This is NOT the product's word-count rule (KAN-15 owns that,
  // against `content` itself, well below this number — see
  // essaySubmissionRequestSchema's own comment) and is deliberately far
  // more generous than any real essay could ever need.
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_ESSAY_CONTENT_BYTES) {
    return NextResponse.json({ error: 'request body exceeds the safety limit' }, { status: 413 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = essaySubmissionRequestSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid essay submission' }, { status: 400 });
  }

  const rawCookie = request.cookies.get(GUEST_SESSION_COOKIE_NAME)?.value;
  const { essay, reissued } = await submitEssay(rawCookie, parsed.data.content);

  const response = NextResponse.json({ id: essay.id }, { status: 201 });
  if (reissued) {
    // See this file's own "trap this route exists to close" comment above,
    // and resolveGuestSession's `reissued` doc comment
    // (lib/domain/guest-session.ts) for the full case list this covers.
    response.cookies.set(GUEST_SESSION_COOKIE_NAME, essay.sessionId, GUEST_SESSION_COOKIE_OPTIONS);
  }
  return response;
}
