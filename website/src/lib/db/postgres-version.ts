// No `import 'server-only'` here, for the same reason schema.ts omits it:
// this module is loaded by scripts/migrate.ts, which runs in plain Node
// outside the Next.js bundler, where that marker throws unconditionally.
// It holds constants and pure functions — no queries, no client, no
// secrets — and the ESLint layering rules still keep it out of adapters.

/**
 * The Postgres major version this project develops and tests against.
 *
 * Local (docker-compose.yml) and CI (.github/workflows/ci.yml) both pin an
 * image of this major version. Production must match it.
 *
 * Why this constant exists rather than an assumption: drizzle-kit generates
 * the SQL dialect it is told to target. A migration using a feature from a
 * newer major version applies cleanly against the CI container, passes every
 * check, and then fails at the production migration — after the code that
 * depends on it has already been reviewed and approved. Nothing in the
 * pipeline can catch that, because nothing in the pipeline touches
 * production.
 *
 * So the assumption is asserted at the only moment it can be: immediately
 * before migrations run, against whatever database they are about to run
 * against. A mismatch stops the migration rather than half-applying it.
 *
 * If production turns out to be older, the fix is to lower this constant and
 * both image pins to match production — not to upgrade production. That
 * instance also carries the live CMS, and a major-version upgrade of it is
 * not a side effect of a schema change.
 */
export const EXPECTED_POSTGRES_MAJOR = 16;

/** `SHOW server_version_num` returns e.g. 160010 for 16.10. */
export function majorFromVersionNum(versionNum: number): number {
  return Math.floor(versionNum / 10_000);
}

export function assertPostgresMajor(versionNum: number, describeTarget: string): void {
  const actual = majorFromVersionNum(versionNum);
  if (actual !== EXPECTED_POSTGRES_MAJOR) {
    throw new Error(
      `Postgres major version mismatch.\n` +
        `  ${describeTarget} is running major version ${actual}.\n` +
        `  This project develops and tests against ${EXPECTED_POSTGRES_MAJOR} ` +
        `(see EXPECTED_POSTGRES_MAJOR in src/lib/db/postgres-version.ts).\n\n` +
        `Migrations were NOT applied. Generated SQL can use syntax the older ` +
        `server does not understand, and a partly-applied migration is worse ` +
        `than none.\n\n` +
        `If this is production, lower EXPECTED_POSTGRES_MAJOR and the image ` +
        `pins in docker-compose.yml and .github/workflows/ci.yml to match it. ` +
        `Do not upgrade the shared instance to match us — it also carries the ` +
        `live CMS.`,
    );
  }
}

/** The one row `SHOW server_version_num` returns. */
export interface PostgresVersionRow {
  readonly server_version_num: string;
}

/**
 * The minimal shape `assertDatabaseMajorVersion` needs from a database
 * handle — satisfied structurally by a real `pg.Pool`/`pg.Client`, and
 * cheaply by a fake in a test. Deliberately not the concrete `pg.Pool` type:
 * that would force every caller (and every test) to construct a real
 * connection just to exercise the assertion.
 */
export interface VersionQueryable {
  query(sql: string): Promise<{ rows: PostgresVersionRow[] }>;
}

/**
 * Reads the connected server's major version and asserts it, throwing
 * before returning if it doesn't match `EXPECTED_POSTGRES_MAJOR`. This is
 * the "pool-reading half" split out of `scripts/migrate.ts` so it — and the
 * refusal it produces — can be exercised directly in a test against both a
 * real pool and an injected fake, rather than only unit-testing the pure
 * arithmetic in `assertPostgresMajor` and hoping the script wires it in
 * correctly. See `assertDatabaseMajorVersion`'s tests and
 * `scripts/migrate.ts::runMigration`, which is what actually proves the
 * guard blocks a migration and not just that it computes the right boolean.
 */
export async function assertDatabaseMajorVersion(
  pool: VersionQueryable,
  describeTarget: string,
): Promise<void> {
  const { rows } = await pool.query('SHOW server_version_num');
  assertPostgresMajor(Number(rows[0].server_version_num), describeTarget);
}
