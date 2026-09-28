/** @vitest-environment node */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { format, inspect } from 'node:util';
import { DatabaseError } from 'pg';
import { DrizzleQueryError, eq, sql } from 'drizzle-orm';
import { NodePgPreparedQuery } from 'drizzle-orm/node-postgres';
import { pgSchema, serial, text } from 'drizzle-orm/pg-core';
import { db } from './client';
import { essays, rateLimitCounters } from './schema';
import { createEssay } from './essays';
import { createGuestSession } from './guest-sessions';
import { installQueryErrorSanitiser, sanitiseQueryError } from './query-error-sanitiser';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { wordsContent } from '@/test/essay-content-fixtures';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import type { GuestActor } from '@/lib/contracts/actor';

/**
 * KAN-36. A failed query's error carries the values it was writing — Drizzle
 * puts every bound parameter into the error's message and `.params`, and `pg`
 * echoes row values into `.cause.detail` — and nothing in this codebase
 * catches a failed write, so the framework's default handling prints the
 * whole tree to stderr (Cloud Logging). See query-error-sanitiser.ts.
 *
 * Every failure below is a REAL failure against the real database, never a
 * mocked throw: the previous per-site test (rate-limit.test.ts) mocks
 * `db.insert` to throw a string it wrote itself, which proves that the catch
 * discards its input but not what the driver actually puts in the error.
 *
 * Structure: (1) the leak, reproduced with the sanitiser bypassed — this is
 * what makes every "does not contain" below mean something; (2) the same
 * failures with it active; (3) what must survive; (4) what must not change.
 */

// --- fixtures -----------------------------------------------------------

// A generic table that has nothing to do with essays, standing in for the
// next one — `grading_jobs.raw_input` (PR #19) is a long text column written
// by an UPDATE, exactly the shape exercised below.
const probeSchema = pgSchema('fluentina');
const probe = probeSchema.table('kan36_query_error_probe', {
  id: serial('id').primaryKey(),
  tag: text('tag').unique('kan36_query_error_probe_tag_key'),
  body: text('body').notNull(),
});

const PROBE_TABLE = 'fluentina.kan36_query_error_probe';

// A realistic long, multi-line essay with recognisable fragments at the start,
// middle and end — a partial leak (a truncated message) must still be caught —
// and a line that begins with `    at ` on purpose: a stack-rewriting bug that
// located the message by "first frame-looking line" would leave what follows.
const ESSAY_HEAD = 'ESSAYHEAD-Sehr geehrte Damen und Herren, ich schreibe Ihnen wegen der Stelle';
const ESSAY_MIDDLE = 'ESSAYMIDDLE-Meiner Meinung nach ist Pünktlichkeit wichtig';
const ESSAY_TAIL = 'ESSAYTAIL-Mit freundlichen Grüßen, Anna Beispiel';
const ESSAY_FRAGMENTS = [ESSAY_HEAD, ESSAY_MIDDLE, ESSAY_TAIL];
const LONG_ESSAY = [
  ESSAY_HEAD,
  wordsContent(140),
  '    at fakeFrame (essay-line.ts:1:1)',
  ESSAY_MIDDLE,
  wordsContent(140),
  ESSAY_TAIL,
].join('\n');

const SESSION_ID_SECRET = 'SESSIONSECRET-0123456789abcdef0123456789abcdef';
const BUCKET_KEY = `essaySubmission:session:${SESSION_ID_SECRET}`;
const WINDOW = new Date('2026-01-01T00:00:00Z');

const prototype = NodePgPreparedQuery.prototype as unknown as { queryWithCache?: unknown };

/**
 * Runs `fn` with the sanitiser removed from the prototype, restoring it
 * after. This is how the leak is measured before the fix: the SAME code path,
 * the SAME database, the sanitiser simply not in the way. The descriptor is
 * read up front so this is a no-op restore if the sanitiser was never
 * installed (the mutation-verification run).
 */
async function withoutSanitiser<T>(fn: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'queryWithCache');
  delete prototype.queryWithCache;
  try {
    return await fn();
  } finally {
    if (descriptor) Object.defineProperty(prototype, 'queryWithCache', descriptor);
  }
}

async function caught(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return error as Error;
  }
  throw new Error('expected the query to fail, but it succeeded');
}

/** Every string reachable from `value` — own properties (enumerable or not), arrays, causes. */
function allStrings(value: unknown, seen = new WeakSet<object>()): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object' || value === null || seen.has(value)) return [];
  seen.add(value);
  return Object.getOwnPropertyNames(value).flatMap((key) =>
    allStrings((value as Record<string, unknown>)[key], seen),
  );
}

/**
 * Everything a log line could contain: each string in the error tree, what
 * `util.inspect` prints (which is what Node's default uncaught-error handling
 * and `console.error(err)` write — every enumerable property, the stack, the
 * cause chain), and `util.format`, which `console.error` runs its arguments
 * through.
 */
function everythingLoggable(error: Error): string {
  return [...allStrings(error), inspect(error, { depth: null }), format('%s', error), format(error)].join('\n');
}

function expectNoneOf(error: Error, secrets: string[]): void {
  const loggable = everythingLoggable(error);
  for (const secret of secrets) {
    expect(loggable, `leaked: ${secret}`).not.toContain(secret);
  }
}

function expectAllOf(error: Error, secrets: string[]): void {
  const loggable = everythingLoggable(error);
  for (const secret of secrets) {
    expect(loggable, `expected the raw driver error to contain: ${secret}`).toContain(secret);
  }
}

function newGuestActor(): GuestActor {
  return { kind: 'guest', sessionId: generateGuestSessionId() };
}

// --- the failures ----------------------------------------------------------
// Each returns the error a caller actually receives.

/** A real foreign-key violation binding an essay and a session id: no such session. */
function failEssayInsertOnForeignKey() {
  return caught(() =>
    db.insert(essays).values({ sessionId: SESSION_ID_SECRET, content: LONG_ESSAY }),
  );
}

/**
 * The real production path: `createEssay` against a real session, with the
 * content Postgres refuses (a NUL byte cannot be stored in `text`). Nothing
 * validates against NUL upstream, so a guest can trigger this on purpose.
 */
async function failCreateEssayOnNulByte(): Promise<{ error: Error; actor: GuestActor }> {
  const actor = newGuestActor();
  await createGuestSession(actor);
  const error = await caught(() => createEssay(actor, `${LONG_ESSAY}\u0000`));
  return { error, actor };
}

/** The rate-limit counter's key shape: a raw session id inside `bucketKey`, failing a real unique constraint. */
async function failRateLimitInsertOnDuplicateKey() {
  await db.insert(rateLimitCounters).values({ bucketKey: BUCKET_KEY, windowStart: WINDOW, count: 1 });
  return caught(() =>
    db.insert(rateLimitCounters).values({ bucketKey: BUCKET_KEY, windowStart: WINDOW, count: 1 }),
  );
}

// --- lifecycle -------------------------------------------------------------

beforeAll(async () => {
  await resetDatabase();
  await db.execute(
    sql.raw(
      `CREATE TABLE IF NOT EXISTS ${PROBE_TABLE} (id serial PRIMARY KEY, tag text CONSTRAINT kan36_query_error_probe_tag_key UNIQUE, body text NOT NULL)`,
    ),
  );
});

afterEach(async () => {
  await resetDatabase();
  await db.execute(sql.raw(`TRUNCATE TABLE ${PROBE_TABLE} RESTART IDENTITY`));
});

afterAll(async () => {
  await db.execute(sql.raw(`DROP TABLE IF EXISTS ${PROBE_TABLE}`));
  await closePool();
});

// ---------------------------------------------------------------------------

describe('KAN-36 — the leak, measured with the sanitiser bypassed', () => {
  // Guards the guard: without this, every "bypass" below could be measuring
  // the sanitiser's absence for the wrong reason, and mutation-disabling the
  // sanitiser would leave THIS file's baseline green while the rest goes red.
  it('the sanitiser is installed on the prepared-query class the app actually queries through', () => {
    expect(Object.getOwnPropertyDescriptor(prototype, 'queryWithCache')?.value).toBeTypeOf('function');
  });

  it('a failed essay insert puts the whole essay into the error message, .params, and the printed error', async () => {
    const error = await withoutSanitiser(failEssayInsertOnForeignKey);

    expect(error.message).toContain(ESSAY_HEAD);
    expect(error.message).toContain(ESSAY_TAIL);
    expect((error as unknown as { params: unknown[] }).params).toContain(LONG_ESSAY);
    expectAllOf(error, ESSAY_FRAGMENTS);
  });

  it('a failed essay insert also puts the session id into the message and into pg\'s cause.detail', async () => {
    const error = await withoutSanitiser(failEssayInsertOnForeignKey);

    expect(error.message).toContain(SESSION_ID_SECRET);
    expect((error.cause as { detail: string }).detail).toContain(SESSION_ID_SECRET);
  });

  it('the real createEssay path leaks the essay on an ordinary failed insert', async () => {
    const { error } = await withoutSanitiser(failCreateEssayOnNulByte);

    expect(error.message).toContain(ESSAY_HEAD);
    expectAllOf(error, ESSAY_FRAGMENTS);
  });

  it('a failed rate-limit insert puts the raw session id into the message and into cause.detail (the exposure KAN-25 closed per call site)', async () => {
    const error = await withoutSanitiser(failRateLimitInsertOnDuplicateKey);

    expect(error.message).toContain(SESSION_ID_SECRET);
    expect((error.cause as { detail: string }).detail).toContain(SESSION_ID_SECRET);
  });
});

describe('KAN-36 — the same failures with the sanitiser active: nothing bound or echoed survives', () => {
  it('essay content: a foreign-key failure on the essays table', async () => {
    const error = await failEssayInsertOnForeignKey();

    expectNoneOf(error, [...ESSAY_FRAGMENTS, SESSION_ID_SECRET, 'fakeFrame']);
  });

  it('essay content: the real createEssay path, in a transaction, with a real session', async () => {
    const { error, actor } = await failCreateEssayOnNulByte();

    // The session id is bound here too — createEssay inserts it as session_id.
    expectNoneOf(error, [...ESSAY_FRAGMENTS, actor.sessionId, 'fakeFrame']);
  });

  it('session id / client address: the rate-limit key shape, failing a real unique constraint', async () => {
    const error = await failRateLimitInsertOnDuplicateKey();

    expectNoneOf(error, [SESSION_ID_SECRET, BUCKET_KEY]);
  });

  it('a client address embedded in a bucket key is scrubbed the same way', async () => {
    const ipKey = 'essaySubmission:ip:203.0.113.77';
    await db.insert(rateLimitCounters).values({ bucketKey: ipKey, windowStart: WINDOW, count: 1 });
    const error = await caught(() =>
      db.insert(rateLimitCounters).values({ bucketKey: ipKey, windowStart: WINDOW, count: 1 }),
    );

    expectNoneOf(error, ['203.0.113.77']);
  });

  // The generic case. Nothing here is essay-specific: an arbitrary table, an
  // arbitrary long text column. This is what protects grading_jobs.raw_input
  // and raw_output when they land — no repository code names them.
  describe('generic: a long text bound to some table, by every statement shape', () => {
    it('INSERT failing a unique constraint (the value is echoed back in pg\'s detail)', async () => {
      await db.insert(probe).values({ tag: 'dup', body: 'first' });
      const error = await caught(() => db.insert(probe).values({ tag: 'dup', body: LONG_ESSAY }));

      expectNoneOf(error, [...ESSAY_FRAGMENTS, 'dup"']);
    });

    it('INSERT failing NOT NULL (pg\'s detail is "Failing row contains (...)" — the whole row)', async () => {
      const error = await caught(() =>
        db.insert(probe).values({ tag: `ROWSECRET-${LONG_ESSAY}`, body: null as unknown as string }),
      );

      expectNoneOf(error, [...ESSAY_FRAGMENTS, 'ROWSECRET']);
    });

    // The exact shape of PR #19's `UPDATE grading_jobs SET raw_input, raw_output`.
    it('UPDATE .set({ two long text columns }) failing', async () => {
      await db.insert(probe).values({ tag: 'row', body: 'x' });
      const error = await caught(() =>
        db
          .update(probe)
          .set({ body: LONG_ESSAY, tag: 'RAWOUTPUT-{"choices":[{"message":"model reply"}]}\u0000' })
          .where(eq(probe.tag, 'row')),
      );

      expectNoneOf(error, [...ESSAY_FRAGMENTS, 'RAWOUTPUT', 'model reply']);
    });

    // pg's OWN message echoes the value here (`invalid input syntax for type
    // integer: "..."`) — dropping `.params` and `.detail` alone would not be
    // enough, which is why the driver's message is rebuilt, not kept.
    it('a raw db.execute whose value the driver echoes inside its own error MESSAGE', async () => {
      const error = await caught(() => db.execute(sql`select ${`ECHOED-${LONG_ESSAY}`}::integer`));

      expectNoneOf(error, [...ESSAY_FRAGMENTS, 'ECHOED']);
    });

    it('SELECT with a bound filter value', async () => {
      const error = await caught(() =>
        db.execute(sql`select * from fluentina.kan36_query_error_probe where id = ${`FILTER-${LONG_ESSAY}`}::integer`),
      );

      expectNoneOf(error, [...ESSAY_FRAGMENTS, 'FILTER']);
    });

    it('DELETE with a bound filter value', async () => {
      const error = await caught(() =>
        db.execute(sql`delete from fluentina.kan36_query_error_probe where id = ${`DELETE-${LONG_ESSAY}`}::integer`),
      );

      expectNoneOf(error, [...ESSAY_FRAGMENTS, 'DELETE-']);
    });

    it('a failure inside db.transaction, which also runs its own begin/commit/rollback through the same funnel', async () => {
      const error = await caught(() =>
        db.transaction(async (tx) => {
          await tx.insert(probe).values({ tag: 'tx', body: LONG_ESSAY });
          await tx.insert(probe).values({ tag: 'tx', body: LONG_ESSAY });
        }),
      );

      expectNoneOf(error, ESSAY_FRAGMENTS);
    });

    it('a bound value that is ITSELF a log-injection attempt: nothing in it is echoed', async () => {
      const error = await caught(() =>
        db.insert(probe).values({ tag: null, body: `${'y'.repeat(50)}\u0000INJECTED\n    at evil (x.ts:1:1)` }),
      );

      expectNoneOf(error, ['INJECTED', 'evil (x.ts', 'yyyyyyyyyy']);
    });
  });
});

describe('KAN-36 — the diagnostic value that survives (a "scrub everything" simplification must fail here)', () => {
  it('unique violation: SQLSTATE, constraint, schema and table, and the statement shape', async () => {
    const error = await failRateLimitInsertOnDuplicateKey();
    const cause = error.cause as Record<string, unknown>;

    expect(cause.code).toBe('23505');
    expect(cause.constraint).toBe('rate_limit_counters_bucket_key_window_start_pk');
    expect(cause.schema).toBe('fluentina');
    expect(cause.table).toBe('rate_limit_counters');
    // The statement, with placeholders — the shape, not the values.
    expect((error as unknown as { query: string }).query).toBe(
      'insert into "fluentina"."rate_limit_counters" ("bucket_key", "window_start", "count") values ($1, $2, $3)',
    );
    // ...and the message a 2am reader sees leads with all of it.
    expect(error.message).toContain('insert into "fluentina"."rate_limit_counters"');
    expect(error.message).toContain('$1, $2, $3');
    expect(cause.constructor).toBe(DatabaseError);
    expect((cause as unknown as Error).message).toBe(
      'postgres ERROR 23505 (unique_violation): table "fluentina.rate_limit_counters", constraint "rate_limit_counters_bucket_key_window_start_pk"',
    );
  });

  it('foreign-key violation: which constraint on which table failed', async () => {
    const error = await failEssayInsertOnForeignKey();
    const cause = error.cause as Record<string, unknown>;

    expect(cause.code).toBe('23503');
    expect(cause.constraint).toBe('essays_session_id_guest_sessions_id_fk');
    expect(cause.table).toBe('essays');
    expect(error.message).toContain('insert into "fluentina"."essays"');
  });

  it('not-null violation: which column', async () => {
    const error = await caught(() => db.insert(probe).values({ tag: 't', body: null as unknown as string }));
    const cause = error.cause as Record<string, unknown>;

    expect(cause.code).toBe('23502');
    expect(cause.column).toBe('body');
    expect(cause.table).toBe('kan36_query_error_probe');
  });

  it('a data error (no constraint): the SQLSTATE and its condition name, without the value', async () => {
    const { error } = await failCreateEssayOnNulByte();
    const cause = error.cause as Record<string, unknown>;

    expect(cause.code).toBe('22021');
    expect((cause as unknown as Error).message).toBe('postgres ERROR 22021 (character_not_in_repertoire)');
    // `.params` keeps its ARITY — how many values were bound is diagnostic — but never the values.
    const params = (error as unknown as { params: unknown[] }).params;
    expect(params).toHaveLength(3);
    expect(params.every((p) => p === '[redacted]')).toBe(true);
    expect(error.message).toContain('params: [3 value(s) [redacted]]');
  });

  it('exact key set of the sanitised cause: an allowlist, so a new driver field cannot slip through', async () => {
    const error = await failRateLimitInsertOnDuplicateKey();

    expect(Object.keys(error.cause as object).sort()).toEqual([
      'code',
      'constraint',
      'name',
      'routine',
      'schema',
      'severity',
      'table',
    ]);
    expect(Object.keys(error).sort()).toEqual(['cause', 'params', 'query']);
  });

  it('the original call-site frames are kept, so a reader can still find which code ran the query', async () => {
    const error = await failEssayInsertOnForeignKey();

    expect(error.stack).toContain('query-error-sanitiser.test.ts');
    expect(error.stack).toMatch(/^Error: Failed query: insert into/);
  });

  it('a network-layer error (no SQLSTATE, never saw a parameter) keeps its message and code', () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
      errno: -111,
      syscall: 'connect',
      address: '127.0.0.1',
      port: 5432,
      internalDetail: 'not on the allowlist',
    });
    const wrapped = new DrizzleQueryError('select 1 where x = $1', ['SECRET'], refused);

    const result = sanitiseQueryError(wrapped) as DrizzleQueryError;

    expect(result).toBe(wrapped);
    const cause = result.cause as unknown as Record<string, unknown>;
    expect(cause.message).toBe('connect ECONNREFUSED 127.0.0.1:5432');
    expect(cause.code).toBe('ECONNREFUSED');
    expect(cause.syscall).toBe('connect');
    expect(cause.port).toBe(5432);
    expect(cause.internalDetail).toBeUndefined();
    expect(everythingLoggable(result)).not.toContain('SECRET');
  });
});

describe('KAN-36 — control flow is unchanged: it scrubs the error, never swallows or replaces it', () => {
  it('the failure still throws the same DrizzleQueryError, with the driver error still on .cause', async () => {
    const error = await failEssayInsertOnForeignKey();

    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect(error.cause).toBeInstanceOf(DatabaseError);
  });

  // lib/domain/guest-session.ts::isUniqueViolation reads `err.cause.code ===
  // '23505'` to recover from a lost race. If the sanitiser ever dropped or
  // renamed it, that recovery would silently become a 500.
  it('the SQLSTATE stays reachable exactly where lib/domain/guest-session.ts reads it', async () => {
    const error = await failRateLimitInsertOnDuplicateKey();

    expect((error as { code?: unknown }).code).toBeUndefined();
    expect((error.cause as { code?: unknown }).code).toBe('23505');
  });

  it('a failed createEssay still rolls its transaction back — no essay row is left behind', async () => {
    const { actor } = await failCreateEssayOnNulByte();

    const rows = await db.select().from(essays).where(eq(essays.sessionId, actor.sessionId));
    expect(rows).toHaveLength(0);
  });

  it('a successful query is untouched', async () => {
    const [row] = await db.insert(probe).values({ tag: 'ok', body: LONG_ESSAY }).returning();

    expect(row.body).toBe(LONG_ESSAY);
  });

  it('an application error thrown inside a transaction keeps its own message — only driver query errors are scrubbed', async () => {
    const error = await caught(() =>
      db.transaction(async () => {
        throw new Error('application-level failure the caller maps to a reason code');
      }),
    );

    expect(error.message).toBe('application-level failure the caller maps to a reason code');
  });

  it('installing twice does not stack a second wrapper', () => {
    const before = Object.getOwnPropertyDescriptor(prototype, 'queryWithCache');
    try {
      installQueryErrorSanitiser();
      installQueryErrorSanitiser();

      expect(Object.getOwnPropertyDescriptor(prototype, 'queryWithCache')?.value).toBe(before?.value);
    } finally {
      // Put the prototype back exactly as found. If client.ts had NOT
      // installed it (the mutation-verification run), the calls above just
      // did — and leaving that in place would quietly protect every test
      // that runs after this one.
      if (before) Object.defineProperty(prototype, 'queryWithCache', before);
      else delete prototype.queryWithCache;
    }
  });
});

describe('KAN-36 — what an operator\'s log actually receives', () => {
  // The same idiom essay-submission-telemetry.test.ts uses: spy the console
  // method and inspect exactly what it was called with.
  it('console.error(err) — what the framework\'s default handling does — writes no essay text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { error } = await failCreateEssayOnNulByte();
      console.error(error);

      const written = spy.mock.calls.map((args) => format(...args)).join('\n');
      for (const fragment of ESSAY_FRAGMENTS) expect(written).not.toContain(fragment);
      // ...and it still says something useful.
      expect(written).toContain('22021');
      expect(written).toContain('insert into "fluentina"."essays"');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('sanitiseQueryError — fails closed and handles hostile shapes', () => {
  function pgError(fields: Record<string, unknown>): DatabaseError {
    return Object.assign(new DatabaseError('leaky driver message SECRET-VALUE', 0, 'error'), fields);
  }

  it('returns non-objects untouched', () => {
    expect(sanitiseQueryError('a string')).toBe('a string');
    expect(sanitiseQueryError(undefined)).toBeUndefined();
  });

  it('never throws and never returns the original when the error cannot be scrubbed (a frozen error)', () => {
    const frozen = Object.freeze(
      Object.assign(new Error('Failed query: x\nparams: SECRET-VALUE'), { query: 'x', params: ['SECRET-VALUE'] }),
    );

    const result = sanitiseQueryError(frozen) as Error;

    expect(result).not.toBe(frozen);
    expect(everythingLoggable(result)).not.toContain('SECRET-VALUE');
  });

  it('terminates on a circular cause chain and on one deeper than the limit', () => {
    const a = pgError({ severity: 'ERROR', code: '23505', detail: 'SECRET-VALUE' });
    const b = pgError({ severity: 'ERROR', code: '23505', detail: 'SECRET-VALUE' });
    (a as unknown as { cause: unknown }).cause = b;
    (b as unknown as { cause: unknown }).cause = a;
    let chain: Error = pgError({ severity: 'ERROR', code: '23505', detail: 'SECRET-VALUE' });
    for (let i = 0; i < 12; i++) {
      chain = Object.assign(pgError({ severity: 'ERROR', code: '23505', detail: 'SECRET-VALUE' }), { cause: chain });
    }

    expect(() => sanitiseQueryError(a)).not.toThrow();
    expect(() => sanitiseQueryError(chain)).not.toThrow();
    expect(everythingLoggable(a)).not.toContain('SECRET-VALUE');
    expect(everythingLoggable(chain)).not.toContain('SECRET-VALUE');
  });

  it('is idempotent', () => {
    const wrapped = new DrizzleQueryError('insert $1', ['SECRET-VALUE'], pgError({ severity: 'ERROR', code: '23505', detail: 'd SECRET-VALUE', constraint: 'c' }));

    sanitiseQueryError(wrapped);
    const once = inspect(wrapped, { depth: null });
    sanitiseQueryError(wrapped);

    expect(inspect(wrapped, { depth: null })).toBe(once);
  });

  it('drops a driver field it has never heard of, rather than keeping it (allowlist, not denylist)', () => {
    const cause = pgError({ severity: 'ERROR', code: '22P02', futureField: 'SECRET-VALUE', where: 'SECRET-VALUE', hint: 'SECRET-VALUE' });
    const wrapped = new DrizzleQueryError('select $1', ['SECRET-VALUE'], cause);

    sanitiseQueryError(wrapped);

    expect(everythingLoggable(wrapped)).not.toContain('SECRET-VALUE');
  });
});
