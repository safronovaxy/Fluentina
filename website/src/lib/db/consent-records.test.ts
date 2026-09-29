/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from './client';
import { consentRecords, users } from './schema';
import { currentConsentState, recordConsent } from './consent-records';
import { resetDatabase, createTestUser, closePool } from '@/test/db-fixtures';
import type { UserActor } from '@/lib/contracts/actor';

async function newUserActor(): Promise<UserActor> {
  return { kind: 'user', userId: await createTestUser() };
}

async function rowsFor(actor: UserActor) {
  return db.select().from(consentRecords).where(eq(consentRecords.userId, actor.userId)).orderBy(consentRecords.recordedAt);
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

describe('consent_records is append-only — KAN-22', () => {
  it('a withdrawal is a NEW row with granted = false; the row that recorded the grant is untouched', async () => {
    const actor = await newUserActor();
    await recordConsent(actor, { kind: 'marketingEmail', documentVersion: '2026-10-01', granted: true });
    const [grant] = await rowsFor(actor);

    await recordConsent(actor, { kind: 'marketingEmail', documentVersion: '2026-10-01', granted: false });

    const rows = await rowsFor(actor);
    expect(rows).toHaveLength(2);
    // The original row is byte-for-byte what it was: same id, same value, same timestamp.
    const original = rows.find((row) => row.id === grant.id);
    expect(original).toEqual(grant);
    expect(original?.granted).toBe(true);
    // And the withdrawal is its own row, recorded no earlier than the grant.
    const withdrawal = rows.find((row) => row.id !== grant.id);
    expect(withdrawal?.granted).toBe(false);
    expect(withdrawal!.recordedAt.getTime()).toBeGreaterThanOrEqual(grant.recordedAt.getTime());
  });

  it('a re-grant after a withdrawal is a third row, not an edit of either', async () => {
    const actor = await newUserActor();
    for (const granted of [true, false, true]) {
      await recordConsent(actor, { kind: 'marketingEmail', documentVersion: '2026-10-01', granted });
    }

    expect((await rowsFor(actor)).map((row) => row.granted)).toEqual([true, false, true]);
  });

  it('the repository offers no way to update or delete a consent row: its whole write surface is inserts', async () => {
    const surface = await import('./consent-records');
    expect(Object.keys(surface).sort()).toEqual(['currentConsentState', 'insertConsentRecordsWithin', 'recordConsent']);
  });
});

// The two ordering-dependent tests below record their decisions in SEPARATE
// sequential transactions, so `recorded_at` (`now()` = transaction start)
// strictly increases between them. `currentConsentState` does not define an
// order for equal timestamps — see its own comment — so a test that wrote two
// decisions in one transaction would be asserting something unspecified.
describe('currentConsentState — the latest row per kind', () => {
  it('reports the most recent decision for each kind, and a withdrawal wins over the earlier grant', async () => {
    const actor = await newUserActor();
    await recordConsent(actor, { kind: 'termsOfService', documentVersion: '2026-01-01', granted: true });
    await recordConsent(actor, { kind: 'marketingEmail', documentVersion: '2026-01-01', granted: true });
    await recordConsent(actor, { kind: 'marketingEmail', documentVersion: '2026-01-01', granted: false });

    // The precondition the ordering rests on, asserted rather than assumed: a
    // tie here would make the result below unspecified, not merely wrong.
    // Counted in SQL, at Postgres' microsecond resolution: a JS `Date` truncates
    // to milliseconds, and two sequential inserts can land in the same one.
    const distinct = await db.execute(
      sql`SELECT count(DISTINCT recorded_at)::int AS n FROM fluentina.consent_records WHERE user_id = ${actor.userId} AND kind = 'marketingEmail'`,
    );
    expect(distinct.rows[0].n).toBe(2);

    const state = await currentConsentState(actor);

    expect(state.find((s) => s.kind === 'marketingEmail')?.granted).toBe(false);
    expect(state.find((s) => s.kind === 'termsOfService')?.granted).toBe(true);
    expect(state).toHaveLength(2);
  });

  it('carries the version the decision was made against, so "which wording did they agree to" is answerable', async () => {
    const actor = await newUserActor();
    await recordConsent(actor, { kind: 'privacyPolicy', documentVersion: '2026-10-01', granted: true });
    await recordConsent(actor, { kind: 'privacyPolicy', documentVersion: '2026-10-01-v2', granted: true });

    const [privacy] = await currentConsentState(actor);
    expect(privacy.documentVersion).toBe('2026-10-01-v2');
  });

  it('is scoped to the actor: one user cannot read another\'s consent trail', async () => {
    const alice = await newUserActor();
    const bob = await newUserActor();
    await recordConsent(alice, { kind: 'marketingEmail', documentVersion: '2026-01-01', granted: true });

    expect(await currentConsentState(bob)).toEqual([]);
    expect(await currentConsentState(alice)).toHaveLength(1);
  });

  it('is empty for a user with no records', async () => {
    expect(await currentConsentState(await newUserActor())).toEqual([]);
  });
});

describe('schema', () => {
  it('cascades: erasing the account erases its consent trail', async () => {
    const actor = await newUserActor();
    await recordConsent(actor, { kind: 'termsOfService', documentVersion: '2026-01-01', granted: true });

    await db.delete(users).where(eq(users.id, actor.userId));

    expect(await db.select().from(consentRecords)).toEqual([]);
  });

  it('refuses a row for a user that does not exist', async () => {
    await expect(
      recordConsent({ kind: 'user', userId: '00000000-0000-0000-0000-000000000000' }, { kind: 'termsOfService', documentVersion: 'x', granted: true }),
    ).rejects.toThrow();
  });
});
