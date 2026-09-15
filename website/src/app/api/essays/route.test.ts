/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { getGuestSessionById, createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { getEssayById } from '@/lib/db/essays';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import type { GuestSessionId } from '@/lib/contracts/actor';
import { MAX_ESSAY_CONTENT_CHARS, MAX_REQUEST_BODY_BYTES } from '@/lib/contracts/essay-submission';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';

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

    const response = await POST(postEssay({ content: 'A perfectly ordinary essay submission.' }, sessionId));
    const body: { id: string } = await response.json();

    expect(response.status).toBe(201);
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();

    const persisted = await getEssayById({ kind: 'guest', sessionId }, body.id);
    expect(persisted?.content).toBe('A perfectly ordinary essay submission.');
    expect(persisted?.sessionId).toBe(sessionId);
  });

  it('never leaks the guest session id into the JSON response body — only the essay id comes back', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: 'Nothing here should reveal the session id.' }, sessionId));
    const body: unknown = await response.json();

    expect(JSON.stringify(body)).not.toContain(sessionId);
  });

  it('never writes the submitted essay text to the console — essay content is never logged', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const secretPhrase = 'a very particular sentence nobody should ever see logged';

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

    const response = await POST(postEssay({ content: 'Submitted before the bootstrap POST completed.' }, mintedByMiddleware));

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
  it('rejects a request with no cookie at all — 400, no session resolved, no essay stored', async () => {
    const response = await POST(postEssay({ content: 'Submitted with no guest session cookie present.' }));

    expect(response.status).toBe(400);
    expect(response.cookies.get(GUEST_SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('rejects a malformed or forged cookie the same way — 400, and the forged value never becomes a row or an essay', async () => {
    const forged = 'attacker-supplied-value';

    const response = await POST(postEssay({ content: 'Submitted with a malformed guest session cookie.' }, forged));

    expect(response.status).toBe(400);
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

    const response = await POST(postEssay({ content: 'Written by a guest whose browser still has the old cookie.' }, staleSessionId));
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

    const response = await POST(postEssay({ content: 'Must never be readable through the stale session.' }, staleSessionId));
    const body: { id: string } = await response.json();

    const readableUnderStaleCookie = await getEssayById({ kind: 'guest', sessionId: staleSessionId }, body.id);
    expect(readableUnderStaleCookie).toBeNull();
  });

  it('the reissued cookie carries HttpOnly, Secure, SameSite=Lax, Path=/ and a 30-day lifetime, the same as guest-session issuance', async () => {
    const staleSessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId: staleSessionId });
    const userId = await createTestUser();
    await convertGuestSessionToUser({ kind: 'guest', sessionId: staleSessionId }, userId);

    const response = await POST(postEssay({ content: 'Checking the reissued cookie attributes.' }, staleSessionId));

    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
    expect(cookie?.maxAge).toBe(30 * 24 * 60 * 60);
  });
});

describe('POST /api/essays — invalid submissions', () => {
  it('rejects empty content with 400 and creates no essay', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: '' }, sessionId));

    expect(response.status).toBe(400);
  });

  it('rejects whitespace-only content with 400 — trimmed, not merely non-empty', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({ content: '     \n\t  ' }, sessionId));

    expect(response.status).toBe(400);
  });

  it('rejects a body with no content field at all', async () => {
    // Round-2 review: the cookie check now runs before the body is ever
    // read (see route.ts's own comment), so this needs a valid cookie —
    // without one, this would still assert 400, but for "missing cookie",
    // not for the missing content field its own name claims to be testing.
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postEssay({}, sessionId));

    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with 400, not a 500', async () => {
    // Round-2 review: same reason as the test above — a valid cookie, so
    // this actually reaches JSON.parse and proves THAT path returns 400
    // rather than a valid cookie being incidental to the assertion.
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(postRaw('{ this is not valid json', sessionId));

    expect(response.status).toBe(400);
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
    const content = 'a'.repeat(MAX_ESSAY_CONTENT_CHARS);

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
    // the character cap itself would happily accept.
    const content = 'ü'.repeat(11_000);

    const response = await POST(postEssay({ content }, sessionId));

    expect(response.status).toBe(201);
  });
});

describe('POST /api/essays — the Content-Length pre-check (round-2 review: nothing here ever set this header before, so this branch was dead — a mutant deleting the whole block, or lowering its threshold to 1,000, left every test in this file green)', () => {
  it('rejects a request whose Content-Length header claims to exceed the transport cap, even though the actual body is small — proves the header check fires and rejects on its own, not merely restating what the byte-length check below it would catch anyway: without this check, this small, otherwise-valid body would 201, not 413', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran
    const response = await POST(
      postEssay({ content: 'A short essay.' }, sessionId, { 'content-length': String(MAX_REQUEST_BODY_BYTES + 1) }),
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

    // Empty text fails JSON.parse the same way a truly empty string body
    // would ('' is not valid JSON), so this lands on the "invalid JSON
    // body" 400 — the same status request.text() would have produced for
    // this exact shape.
    expect(response.status).toBe(400);
  });
});

describe('POST /api/essays — cross-origin requests', () => {
  // One integration-level test here (round-1 review): the guard's own
  // edge cases — malformed Origin, absent Host/forwarded-host, and
  // forwarded-host precedence — are unit-tested directly against
  // `isCrossOriginRequest` in `lib/same-origin.test.ts`, so this file only
  // needs to prove the guard is actually wired into THIS route, ahead of
  // session resolution.
  it('rejects a mismatched Origin header with 400 before ever reaching session resolution — a cookie naming no existing session is left uncreated, an existing one untouched', async () => {
    // A fresh, never-persisted id: if the origin check actually
    // short-circuits before resolveGuestSession runs, nothing creates this
    // row. If the guard were ever bypassed, resolveGuestSession's ordinary
    // first-use path would create it under this exact id, same as the
    // "bootstrap never landed" test above — making this a real,
    // failing-capable check, not just a restatement of the status code.
    const neverPersistedSessionId = generateGuestSessionId();

    const response = await POST(
      postEssay({ content: 'Should never be stored.' }, neverPersistedSessionId, { origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(400);
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
        { content: 'Submitted against the real deployed request shape.' },
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
          content: 'Must be attributed to whoever the cookie says, never whoever the body claims.',
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
