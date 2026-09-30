/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client, type Pool, type PoolClient } from 'pg';

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

/**
 * Stands in for the guest's essay. `query-error-sanitiser.ts` documents that
 * `pg`'s `detail` carries `Key (col)=(<the value>)` and `Failing row contains
 * (<the whole row>)`, so on a real constraint error these fields ARE essay
 * text. The line must never contain it, from any field.
 */
const ESSAY_MARKER = 'Meine Heimatstadt ist sehr schoen ESSAY-MARKER-7f3a';

/**
 * Markers that SURVIVE a shape check. `ESSAY_MARKER` above is rejected on
 * charset (colon, spaces, hyphens) by all three regexes in `client.ts`, so on
 * its own it proves the shape check works, not that the allowlist is narrow: a
 * handler that also read `e.detail` would still log nothing. These three are
 * alphanumeric/underscore tokens that each satisfy exactly one regex, so if the
 * handler ever falls back to another `pg` field for that slot, the planted
 * value is accepted and lands in the line. No single value can satisfy all
 * three (syscall is lowercase-only, SQLSTATE/errno uppercase-only), hence one
 * per slot. The test "the shape-passing markers really do pass" below pins each
 * to the real handler, so none can be edited into something inert.
 */
const NAME_MARKER = 'ESSAYMARKER7f3a'; // errorName: /^[A-Za-z][A-Za-z0-9]{0,39}$/
const CODE_MARKER = 'ESSAYMARKER_7F3A'; // errorCode: SQLSTATE or libuv errno name
const SYSCALL_MARKER = 'essay_marker'; // syscall: /^[a-z_]{2,20}$/
const SHAPE_PASSING_MARKERS = [
  ['errorName', 'name', NAME_MARKER],
  ['errorCode', 'code', CODE_MARKER],
  ['syscall', 'syscall', SYSCALL_MARKER],
] as const;

/** Every field a `pg` `DatabaseError` (or Drizzle's wrapper around one) can carry that is not a short token. */
const PG_ERROR_FIELDS = [
  'severity',
  'detail',
  'hint',
  'position',
  'internalPosition',
  'internalQuery',
  'where',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'file',
  'line',
  'routine',
  'query',
] as const;

const LOGGED_KEYS = [
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
].sort();

/**
 * An error dirty in every place a leak could come from: the message and stack,
 * each `pg` field above, Drizzle's `params`, and the `client` that `pg-pool`
 * itself hangs on the error (`err.client = client`, whose parameters hold the
 * password). Only `name`/`code`/`syscall` vary, because what the handler does
 * with them decides which branch runs: a valid token is used, an invalid or
 * absent one is where a careless fallback to another field would leak.
 */
function pgErrorCarryingSecrets(
  tokens: { name: unknown; code: unknown; syscall: unknown },
  plant: (field: string) => string = (f) => `${f}: ${ESSAY_MARKER} ${DATABASE_URL}`,
): Error {
  const err = new Error(`connection to ${DATABASE_URL} failed: read ECONNRESET`);
  const planted = Object.fromEntries(PG_ERROR_FIELDS.map((f) => [f, plant(f)]));
  return Object.assign(err, planted, {
    length: 123,
    errno: -104,
    address: '10.20.30.40',
    port: 5432,
    params: [ESSAY_MARKER, PASSWORD],
    connectionString: DATABASE_URL,
    client: { connectionParameters: { user: 'fluentina_app', password: PASSWORD, host: '10.20.30.40' } },
    dsn: { host: '10.20.30.40', user: 'fluentina_app', password: PASSWORD },
    cause: new Error(DATABASE_URL),
    ...tokens,
  });
}

type ClientModule = typeof import('./client');

async function importClientWith(url: string): Promise<{ mod: ClientModule; pool: Pool }> {
  vi.resetModules();
  vi.stubEnv('DATABASE_URL', url);
  const mod = await import('./client');
  return { mod, pool: mod.db.$client as Pool };
}

function throwsTheUrl(): never {
  throw new Error(`getter failed for ${DATABASE_URL}`);
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
      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(Object.keys(entry).sort()).toEqual(LOGGED_KEYS);
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

  // `max` is hardcoded in client.ts, so a differently-configured pool cannot be
  // had by importing. `pool.options` is a mutable plain object, though: change
  // it after construction and the line must follow. A literal `poolMax: 10`
  // would keep every other assertion here green and misreport once ADR-16
  // changes `max`.
  it('reads poolMax from the pool at the moment the event fires, not a constant', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    const configuredMax = pool.options.max;
    try {
      expect(configuredMax).toBe(10);
      pool.options.max = 27;
      pool.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' }));
      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]).poolMax).toBe(27);
    } finally {
      pool.options.max = configuredMax;
      await mod.closePool();
    }
  });

  // Only `Date` is faked: pg, timers and the event loop stay real. Two events at
  // two different times, so neither a fixed string nor a value captured once at
  // module load can satisfy both.
  it('stamps each line with the time the event fired', async () => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-03-04T05:06:07.089Z'));
      pool.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' }));
      vi.setSystemTime(new Date('2026-11-12T13:14:15.161Z'));
      pool.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' }));

      const lines = console_.lines();
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0]).timestamp).toBe('2026-03-04T05:06:07.089Z');
      expect(JSON.parse(lines[1]).timestamp).toBe('2026-11-12T13:14:15.161Z');
    } finally {
      vi.useRealTimers();
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
      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ errorName: 'error', errorCode: '57P01', syscall: null });
    } finally {
      await mod.closePool();
    }
  });

  // The handler runs inside `emit`. If it throws, that throw is itself the
  // uncaught exception it exists to prevent, and there is no outer catch.
  it.each([
    ['name', () => Object.defineProperty(new Error('x'), 'name', { get: throwsTheUrl })],
    ['code', () => Object.defineProperty(new Error('x'), 'code', { get: throwsTheUrl })],
    ['syscall', () => Object.defineProperty(new Error('x'), 'syscall', { get: throwsTheUrl })],
    ['every property (a Proxy)', () => new Proxy(new Error('x'), { get: throwsTheUrl })],
  ])('fails closed: an error whose %s accessor throws still does not escape emit()', async (_label, makeError) => {
    const { mod, pool } = await importClientWith(DATABASE_URL);
    const console_ = spyOnEveryConsoleMethod();
    try {
      expect(() => pool.emit('error', makeError())).not.toThrow();
      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toEqual({ severity: 'WARNING', event: 'db_pool_idle_client_error' });
      expect(lines[0]).not.toContain('postgres://');
      expect(lines[0]).not.toContain(PASSWORD);
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
    // The guest's essay text (see ESSAY_MARKER) — what `detail`/`where`/... hold.
    expect(line).not.toContain('ESSAY-MARKER');
    expect(line).not.toContain('Heimatstadt');
    // Shape-passing markers: would be accepted by a regex, so their absence is
    // down to WHICH field was read, not to the charset check.
    for (const [, , marker] of SHAPE_PASSING_MARKERS) expect(line).not.toContain(marker);
  }

  // Without this, a marker edited into something a regex rejects would turn the
  // next test back into one that only exercises the charset check.
  it.each(SHAPE_PASSING_MARKERS)(
    'the shape-passing markers really do pass client.ts\'s shape check: %s',
    async (logged, field, marker) => {
      const { mod, pool } = await importClientWith(DATABASE_URL);
      const console_ = spyOnEveryConsoleMethod();
      try {
        pool.emit('error', Object.assign(new Error('x'), { name: undefined, code: undefined, syscall: undefined, [field]: marker }));
        const lines = console_.lines();
        expect(lines).toHaveLength(1);
        expect(JSON.parse(lines[0])[logged]).toBe(marker);
      } finally {
        await mod.closePool();
      }
    },
  );

  // The same dirty error is run down each branch of the short-token handling.
  // A leak is only possible where a field OTHER than the three short tokens is
  // read, and that only happens as a fallback when a token is missing or
  // invalid — so the absent and hostile cases are the ones that matter, and
  // the valid case is what proves the allowlist is not simply logging nothing.
  it.each([
    [
      'valid name, code and syscall',
      { name: 'error', code: 'ECONNRESET', syscall: 'read' },
      { errorName: 'error', errorCode: 'ECONNRESET', syscall: 'read' },
    ],
    [
      'name, code and syscall all absent',
      { name: undefined, code: undefined, syscall: undefined },
      { errorName: null, errorCode: null, syscall: null },
    ],
    [
      'name, code and syscall that are really the connection string',
      { name: DATABASE_URL, code: DATABASE_URL, syscall: DATABASE_URL },
      { errorName: null, errorCode: null, syscall: null },
    ],
  ])(
    'copies nothing but the allowlist off an error carrying the password and essay text in every pg field: %s',
    async (_label, tokens, expected) => {
      const { mod, pool } = await importClientWith(DATABASE_URL);
      const console_ = spyOnEveryConsoleMethod();
      try {
        const err = pgErrorCarryingSecrets(tokens);
        expect(err.stack).toContain(PASSWORD); // the leak is real before the listener runs
        for (const field of PG_ERROR_FIELDS) expect(String((err as never)[field])).toContain(ESSAY_MARKER);

        pool.emit('error', err);

        const lines = console_.lines();
        expect(lines).toHaveLength(1);
        assertNoCredentialIn(lines[0]);
        const entry = JSON.parse(lines[0]);
        expect(Object.keys(entry).sort()).toEqual(LOGGED_KEYS);
        // Numbers stay numbers: a pg field smuggled into a pool count is a string.
        expect(entry).toMatchObject({ ...expected, poolMax: 10, poolTotal: 0, poolIdle: 0, poolWaiting: 0 });
        expect(entry).toMatchObject({ severity: 'WARNING', event: 'db_pool_idle_client_error' });
      } finally {
        await mod.closePool();
      }
    },
  );

  // The allowlist itself: every `pg` field carries a value that PASSES the shape
  // check for one slot, and the real `name`/`code`/`syscall` are valid, absent or
  // hostile. Only a handler that reads a field other than the three tokens (as a
  // fallback, when the token is absent or rejected) can put the marker in the
  // line. Each marker is run separately so a failure names the slot it leaked
  // through; the valid row passes for any handler and shows nothing is swallowed.
  it.each(
    SHAPE_PASSING_MARKERS.flatMap(([logged, , marker]) =>
      [
        ['valid name, code and syscall', { name: 'error', code: 'ECONNRESET', syscall: 'read' }],
        ['name, code and syscall all absent', { name: undefined, code: undefined, syscall: undefined }],
        ['name, code and syscall that are really the connection string', { name: DATABASE_URL, code: DATABASE_URL, syscall: DATABASE_URL }],
      ].map(([label, tokens]) => [logged, marker, label, tokens] as const),
    ),
  )(
    'a value that would pass the %s shape check, planted in every other pg field, is not read (%s): %s',
    async (logged, marker, _label, tokens) => {
      const { mod, pool } = await importClientWith(DATABASE_URL);
      const console_ = spyOnEveryConsoleMethod();
      try {
        const err = pgErrorCarryingSecrets(tokens as never, () => marker);
        for (const field of PG_ERROR_FIELDS) expect((err as never)[field]).toBe(marker);

        pool.emit('error', err);

        const lines = console_.lines();
        expect(lines).toHaveLength(1);
        assertNoCredentialIn(lines[0]);
        expect(lines[0]).not.toContain(marker);
        expect(JSON.parse(lines[0])[logged]).not.toBe(marker);
      } finally {
        await mod.closePool();
      }
    },
  );

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
      // Incidental for the undefined/null rows (nothing there to leak); their coverage is not.toThrow and exactly-one-line.
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
      // Three real connections, all released: idle, and counted by the pool.
      const clients = await Promise.all([pool.connect(), pool.connect(), pool.connect()]);
      const { rows } = await clients[0].query<{ pid: number }>('select pg_backend_pid() as pid');
      clients.forEach((c) => c.release()); // idle again: nothing is awaiting a result on these
      expect(pool.totalCount).toBe(3);
      expect(pool.idleCount).toBe(3);

      // The production listener must be the ONLY one. Any other 'error'
      // listener (say, one this test added to await the event) satisfies
      // EventEmitter on its own, so emit could never throw and the
      // uncaughtException check below could not fail whatever client.ts did.
      expect(pool.listenerCount('error')).toBe(1);

      // A separate connection, outside the pool, plays the part of Cloud SQL.
      const admin = new Client({ connectionString: process.env.DATABASE_URL });
      await admin.connect();
      try {
        await admin.query('select pg_terminate_backend($1)', [rows[0].pid]);
      } finally {
        await admin.end();
      }
      // Wait on the thing the listener does. If it were missing, emit would
      // throw inside pg's socket callback (an uncaughtException, recorded
      // below) and no line would ever appear.
      await vi.waitFor(() => expect(console_.lines()).toHaveLength(1), { timeout: 5000 });

      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      const entry = JSON.parse(lines[0]);
      expect(entry).toMatchObject({ event: 'db_pool_idle_client_error', errorCode: '57P01', poolMax: 10 });
      // Counts are read when the event fires, not at module load: the dead
      // client is already out of the pool, the other two are not.
      expect(entry).toMatchObject({ poolTotal: 2, poolIdle: 2, poolWaiting: 0 });
      expect(uncaught).not.toHaveBeenCalled();

      await expect(pool.query('select 1 as ok')).resolves.toMatchObject({ rows: [{ ok: 1 }] });
    } finally {
      process.off('uncaughtException', uncaught);
      await mod.closePool();
    }
  });

  // `poolWaiting` cannot be non-zero on a REAL idle-client error: `pg` hands an
  // idle client straight to a queued request, so an idle client and a waiting
  // one never coexist. So this one emits synthetically, against a genuinely
  // saturated pool, to prove the field reads the live queue and is not a
  // constant that merely happens to be right.
  it('reads every pool count live, at the moment the event fires (saturated pool, two requests queued)', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    const mod = await import('./client');
    const pool = mod.db.$client as Pool;
    const console_ = spyOnEveryConsoleMethod();
    let held: PoolClient[] = [];
    let queued: Promise<PoolClient>[] = [];
    try {
      held = await Promise.all(Array.from({ length: 10 }, () => pool.connect()));
      queued = [pool.connect(), pool.connect()];
      await vi.waitFor(() => expect(pool.waitingCount).toBe(2));

      pool.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' }));

      const lines = console_.lines();
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({ poolMax: 10, poolTotal: 10, poolIdle: 0, poolWaiting: 2 });
    } finally {
      // In the finally so a failed assertion above reports itself: `pool.end()`
      // waits for every checked-out client, so releasing after the assertions
      // would turn any failure into "Test timed out". Held first, which hands
      // the queued requests their clients; those are released in turn.
      held.forEach((c) => c.release());
      (await Promise.allSettled(queued)).forEach((r) => r.status === 'fulfilled' && r.value.release());
      await mod.closePool();
    }
  });
});
