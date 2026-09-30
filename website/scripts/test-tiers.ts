/**
 * Which tests does a diff need? The map and the pure selection function behind
 * the smoke tier (CLAUDE.md, "Test tiers"; ci.yml's `website-smoke` job).
 *
 * Read this before editing it, because the failure mode is the dangerous kind:
 * a bug here does not turn anything red, it makes tests quietly not run.
 *
 * The one rule everything else hangs off: **anything the map does not
 * recognise runs everything.** The map can have gaps (it is hand-maintained),
 * so a gap must cost minutes, never coverage. There is no "inert" list and no
 * default-to-nothing path; the only way a path selects fewer than everything
 * is by matching an area below on purpose.
 *
 * Evaluation order, per diff:
 *   1. RUN_EVERYTHING first, and absolute. One changed path matching it
 *      selects everything, even if the same path also matches an area.
 *   2. Any changed path matching no area selects everything.
 *   3. Otherwise: the union of the matched areas' unit tests and e2e specs.
 * An empty diff also selects everything: if the diff step quietly produced
 * nothing, "nothing changed" is the least likely explanation.
 *
 * All paths are repo-relative, exactly as `git diff --name-only` emits them
 * (`website/src/...`), never relative to `website/src` or `website/`.
 *
 * Deliberately not modelled: the import graph. `lib/db/**` is consumed by
 * half the domain layer, and the map does not know that. That is the Test
 * Lead's per-story job ("what does the default miss for this diff"); the
 * full run is what gates merge.
 */

const S = 'website/src';
const T = 'website/tests';

export interface Area {
  name: string;
  /**
   * Repo-relative globs. A changed path matching one triggers the area, and
   * every unit test file matching one is the area's own tests — unit tests are
   * co-located with their source, so they fall out of the same globs.
   */
  paths: string[];
  /**
   * Playwright specs this area runs, repo-relative. Specs are NOT co-located
   * (`testDir` is `./tests`), so no path glob can find them; each needs naming
   * here. The map-coverage tests fail if a spec under website/tests/ is named
   * by no area.
   */
  specs: string[];
  /** Why the area exists, or why it selects nothing. */
  note: string;
}

/**
 * Shared by construction: a change here can break any test, so it runs
 * everything. Checked before the areas and not overridable by them.
 */
export const RUN_EVERYTHING: string[] = [
  // CI itself — including the deploy workflows and their verify-ci gate.
  '.github/**',
  // The database every DB-backed test runs against, and what builds it.
  'docker-compose.yml',
  'website/drizzle/**',
  'website/drizzle.config.ts',
  `${S}/lib/db/schema.ts`,
  // Shared contracts: every layer imports these.
  `${S}/lib/contracts/**`,
  // Runs in front of every request the guest flow makes.
  `${S}/middleware.ts`,
  // Everything every unit test loads (vitest.config.ts `setupFiles`, the
  // fixtures, the `server-only` stub) and every spec loads (tests/helpers).
  `${S}/test/**`,
  `${T}/helpers/**`,
  // The test runners' own wiring — the files whose mis-wiring once left the
  // suite green against no DOM.
  'website/vitest.config.ts',
  'website/playwright.config.ts',
  // Toolchain and build inputs.
  'website/package.json',
  'website/package-lock.json',
  'website/tsconfig.json',
  'website/eslint.config.js',
  'website/next.config.ts',
  'website/tailwind.config.ts',
  'website/postcss.config.js',
  // Shared UI primitives: every page renders them.
  `${S}/components/ui/**`,
  // CI tooling: this selector, its tests, the TLS proxy the e2e job runs
  // behind, the migration runner. A change to the selector cannot vouch for
  // itself.
  'website/scripts/**',
];

export const AREAS: Area[] = [
  {
    name: 'guest-funnel',
    note: 'The guest essay flow: entry form, word count, preview, and their pages.',
    paths: [
      `${S}/components/guest/**`,
      `${S}/app/[locale]/**`,
      `${S}/app/api/essays/**`,
      `${S}/hooks/use-grading-status*`,
      `${S}/hooks/use-pending-elapsed*`,
      `${S}/lib/domain/essay-*`,
    ],
    specs: [
      `${T}/essay-entry.spec.ts`,
      `${T}/word-count.spec.ts`,
      `${T}/grading-preview.spec.ts`,
      `${T}/guest-flow.spec.ts`,
      `${T}/guest-flow-i18n.spec.ts`,
      `${T}/guest-session.spec.ts`,
      `${T}/registration.spec.ts`,
    ],
  },
  {
    name: 'grading',
    note: 'The grading pipeline. lib/contracts/grading* is in RUN_EVERYTHING, not here.',
    paths: [
      `${S}/lib/domain/grading/**`,
      `${S}/app/api/essays/[id]/grading/**`,
      `${S}/app/api/internal/grading-jobs/**`,
      `${S}/lib/db/grading-jobs*`,
    ],
    // The e2e job serves the built app with MOCK_GRADING_PROVIDER=1, so the
    // funnel specs exercise the orchestration end to end.
    specs: [`${T}/grading-preview.spec.ts`, `${T}/essay-entry.spec.ts`],
  },
  {
    name: 'auth',
    note: 'Guest and registered sessions, login, registration, ownership.',
    paths: [
      `${S}/lib/domain/{owner-actor,ownership,registered-session,registered-session-token,guest-session,login,registration,password,session-id}*`,
      `${S}/app/api/auth/**`,
      `${S}/app/api/guest-session/**`,
      `${S}/lib/*session-cookie*`,
      `${S}/lib/guest-session-rejection-log*`,
      `${S}/lib/db/{sessions,users,guest-sessions,consent-records,ownership}*`,
      `${S}/components/guest/GuestSessionBootstrap*`,
      `${S}/middleware.test.ts`,
    ],
    specs: [`${T}/guest-session.spec.ts`, `${T}/registration.spec.ts`],
  },
  {
    name: 'api-edge',
    note: 'The HTTP boundary: every route handler, and the guards they all call.',
    paths: [
      `${S}/app/api/**`,
      `${S}/lib/same-origin*`,
      `${S}/lib/client-ip*`,
      `${S}/lib/request-body*`,
      `${S}/lib/rejection-response*`,
      `${S}/lib/domain/rate-limit*`,
      `${S}/lib/db/rate-limit*`,
    ],
    specs: [`${T}/essay-entry.spec.ts`, `${T}/guest-session.spec.ts`, `${T}/registration.spec.ts`],
  },
  {
    name: 'data',
    note: 'The data layer (schema.ts and the migrations are in RUN_EVERYTHING).',
    paths: [`${S}/lib/db/**`],
    // The only specs that reach the real database through the built app.
    specs: [`${T}/essay-entry.spec.ts`, `${T}/guest-session.spec.ts`],
  },
  {
    name: 'i18n',
    note: 'Locale routing, message catalogues, the intl provider.',
    paths: [`${S}/messages/**`, `${S}/i18n/**`, `${S}/components/IntlProvider.tsx`],
    // Every guest component renders from the catalogues.
    specs: [`${T}/guest-flow-i18n.spec.ts`, `${T}/guest-flow.spec.ts`, `${T}/essay-entry.spec.ts`, `${T}/registration.spec.ts`],
  },
  {
    name: 'marketing',
    note: 'The Strapi-backed marketing site, SEO, sitemap.',
    paths: [
      `${S}/app/(marketing)/**`,
      `${S}/page-components/**`,
      `${S}/lib/strapi*`,
      `${S}/lib/seo.ts`,
      `${S}/hooks/use-strapi.ts`,
      `${S}/types/strapi.ts`,
      `${S}/components/SEO.tsx`,
      `${S}/app/sitemap.ts`,
      `${S}/app/robots.ts`,
      `${S}/app/health/**`,
    ],
    specs: [
      `${T}/blog.spec.ts`,
      `${T}/contact-form.spec.ts`,
      `${T}/navigation.spec.ts`,
      `${T}/no-console-errors.spec.ts`,
      `${T}/redirects.spec.ts`,
      `${T}/routing.spec.ts`,
      `${T}/seo.spec.ts`,
      `${T}/sitemap.spec.ts`,
    ],
  },
  {
    name: 'placement-test',
    note: 'The placement-test landing pages.',
    paths: [
      `${S}/components/placement-test/**`,
      `${S}/app/(placement-test)/**`,
      `${S}/components/pages/**`,
      `${S}/lib/placement-test-api.ts`,
      `${S}/page-components/PlacementTest*`,
    ],
    specs: [`${T}/placement-test.spec.ts`, `${T}/no-console-errors.spec.ts`],
  },
  {
    name: 'shell',
    note: 'Site chrome and global styling shared by every page.',
    paths: [
      `${S}/components/layout/**`,
      `${S}/components/{Providers,NavLink,PageViewTracker}.tsx`,
      `${S}/app/layout.tsx`,
      `${S}/app/not-found.tsx`,
      `${S}/app/globals.css`,
      `${S}/index.css`,
      `${S}/App.*`,
      `${S}/hooks/use-mobile.tsx`,
      `${S}/hooks/use-toast.ts`,
      `${S}/lib/{analytics,growthbook,icons,queryClient,utils}.ts`,
    ],
    specs: [`${T}/navigation.spec.ts`, `${T}/no-console-errors.spec.ts`, `${T}/guest-flow.spec.ts`],
  },
  {
    name: 'cms',
    note:
      'Selects no website test, on purpose — and that is not because something else covers ' +
      'cms/**. Nothing does. cms/package.json has no test script at all, and ci.yml runs `@cms` ' +
      'specs nowhere, so the `cms` job\'s `npm ci` + `strapi build` (every event, tiered or ' +
      'not) is the ENTIRE signal that exists for cms/**. The CORS whitelist and the rate-limit ' +
      'values (cms/config/middlewares.ts, cms/src/middlewares/rate-limit.ts) are asserted ' +
      'nowhere; both are security-relevant. Documented here, not closed here.',
    paths: ['cms/**'],
    specs: [],
  },
];

/**
 * Areas allowed to resolve to no test at all. Adding to this needs a reviewer:
 * it is the list of places where "the diff touched only this" runs nothing, and
 * a test pins it exactly so that widening it cannot pass unnoticed.
 */
export const AREAS_WITHOUT_TESTS = ['cms'];

export interface TierConfig {
  areas: Area[];
  runEverything: string[];
}

export const DEFAULT_CONFIG: TierConfig = { areas: AREAS, runEverything: RUN_EVERYTHING };

export interface Selection {
  /** `all` = run the complete suite; `subset` = run only `unitTests` / `e2eSpecs`. */
  mode: 'all' | 'subset';
  /** Why `all`, one line each. Empty for `subset`. */
  reasons: string[];
  /** Matched areas. Empty for `all`. */
  areas: string[];
  /** Paths relative to website/, for `vitest run`. Empty for `all`. */
  unitTests: string[];
  /** Paths relative to website/, for `playwright test`. Empty for `all`. */
  e2eSpecs: string[];
}

/**
 * Glob to RegExp. Supports `**` (any depth), `*` and `?` (within one path
 * segment) and `{a,b}`. Everything else is literal — in particular `[`, `]`,
 * `(` and `)`, because real directory names here are `[locale]`, `[id]` and
 * `(guest)`, and treating them as character classes or groups would make those
 * paths silently match nothing.
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else {
          re += '.*';
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      braceDepth++;
      re += '(?:';
    } else if (c === '}' && braceDepth > 0) {
      braceDepth--;
      re += ')';
    } else if (c === ',' && braceDepth > 0) {
      re += '|';
    } else {
      re += c.replace(/[\\^$.|+()[\]{}]/g, '\\$&');
    }
  }
  if (braceDepth !== 0) throw new Error(`Unbalanced "{" in glob: ${glob}`);
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: string[]): string | undefined {
  return globs.find((g) => globToRegExp(g).test(path));
}

/**
 * Unit test and spec files under website/src. This is NOT all of vitest.config.ts's
 * `include`: that also takes `scripts/**\/*.test.ts`, which this deliberately
 * leaves out — `website/scripts/**` is in RUN_EVERYTHING, so a change there never
 * reaches a per-file selection, and those files are never handed to `vitest run`
 * as a subset.
 */
export function isUnitTestFile(path: string): boolean {
  return path.startsWith(`${S}/`) && /\.(test|spec)\.tsx?$/.test(path);
}

export function isSpecFile(path: string): boolean {
  return /^website\/tests\/[^/]+\.spec\.ts$/.test(path);
}

/**
 * Only characters that cannot change meaning in a shell word or a
 * Playwright/Vitest filter. `[`, `]`, `(` and `)` are allowed because real
 * route directories contain them. A test file outside this set is one we would
 * rather not hand to a command line at all, so the caller runs everything.
 */
const SAFE_PATH = /^[A-Za-z0-9._/@+()[\]-]+$/;

const allReasons = (reasons: string[]): Selection => ({
  mode: 'all',
  reasons,
  areas: [],
  unitTests: [],
  e2eSpecs: [],
});

const toWebsiteRelative = (p: string): string => p.replace(/^website\//, '');

/**
 * @param changed every path in the diff, INCLUDING deleted files (a deleted
 *   module still says which area to re-test) and both sides of a rename.
 * @param files every tracked file in the repo, repo-relative. Selected tests
 *   are resolved against this, so a deleted test is never handed to a runner
 *   that would fail with "No test files found".
 */
export function selectTests(
  changed: string[],
  files: string[],
  config: TierConfig = DEFAULT_CONFIG,
): Selection {
  const paths = [...new Set(changed.map((p) => p.trim().replace(/^\.\//, '')).filter(Boolean))];

  if (paths.length === 0) {
    return allReasons(['empty diff: cannot tell what changed, so nothing is ruled out']);
  }

  // 1. The run-everything set is evaluated first and is absolute.
  const escapes = paths.flatMap((p) => {
    const hit = matchesAny(p, config.runEverything);
    return hit ? [`${p} (shared: ${hit})`] : [];
  });
  if (escapes.length > 0) return allReasons(escapes);

  // 2. Fail open: a path no area claims selects everything.
  const knownSpecs = new Set(config.areas.flatMap((a) => a.specs));
  const areaGlobs = (a: Area) => a.paths.map(globToRegExp);
  const matchers = config.areas.map((a) => ({ area: a, res: areaGlobs(a) }));

  const matched = new Set<Area>();
  const selectedSpecs = new Set<string>();
  const unmapped: string[] = [];
  for (const p of paths) {
    const hits = matchers.filter(({ res }) => res.some((re) => re.test(p)));
    if (hits.length > 0) {
      for (const { area } of hits) matched.add(area);
    } else if (knownSpecs.has(p)) {
      // A spec edited directly runs itself. Only if some area names it.
      selectedSpecs.add(p);
    } else {
      unmapped.push(`${p} (matches no area)`);
    }
  }
  if (unmapped.length > 0) return allReasons(unmapped);

  // 3. Union of the matched areas, resolved against what actually exists.
  const fileSet = new Set(files);
  const unit = new Set<string>();
  for (const area of matched) {
    const res = areaGlobs(area);
    for (const f of files) {
      if (isUnitTestFile(f) && res.some((re) => re.test(f))) unit.add(f);
    }
    for (const s of area.specs) selectedSpecs.add(s);
  }
  const specs = [...selectedSpecs].filter((s) => fileSet.has(s));

  const unsafe = [...unit, ...specs].filter((p) => !SAFE_PATH.test(p));
  if (unsafe.length > 0) {
    return allReasons(unsafe.map((p) => `${p} (path is not safe to pass to a test runner)`));
  }

  return {
    mode: 'subset',
    reasons: [],
    areas: [...matched].map((a) => a.name).sort(),
    unitTests: [...unit].sort().map(toWebsiteRelative),
    e2eSpecs: specs.sort().map(toWebsiteRelative),
  };
}

/**
 * The job-output form. Kept here, not in the CLI, so it is unit-tested:
 * `run_unit` / `run_e2e` are what the workflow's `if:` lines key off, and a
 * wrong value there is another way for tests to silently not run.
 */
export function toOutputs(s: Selection): Record<string, string> {
  const all = s.mode === 'all';
  return {
    mode: s.mode,
    areas: s.areas.join(','),
    run_unit: String(all || s.unitTests.length > 0),
    run_e2e: String(all || s.e2eSpecs.length > 0),
    // Space-separated on one line. Safe: selectTests rejects any path that is
    // not in SAFE_PATH, so no entry contains whitespace or shell syntax.
    unit_files: s.unitTests.join(' '),
    e2e_files: s.e2eSpecs.join(' '),
  };
}
