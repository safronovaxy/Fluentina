// @vitest-environment node
import { afterAll, describe, it, expect, vi } from 'vitest';
import { Pool } from 'pg';
import {
  EXPECTED_POSTGRES_MAJOR,
  majorFromVersionNum,
  assertPostgresMajor,
  assertDatabaseMajorVersion,
  type VersionQueryable,
} from './postgres-version';
// The script under test, not a copy of its logic — see the "guard as a
// guard" tests below.
import { runMigration } from '../../../scripts/migrate';

describe('postgres version guard', () => {
  it('reads the major out of server_version_num', () => {
    // 16.10 -> 160010, 15.6 -> 150006, 14.11 -> 140011
    expect(majorFromVersionNum(160010)).toBe(16);
    expect(majorFromVersionNum(150006)).toBe(15);
    expect(majorFromVersionNum(140011)).toBe(14);
  });

  it('passes on the expected major, whatever the patch level', () => {
    expect(() =>
      assertPostgresMajor(EXPECTED_POSTGRES_MAJOR * 10_000, 'test'),
    ).not.toThrow();
    expect(() =>
      assertPostgresMajor(EXPECTED_POSTGRES_MAJOR * 10_000 + 42, 'test'),
    ).not.toThrow();
  });

  it('refuses an older major and says what to do about it', () => {
    // The realistic case: production turns out to predate what we develop on.
    expect(() => assertPostgresMajor(150006, 'The target database')).toThrow(
      /major version 15/,
    );
    expect(() => assertPostgresMajor(150006, 'The target database')).toThrow(
      /Migrations were NOT applied/,
    );
    // The instruction matters as much as the refusal: the shared instance
    // carries the live CMS, so the fix is to lower ours, not raise theirs.
    expect(() => assertPostgresMajor(150006, 'The target database')).toThrow(
      /Do not upgrade the shared instance/,
    );
  });

  it('refuses a newer major too', () => {
    // Not just "too old". Generated SQL is pinned to a dialect either way,
    // and an unexpected newer server is still an unverified assumption.
    expect(() => assertPostgresMajor(170004, 'The target database')).toThrow(
      /major version 17/,
    );
  });
});

// The four tests above only prove the arithmetic. Nothing above imports or
// runs the migration script itself, so deleting the version check from
// `scripts/migrate.ts` — or moving the call to `migrate()` above it — would
// leave all four green. These two describe blocks close that: the first
// exercises `assertDatabaseMajorVersion` (the "pool-reading half" pulled out
// of the script) against a real connection and a fake one; the second
// exercises the script's own `runMigration` and proves the guard actually
// blocks a migration, not just that it computes the right boolean.
describe('assertDatabaseMajorVersion', () => {
  // A real connection to the same database every other lib/db test runs
  // against — this is the "against the live pool" half of the requirement,
  // proving the function reads an actual running server rather than only
  // ever seeing a mock.
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  afterAll(async () => {
    await pool.end();
  });

  it('passes against the real, currently-running database', async () => {
    await expect(
      assertDatabaseMajorVersion(pool, 'the live test database'),
    ).resolves.toBeUndefined();
  });

  it('throws against an injected fake reporting an older major version', async () => {
    const fakePool: VersionQueryable = {
      query: vi.fn().mockResolvedValue({ rows: [{ server_version_num: '150006' }] }),
    };

    await expect(assertDatabaseMajorVersion(fakePool, 'a fake database')).rejects.toThrow(
      /major version 15/,
    );
  });
});

describe('runMigration (scripts/migrate.ts)', () => {
  it('refuses to run a migration when the version guard throws', async () => {
    // Same fake as above, but this time driving the actual script export —
    // not a re-implementation of its logic — so a regression that deletes
    // the guard or reorders it after the migration call fails this test.
    const fakePool: VersionQueryable = {
      query: vi.fn().mockResolvedValue({ rows: [{ server_version_num: '150006' }] }),
    };
    const applyMigrations = vi.fn();

    await expect(
      runMigration(fakePool as unknown as Pool, applyMigrations),
    ).rejects.toThrow(/major version 15/);
    // The point of the guard: a partly-applied migration is worse than
    // none, so the migrator must never even be invoked on a version
    // mismatch, not merely have its result discarded.
    expect(applyMigrations).not.toHaveBeenCalled();
  });
});
