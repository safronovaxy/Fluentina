/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, type Pool } from 'pg';

/**
 * KAN-43. `pg` reports an error on an IDLE client as an `'error'` event on the
 * `Pool`, and Node throws an `'error'` event nobody listens for — an uncaught
 * exception, i.e. a dead process (on Cloud Run, an unexplained restart). These
 * tests drive the pool `client.ts` actually constructs, not a copy of the
 * handler, so deleting the listener there is what turns them red.
 *
 * The listener logs one structured line and must never let the connection
 * string out with it: `pg` builds connection errors from the configuration,
 * so `DATABASE_URL` (password included) can sit in `err.message` or in any
 * field hung off the error. The credential below is deliberately realistic —
 * user, password with punctuation, host, query string.
 */
const PASSWORD = 'Sup3r-S3cret-Pw!';
const DATABASE_URL = `postgres://fluentina_app:${PASSWORD}@10.20.30.40:5432/fluentina?sslmode=require`;

type ClientModule = typeof import('./client');

async function importClientWith(url: string): Promise<{ mod: ClientModule; pool: Pool }> {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', url);
  const mod = await import('./client');
  return { mod, pool: mod.db.$client as Pool };
}

function spyOnEveryConsoleMethod() {
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  const lines = (): string[] => spies.flatMap((s) => s.mock.calls.map((args) => args.map(String).join(' ')));
  return { lines };
}

afterEach(() => {
  vi.doUnmock('drizzle-orm/node-postgres');
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('client.ts — KAN-43: an error on an idle pooled client must not kill the process', () => {
  it('attaches the error listener before drizzle() receives the pool', async () => {
    let listenersWhenDrizzleWasCalled = -1;
    vi.doMock('drizzle-orm/node-postgres', async (importOriginal) => {
      const actual = await importOriginal<typeof import('drizzle-orm/node-postgres')>();
      return {
        ...actual,
        drizzle: ((pool: Pool, config: never) => {
          listenersWhenDrizzleWasCalled = pool.listenerCount('error');
          return actual.drizzle(pool, config);
        }) as typeof actual.drizzle,
      };
    });
    const { mod } = await importClientWith(DATABASE_URL);
    try {
      expect(listenersWhenDrizzleWasCalled).toBe(1);
    } finally {
      await mod.closePool();
    }
  });

  it('survives an emitted pool error and writes exactly one structured line', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      // With no listener, EventEmitter#emit throws the error itself — in
      // production, from inside a socket callback, that is uncaughtException.
      expect(() => pool.emit('error', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).not.toThrow();

      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry).toMatchObject({ severity: 'WARNING', event: 'db_pool_idle_client_error' });
    } finally {
      await mod.closePool();
    }
  });

  it('is not an empty handler: the line says what failed and how loaded the pool was', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      pool.emit(
        'error',
        Object.assign(new Error('read ECONNRESET'), { name: 'Error', code: 'ECONNRESET', errno: -104, syscall: 'read' }),
      );
      const entry = JSON.parse(console_.lines()[0]);
      expect(Object.keys(entry).sort()).toEqual(
        [
          'errorCode',
          'errorName',
          'event',
          'poolIdle',
          'poolMax',
          'poolTotal',
          'poolWaiting',
          'severity',
          'syscall',
          'timestamp',
        ].sort(),
      );
      expect(entry).toMatchObject({
        errorName: 'Error',
        errorCode: 'ECONNRESET',
        syscall: 'read',
        poolMax: 10,
        poolTotal: 0,
        poolIdle: 0,
        poolWaiting: 0,
      });
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp);
    } finally {
      await mod.closePool();
    }
  });

  it('keeps the SQLSTATE of a server-side termination (what a Cloud SQL restart looks like)', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      // `pg`'s DatabaseError: name is literally 'error', severity FATAL.
      pool.emit(
        'error',
        Object.assign(new Error('terminating connection due to administrator command'), {
          name: 'error',
          severity: 'FATAL',
          code: '57P01',
          routine: 'ProcessInterrupts',
        }),
      );
      expect(JSON.parse(console_.lines()[0])).toMatchObject({ errorName: 'error', errorCode: '57P01', syscall: null });
    } finally {
      await mod.closePool();
    }
  });
});

describe('client.ts — KAN-43: the logged line never carries the connection string or its password', () => {
  function assertNoCredentialIn(line: string): void {
    expect(line).not.toContain(PASSWORD);
    expect(line).not.toContain('Sup3r');
    expect(line).not.toContain('S3cret');
    expect(line).not.toContain('postgres://');
    expect(line).not.toContain('fluentina_app');
    expect(line).not.toContain('10.20.30.40');
    expect(line).not.toContain(encodeURIComponent(PASSWORD));
  }

  it('does not copy err.message, err.stack or any other field off a password-bearing error', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      const err = Object.assign(new Error(`connection to ${DATABASE_URL} failed: read ECONNRESET`), {
        code: 'ECONNRESET',
        errno: -104,
        syscall: 'read',
        address: '10.20.30.40',
        port: 5432,
        connectionString: DATABASE_URL,
        dsn: { host: '10.20.30.40', user: 'fluentina_app', password: PASSWORD },
        detail: `password authentication failed for user "fluentina_app" (${DATABASE_URL})`,
        cause: new Error(DATABASE_URL),
      });
      expect(err.stack).toContain(PASSWORD); // the leak is real before the listener runs

      pool.emit('error', err);

      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      assertNoCredentialIn(lines[0]);
      expect(JSON.parse(lines[0])).toMatchObject({ errorCode: 'ECONNRESET', syscall: 'read' });
    } finally {
      await mod.closePool();
    }
  });

  it('does not trust the short fields either: a code, name or syscall that is really the URL is dropped', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      pool.emit('error', Object.assign(new Error('x'), { name: DATABASE_URL, code: DATABASE_URL, syscall: DATABASE_URL }));
      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      assertNoCredentialIn(lines[0]);
      expect(JSON.parse(lines[0])).toMatchObject({ errorName: null, errorCode: null, syscall: null });
    } finally {
      await mod.closePool();
    }
  });

  it.each([
    ['a bare string', DATABASE_URL],
    ['undefined', undefined],
    ['null', null],
    ['a plain object', { message: DATABASE_URL, code: 'ECONNRESET' }],
  ])('emits one clean line when the "error" is %s', async (_label, thrown) => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      expect(() => pool.emit('error', thrown)).not.toThrow();
      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      assertNoCredentialIn(lines[0]);
    } finally {
      await mod.closePool();
    }
  });
});

describe('client.ts — KAN-43: against a real database, a killed idle connection is logged and the pool recovers', () => {
  it('pg_terminate_backend on an idle pooled client emits SQLSTATE 57P01 as one line, and the next query works', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const mod = await import('./client');
    const pool = mod.db.$client as Pool;
    const console_ = spyOnEveryConsoleMethod();
    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);
    try {
      const client = await pool.connect();
      const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
      client.release(); // idle again: nothing is awaiting a result on this connection

      const killed = new Promise<void>((resolve) => pool.once('error', () => resolve()));
      // A separate connection, outside the pool, plays the part of Cloud SQL.
      const admin = new Client({ connectionString: process.env.DATABASE_URL });
      await admin.connect();
      try {
        await admin.query('select pg_terminate_backend($1)', [rows[0].pid]);
      } finally {
        await admin.end();
      }
      await killed;

      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ event: 'db_pool_idle_client_error', errorCode: '57P01' });
      expect(uncaught).not.toHaveBeenCalled();

      await expect(pool.query('select 1 as ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
    } finally {
      process.off('uncaughtException', uncaught);
      await mod.closePool();
    }
  });
});
