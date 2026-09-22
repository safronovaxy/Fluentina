/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { POST } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { getGuestSessionById, createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { getEssayById } from '@/lib/db/essays';
import { db } from '@/lib/db/client';
import { essays } from '@/lib/db/schema';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import type { GuestSessionId } from '@/lib/contracts/actor';
import { MAX_ESSAY_CONTENT_CHARS, MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { MIN_ESSAY_WORDS, MAX_ESSAY_WORDS } from '@/lib/contracts/word-count';
import { ESSAY_SUBMISSION_SESSION_LIMIT, ESSAY_SUBMISSION_IP_LIMIT } from '@/lib/domain/rate-limit';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import { wordsContent, validLengthContent, contentOfExactLength } from '@/test/essay-content-fixtures';

/**
 * Round-1 review (should-fix #9): two tests below CLAIM "creates no essay"
 * in their own title but only ever asserted the response status — a status-
 * only assertion would not notice a route that returns 400 after already
 * writing the row (e.g. a transaction that inserts, then fails validation
 * on the way back out). This queries the `essays` table directly rather
 * than going through `getEssayById`, which needs an id neither test has —
 * the whole point is that no id was ever returned. Test-only: `db` is
 * otherwise `lib/db`-internal (see that module's own comment) — test files
 * are exempt from the import restriction that enforces that (eslint.config.js),
 * the same exemption `test/db-fixtures.ts` already relies on for its own
 * direct `db` use.
 */
async function countEssaysForSession(sessionId: string): Promise<number> {
  const rows = await db.select({ id: essays.id }).from(essays).where(eq(essays.sessionId, sessionId));
  return rows.length;
}

function postEssay(
  body: unknown,
  cookieValue?: string,
  headers?: Record<string, string>,
  url = 'http://localhost:3000/api/essays',
): NextRequest {
  const cookieHeader = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL(url), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...cookieHeader,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

/**
 * The `X-Forwarded-For` header value for a request that arrived through the
 * real production proxy chain — a client IP followed by the load balancer's
 * own, the exact two-hop shape `clientIp` (`lib/client-ip.ts`) is written
 * against; see that module's own comment for why the trusted entry is the
 * second-to-last one, not the last. Every KAN-25 test below that needs a
 * specific, distinct IP identity uses this rather than a bare string, so
 * each one is also proof `clientIp` is wired into these routes correctly,
 * not just that some string labelled "IP" made it into a bucket key.
 */
function xff(ip: string): Record<string, string> {
  return { 'x-forwarded-for': `${ip}, 34.120.0.1` };
}

/** A request whose raw body is exactly `text`, bypassing JSON.stringify — needed for the oversized/malformed-body tests. */
function postRaw(text: string, cookieValue?: string): NextRequest {
  const cookieHeader = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL('http://localhost:3000/api/essays'), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...cookieHeader,
    },
    body: text,
  });
}

// KAN-15: most tests below use `validLengthContent`, a short, human-readable
// sentence standing in for "some essay", padded to clear the 50-word floor —
// none of them are testing length, they're testing cookie/session/
// cross-origin/ownership behaviour, with essay text as incidental content.
// `wordsContent` and `contentOfExactLength` build content that pins an
// EXACT word count or character length instead, for the tests that are
// testing length (or need to hold it fixed while a different axis is the
// one under test) — see `@/test/essay-content-fixtures`'s own comment for
// why all three now live there, shared with essay-submission.test.ts and
// EssayEntryForm.test.tsx, rather than redefined per file.

beforeAll(async () => {
  await resetDatabase();
});

afterEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await closePool();
});

describe('POST /api/essays — well-formed cookie, row already exists (returning guest)', () => {
  it('persists the essay under the presented session and returns its id, with no cookie to reissue', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const content = validLengthContent('A perfectly ordinary essay submission.');
    const response = await POST(postEssay({ content }, sessionId));
    const body: { id: string } = await response.json();

    expect(response.status).toBe(201);
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();

    const persisted = await getEssayById({ kind: 'guest', sessionId }, body.id);
    expect(persisted?.content).toBe(content);
    expect(persisted?.sessionId).toBe(sessionId);
  });

  it('never leaks the guest session id into the JSON response body — only the essay id comes back', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const content = validLengthContent('Nothing here should reveal the session id.');
    const response = await POST(postEssay({ content }, sessionId));
    const body: unknown = await response.json();

    // Round-1 review (Test Lead, blocking): this test's own title claims a
    // successful submission ran — asserting only the body's absence proves
    // that even when the submission was REJECTED and never wrote a body
    // containing a session id in the first place (e.g. every request
    // refused by KAN-25's own rate limit). Pinning 201 is what proves the
    // path this test's title names actually ran.
    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain(sessionId);
  });

  it('never writes the submitted essay text to the console — essay content is never logged', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secretPhrase = validLengthContent('a very particular sentence nobody should ever see logged');

    try {
      const response = await POST(postEssay({ content: secretPhrase }, sessionId));

      // Round-1 review (Test Lead, blocking): same reasoning as the test
      // above — with the limiter mutated to refuse everything, this
      // submission would never reach the code path that could log the
      // secret phrase, and every assertion below would still pass for the
      // wrong reason. 201 proves the submission actually went through.
      expect(response.status).toBe(201);
      for (const spy of [logSpy, errorSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(secretPhrase);
        }
      }
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

describe('POST /api/essays — well-formed cookie, no row yet (bootstrap never landed)', () => {
  it('creates the session row under the presented id and stores the essay there', async () => {
    const mintedByMiddleware = generateGuestSessionId();

    const response = await POST(
      postEssay({ content: validLengthContent('Submitted before the bootstrap POST completed.') }, mintedByMiddleware),
    );

    expect(response.status).toBe(201);
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
    const persistedSession = await getGuestSessionById({ kind: 'guest', sessionId: mintedByMiddleware }, mintedByMiddleware);
    expect(persistedSession?.id).toBe(mintedByMiddleware);
  });
});

describe('POST /api/essays — no cookie at all', () => {
  // Round-1 review (blocking): this route used to mint a fresh session for
  // anyone who called it with no cookie at all — reusing the exact
  // resolution behaviour `/api/guest-session` was reworked to refuse, for
  // the same reason: a caller presenting nothing is not a real guest whose
  // browser already carries the cookie middleware set, it's the second,
  // unauthenticated cookie issuer that route's own review closed. Mirrors
  // `/api/guest-session`'s own "missing or malformed cookie" tests
  // (route.test.ts) exactly.
  //
  // KAN-15 round-1 review (blocking, again): both fixtures below used to be
  // a handful of words — seven, comfortably under the new 50-word floor
  // this story adds. That made a 400 here ambiguous: it's the same status
  // this route now also returns for a too-short essay from a perfectly
  // legitimate cookie, so a mutant that widened the cookie guard to accept
  // (and mint a session for) any non-empty or even any cookie value at all
  // left this entire file green — the fixture's own word count was doing
  // the rejecting, not the guard these tests exist to pin. `validLengthContent`
  // (60 words, defined above) clears the floor, so a 400 here can only be
  // the cookie guard; asserting the exact message (naming the cookie, not
  // the word count) and that no session cookie is ever reissued closes the
  // gap the padding alone wouldn't — a mutant minting a session for a forged
  // cookie could still return 400 for some unrelated reason and pass a
  // status-only assertion.
  it('rejects a request with no cookie at all — 400, reason "invalidSessionCookie", no session resolved, no essay stored', async () => {
    const response = await POST(
      postEssay({ content: validLengthContent('Submitted with no guest session cookie present.') }),
    );
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing or invalid guest session cookie');
    // KAN-31: `reason`, not just the status, is what tells this guard's 400
    // apart from every OTHER 400 this route can return — including the
    // 50-word floor's, which fired ahead of this exact guard for two tests
    // here before `validLengthContent` closed that gap (see this describe
    // block's own comment above). A mutant that widened the cookie guard to
    // accept (and mint a session for) any request, leaving some unrelated
    // guard to reject this content for a different reason, now fails here
    // even if it happened to also return 400.
    expect(body.reason).toBe('invalidSessionCookie');
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('rejects a malformed or forged cookie the same way — 400, reason "invalidSessionCookie", and the forged value never becomes a row or an essay', async () => {
    const forged = 'attacker-supplied-value';

    const response = await POST(
      postEssay({ content: validLengthContent('Submitted with a malformed guest session cookie.') }, forged),
    );
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing or invalid guest session cookie');
    expect(body.reason).toBe('invalidSessionCookie');
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
    const forgedActor = { kind: 'guest' as const, sessionId: forged as GuestSessionId };
    expect(await getGuestSessionById(forgedActor, forged)).toBeNull();
  });

  // Round-2 review: the cookie check moved back ahead of every body-reading
  // step specifically so a caller presenting no cookie never costs this
  // route a buffer or a JSON parse — see route.ts's own comment. Nothing
  // proved that ordering; a mutant restoring the old order (cookie check
  // after the body is read and parsed) left the whole suite green, because
  // every other "no cookie" test above sends a small, already-buffered body
  // that reads instantly either way. An effectively unbounded stream is the
  // only shape that tells the two orderings apart within a test timeout.
  it('never pulls a single chunk off the body stream for a missing cookie — rejected on the header checks alone, before the body is read at all', async () => {
    let pulls = 0;
    const chunk = new TextEncoder().encode('a'.repeat(10_000));
    // Never closes on its own — if the cookie check ran after the body were
    // read, this route would have to drain (or cap-reject) this stream
    // first, which pulls at least once. Zero pulls is only possible if the
    // cookie check runs first and the body is never touched.
    //
    // highWaterMark: 0 is deliberate — a default ReadableStream (hwm 1)
    // eagerly calls `pull` once at construction to fill its queue,
    // regardless of whether anything ever reads from it, which would make
    // "0 pulls" unreachable no matter how this route behaves. hwm 0 keeps
    // desiredSize at 0 until something actually calls read(), so a pull
    // count of 0 here means what it claims: nothing pulled anything.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 },
    );
    const request = new NextRequest(new URL('http://localhost:3000/api/essays'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        // deliberately no cookie header
      },
      body: stream,
      duplex: 'half',
      // `duplex` is required by the underlying fetch implementation for a
      // streamed body but isn't in Next's own narrower NextRequestInit type.
    } as ConstructorParameters<typeof NextRequest>[1]);

    const response = await POST(request);

    expect(response.status).toBe(400);
    expect(pulls).toBe(0);
  });
});

describe('POST /api/essays — the presented cookie names an already-converted session (the reissue trap)', () => {
  // This is the exact scenario the Architect flagged: a guest converts,
  // still holds the old session cookie, and submits an essay on their very
  // next request. Storing it under the presented (stale) id instead of the
  // resolved (new) one would insert a row this guest's own browser can
  // never read back — the essay exists, but the cookie naming it never
  // reaches them. Each assertion below closes one part of that off.
  it('stores the essay under a NEW session id, not the stale one presented, and sets the cookie to it', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const response = await POST(
      postEssay({ content: validLengthContent('Written by a guest whose browser still has the old cookie.') }, staleSessionId),
    );
    const body: { id: string } = await response.json();

    expect(response.status).toBe(201);
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).not.toBe(staleSessionId);
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);

    const newSessionId = guestSessionIdSchema.parse(cookie?.value);
    const readableUnderNewCookie = await getEssayById({ kind: 'guest', sessionId: newSessionId }, body.id);
    expect(readableUnderNewCookie?.id).toBe(body.id);
  });

  it('the essay is NOT readable under the stale, presented session id — the leak this route exists to close', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const response = await POST(
      postEssay({ content: validLengthContent('Must never be readable through the stale session.') }, staleSessionId),
    );
    const body: { id: string } = await response.json();

    // KAN-15 round: this used to assert nothing about `response.status`, so
    // a submission that started being rejected for an unrelated reason
    // would still pass here — `body.id` would be `undefined`, and
    // `getEssayById(..., undefined)` returns null trivially, the exact
    // outcome asserted below, with nothing about the actual leak this test
    // exists to close ever exercised. Asserting 201 first is what makes the
    // assertion after it mean what it claims.
    expect(response.status).toBe(201);
    const readableUnderStaleCookie = await getEssayById({ kind: 'guest', sessionId: staleSessionId }, body.id);
    expect(readableUnderStaleCookie).toBeNull();
  });

  it('the reissued cookie carries HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime, the same as guest-session issuance', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const response = await POST(
      postEssay({ content: validLengthContent('Checking the reissued cookie attributes.') }, staleSessionId),
    );

    expect(response.status).toBe(201);
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });
});

describe('POST /api/essays — invalid submissions', () => {
  // Round-2 review (Test Lead, blocking): this test's own title used to
  // claim "creates no essay" while asserting only `response.status` — a
  // status-only assertion would not notice a route that inserted the row
  // before failing on the way back out. It also predates KAN-15's 50-word
  // floor: an empty string is 0 words, which the floor rejects on its own
  // terms (reason `tooShort`) — the schema's separate `.min(1)` "must not be
  // empty" issue still fires too (zod collects every issue in the chain, not
  // just the first), but `route.ts`'s own lookup prefers the length-specific
  // custom issue when one exists (see its own comment), so the response this
  // test actually observes is indistinguishable from any other too-short
  // essay's. Asserting `reason: 'tooShort'` (not just a bare 400) and the
  // persisted-row count (via `countEssaysForSession`, the helper round-1
  // review's should-fix #9 added for exactly this) is what makes this test's
  // own claim true, and what a mutant weakening either guard would now fail.
  it('rejects empty content with 400, reason "tooShort", and creates no essay', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: '' }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('tooShort');
    expect(await countEssaysForSession(sessionId)).toBe(0);
  });

  it('rejects whitespace-only content with 400, reason "tooShort", and creates no essay — trimmed, not merely non-empty', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: '     \n\t  ' }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('tooShort');
    expect(await countEssaysForSession(sessionId)).toBe(0);
  });

  it('rejects a body with no content field at all, with the generic message and reason "invalidSubmission" — never a length-specific reason for a field that was never a string to count words in', async () => {
    // Round-2 review: the cookie check now runs before the body is ever
    // read (see route.ts's own comment), so this needs a valid cookie —
    // without one, this would still assert 400, but for "missing cookie",
    // not for the missing content field its own name claims to be testing.
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({}, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    // Round-2 review (Test Lead, blocking): a status-only assertion here
    // cannot tell "content is required" apart from the 400 the 50-word
    // floor also returns. `content` missing entirely fails zod's base
    // `string()` type check (an `invalid_type` issue), which short-circuits
    // the rest of the chain — `.superRefine` never runs, so no `tooShort`/
    // `tooLong` custom issue exists for route.ts to find, and this falls
    // through to the one generic message left in that branch. Asserting
    // that message (and, KAN-31, that `reason` is the generic
    // `invalidSubmission` rather than a length one) is what proves this 400
    // came from the missing field, not a coincidental length rejection.
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid essay submission');
    expect(body.reason).toBe('invalidSubmission');
    expect(await countEssaysForSession(sessionId)).toBe(0);
  });

  it('rejects malformed JSON with 400, not a 500, with the dedicated "invalid JSON body" message, and reason "invalidJson"', async () => {
    // Round-2 review: same reason as the test above — a valid cookie, so
    // this actually reaches JSON.parse and proves THAT path returns 400
    // rather than a valid cookie being incidental to the assertion.
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postRaw('{ this is not valid json', sessionId));
    const body: { error: string; reason?: string } = await response.json();

    // Round-2 review (Test Lead, blocking): a bare 400 here is also what the
    // missing-cookie guard, the schema-validation branch and (with a small
    // enough body) nothing else in this file returns — asserting the exact
    // message this branch alone produces is what proves JSON.parse's own
    // catch fired, not some other 400 path this malformed-but-small body
    // happened to also satisfy. KAN-31: `reason` pins it further still — a
    // mutant that merged this catch into the generic `invalidSubmission`
    // branch (same status, same "invalid" flavour of message) would now be
    // caught even if it kept an "invalid JSON body"-shaped message.
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid JSON body');
    expect(body.reason).toBe('invalidJson');
  });

  it('does not create a guest session row as a side effect of a rejected submission', async () => {
    const sessionId = generateGuestSessionId(); // never persisted

    const response = await POST(postEssay({ content: '' }, sessionId));

    // Round-1 review (Test Lead, blocking): the title names a specific
    // path (empty content, rejected) — pinning the exact 400/"tooShort"
    // pair is what proves THIS rejection ran, not some other guard (e.g.
    // KAN-25's rate limit) that would also leave no row behind and pass
    // this assertion for the wrong reason.
    expect(response.status).toBe(400);
    const body: { reason?: string } = await response.json();
    expect(body.reason).toBe('tooShort');
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });
});

describe('POST /api/essays — the raw-body transport cap (KAN-14 scope note: a blunt cap, not the KAN-15 word-count rule, and NOT the same number as the character cap — see essay-submission.ts own comment)', () => {
  it('rejects a request body over the transport cap with 413, reason "bodyTooLarge", before ever touching the database', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran
    const oversizedContent = 'a'.repeat(MAX_REQUEST_BODY_BYTES + 1);

    const response = await POST(postEssay({ content: oversizedContent }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(413);
    // KAN-31: this is the streaming byte-count guard (readBodyWithinLimit),
    // not the Content-Length pre-check above it — no header is set here, so
    // Content-Length is absent and that earlier check never fires. Both
    // guards share the one `bodyTooLarge` reason (see rejection-reason.ts's
    // own comment on why), but this test's own job — proving the streaming
    // guard specifically fires, not merely restating the shared reason — is
    // still the 413 status plus the "never touched the database" assertion
    // below, exactly as before; `reason` here is additive, not a
    // replacement for that.
    expect(body.reason).toBe('bodyTooLarge');
    // KAN-25: measured directly against the deployed build — 30 requests
    // against this guard left 28 sockets in a wait state, against zero on
    // the no-cookie path (which never reads the body at all). Telling the
    // runtime to close the connection is the verified fix — see route.ts's
    // own comment at this exact branch for the full measurement and
    // reasoning. Round-1 review (note, not a fix): this assertion pins the
    // `Connection` HEADER on the returned response object — it does not
    // itself observe the socket actually closing. The socket behaviour was
    // what got measured directly against the deployed build (see the
    // comment above); this assertion is the regression guard for the
    // header that measurement was made against, not a re-run of the
    // measurement itself.
    expect(response.headers.get('connection')).toBe('close');
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });

  it('rejects a body over the transport cap even when its actual essay content is short — the guard protects against payload size, not essay length, which the character cap alone would not catch (round-1 review)', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran

    const response = await POST(
      postEssay({ content: 'A short essay.', junk: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }, sessionId),
    );
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(413);
    expect(body.reason).toBe('bodyTooLarge');
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });

  it('accepts content right at the character cap — the transport guard, sized well above it, never fires for a legitimately maximal submission', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    // KAN-15: a single giant token is one "word" by countGermanWords' own
    // rule, and would now also trip the unrelated <50-word block —
    // contentOfExactLength keeps this pinned at the exact character
    // boundary while landing word count safely inside the KAN-15 bounds.
    const content = contentOfExactLength(MAX_ESSAY_CONTENT_CHARS, 250);

    const response = await POST(postEssay({ content }, sessionId));

    expect(response.status).toBe(201);
  });

  it('accepts content comfortably under the character cap even though it is far over that same number in bytes — German is not a byte count (round-1 review: 11,000 umlauts used to 413 here, before the character cap and the transport cap were split into two different numbers)', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    // 11,000 UTF-16 code units — comfortably under the 20,000-character cap
    // — but 22,000 UTF-8 bytes, since an umlaut is 2 bytes. That byte count
    // used to exceed the single MAX_ESSAY_CONTENT_BYTES=20,000, read as
    // bytes by the old (pre-split) transport check, and 413 a submission
    // the character cap itself would happily accept. Split across 200 words
    // (see contentOfExactLength's own comment) so the KAN-15 word-count
    // check this test isn't about doesn't also reject it.
    const content = contentOfExactLength(11_000, 200, 'ü');

    const response = await POST(postEssay({ content }, sessionId));

    expect(response.status).toBe(201);
  });
});

describe('POST /api/essays — the Content-Length pre-check (round-2 review: nothing here ever set this header before, so this branch was dead — a mutant deleting the whole block, or lowering its threshold to 1,000, left every test in this file green)', () => {
  // Round-2 review sweep: this title's own claim ("this small, otherwise-
  // valid body would 201, not 413") used to be false — 'A short essay.' is
  // three words, under KAN-15's 50-word floor, so with this header check
  // removed the body would still 400 (too short), never 201, and the title
  // asserted an outcome this fixture couldn't actually produce.
  // `validLengthContent` clears the floor, so the claim in the title is now
  // literally what this test would observe if the guard it names were gone.
  it('rejects a request whose Content-Length header claims to exceed the transport cap, even though the actual body is small — proves the header check fires and rejects on its own, not merely restating what the byte-length check below it would catch anyway: without this check, this small, otherwise-valid body would 201, not 413', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran
    const response = await POST(
      postEssay(
        { content: validLengthContent('A short essay.') },
        sessionId,
        { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) },
      ),
    );
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(413);
    // KAN-31: same `bodyTooLarge` reason the streaming guard's own three
    // tests assert (see rejection-reason.ts's own comment on why one code,
    // not two) — this test's OWN uniquely-killing evidence that the header
    // pre-check specifically fired, rather than the streaming guard below
    // it, is still the small actual body plus the 413 (see this test's own
    // title): a mutant that deleted this block entirely would let a small
    // body sail past it and 201 downstream, which `reason` here cannot by
    // itself distinguish from the streaming guard catching the same body.
    expect(body.reason).toBe('bodyTooLarge');
    // KAN-25: same socket-retention fix as the streaming guard's own test —
    // see route.ts's own comment at this branch. Round-1 review (note, not
    // a fix): same caveat as that test's own — this pins the `Connection`
    // header on the response object, not the socket behaviour that was
    // actually measured against the deployed build.
    expect(response.headers.get('connection')).toBe('close');
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });

  it('accepts a realistic essay submission with an honest, correctly-sized Content-Length header', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    // 150-200 words, roughly the B2 recommended range — one to two
    // kilobytes, nowhere near either cap.
    const content = 'Ein typischer Aufsatz für die B2-Prüfung. '.repeat(40);
    const honestContentLength = String(Buffer.byteLength(JSON.stringify({ content }), 'utf8'));

    const response = await POST(postEssay({ content }, sessionId, { 'content-length': honestContentLength }));

    expect(response.status).toBe(201);
    // KAN-25: the socket-retention fix is scoped to the two `bodyTooLarge`
    // branches specifically, not blanket-applied to every response — a
    // successful submission's connection is left alone, free to be reused
    // for keep-alive the way every other 2xx response on this route already
    // is.
    expect(response.headers.get('connection')).toBeNull();
  });
});

describe('POST /api/essays — the raw-body transport cap under chunked transfer, no Content-Length at all (round-2 review)', () => {
  it('rejects a body that exceeds the transport cap when streamed with no Content-Length header — the shape a real chunked-transfer request takes, not merely a lying header — and never reads past the limit plus one chunk, so it never buffers the whole thing', async () => {
    const chunkBytes = 10_000;
    const chunk = new TextEncoder().encode('a'.repeat(chunkBytes));
    let pulls = 0;
    let cancelled = false;
    // An effectively unbounded source: if readBodyWithinLimit ever fell
    // back to draining the whole stream (the request.text() shape this
    // guard replaced), this would never terminate rather than merely being
    // slow — a stronger failure signal than a byte-count assertion alone.
    //
    // KAN-25: `highWaterMark: 0` added — this test used to rely on the
    // platform default (1), which eagerly pre-fetches one chunk into the
    // stream's internal queue as soon as the stream is constructed,
    // independently of when anything actually starts reading it (see the
    // "never pulls a single chunk" test above, which already documents this
    // for the zero-pulls case and sets hwm 0 for exactly this reason). That
    // pre-fetch's own timing depends on how many microtask turns run before
    // the first `reader.read()` call — invisible while nothing meaningful
    // happened between constructing the request and reading its body, but
    // this story's own rate-limit check (two awaited Postgres round trips)
    // now runs in between, ahead of `readBodyWithinLimit`, and gave that
    // pre-fetch enough room to fire once more than before: `pulls` went from
    // a reliable 13 to a reliable 14, deterministically, not a flake — this
    // test's own synthetic source racing the stream's default backpressure
    // behaviour, not anything wrong with the guard being counted. Pinning
    // hwm 0 removes the pre-fetch entirely, the same fix already applied
    // above, so this count is driven only by the deliberate read loop below
    // and stays exactly the boundary-derived number regardless of how much
    // (or how little) async work a future guard adds ahead of it.
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran
    const request = new NextRequest(new URL('http://localhost:3000/api/essays'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: stream,
      duplex: 'half',
      // `duplex` is required by the underlying fetch implementation for a
      // streamed body but isn't in Next's own narrower NextRequestInit type.
    } as ConstructorParameters<typeof NextRequest>[1]);
    // NextRequest never sets one for a stream body on its own (confirmed
    // directly against this runtime), but delete it explicitly so the
    // absence this test exists to cover can never depend on that.
    request.headers.delete('content-length');

    const response = await POST(request);
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(413);
    expect(body.reason).toBe('bodyTooLarge'); // KAN-31: same reason as the header pre-check and the other two streaming-guard tests — see rejection-reason.ts's own comment on why.
    // Cancelling the reader stops us pulling more bytes off a request we've
    // already decided to reject. It is NOT what returns the underlying
    // socket to Cloud Run's pool — measured directly against the deployed
    // build with an identical client, 30 requests each way: cancelling here
    // left 28 of 30 sockets sitting in a wait state, where the no-cookie
    // path above (which never reads the body at all) left zero. See KAN-25
    // for those measurements and the actual, verified fix for that
    // retention — this assertion only pins that we stop pulling, not that
    // the connection is freed.
    expect(cancelled).toBe(true);
    // Exact pull count, derived from the limit and the chunk size: correct
    // code stops the instant the running total first exceeds
    // MAX_REQUEST_BODY_BYTES (128,000 / 10,000 = 12.8, so the 13th pull is
    // the one that crosses it) and bounds resident memory at the limit plus
    // ONE chunk, not one more. A mutant that compares the running total
    // BEFORE adding the new chunk, rather than after, crosses the threshold
    // one pull late and lands on 14 — the old `toBeLessThanOrEqual(...+ 1)`
    // bound let that mutant through; only other tests in the suite caught it.
    expect(pulls).toBe(Math.floor(MAX_REQUEST_BODY_BYTES / chunkBytes) + 1);
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });
});

describe('POST /api/essays — no body stream at all', () => {
  // readBodyWithinLimit's own early-return branch (`request.body?.getReader()`
  // undefined) exists purely to preserve the behaviour `request.text()` had
  // for this shape — an empty string, not a rejection. Nothing here proved
  // that: a mutant turning that branch into `{ ok: false }` (the same
  // shape the over-the-cap case returns) left the whole suite green, because
  // every other test in this file sends a real body. This is the one
  // request shape that reaches readBodyWithinLimit with `request.body`
  // itself null — no reader to get — so it's the only test that can tell
  // the early return apart from the rejection case.
  it('returns 400 for a request with no body at all — the same outcome request.text() gave an empty body, not the 413 a rejection would produce', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const request = new NextRequest(new URL('http://localhost:3000/api/essays'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${sessionId}`,
      },
      // no `body` at all — `request.body` is `null`, unlike an empty string
      // body, which would still produce a stream.
    });

    const response = await POST(request);
    const body: { error: string; reason?: string } = await response.json();

    // Empty text fails JSON.parse the same way a truly empty string body
    // would ('' is not valid JSON), so this lands on the "invalid JSON
    // body" 400 — the same status request.text() would have produced for
    // this exact shape. Asserting the exact message (round-2 review,
    // Test Lead, blocking) is what proves it's THIS branch, not merely any
    // 400 — a mutant that made the no-reader early return `{ ok: false }`
    // (readBodyWithinLimit's own comment names this exact mutant) would
    // still 400 here, for the transport-cap message instead. KAN-31: the
    // reason assertion closes the same gap one layer more precisely — that
    // mutant's 400 would carry `bodyTooLarge`, not `invalidJson`.
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid JSON body');
    expect(body.reason).toBe('invalidJson');
  });
});

describe('POST /api/essays — cross-origin requests', () => {
  // One integration-level test here (round-1 review): the guard's own
  // edge cases — malformed Origin, absent Host/forwarded-host, and
  // forwarded-host precedence — are unit-tested directly against
  // `isCrossOriginRequest` in `lib/same-origin.test.ts`, so this file only
  // needs to prove the guard is actually wired into THIS route, ahead of
  // session resolution.
  //
  // Round-2 review (Test Lead, blocking): this fixture used to be a
  // four-word body ('Should never be stored.') — under the KAN-15 50-word
  // floor on top of being cross-origin. Disabling the cross-origin guard
  // entirely (`isCrossOriginRequest` always returning `false`) left this
  // test, and all 257 others, green: the schema's own word-count check
  // ALSO rejects a four-word body, and runs before session resolution
  // either way, so the "left uncreated" assertion below held for the wrong
  // reason. `validLengthContent` clears the floor, so a 400 here can only
  // be the cross-origin guard — and asserting the exact message (round-2
  // review) is what tells that guard's 400 apart from the word-count one,
  // now that the fixture alone no longer does.
  it('rejects a mismatched Origin header with 400 before ever reaching session resolution — a cookie naming no existing session is left uncreated, an existing one untouched', async () => {
    // A fresh, never-persisted id: if the origin check actually
    // short-circuits before resolveGuestSession runs, nothing creates this
    // row. If the guard were ever bypassed, resolveGuestSession's ordinary
    // first-use path would create it under this exact id, same as the
    // "bootstrap never landed" test above — making this a real,
    // failing-capable check, not just a restatement of the status code.
    const neverPersistedSessionId = generateGuestSessionId();

    const response = await POST(
      postEssay(
        { content: validLengthContent('Should never be stored.') },
        neverPersistedSessionId,
        { origin: 'https://evil.example' },
      ),
    );
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('cross-origin request rejected');
    // KAN-31: `reason` is what tells this guard's 400 apart from the
    // cookie guard's — both 400, and (round-2 review, above) this test's
    // own fixture is deliberately valid on every OTHER axis specifically so
    // a mutant disabling only the cross-origin check is caught here, not
    // coincidentally by some other rejection.
    expect(body.reason).toBe('crossOrigin');
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: neverPersistedSessionId }, neverPersistedSessionId);
    expect(persisted).toBeNull();
  });

  // Round-2 review: this suite had no test carrying a MATCHING Origin at
  // all — every other test here either omits Origin entirely or sends the
  // reject-direction mismatch above, so a mutant that made this route
  // reject anything bearing an Origin header at all left every unit test in
  // this file green; only a browser test caught it. And separately, this
  // route's own request in production is bound to the `output: standalone`
  // container address (`https://0.0.0.0:8080`, see route.ts's own comment
  // and lib/same-origin.ts's), not the public hostname the browser's Origin
  // and the load balancer's forwarded Host both carry — reproduced directly
  // here (see lib/same-origin.test.ts's equivalent unit test for the same
  // shape against isCrossOriginRequest itself). If someone reintroduced the
  // inline `request.nextUrl.origin` comparison this route's own comment
  // documents as the actual production outage, this would fail: nextUrl's
  // host in that shape is always 0.0.0.0:8080, which never equals the
  // public hostname below.
  it('accepts a same-origin submission even when the request is bound to the container address rather than the deployed public hostname — the real output:standalone/Cloud Run shape (round-2 review)', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(
      postEssay(
        { content: validLengthContent('Submitted against the real deployed request shape.') },
        sessionId,
        { origin: 'https://fluentina.com', 'x-forwarded-host': 'fluentina.com' },
        'https://0.0.0.0:8080/api/essays',
      ),
    );

    expect(response.status).toBe(201);
  });
});

describe('POST /api/essays — the session comes from the cookie, never the body', () => {
  // Blocking, round-1 review: a mutant that added an optional `sessionId`
  // (and `userId`) to `essaySubmissionRequestSchema` and preferred it over
  // the cookie passed the entire suite — 162 tests green — because nothing
  // here proved the request body couldn't name the actor. Resolution
  // accepts any well-formed id naming an existing, unconverted session, so
  // that mutant lets any caller attribute an essay to any session it names:
  // the write lands in the victim's session, nothing is reissued, and the
  // essay becomes readable by the victim and invisible to whoever actually
  // wrote it.
  it('stores the essay under the cookie session even when the body also carries a sessionId/userId naming a different, existing session — and that other session cannot read it back', async () => {
    const cookieSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: cookieSessionId });
    const otherSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: otherSessionId });

    const response = await POST(
      postEssay(
        {
          content: validLengthContent('Must be attributed to whoever the cookie says, never whoever the body claims.'),
          sessionId: otherSessionId,
          userId: 'attacker-chosen-user-id',
        },
        cookieSessionId,
      ),
    );
    const body: { id: string } = await response.json();

    expect(response.status).toBe(201);

    const storedUnderCookieSession = await getEssayById({ kind: 'guest', sessionId: cookieSessionId }, body.id);
    expect(storedUnderCookieSession?.id).toBe(body.id);
    expect(storedUnderCookieSession?.sessionId).toBe(cookieSessionId);

    const storedUnderNamedSession = await getEssayById({ kind: 'guest', sessionId: otherSessionId }, body.id);
    expect(storedUnderNamedSession).toBeNull();
  });
});

// Round-1 review: the whole "browser can't forge x-forwarded-host without
// triggering an unanswered CORS preflight" argument this route's guard
// relies on (see route.ts's own comment, and lib/same-origin.ts's) rests on
// this route exporting no OPTIONS handler, the same as
// `/api/guest-session` — see that route's own equivalent test. Assert it
// directly here too, rather than trust it stays true by omission.
describe('POST /api/essays — preflight surface', () => {
  it('exports no OPTIONS handler — the forged-header path stays closed only as long as this is true', async () => {
    const routeModule: Record<string, unknown> = await import('./route');

    expect(routeModule.OPTIONS).toBeUndefined();
  });
});

/**
 * KAN-25 — the acceptance criterion verbatim: five submissions per guest
 * session per hour. `ESSAY_SUBMISSION_SESSION_LIMIT` (lib/domain/rate-limit.ts)
 * is the fixed number the ticket names, not an engineering call this test
 * re-derives; it's read from that constant rather than hardcoded as `5` so a
 * change to the constant (which this story's own PR description says is not
 * this story's call to make) can't silently desync this test from the code
 * it's supposed to be pinning.
 *
 * The trap the ticket itself names, addressed directly: every test below
 * that proves a request is refused asserts the successes that precede it
 * too — not just the final refusal — so a guard that (say) rejected the
 * FIRST request for an unrelated reason couldn't still make the "sixth is
 * refused" assertion pass for the wrong reason.
 *
 * Round-2 review (Test Lead, noted rather than fixed): every KAN-25
 * rate-limit test in this file (this describe block and the two below it)
 * calls `POST` directly, which calls `checkEssaySubmissionRateLimit` with no
 * explicit `now` — the route itself never passes one (see route.ts), so
 * these run against REAL wall-clock time, unlike
 * `lib/domain/rate-limit.test.ts`'s own suite, which threads a
 * fixed `now` through every call specifically to avoid this. The Test Lead
 * measured roughly a 1-in-1000 run landing on an hour boundary mid-test,
 * which would fail a test here for a time-of-day reason while claiming the
 * limiter itself is broken. Threading a clock through the route handlers
 * to fix this properly may not be worth the surface area it adds to
 * production code for a 1-in-1000 flake; left as a known, named risk rather
 * than "fixed" — a rate-limit test failing for a reason unrelated to rate
 * limiting is exactly the kind that gets retried into invisibility instead
 * of investigated, so if this file flakes, check the clock before the code.
 */
describe('POST /api/essays — KAN-25: the per-session rate limit (5/hour, fixed by the ticket)', () => {
  it('allows exactly the limit\'s worth of submissions for one session — each one actually succeeds, not just "some request happened"', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const response = await POST(postEssay({ content: validLengthContent(`Submission number ${i}.`) }, sessionId));
      expect(response.status).toBe(201);
    }
    expect(await countEssaysForSession(sessionId)).toBe(ESSAY_SUBMISSION_SESSION_LIMIT);
  });

  it('rejects the submission one past the limit with 429, reason "rateLimited", and clear (non-generic) English text — and creates no essay for it', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const response = await POST(postEssay({ content: validLengthContent(`Submission number ${i}.`) }, sessionId));
      expect(response.status).toBe(201); // see this describe block's own top comment
    }

    const response = await POST(postEssay({ content: validLengthContent('One too many.') }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
    // "Clear, non-cryptic" (the AC's own wording) — proven at the schema
    // level rather than pinning exact prose: the message names the actual
    // problem (too many submissions), not a generic "something went wrong".
    expect(body.error.toLowerCase()).toMatch(/too many|rate|limit/);
    expect(await countEssaysForSession(sessionId)).toBe(ESSAY_SUBMISSION_SESSION_LIMIT);
  });

  it('does not let one session\'s exhausted cap affect a completely different session', async () => {
    const exhaustedSession = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: exhaustedSession });
    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const response = await POST(postEssay({ content: validLengthContent(`Submission number ${i}.`) }, exhaustedSession));
      expect(response.status).toBe(201);
    }
    // The exhausted session really is exhausted now — establishes the
    // rejection this test's own point rests on actually fired.
    const exhaustedResponse = await POST(postEssay({ content: validLengthContent('Should be refused.') }, exhaustedSession));
    expect(exhaustedResponse.status).toBe(429);

    const freshSession = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: freshSession });
    const freshResponse = await POST(postEssay({ content: validLengthContent('A different guest entirely.') }, freshSession));

    expect(freshResponse.status).toBe(201);
  });
});

/**
 * KAN-25 — the per-IP backstop, and the specific bypass the ticket names:
 * "must not be trivially bypassable by clearing the session cookie." A
 * caller that clears its cookie between every five submissions gets a
 * brand-new session id (and therefore a fresh session-scoped budget) for
 * free — see `lib/domain/rate-limit.ts`'s own comment on why that cap alone
 * is not enough. These tests prove the IP-scoped counter is what actually
 * closes that: it stays keyed on the one thing clearing a cookie doesn't
 * change.
 */
describe('POST /api/essays — KAN-25: the per-IP backstop is not bypassable by clearing the session cookie', () => {
  it('blocks a request from a BRAND-NEW session — one that has never submitted before, nowhere near its own cap — once that IP has exhausted its backstop', async () => {
    const sharedIp = '198.51.100.42';
    const sessionsNeeded = Math.ceil(ESSAY_SUBMISSION_IP_LIMIT / ESSAY_SUBMISSION_SESSION_LIMIT);

    let submitted = 0;
    for (let s = 0; s < sessionsNeeded && submitted < ESSAY_SUBMISSION_IP_LIMIT; s++) {
      const sessionId = generateGuestSessionId();
      await createGuestSession({ kind: 'guest', sessionId });
      for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT && submitted < ESSAY_SUBMISSION_IP_LIMIT; i++) {
        const response = await POST(
          postEssay({ content: validLengthContent(`IP-backstop fixture ${s}-${i}.`) }, sessionId, xff(sharedIp)),
        );
        // Every one of these must genuinely succeed — the trap this
        // describe block's own top comment names: reaching
        // ESSAY_SUBMISSION_IP_LIMIT total submissions only proves what this
        // test claims if none of them failed on the way there.
        expect(response.status).toBe(201);
        submitted++;
      }
    }
    expect(submitted).toBe(ESSAY_SUBMISSION_IP_LIMIT);

    const brandNewSession = generateGuestSessionId(); // never submitted before — its OWN session cap is nowhere near exhausted
    await createGuestSession({ kind: 'guest', sessionId: brandNewSession });

    const response = await POST(
      postEssay({ content: validLengthContent('Should be refused by the IP backstop alone.') }, brandNewSession, xff(sharedIp)),
    );
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
  });

  it('does not let one IP\'s exhausted backstop affect a request from a different IP', async () => {
    const exhaustedIp = '198.51.100.43';
    for (let i = 0; i < ESSAY_SUBMISSION_IP_LIMIT; i++) {
      const sessionId = generateGuestSessionId();
      await createGuestSession({ kind: 'guest', sessionId });
      const response = await POST(
        postEssay({ content: validLengthContent(`IP-backstop fixture ${i}.`) }, sessionId, xff(exhaustedIp)),
      );
      expect(response.status).toBe(201);
    }

    const stillOnExhaustedIp = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: stillOnExhaustedIp });
    const exhaustedResponse = await POST(
      postEssay({ content: validLengthContent('Refused.') }, stillOnExhaustedIp, xff(exhaustedIp)),
    );
    expect(exhaustedResponse.status).toBe(429); // establishes the IP really is exhausted

    const differentIpSession = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: differentIpSession });
    const differentIpResponse = await POST(
      postEssay({ content: validLengthContent('A different network entirely.') }, differentIpSession, xff('198.51.100.44')),
    );

    expect(differentIpResponse.status).toBe(201);
  });
});

/**
 * KAN-25 — "before the body is read" is not just a comment; a rate-limited
 * caller must never cost this route the up-to-128KB buffer
 * `readBodyWithinLimit` allocates. Same proof technique the cookie guard's
 * own "never pulls a single chunk" test (above) already established: a
 * stream that would pull forever if anything ever tried to read it.
 */
describe('POST /api/essays — KAN-25: the rate limit runs before the body is read', () => {
  it('never pulls a single chunk off the body stream once the session cap is already exhausted — rejected on the counters alone, before the body is touched', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const response = await POST(postEssay({ content: validLengthContent(`Submission number ${i}.`) }, sessionId));
      expect(response.status).toBe(201); // see the per-session describe block's own top comment
    }

    let pulls = 0;
    const chunk = new TextEncoder().encode('a'.repeat(10_000));
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(chunk);
        },
      },
      { highWaterMark: 0 }, // see the chunked-transfer describe block's own KAN-25 comment for why this matters here
    );
    const request = new NextRequest(new URL('http://localhost:3000/api/essays'), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        cookie: `${GUEST_SESSION_COOKIE_NAME}=${sessionId}`,
      },
      body: stream,
      duplex: 'half',
    } as ConstructorParameters<typeof NextRequest>[1]);

    const response = await POST(request);
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
    expect(pulls).toBe(0);
  });
});

/**
 * KAN-15 (BR-1.4 through BR-1.7) — the word-count bounds, enforced
 * server-side. Every test in this file already calls `POST()` directly with
 * a hand-built `NextRequest` — no `EssayEntryForm`, no browser, nothing
 * client-side runs at all — so this describe block is exactly the
 * "independently revalidated and blocked server-side... a request that
 * bypasses the browser entirely" proof the story asks for, not a special
 * case: a request built this way could never have gone through the
 * client-side check in EssayEntryForm.test.tsx, and the server rejects it
 * anyway. Boundaries only (49/50, 300/301), plus the story's own two named
 * verification cases (220 never blocked, 1000 blocked) — the full 49-301
 * boundary matrix is already pinned once, at the schema level
 * (essay-submission.test.ts), and repeating all eight points here would
 * test zod's own dispatch, not this route.
 */
describe('POST /api/essays — the KAN-15 word-count bounds, enforced independently of the client', () => {

  it('rejects 49 words with 400, a "too short" message, and creates no essay', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: wordsContent(MIN_ESSAY_WORDS - 1) }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.toLowerCase()).toContain('short');
    // Round-1 review (should-fix #3): `reason` travels alongside `message`
    // in the HTTP body now, not just internally on the zod issue — this is
    // what EssayEntryForm's postEssay reads to map onto its own translated
    // string, rather than discarding the body and rendering the generic
    // fallback regardless of why (see EssayEntryForm.tsx's own comment).
    expect(body.reason).toBe('tooShort');
    expect(await countEssaysForSession(sessionId)).toBe(0);
  });

  it('accepts exactly 50 words — the minimum itself is not blocked', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: wordsContent(MIN_ESSAY_WORDS) }, sessionId));

    expect(response.status).toBe(201);
  });

  it('accepts exactly 300 words — the hard ceiling itself is not blocked', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: wordsContent(MAX_ESSAY_WORDS) }, sessionId));

    expect(response.status).toBe(201);
  });

  it('rejects 301 words with 400 and a "too long"/"maximum" message, distinct from the too-short message above', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: wordsContent(MAX_ESSAY_WORDS + 1) }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.toLowerCase()).toMatch(/maximum|too long|exceeds/);
    expect(body.error.toLowerCase()).not.toContain('short');
    expect(body.reason).toBe('tooLong');
  });

  it('a 220-word essay — the story\'s own "never blocked" verification case — is accepted end to end and persisted with its full content, bypassing any client entirely', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const content = wordsContent(220);

    const response = await POST(postEssay({ content }, sessionId));
    const body: { id: string } = await response.json();

    expect(response.status).toBe(201);
    const persisted = await getEssayById({ kind: 'guest', sessionId }, body.id);
    expect(persisted?.content).toBe(content);
  });

  it('a 1000-word essay — the story\'s own "blocked" verification case — is rejected with 400 and creates no essay, even though it is comfortably under both the character cap and the transport cap', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const content = wordsContent(1000);
    expect(content.length).toBeLessThan(MAX_ESSAY_CONTENT_CHARS);

    const response = await POST(postEssay({ content }, sessionId));
    const body: { error: string; reason?: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.reason).toBe('tooLong');
    expect(await countEssaysForSession(sessionId)).toBe(0);
  });

  it('creates no guest session row as a side effect of a length-rejected submission, the same guarantee already proven for an empty one', async () => {
    const sessionId = generateGuestSessionId(); // never persisted

    const response = await POST(postEssay({ content: wordsContent(1000) }, sessionId));

    // Round-1 review (Test Lead, blocking): same reasoning as the empty-
    // content version of this test above — 400/"tooLong" proves THIS
    // rejection ran, not some other guard (KAN-25's rate limit included)
    // that would also leave no row behind.
    expect(response.status).toBe(400);
    const body: { reason?: string } = await response.json();
    expect(body.reason).toBe('tooLong');
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });

  it('never writes the rejected essay text to the console, the same "never log essay text" guarantee proven for a successful submission', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secretToken = 'EinBesonderesWortDasNieGeloggtWerdenDarf';
    const content = `${secretToken} ${wordsContent(999)}`;

    try {
      const response = await POST(postEssay({ content }, sessionId));

      // Round-1 review (Test Lead, blocking): 400/"tooLong" proves the
      // length rejection this test's own title names actually ran, rather
      // than passing for the wrong reason against some other refusal
      // (KAN-25's rate limit included) that also never reaches the log
      // statement this test is checking for.
      expect(response.status).toBe(400);
      const body: { reason?: string } = await response.json();
      expect(body.reason).toBe('tooLong');
      for (const spy of [logSpy, errorSpy, warnSpy]) {
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(secretToken);
        }
      }
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  // Round-1 review (should-fix #10): the length rejection's `error` (and,
  // as of this same review, `reason`) travel straight into the HTTP
  // response body — today `essaySubmissionRequestSchema`'s message is a
  // static string with no submitted content in it, but nothing pins that
  // invariant, so a later change that interpolated the essay itself into
  // the message (e.g. "too long by N words, starting: <content>") would
  // ship silently. Matches the console-output test above: the same secret
  // must never appear anywhere in the rejection body either, and the
  // session id — the one other value this route must never leak into a
  // response body a caller controls (see the "never leaks the session id"
  // success-path test) — is checked here too.
  it('the length-rejection response body contains neither the submitted content nor the session id', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const secretToken = 'EinAndererGeheimerTokenFuerDenAntwortkoerper';
    const content = `${secretToken} ${wordsContent(999)}`;

    const response = await POST(postEssay({ content }, sessionId));
    const rawBody = JSON.stringify(await response.json());

    expect(response.status).toBe(400);
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(sessionId);
  });
});

/**
 * KAN-31 — "do not let a reason leak anything": every rejection above
 * already proves its own status/message/reason; this block is specifically
 * the "never logs essay text or a session id" property, extended to the
 * FIVE guard-level rejections `reason` newly names (cross-origin, an
 * invalid session cookie, an oversized body, malformed JSON, and the
 * schema's own generic failure) — the same property the length-rejection
 * test just above this block already pins for the two length reasons, and
 * the well-formed-cookie describe block at the top of this file pins for a
 * successful submission. `reason` itself is a fixed string drawn from
 * `REJECTION_REASONS` (lib/contracts/rejection-reason.ts), never built from
 * request content, so there is no code path today that COULD leak through
 * it — these tests exist so a later change that started interpolating
 * anything request-specific into a rejection body fails immediately, the
 * same guarantee the length-rejection test above already gives that
 * failure mode for the two reasons it covers.
 */
describe('POST /api/essays — KAN-31: guard-level rejections never leak essay content or a session id', () => {
  it('a cross-origin rejection leaks neither the submitted content nor the session id the (rejected) cookie carried', async () => {
    const sessionId = generateGuestSessionId();
    const secretToken = 'EinDritterToken_NieInEinerCrossOriginAntwort';

    const response = await POST(
      postEssay({ content: `${secretToken} ${wordsContent(60)}` }, sessionId, { origin: 'https://evil.example' }),
    );
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(400);
    // Round-1 review: a status-and-absence assertion alone survives a later
    // guard (e.g. a rate limiter) returning the same 400 ahead of THIS one —
    // the test would keep passing without ever exercising the cross-origin
    // branch its own title names. Asserting the specific reason is what
    // still fails once this guard stops being the one that actually fired.
    expect(body.reason).toBe('crossOrigin');
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(sessionId);
  });

  it('an invalid-session-cookie rejection leaks neither the submitted content nor the forged cookie value itself', async () => {
    const forged = 'attacker-supplied-value-that-must-not-echo';
    const secretToken = 'EinVierterToken_NieBeiEinemUngueltigenCookie';

    const response = await POST(postEssay({ content: `${secretToken} ${wordsContent(60)}` }, forged));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(400);
    // See the cross-origin test's own comment above — the reason is what
    // proves this branch, specifically, is what fired.
    expect(body.reason).toBe('invalidSessionCookie');
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(forged);
  });

  it('an over-the-transport-cap rejection leaks neither the session id nor any prefix of the oversized content', async () => {
    const sessionId = generateGuestSessionId();
    const secretToken = 'EinFuenfterToken_NieBeiEinerZuGrossenAnfrage';
    const oversizedContent = `${secretToken} ${'a'.repeat(MAX_REQUEST_BODY_BYTES)}`;

    const response = await POST(postEssay({ content: oversizedContent }, sessionId));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(413);
    expect(body.reason).toBe('bodyTooLarge');
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(sessionId);
  });

  it('an invalid-JSON rejection leaks neither the session id nor any fragment of the malformed body', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const secretToken = 'EinSechsterToken_NieBeiUngueltigemJson';

    const response = await POST(postRaw(`{ "content": "${secretToken}" this is not valid json`, sessionId));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(400);
    // See the cross-origin test's own comment above — the reason is what
    // proves this branch, specifically, is what fired.
    expect(body.reason).toBe('invalidJson');
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(sessionId);
  });

  it('a generic invalid-submission rejection leaks neither the session id nor any field value the body carried', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const secretToken = 'EinSiebterToken_NieBeiEinerFehlendenContentEigenschaft';

    const response = await POST(postEssay({ content: 123, note: secretToken }, sessionId));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(400);
    // See the cross-origin test's own comment above — the reason is what
    // proves this branch, specifically, is what fired.
    expect(body.reason).toBe('invalidSubmission');
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(sessionId);
  });

  // KAN-25: the same guarantee, extended to the new rate-limit rejection —
  // this guard runs earliest of all (right after the cookie guard, ahead of
  // the body ever being read), so it has the least excuse of any of them to
  // ever echo anything request-specific.
  it('a rate-limited rejection leaks neither the session id nor the submitted content', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const secretToken = 'EinAchterToken_NieBeiEinerRateLimitAntwort';
    for (let i = 0; i < ESSAY_SUBMISSION_SESSION_LIMIT; i++) {
      const setupResponse = await POST(postEssay({ content: validLengthContent(`Setup ${i}.`) }, sessionId));
      expect(setupResponse.status).toBe(201); // establishes the cap is genuinely exhausted below
    }

    const response = await POST(postEssay({ content: `${secretToken} ${wordsContent(60)}` }, sessionId));
    const body = await response.json();
    const rawBody = JSON.stringify(body);

    expect(response.status).toBe(429);
    expect(body.reason).toBe('rateLimited');
    expect(rawBody).not.toContain(secretToken);
    expect(rawBody).not.toContain(sessionId);
  });
});
