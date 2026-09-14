/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { getGuestSessionById, createGuestSession, convertGuestSessionToUser } from '@/lib/db/guest-sessions';
import { getEssayById } from '@/lib/db/essays';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { guestSessionIdSchema } from '@/lib/contracts/actor';
import { MAX_ESSAY_CONTENT_BYTES } from '@/lib/contracts/essay-submission';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';

function postEssay(body: unknown, cookieValue?: string, headers?: Record<string, string>): NextRequest {
  const cookieHeader = cookieValue ? { cookie: `${GUEST_SESSION_COOKIE_NAME}=${cookieValue}` } : undefined;
  return new NextRequest(new URL('http://localhost:3000/api/essays'), {
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
  it('mints a fresh session, stores the essay under it, and sets the cookie', async () => {
    const response = await POST(postEssay({ content: 'Submitted with no guest session cookie present.' }));
    const body: { id: string } = await response.json();

    expect(response.status).toBe(201);
    const cookie = response.cookies.get(GUEST_SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(guestSessionIdSchema.safeParse(cookie?.value).success).toBe(true);

    const newSessionId = guestSessionIdSchema.parse(cookie?.value);
    const persisted = await getEssayById({ kind: 'guest', sessionId: newSessionId }, body.id);
    expect(persisted?.id).toBe(body.id);
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
    const response = await POST(postEssay({}));

    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with 400, not a 500', async () => {
    const response = await POST(postRaw('{ this is not valid json'));

    expect(response.status).toBe(400);
  });

  it('does not create a guest session row as a side effect of a rejected submission', async () => {
    const sessionId = generateGuestSessionId(); // never persisted

    await POST(postEssay({ content: '' }, sessionId));

    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });
});

describe('POST /api/essays — the request body safety cap (KAN-14 scope note: a blunt cap, not the KAN-15 word-count rule)', () => {
  it('rejects a request body over the safety cap with 413, before ever touching the database', async () => {
    const sessionId = generateGuestSessionId(); // never persisted — proves nothing downstream ran
    const oversizedContent = 'a'.repeat(MAX_ESSAY_CONTENT_BYTES + 1);

    const response = await POST(postEssay({ content: oversizedContent }, sessionId));

    expect(response.status).toBe(413);
    const persisted = await getGuestSessionById({ kind: 'guest', sessionId }, sessionId);
    expect(persisted).toBeNull();
  });

  it('accepts a body right at the cap for an otherwise-valid submission', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });
    // The JSON envelope itself (`{"content":"..."}`) also counts against the
    // raw-body cap, so the content string is sized comfortably under the
    // limit rather than exactly at it — this proves "a normal-shaped body
    // under the cap succeeds", not the exact boundary byte, which belongs
    // to the schema-level test, not this route-level one.
    const content = 'a'.repeat(MAX_ESSAY_CONTENT_BYTES - 100);

    const response = await POST(postEssay({ content }, sessionId));

    expect(response.status).toBe(201);
  });
});

describe('POST /api/essays — cross-origin requests', () => {
  it('rejects a mismatched Origin header with 400, even with an otherwise valid cookie and body', async () => {
    const sessionId = generateGuestSessionId();
    await createGuestSession({ kind: 'guest', sessionId });

    const response = await POST(
      postEssay({ content: 'Should never be stored.' }, sessionId, { origin: 'https://evil.example' }),
    );

    expect(response.status).toBe(400);
  });

  it('never reaches session resolution for a rejected cross-origin request — a cookie naming no existing session is left uncreated', async () => {
    // A fresh, never-persisted id: if the origin check actually short-circuits
    // before resolveGuestSession runs, nothing creates this row. If the
    // guard were ever bypassed, resolveGuestSession's ordinary first-use
    // path would create it under this exact id, same as the "bootstrap
    // never landed" test above — making this a real, failing-capable check,
    // not just a restatement of the status code.
    const neverPersistedSessionId = generateGuestSessionId();

    await POST(postEssay({ content: 'Should never be stored.' }, neverPersistedSessionId, { origin: 'https://evil.example' }));

    const persisted = await getGuestSessionById({ kind: 'guest', sessionId: neverPersistedSessionId }, neverPersistedSessionId);
    expect(persisted).toBeNull();
  });
});
