/** @vitest-environment node */
/**
 * KAN-52 — migration 0006 against a POPULATED database.
 *
 * The backfill (`UPDATE ... SET session_id = NULL WHERE user_id IS NOT NULL`) is
 * a no-op against every database that exists today, so nothing else in this
 * suite would notice if it were deleted: the normal test database is migrated
 * from empty. This builds a scratch database, migrates it to 0005, fills it with
 * the pre-KAN-52 shape (a converted essay carrying BOTH columns), then applies
 * 0006 — and, as the control that makes the first half mean something, applies
 * 0006 with the backfill stripped to show the CHECK would have refused it.
 *
 * Needs CREATE DATABASE on the server DATABASE_URL points at (the local
 * docker-compose user and CI's service container are both superusers).
 */
import { afterAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'drizzle');
const TARGET = '0006_kan52_essay_owner_actor.sql';

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function urlForDatabase(name: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${name}`;
  return url.toString();
}

const created: string[] = [];
const admin = new Client({ connectionString: process.env.DATABASE_URL });
const adminReady = admin.connect();

/** A scratch database migrated to just before 0006, holding one converted and one unconverted essay in the OLD shape. */
async function populatedPre0006(): Promise<Client> {
  await adminReady;
  const name = `kan52_mig_${randomBytes(6).toString('hex')}`;
  await admin.query(`CREATE DATABASE ${name}`);
  created.push(name);
  const client = new Client({ connectionString: urlForDatabase(name) });
  await client.connect();
  for (const file of migrationFiles().filter((f) => f < TARGET)) {
    await client.query(readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
  }
  await client.query(`
    INSERT INTO fluentina.users (email, password_hash) VALUES ('converted@example.test', 'h');
    INSERT INTO fluentina.guest_sessions (id, user_id, converted_at)
      SELECT repeat('a', 32), id, now() FROM fluentina.users;
    INSERT INTO fluentina.guest_sessions (id) VALUES (repeat('b', 32));
    -- the pre-KAN-52 converted essay: session_id KEPT "as provenance", user_id set
    INSERT INTO fluentina.essays (session_id, user_id, content)
      SELECT repeat('a', 32), id, 'converted' FROM fluentina.users;
    INSERT INTO fluentina.essays (session_id, content) VALUES (repeat('b', 32), 'guest');
  `);
  return client;
}

afterAll(async () => {
  await adminReady;
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe('migration 0006 on a populated database', () => {
  it('nulls session_id on every account-owned essay and leaves a guest-owned essay alone', async () => {
    const client = await populatedPre0006();
    try {
      await client.query(readFileSync(path.join(MIGRATIONS_DIR, TARGET), 'utf8'));

      const { rows } = await client.query<{ content: string; session_id: string | null; user_id: string | null }>(
        'SELECT content, session_id, user_id FROM fluentina.essays ORDER BY content',
      );
      const converted = rows.find((r) => r.content === 'converted');
      const guest = rows.find((r) => r.content === 'guest');
      expect(converted?.session_id).toBeNull();
      expect(converted?.user_id).not.toBeNull();
      expect(guest?.session_id).toBe('b'.repeat(32));
      expect(guest?.user_id).toBeNull();
    } finally {
      await client.end();
    }
  });

  it('WITHOUT the backfill the same migration is refused by its own CHECK — so the backfill is load-bearing', async () => {
    const client = await populatedPre0006();
    try {
      const withoutBackfill = readFileSync(path.join(MIGRATIONS_DIR, TARGET), 'utf8')
        .split('\n')
        .filter((line) => !line.startsWith('UPDATE "fluentina"."essays"'))
        .join('\n');
      // Guard the control itself: if the UPDATE line were reformatted and the
      // filter stopped matching, this would be testing the unmodified file.
      expect(withoutBackfill).not.toMatch(/SET "session_id" = NULL/);

      await expect(client.query(withoutBackfill)).rejects.toThrow(/essays_exactly_one_owner/);
    } finally {
      await client.end();
    }
  });
});
