/** @vitest-environment node */
/**
 * KAN-52 — the `essays_exactly_one_owner` CHECK and the partial index, against
 * the real database. Raw inserts on purpose: these are the writes NO repository
 * function makes, so the constraint is tested as the last line of defence it is,
 * not through the code that is supposed to keep it from firing.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './client';
import { essays } from './schema';
import { createGuestSession } from './guest-sessions';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';

const CHECK_VIOLATION = '23514';
const CONSTRAINT = 'essays_exactly_one_owner';

/** Drizzle wraps the driver error; the SQLSTATE and constraint live on `.cause` (the sanitiser keeps both and strips `detail`). */
async function violation(write: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await write;
  } catch (error) {
    const cause = (error as { cause?: { code?: string; constraint?: string } }).cause;
    return { code: cause?.code, constraint: cause?.constraint };
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

async function newSession(): Promise<string> {
  const sessionId = generateGuestSessionId();
  await createGuestSession({ kind: 'guest', sessionId });
  return sessionId;
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

describe('essays_exactly_one_owner — the three legal states', () => {
  it('guest, unconverted: session_id set, user_id NULL', async () => {
    const sessionId = await newSession();
    await expect(db.insert(essays).values({ sessionId, userId: null, content: 'guest' })).resolves.toBeDefined();
  });

  it('guest, converted, and registered-native: session_id NULL, user_id set', async () => {
    const userId = await createTestUser();
    await expect(db.insert(essays).values({ sessionId: null, userId, content: 'account' })).resolves.toBeDefined();
  });
});

describe('essays_exactly_one_owner — the two forbidden states', () => {
  it('refuses BOTH columns set — the state a conversion that forgot to null session_id would write', async () => {
    const sessionId = await newSession();
    const userId = await createTestUser();

    const refused = await violation(db.insert(essays).values({ sessionId, userId, content: 'two owners' }));

    expect(refused).toEqual({ code: CHECK_VIOLATION, constraint: CONSTRAINT });
  });

  it('refuses NEITHER column set — a row nobody can read and nothing would ever sweep', async () => {
    const refused = await violation(db.insert(essays).values({ sessionId: null, userId: null, content: 'no owner' }));

    expect(refused).toEqual({ code: CHECK_VIOLATION, constraint: CONSTRAINT });
  });

  it('refuses an UPDATE that would leave a row with two owners, not just an INSERT', async () => {
    const sessionId = await newSession();
    const userId = await createTestUser();
    const [row] = await db.insert(essays).values({ sessionId, userId: null, content: 'a guest essay' }).returning();

    // Exactly what a conversion that set `user_id` and left `session_id` would do.
    const refused = await violation(db.update(essays).set({ userId }).where(eq(essays.id, row.id)));

    expect(refused).toEqual({ code: CHECK_VIOLATION, constraint: CONSTRAINT });
  });

  it('refuses an UPDATE that would leave a row with no owner', async () => {
    const userId = await createTestUser();
    const [row] = await db.insert(essays).values({ sessionId: null, userId, content: 'an account essay' }).returning();

    const refused = await violation(db.update(essays).set({ userId: null }).where(eq(essays.id, row.id)));

    expect(refused).toEqual({ code: CHECK_VIOLATION, constraint: CONSTRAINT });
  });
});

describe('the constraint is stated with bare column names and is `= 1`, not `>= 1`', () => {
  it('is stored as num_nonnulls(user_id, session_id) = 1', async () => {
    const { rows } = await db.execute<{ def: string }>(
      sql`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${CONSTRAINT}`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].def).toBe('CHECK ((num_nonnulls(user_id, session_id) = 1))');
  });
});

describe('essays_session_id_idx is partial (KAN-52)', () => {
  it('indexes only rows that have a session — account-owned essays carry a NULL session_id', async () => {
    const { rows } = await db.execute<{ def: string }>(
      sql`SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'fluentina' AND indexname = 'essays_session_id_idx'`,
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].def).toMatch(/WHERE \(session_id IS NOT NULL\)/);
  });
});
