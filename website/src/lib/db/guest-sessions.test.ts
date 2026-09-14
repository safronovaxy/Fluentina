/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { eq } from 'drizzle-orm';
import { db } from './client';
import { guestSessions } from './schema';
import { createEssay, getEssayById } from './essays';
import { createGuestSession, getGuestSessionById, convertGuestSessionToUser } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { GuestActor, GuestSessionId, UserActor } from '@/lib/contracts/actor';

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

// Bypasses the ownership-scoped `getGuestSessionById` (which itself re-parses
// via `toGuestSession`) to check, directly, whether a row was ever written —
// distinguishing "the insert never ran" from "it ran, and something further
// downstream merely also threw on the way out."
async function rawSessionRow(id: string) {
  const [row] = await db.select().from(guestSessions).where(eq(guestSessions.id, id));
  return row;
}

// A real users row: essays.user_id/guest_sessions.user_id both FK to it.
async function newUserActor(): Promise<UserActor> {
  return { kind: 'user', userId: await createTestUser() };
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

describe('createGuestSession', () => {
  it('persists a session keyed by the generated bearer id, unattached to any user', async () => {
    const actor = newGuestActor();

    const session = await createGuestSession(actor);

    expect(session.id).toBe(actor.sessionId);
    expect(session.userId).toBeNull();
    expect(session.convertedAt).toBeNull();
  });

  it('rejects a malformed session id at runtime, even though its type already claims to be a branded GuestSessionId', async () => {
    // Mirrors the real boundary the comment above `createGuestSession`
    // describes: a forced cast (`as GuestSessionId`) erases the branded
    // type's only compile-time guarantee, which is exactly what happens at
    // whatever boundary builds a `GuestActor` from a raw cookie value
    // (KAN-9). Without the runtime re-parse this function trusts, this would
    // insert an attacker-chosen id as a primary key — the session-fixation
    // route the comment says this line closes.
    const malformed = 'not-a-valid-session-id';
    const actor: GuestActor = { kind: 'guest', sessionId: malformed as GuestSessionId };

    await expect(createGuestSession(actor)).rejects.toThrow(/32-character lowercase hex/);
    // The rejection has to happen before the INSERT, not merely somewhere
    // downstream (`toGuestSession` re-parses whatever a query returns too) —
    // otherwise the attacker-chosen id is already a persisted row by the
    // time anything throws, which is the exact hole this re-parse exists to
    // close.
    expect(await rawSessionRow(malformed)).toBeUndefined();
  });

  it('rejects a well-formed but uppercase session id — the format is lowercase hex only', async () => {
    const uppercaseId = generateGuestSessionId().toUpperCase();
    const actor: GuestActor = { kind: 'guest', sessionId: uppercaseId as GuestSessionId };

    await expect(createGuestSession(actor)).rejects.toThrow(/32-character lowercase hex/);
    expect(await rawSessionRow(uppercaseId)).toBeUndefined();
  });
});

describe('getGuestSessionById', () => {
  it('a guest can read its own session; another guest cannot', async () => {
    const owner = newGuestActor();
    const stranger = newGuestActor();
    await createGuestSession(owner);
    await createGuestSession(stranger);

    const own = await getGuestSessionById(owner, owner.sessionId);
    const others = await getGuestSessionById(stranger, owner.sessionId);

    expect(own?.id).toBe(owner.sessionId);
    expect(others).toBeNull();
  });
});

describe('convertGuestSessionToUser', () => {
  it('attaches the session and every essay under it to the user in one operation', async () => {
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essayOne = await createEssay(actor, 'First essay written before conversion.');
    const essayTwo = await createEssay(actor, 'Second essay, also written before conversion.');
    const user = await newUserActor();

    await convertGuestSessionToUser(actor, user.userId);

    const convertedSession = await getGuestSessionById(user, actor.sessionId);
    const convertedEssayOne = await getEssayById(user, essayOne.id);
    const convertedEssayTwo = await getEssayById(user, essayTwo.id);

    expect(convertedSession?.userId).toBe(user.userId);
    expect(convertedSession?.convertedAt).not.toBeNull();
    expect(convertedEssayOne?.userId).toBe(user.userId);
    expect(convertedEssayTwo?.userId).toBe(user.userId);
  });

  it('rejects converting a session id that was never created', async () => {
    const actor = newGuestActor(); // never persisted via createGuestSession
    // No row matches the WHERE clause, so the update touches nothing and the
    // FK is never checked — a made-up id is fine here, unlike the tests
    // above where the update actually has to write this value.
    const madeUpUserId = randomUUID();

    await expect(convertGuestSessionToUser(actor, madeUpUserId)).rejects.toThrow(
      /no unconverted session found/,
    );
  });

  it('does not touch a second, unrelated guest session or its essay', async () => {
    // The essays update is the one multi-row write in this story. Every
    // other conversion test above has exactly one guest session in the
    // database when it runs, so a predicate that dropped the session match
    // — leaving only "unattached" — would attach every OTHER guest's
    // unattached essay to the converting user too, and every test would
    // still pass. This is the case that catches that: a bystander session,
    // never converted, with its own essay.
    const converting = newGuestActor();
    const bystander = newGuestActor();
    await createGuestSession(converting);
    await createGuestSession(bystander);
    await createEssay(converting, 'Essay under the session that will be converted.');
    const bystanderEssay = await createEssay(bystander, 'Essay under an entirely unrelated guest session.');
    const user = await newUserActor();

    await convertGuestSessionToUser(converting, user.userId);

    const bystanderSessionAfter = await getGuestSessionById(bystander, bystander.sessionId);
    const bystanderEssayAsItsOwnGuest = await getEssayById(bystander, bystanderEssay.id);
    const bystanderEssayAsConvertingUser = await getEssayById(user, bystanderEssay.id);

    // Still a guest session, not swept up into the conversion.
    expect(bystanderSessionAfter?.userId).toBeNull();
    expect(bystanderSessionAfter?.convertedAt).toBeNull();
    // Its own guest can still read its essay...
    expect(bystanderEssayAsItsOwnGuest?.id).toBe(bystanderEssay.id);
    // ...and the converting user, despite now owning everything under its
    // own session, must not be able to read someone else's.
    expect(bystanderEssayAsConvertingUser).toBeNull();
  });

  it('leaves the session unconverted when the essays write never completes — the two updates are one atomic operation', async () => {
    // Proves the transaction, not just each update individually: a second
    // connection holds a lock on the essay row so the conversion's own
    // essays UPDATE blocks on it, then that connection is killed mid-wait.
    // If both updates run inside one transaction, killing the backend rolls
    // back the session UPDATE too, even though it had already run (just not
    // committed). If a future edit ever split this into two independent
    // writes, the session UPDATE would have already committed by the time
    // the essays UPDATE blocked, and this test would find the session
    // converted with its essay still unattached.
    const actor = newGuestActor();
    await createGuestSession(actor);
    const essay = await createEssay(actor, 'Held under lock by another connection during conversion.');
    const user = await newUserActor();

    const blocker = new Client({ connectionString: process.env.DATABASE_URL });
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await blocker.connect();
    await admin.connect();

    // `pg_terminate_backend` kills the pool's own checked-out connection out
    // from under `db.transaction()`. Its pending query rejects normally
    // (caught below), but the underlying `pg.Client` — mid-use, so outside
    // the pool's own idle-client error handling — separately emits 'error'
    // on itself with no listener attached, which Node treats as an uncaught
    // exception. That is an artifact of deliberately killing a connection
    // this way, not a bug in production code (nothing in this repo bypasses
    // `pool.connect()` outside drizzle's own transaction handling), so it is
    // swallowed here, narrowly, rather than by changing `lib/db/client.ts`.
    let unexpectedDuringKill: unknown;
    const catchExpectedDisconnect = (err: unknown): void => {
      if (err instanceof Error && /Connection terminated/.test(err.message)) {
        return;
      }
      unexpectedDuringKill = err;
    };
    process.on('uncaughtException', catchExpectedDisconnect);

    try {
      await blocker.query('BEGIN');
      // Same row `convertGuestSessionToUser`'s essays UPDATE needs to lock.
      await blocker.query('SELECT 1 FROM fluentina.essays WHERE id = $1 FOR UPDATE', [essay.id]);

      const converting = convertGuestSessionToUser(actor, user.userId).catch(() => {
        // Expected: its backend is about to be killed out from under it.
      });

      // Poll for the backend now waiting on that lock. The conversion's
      // session UPDATE has to have already run — committed or not — by the
      // time this shows up.
      let blockedPid: number | null = null;
      for (let i = 0; i < 200 && blockedPid === null; i++) {
        const { rows } = await admin.query<{ pid: number }>(
          "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()",
        );
        blockedPid = rows[0]?.pid ?? null;
        if (blockedPid === null) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(blockedPid).not.toBeNull();

      await admin.query('SELECT pg_terminate_backend($1)', [blockedPid]);
      await converting;

      const sessionAfter = await getGuestSessionById(actor, actor.sessionId);
      const essayAfter = await getEssayById(actor, essay.id);
      expect(sessionAfter?.userId).toBeNull();
      expect(essayAfter?.id).toBe(essay.id);
      expect(unexpectedDuringKill).toBeUndefined();
    } finally {
      process.removeListener('uncaughtException', catchExpectedDisconnect);
      // Same reasoning as essays.test.ts's row-lock test: release the lock
      // even if an assertion above throws, or resetDatabase's TRUNCATE hangs
      // behind it.
      await blocker.query('COMMIT').catch(() => {});
      await blocker.end();
      await admin.end();
    }
  }, 20000);
});
