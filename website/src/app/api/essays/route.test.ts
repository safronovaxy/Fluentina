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
      await POST(postEssay({ content: secretPhrase }, sessionId));

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
  it('rejects a request with no cookie at all — 400, no session resolved, no essay stored', async () => {
    const response = await POST(
      postEssay({ content: validLengthContent('Submitted with no guest session cookie present.') }),
    );
    const body: { error: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing or invalid guest session cookie');
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('rejects a malformed or forged cookie the same way — 400, and the forged value never becomes a row or an essay', async () => {
    const forged = 'attacker-supplied-value';

    const response = await POST(
      postEssay({ content: validLengthContent('Submitted with a malformed guest session cookie.') }, forged),
    );
    const body: { error: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('missing or invalid guest session cookie');
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

  it('rejects a body with no content field at all, with the generic message — never a length-specific reason for a field that was never a string to count words in', async () => {
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
    // that message (and the absence of `reason`) is what proves this 400
    // came from the missing field, not a coincidental length rejection.
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid essay submission');
    expect(body.reason).toBeUndefined();
    expect(await countEssaysForSession(sessionId)).toBe(0);
  });

  it('rejects malformed JSON with 400, not a 500, and with the dedicated "invalid JSON body" message', async () => {
    // Round-2 review: same reason as the test above — a valid cookie, so
    // this actually reaches JSON.parse and proves THAT path returns 400
    // rather than a valid cookie being incidental to the assertion.
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postRaw('{ this is not valid json', sessionId));
    const body: { error: string } = await response.json();

    // Round-2 review (Test Lead, blocking): a bare 400 here is also what the
    // missing-cookie guard, the schema-validation branch and (with a small
    // enough body) nothing else in this file returns — asserting the exact
    // message this branch alone produces is what proves JSON.parse's own
    // catch fired, not some other 400 path this malformed-but-small body
    // happened to also satisfy.
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid JSON body');
  });

  it('does not create a guest session row as a side effect of a rejected submission', async () => {
    const sessionId = generateGuestSessionId(); // never persisted

    await POST(postEssay({ content: '' }, sessionId));

    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });
});

describe('POST /api/essays — the raw-body transport cap (KAN-14 scope note: a blunt cap, not the KAN-15 word-count rule, and NOT the same number as the character cap — see essay-submission.ts own comment)', () => {
  it('rejects a request body over the transport cap with 413, before ever touching the database', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran
    const oversizedContent = 'a'.repeat(MAX_REQUEST_BODY_BYTES + 1);

    const response = await POST(postEssay({ content: oversizedContent }, sessionId));

    expect(response.status).toBe(413);
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });

  it('rejects a body over the transport cap even when its actual essay content is short — the guard protects against payload size, not essay length, which the character cap alone would not catch (round-1 review)', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran

    const response = await POST(
      postEssay({ content: 'A short essay.', junk: 'x'.repeat(MAX_REQUEST_BODY_BYTES) }, sessionId),
    );

    expect(response.status).toBe(413);
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

    expect(response.status).toBe(413);
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
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
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

    expect(response.status).toBe(413);
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
    const body: { error: string } = await response.json();

    // Empty text fails JSON.parse the same way a truly empty string body
    // would ('' is not valid JSON), so this lands on the "invalid JSON
    // body" 400 — the same status request.text() would have produced for
    // this exact shape. Asserting the exact message (round-2 review,
    // Test Lead, blocking) is what proves it's THIS branch, not merely any
    // 400 — a mutant that made the no-reader early return `{ ok: false }`
    // (readBodyWithinLimit's own comment names this exact mutant) would
    // still 400 here, for the transport-cap message instead.
    expect(response.status).toBe(400);
    expect(body.error).toBe('invalid JSON body');
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
    const body: { error: string } = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('cross-origin request rejected');
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

    await POST(postEssay({ content: wordsContent(1000) }, sessionId));

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
      await POST(postEssay({ content }, sessionId));

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
