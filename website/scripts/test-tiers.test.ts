/**
 * Tests for the smoke tier's test selection (scripts/test-tiers.ts).
 *
 * A selection bug does not go red — it makes tests quietly not run, which is
 * the same failure as a vacuous assertion at larger scale. So these tests are
 * written to fail on the *absence* of a test from a selection: each one names
 * the tests that must be present, rather than checking that some selection was
 * produced.
 *
 * Two kinds of test, deliberately:
 *   - rule tests run against a small synthetic map, so they pin the rules
 *     (precedence, fail-open, empty diff) independent of what the real map
 *     happens to contain today;
 *   - map tests run against the real map and the real `git ls-files`, so they
 *     fail when the map rots (a renamed directory, a new spec no area names).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AREAS,
  AREAS_WITHOUT_TESTS,
  RUN_EVERYTHING,
  globToRegExp,
  isSpecFile,
  isUnitTestFile,
  matchesAny,
  selectTests,
  toOutputs,
  type Area,
  type TierConfig,
} from './test-tiers';

const websiteDir = path.resolve(__dirname, '..');
const repoRoot = path
  .resolve(execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: websiteDir, encoding: 'utf8' }).trim());
const tracked = execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const S = 'website/src';
const unitTestsOnDisk = tracked.filter(isUnitTestFile);
const specsOnDisk = tracked.filter(isSpecFile);
// What `selectTests` reports is relative to website/, which is where the
// runners are invoked from.
const rel = (p: string) => p.replace(/^website\//, '');
const select = (changed: string[]) => selectTests(changed, tracked);

describe('glob matching', () => {
  it('treats [locale], [id] and (guest) as literal directory names, not classes or groups', () => {
    const re = globToRegExp(`${S}/app/[locale]/(guest)/**`);
    expect(re.test(`${S}/app/[locale]/(guest)/practice/page.tsx`)).toBe(true);
    // As a character class, [locale] would match a directory named "l".
    expect(re.test(`${S}/app/l/(guest)/practice/page.tsx`)).toBe(false);
    expect(globToRegExp(`${S}/app/api/essays/[id]/grading/**`).test(`${S}/app/api/essays/[id]/grading/route.ts`)).toBe(true);
  });

  it('`*` stays inside one path segment; `**` crosses them', () => {
    expect(globToRegExp('a/*.ts').test('a/b.ts')).toBe(true);
    expect(globToRegExp('a/*.ts').test('a/b/c.ts')).toBe(false);
    expect(globToRegExp('a/**').test('a/b/c/d.ts')).toBe(true);
    expect(globToRegExp('a/**/d.ts').test('a/d.ts')).toBe(true);
    expect(globToRegExp('a/**/d.ts').test('a/b/c/d.ts')).toBe(true);
  });

  it('expands {x,y} and lets a trailing * follow it', () => {
    const re = globToRegExp('lib/{login,password}*');
    expect(re.test('lib/login.ts')).toBe(true);
    expect(re.test('lib/password.test.ts')).toBe(true);
    expect(re.test('lib/logout.ts')).toBe(false);
  });

  it('anchors: a pattern does not match a longer path that merely contains it', () => {
    expect(globToRegExp('website/src/middleware.ts').test('website/src/middleware.ts.bak')).toBe(false);
    expect(globToRegExp('src/a.ts').test('website/src/a.ts')).toBe(false);
  });
});

// --- The rules, against a synthetic map ------------------------------------

const area = (name: string, paths: string[], specs: string[] = []): Area => ({ name, paths, specs, note: '' });
const synth: TierConfig = {
  runEverything: ['x/shared/**', 'x/cfg.json'],
  areas: [
    // `x/shared/**` is ALSO claimed by area `a`, to exercise precedence.
    area('a', ['x/a/**', 'x/shared/**'], ['website/tests/a.spec.ts']),
    area('b', ['x/b/**'], ['website/tests/b.spec.ts']),
    area('none', ['x/none/**']),
  ],
};
const synthFiles = [
  'x/a/one.ts',
  'website/src/a1.test.ts',
  'website/tests/a.spec.ts',
  'website/tests/b.spec.ts',
];

describe('selection rules (synthetic map)', () => {
  it('a path that matches no area selects everything, not nothing', () => {
    const s = selectTests(['x/unheard-of/new.ts'], synthFiles, synth);
    expect(s.mode).toBe('all');
    expect(s.reasons.join('\n')).toContain('x/unheard-of/new.ts');
  });

  it('one unmatched path among many matched ones still selects everything', () => {
    expect(selectTests(['x/a/one.ts', 'x/b/two.ts', 'x/stray.md'], synthFiles, synth).mode).toBe('all');
  });

  it('a run-everything path selects everything even though an area also claims it', () => {
    const s = selectTests(['x/shared/file.ts'], synthFiles, synth);
    expect(s.mode).toBe('all');
    expect(s.reasons.join('\n')).toContain('x/shared/**');
  });

  it('precedence does not depend on the order of the diff', () => {
    expect(selectTests(['x/a/one.ts', 'x/cfg.json'], synthFiles, synth).mode).toBe('all');
    expect(selectTests(['x/cfg.json', 'x/a/one.ts'], synthFiles, synth).mode).toBe('all');
  });

  it('an area selects its own spec, and only the specs of areas the diff touched', () => {
    const s = selectTests(['x/a/one.ts'], synthFiles, synth);
    expect(s).toMatchObject({ mode: 'subset', areas: ['a'], e2eSpecs: ['tests/a.spec.ts'] });
  });

  it('unions the areas a diff touches', () => {
    const s = selectTests(['x/a/one.ts', 'x/b/two.ts'], synthFiles, synth);
    expect(s.areas).toEqual(['a', 'b']);
    expect(s.e2eSpecs).toEqual(['tests/a.spec.ts', 'tests/b.spec.ts']);
  });

  it('an empty diff selects everything: nothing changed is the least likely explanation', () => {
    for (const changed of [[], [''], ['\n'], ['  ']]) {
      const s = selectTests(changed, synthFiles, synth);
      expect(s.mode).toBe('all');
      expect(s.reasons[0]).toMatch(/empty diff/);
    }
  });

  it('a deleted file still selects its area, and is never itself handed to a runner', () => {
    const s = selectTests(['x/a/gone.test.ts'], synthFiles, synth);
    expect(s.mode).toBe('subset');
    expect(s.areas).toEqual(['a']);
    expect(s.unitTests.join(' ')).not.toContain('gone');
  });

  it('a diff of only deleted files that no area claims still selects everything', () => {
    expect(selectTests(['x/gone/entirely.ts'], synthFiles, synth).mode).toBe('all');
  });

  it('a spec edited directly runs itself, and only itself', () => {
    const s = selectTests(['website/tests/b.spec.ts'], synthFiles, synth);
    expect(s).toMatchObject({ mode: 'subset', unitTests: [], e2eSpecs: ['tests/b.spec.ts'] });
  });

  it('a spec no area names is unmapped, so it selects everything', () => {
    expect(selectTests(['website/tests/c.spec.ts'], synthFiles, synth).mode).toBe('all');
  });

  it('selects everything rather than hand a runner a path with shell syntax in it', () => {
    const files = [...synthFiles, 'website/src/a$(evil).test.ts'];
    const cfg: TierConfig = { ...synth, areas: [area('a', ['website/src/**'])] };
    const s = selectTests(['website/src/x.ts'], files, cfg);
    expect(s.mode).toBe('all');
    expect(s.reasons.join('\n')).toContain('not safe');
  });

  it('normalises a leading ./ and duplicates', () => {
    expect(selectTests(['./x/a/one.ts', 'x/a/one.ts'], synthFiles, synth).areas).toEqual(['a']);
  });
});

// --- Job outputs -------------------------------------------------------------

describe('toOutputs', () => {
  it('everything: both run flags true, no file lists', () => {
    expect(toOutputs(select([]))).toMatchObject({ mode: 'all', run_unit: 'true', run_e2e: 'true', unit_files: '', e2e_files: '' });
  });

  it('a subset with no unit tests does not claim to run unit tests, and vice versa', () => {
    const specOnly = toOutputs({ mode: 'subset', reasons: [], areas: ['a'], unitTests: [], e2eSpecs: ['tests/a.spec.ts'] });
    expect(specOnly).toMatchObject({ run_unit: 'false', run_e2e: 'true', e2e_files: 'tests/a.spec.ts' });
    const unitOnly = toOutputs({ mode: 'subset', reasons: [], areas: ['a'], unitTests: ['src/a.test.ts', 'src/b.test.ts'], e2eSpecs: [] });
    expect(unitOnly).toMatchObject({ run_unit: 'true', run_e2e: 'false', unit_files: 'src/a.test.ts src/b.test.ts' });
  });

  it('cms only: a subset that runs nothing, and says so', () => {
    expect(toOutputs(select(['cms/src/index.ts']))).toMatchObject({
      mode: 'subset',
      areas: 'cms',
      run_unit: 'false',
      run_e2e: 'false',
    });
  });
});

// --- The real map --------------------------------------------------------------

describe('the real map: paths the first version of it dropped on the floor', () => {
  // Reviewers enumerated 135-138 tracked files matching no area. These are the
  // ones they named. Each must now either select everything or select the
  // file's own tests — never nothing.
  const named: Array<[string, string[]]> = [
    [`${S}/lib/domain/rate-limit.ts`, [`${S}/lib/domain/rate-limit.test.ts`, `${S}/lib/domain/rate-limit-auth.test.ts`]],
    [`${S}/lib/same-origin.ts`, [`${S}/lib/same-origin.test.ts`]],
    [`${S}/lib/client-ip.ts`, [`${S}/lib/client-ip.test.ts`]],
    [`${S}/lib/domain/essay-submission.ts`, [`${S}/lib/domain/essay-submission.test.ts`]],
    [`${S}/app/api/guest-session/route.ts`, [`${S}/app/api/guest-session/route.test.ts`]],
    [`${S}/app/api/internal/grading-jobs/process/route.ts`, [`${S}/app/api/internal/grading-jobs/process/route.test.ts`]],
    [`${S}/hooks/use-grading-status.ts`, [`${S}/hooks/use-grading-status.test.ts`]],
    [`${S}/hooks/use-pending-elapsed.ts`, [`${S}/hooks/use-pending-elapsed.test.ts`]],
  ];
  it.each(named)('%s selects its own suite(s)', (file, tests) => {
    const s = select([file]);
    expect(s.mode).toBe('subset');
    for (const t of tests) expect(s.unitTests).toContain(rel(t));
  });

  // Asserts the REASON, not just `all`: a path no area claims would select
  // everything anyway, via the catch-all, so `mode` alone cannot tell whether
  // the run-everything entry is still there.
  it.each([
    `${S}/test/setup.ts`,
    `${S}/test/db-fixtures.ts`,
    `${S}/test/renderWithIntl.tsx`,
    'website/tests/helpers/essay-fill.ts',
    'website/tests/helpers/routes.ts',
    'website/vitest.config.ts',
    'website/playwright.config.ts',
    'website/package.json',
    '.github/workflows/ci.yml',
    '.github/workflows/deploy-website.yml',
    'website/scripts/test-tiers.ts',
  ])('%s selects everything, as a shared file', (file) => {
    const s = select([file]);
    expect(s.mode).toBe('all');
    expect(s.reasons.join('\n')).toContain('shared:');
  });

  it('IntlProvider, sitemap.ts and robots.ts land in an area, with their specs', () => {
    expect(select([`${S}/components/IntlProvider.tsx`]).e2eSpecs).toContain('tests/guest-flow-i18n.spec.ts');
    expect(select([`${S}/app/sitemap.ts`]).e2eSpecs).toContain('tests/sitemap.spec.ts');
    expect(select([`${S}/app/robots.ts`]).e2eSpecs).toContain('tests/sitemap.spec.ts');
  });

  it.each(['website/src/brand-new-area/thing.ts', 'website/README.md', 'CLAUDE.md', '.claude/agents/test-lead.md', 'website/.env.example', 'website/Dockerfile'])(
    '%s is in no area, so it selects everything',
    (file) => {
      const s = select([file]);
      expect(s.mode).toBe('all');
      expect(s.reasons.join('\n')).toContain('matches no area');
    },
  );

  it('measured: how many tracked files fall through to "everything" now', () => {
    const fallThrough = tracked.filter((f) => select([f]).mode === 'all');
    const viaEscape = tracked.filter((f) => matchesAny(f, RUN_EVERYTHING));
    // Not an assertion about the number being small — a large number is safe,
    // just slow. It is here so a change that makes the map far less specific
    // shows up as a failing diff, not a quiet slowdown. `components/ui` alone is 49.
    expect(tracked.length).toBeGreaterThan(fallThrough.length);
    expect(fallThrough.length).toBeGreaterThanOrEqual(viaEscape.length);
    expect(fallThrough.length).toBeLessThan(tracked.length * 0.6);
  });
});

describe('the real map: run-everything set', () => {
  it.each([
    [`${S}/lib/contracts/grading.ts`, 'lib/contracts/**'],
    [`${S}/lib/contracts/grading-job.ts`, 'lib/contracts/**'],
    [`${S}/lib/contracts/grading.test.ts`, 'lib/contracts/**'],
    [`${S}/lib/db/schema.ts`, 'schema.ts'],
    [`${S}/middleware.ts`, 'middleware.ts'],
  ])('%s selects everything, naming why', (file, why) => {
    const s = select([file]);
    expect(s.mode).toBe('all');
    expect(s.reasons.join('\n')).toContain(why);
  });

  it('wins over an area when a diff carries both', () => {
    const s = select([`${S}/lib/domain/essay-submission.ts`, `${S}/lib/db/schema.ts`]);
    expect(s.mode).toBe('all');
  });

  it('includes every migration', () => {
    for (const f of tracked.filter((t) => t.startsWith('website/drizzle/'))) {
      expect(select([f]).mode).toBe('all');
    }
  });
});

// A representative, non-shared file per area.
const TRIGGER: Record<string, string> = {
  'guest-funnel': `${S}/components/guest/EssayEntryForm.tsx`,
  grading: `${S}/lib/domain/grading/orchestrate-grading.ts`,
  auth: `${S}/lib/domain/login.ts`,
  'api-edge': `${S}/lib/same-origin.ts`,
  data: `${S}/lib/db/essays.ts`,
  i18n: `${S}/i18n/request.ts`,
  marketing: `${S}/page-components/About.tsx`,
  'placement-test': `${S}/components/placement-test/steps/ExamStep.tsx`,
  shell: `${S}/components/layout/Header.tsx`,
  cms: 'cms/src/index.ts',
  };


describe('the real map: each area selects its own unit tests and its own specs', () => {
  // Literal, not derived from AREAS: if someone empties an area's `specs`, a
  // derived expectation would shrink with it and the test would still pass.
  const expectedSpecs: Record<string, string[]> = {
    'guest-funnel': ['essay-entry', 'word-count', 'grading-preview', 'guest-flow', 'guest-flow-i18n', 'guest-session'],
    grading: ['grading-preview', 'essay-entry'],
    auth: ['guest-session'],
    'api-edge': ['essay-entry', 'guest-session'],
    data: ['essay-entry', 'guest-session'],
    i18n: ['guest-flow-i18n', 'guest-flow', 'essay-entry'],
    marketing: ['blog', 'contact-form', 'navigation', 'no-console-errors', 'redirects', 'routing', 'seo', 'sitemap'],
    'placement-test': ['placement-test', 'no-console-errors'],
    shell: ['navigation', 'no-console-errors', 'guest-flow'],
    cms: [],
  };

  it('the expectation table covers every area, no more and no fewer', () => {
    expect(Object.keys(expectedSpecs).sort()).toEqual(AREAS.map((a) => a.name).sort());
  });

  it.each(Object.keys(expectedSpecs))('%s', (name) => {
    const s = select([TRIGGER[name]]);
    expect(s.mode).toBe('subset');
    expect(s.areas).toContain(name);
    for (const spec of expectedSpecs[name]) expect(s.e2eSpecs).toContain(`tests/${spec}.spec.ts`);

    // Its own co-located unit tests, resolved from disk rather than listed.
    const own = AREAS.find((a) => a.name === name)!;
    const res = own.paths.map(globToRegExp);
    for (const t of unitTestsOnDisk.filter((f) => res.some((re) => re.test(f)))) {
      expect(s.unitTests).toContain(rel(t));
    }
  });

  it('deleting a module and its tests selects the area\'s surviving tests, and hands the runner no deleted file', () => {
    const deleted = [`${S}/lib/domain/rate-limit.ts`, `${S}/lib/domain/rate-limit.test.ts`, `${S}/lib/domain/rate-limit-auth.test.ts`];
    const surviving = tracked.filter((f) => !deleted.includes(f));
    const s = selectTests(deleted, surviving);
    expect(s.mode).toBe('subset');
    expect(s.areas).toContain('api-edge');
    // A deleted test is gone from the tree; `vitest run <gone>` would exit 1
    // with "No test files found".
    for (const d of deleted) expect(s.unitTests).not.toContain(rel(d));
    expect(s.unitTests).toContain(rel(`${S}/lib/same-origin.test.ts`));
  });

  it('a diff of only deleted files that no area claims still selects everything', () => {
    const s = selectTests(['website/src/lib/long-gone.ts'], tracked);
    expect(s.mode).toBe('all');
  });

  it('a change to a spec does not drag in unrelated unit tests', () => {
    const s = select(['website/tests/seo.spec.ts']);
    expect(s).toMatchObject({ mode: 'subset', unitTests: [], e2eSpecs: ['tests/seo.spec.ts'] });
  });

  it.each([
    ['cms/src/index.ts'],
    ['cms/config/database.ts'],
    ['cms/package.json'],
  ])('%s selects no website test, on purpose', (file) => {
    // ci.yml excludes every @cms spec and has no CMS to run them against, so
    // nothing in the website suite can observe cms/**. The `cms` job builds it
    // on every event regardless of tier.
    expect(select([file])).toMatchObject({ mode: 'subset', areas: ['cms'], unitTests: [], e2eSpecs: [] });
  });

  it('cms plus a website file selects that file\'s area and nothing extra', () => {
    const s = select(['cms/src/index.ts', `${S}/app/sitemap.ts`]);
    expect(s.areas).toEqual(['cms', 'marketing']);
    expect(s.e2eSpecs).toContain('tests/sitemap.spec.ts');
  });
});

// The api-edge area exists so that a change to a guard every handler calls
// re-runs every handler's test. That property is asserted nowhere else: each
// route file is also claimed by `auth`, `grading` or `guest-funnel`, so deleting
// api-edge's `app/api/**` glob leaves "a module selects its own co-located test"
// green while a guard change silently stops running eight route suites (measured:
// same-origin.ts went from 13 unit files to 5). Literal, not derived from AREAS,
// or the expectation would shrink with the mutation.
describe('the real map: a change to a shared request guard runs every route handler suite', () => {
  const routeSuites = [
    'src/app/api/auth/login/route.test.ts',
    'src/app/api/auth/logout/route.test.ts',
    'src/app/api/auth/register/route.test.ts',
    'src/app/api/auth/methods.test.ts',
    'src/app/api/essays/[id]/grading/route.test.ts',
    'src/app/api/essays/route.test.ts',
    'src/app/api/guest-session/route.test.ts',
    'src/app/api/internal/grading-jobs/process/route.test.ts',
  ];
  const guards = ['same-origin.ts', 'client-ip.ts', 'request-body.ts', 'rejection-response.ts'];

  it('the eight route suites it names exist', () => {
    expect(routeSuites.filter((t) => !tracked.includes(`website/${t}`))).toEqual([]);
  });

  it.each(guards)('%s selects all eight route test files', (guard) => {
    const s = select([`${S}/lib/${guard}`]);
    expect(s.mode).toBe('subset');
    expect(s.areas).toContain('api-edge');
    for (const t of routeSuites) expect(s.unitTests, t).toContain(t);
  });
});

describe('the real map: nothing is orphaned (this is what fails when the map rots)', () => {
  it('every spec under website/tests is named by at least one area', () => {
    const named = new Set(AREAS.flatMap((a) => a.specs));
    expect(specsOnDisk.length).toBeGreaterThanOrEqual(15);
    expect(specsOnDisk.filter((s) => !named.has(s))).toEqual([]);
  });

  it('every spec an area names exists', () => {
    const missing = AREAS.flatMap((a) => a.specs.filter((s) => !tracked.includes(s)).map((s) => `${a.name}: ${s}`));
    expect(missing).toEqual([]);
  });

  it('every unit test file is reachable: in an area, or under the run-everything set', () => {
    const orphans = unitTestsOnDisk.filter(
      (f) => !matchesAny(f, RUN_EVERYTHING) && !AREAS.some((a) => matchesAny(f, a.paths)),
    );
    expect(orphans).toEqual([]);
  });

  it('every glob in the map matches at least one tracked file (no dead or mistyped patterns)', () => {
    const dead = [
      ...RUN_EVERYTHING.map((g) => ['run-everything', g] as const),
      ...AREAS.flatMap((a) => a.paths.map((g) => [a.name, g] as const)),
    ].filter(([, g]) => !tracked.some((f) => globToRegExp(g).test(f)));
    expect(dead).toEqual([]);
  });

  // Literal: widening this list is how an area quietly becomes one that selects
  // nothing. A reviewer should have to read the line that changes.
  it('the areas allowed to select no test are exactly the cms', () => {
    expect(AREAS_WITHOUT_TESTS).toEqual(['cms']);
  });

  it('every area except the named exceptions selects at least one test', () => {
    for (const a of AREAS.filter((x) => !AREAS_WITHOUT_TESTS.includes(x.name))) {
      const res = a.paths.map(globToRegExp);
      const units = unitTestsOnDisk.filter((f) => res.some((re) => re.test(f)));
      expect(units.length + a.specs.length, a.name).toBeGreaterThan(0);
    }
  });

  it('editing any unit test file selects that file (or everything)', () => {
    for (const f of unitTestsOnDisk) {
      const s = select([f]);
      expect(s.mode === 'all' || s.unitTests.includes(rel(f)), f).toBe(true);
    }
  });

  it('editing any spec selects that spec (or everything)', () => {
    for (const f of specsOnDisk) {
      const s = select([f]);
      expect(s.mode === 'all' || s.e2eSpecs.includes(rel(f)), f).toBe(true);
    }
  });

  it('editing a module always selects its own co-located test (or everything)', () => {
    const missed: string[] = [];
    for (const test of unitTestsOnDisk) {
      const base = test.replace(/\.(test|spec)\.tsx?$/, '');
      for (const src of tracked.filter((f) => f.startsWith(`${base}.`) && !isUnitTestFile(f) && !/\.typecheck\./.test(f))) {
        const s = select([src]);
        if (s.mode === 'subset' && !s.unitTests.includes(rel(test))) missed.push(`${src} -> ${test}`);
      }
    }
    expect(missed).toEqual([]);
  });

  it('no file under website/src selects a subset with no area in it', () => {
    // The fail-open rule, over the real tree: a file either matches an area or
    // selects everything. "Subset of nothing" would be tests silently not running.
    for (const f of tracked.filter((t) => t.startsWith(`${S}/`))) {
      const s = select([f]);
      expect(s.mode === 'all' || s.areas.length > 0, f).toBe(true);
    }
  });
});

describe('the runners select exactly what the map says', () => {
  // Vitest treats each CLI argument as a substring of the absolute test path;
  // Playwright treats each as a regular expression over it. A selection is only
  // as good as what the runner makes of it.
  const abs = (p: string) => path.join(repoRoot, p);

  it('vitest filters match the selected unit tests and no others', () => {
    for (const f of [`${S}/lib/db/sessions.ts`, `${S}/lib/domain/rate-limit.ts`, `${S}/app/api/essays/route.ts`, `${S}/hooks/use-mobile.tsx`]) {
      const s = select([f]);
      const matchedByRunner = unitTestsOnDisk.filter((t) => s.unitTests.some((filter) => abs(t).includes(filter)));
      expect(matchedByRunner.map(rel).sort(), f).toEqual(s.unitTests);
    }
  });

  it('playwright filters match the selected specs and no others', () => {
    for (const [name, file] of Object.entries(TRIGGER)) {
      const s = select([file]);
      const matchedByRunner = specsOnDisk.filter((t) => s.e2eSpecs.some((filter) => new RegExp(filter).test(abs(t))));
      expect(matchedByRunner.map(rel).sort(), name).toEqual(s.e2eSpecs);
    }
    // The pairs that share a prefix are the ones a loose regex would confuse.
    const s = select(['website/tests/guest-flow.spec.ts']);
    expect(specsOnDisk.filter((t) => s.e2eSpecs.some((f) => new RegExp(f).test(abs(t)))).map(rel)).toEqual(['tests/guest-flow.spec.ts']);
  });
});

// --- The docs describe what the code does ----------------------------------------

describe('CLAUDE.md agrees with the map', () => {
  // The first version of this section described a pipeline that did not exist.
  // The prose is allowed to be shorter than the map, not to contradict it.
  const doc = readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');

  it('lists every run-everything glob, in full repo-relative form', () => {
    expect(RUN_EVERYTHING.filter((g) => !doc.includes(`\`${g}\``))).toEqual([]);
  });

  it('has a row for every area, naming every spec that area runs', () => {
    for (const a of AREAS) {
      const row = doc.split('\n').find((l) => l.startsWith(`| \`${a.name}\` |`));
      expect(row, `no row for area ${a.name}`).toBeDefined();
      for (const spec of a.specs) {
        expect(row, `${a.name} row is missing ${spec}`).toContain(path.basename(spec, '.spec.ts'));
      }
    }
  });
});

// --- Real diffs ------------------------------------------------------------------

// `git show --name-status --no-renames` for each merged story, frozen here so
// the test does not depend on history being present (CI checks out shallow).
// The point of each: the bugs that story had to fix were caught by specific
// tests, and the selection for its diff must contain them.
const HISTORY: Record<string, string[]> = {
  'KAN-17 (bf021e6)': [
    'website/src/app/[locale]/(guest)/practice/preview/page.tsx',
    'website/src/app/api/essays/[id]/grading/route.test.ts',
    'website/src/components/guest/GradingPreview.test.tsx',
    'website/src/components/guest/GradingPreview.tsx',
    'website/src/components/guest/PendingProgress.tsx',
    'website/src/hooks/use-grading-status.test.ts',
    'website/src/hooks/use-grading-status.ts',
    'website/src/hooks/use-pending-elapsed.test.ts',
    'website/src/hooks/use-pending-elapsed.ts',
    'website/src/messages/de.json',
    'website/src/messages/en.json',
    'website/tests/grading-preview.spec.ts',
  ],
  'KAN-20 (fb217e2)': [
    'website/.env.example',
    'website/drizzle/0005_kan20_registration.sql',
    'website/drizzle/meta/0005_snapshot.json',
    'website/drizzle/meta/_journal.json',
    'website/eslint.config.js',
    'website/src/app/api/auth/login/route.test.ts',
    'website/src/app/api/auth/login/route.ts',
    'website/src/app/api/auth/logout/route.test.ts',
    'website/src/app/api/auth/logout/route.ts',
    'website/src/app/api/auth/methods.test.ts',
    'website/src/app/api/auth/register/route.test.ts',
    'website/src/app/api/auth/register/route.ts',
    'website/src/components/guest/EssayEntryForm.tsx',
    'website/src/lib/contracts/actor.ts',
    'website/src/lib/contracts/auth.test.ts',
    'website/src/lib/contracts/auth.ts',
    'website/src/lib/contracts/consent.test.ts',
    'website/src/lib/contracts/consent.ts',
    'website/src/lib/contracts/rejection-reason.test.ts',
    'website/src/lib/contracts/rejection-reason.ts',
    'website/src/lib/contracts/session-policy.ts',
    'website/src/lib/db/actor.typecheck.ts',
    'website/src/lib/db/client.ts',
    'website/src/lib/db/consent-records.test.ts',
    'website/src/lib/db/consent-records.ts',
    'website/src/lib/db/guest-sessions.test.ts',
    'website/src/lib/db/guest-sessions.ts',
    'website/src/lib/db/ownership.test.ts',
    'website/src/lib/db/schema.ts',
    'website/src/lib/db/sessions.test.ts',
    'website/src/lib/db/sessions.ts',
    'website/src/lib/db/users.test.ts',
    'website/src/lib/db/users.ts',
    'website/src/lib/domain/login.test.ts',
    'website/src/lib/domain/login.ts',
    'website/src/lib/domain/owner-actor.ts',
    'website/src/lib/domain/password.test.ts',
    'website/src/lib/domain/password.ts',
    'website/src/lib/domain/rate-limit-auth.test.ts',
    'website/src/lib/domain/rate-limit.ts',
    'website/src/lib/domain/registered-session-token.test.ts',
    'website/src/lib/domain/registered-session-token.ts',
    'website/src/lib/domain/registered-session.test.ts',
    'website/src/lib/domain/registered-session.ts',
    'website/src/lib/domain/registration.test.ts',
    'website/src/lib/domain/registration.ts',
    'website/src/lib/registered-session-cookie.test.ts',
    'website/src/lib/registered-session-cookie.ts',
    'website/src/lib/request-body.ts',
    'website/src/test/auth-fixtures.ts',
    'website/src/test/auth-requests.ts',
    'website/src/test/db-fixtures.ts',
  ],
  'KAN-41 (04a00da)': [
    'website/src/lib/domain/guest-session.test.ts',
    'website/src/lib/domain/guest-session.ts',
  ],
  'KAN-43 (7ad5532)': ['website/src/lib/db/client-pool-error.test.ts', 'website/src/lib/db/client.ts'],
  'KAN-52 (aa58e70)': [
    'CONTRIBUTING.md',
    'website/docs/kan-24-grading-telemetry.md',
    'website/drizzle.config.ts',
    'website/drizzle/0006_kan52_essay_owner_actor.sql',
    'website/drizzle/meta/0006_snapshot.json',
    'website/drizzle/meta/_journal.json',
    'website/eslint.config.js',
    'website/scripts/migrate.ts',
    'website/src/app/api/auth/login/route.test.ts',
    'website/src/app/api/auth/login/route.ts',
    'website/src/app/api/auth/logout/route.test.ts',
    'website/src/app/api/auth/register/route.test.ts',
    'website/src/app/api/essays/[id]/grading/route.test.ts',
    'website/src/app/api/essays/route.test.ts',
    'website/src/app/api/essays/route.ts',
    'website/src/app/api/guest-session/route.test.ts',
    'website/src/app/api/guest-session/route.ts',
    'website/src/components/guest/GuestSessionBootstrap.tsx',
    'website/src/lib/contracts/essay.ts',
    'website/src/lib/db/essay-owner-constraint.test.ts',
    'website/src/lib/db/essays.test.ts',
    'website/src/lib/db/essays.ts',
    'website/src/lib/db/guest-sessions.test.ts',
    'website/src/lib/db/guest-sessions.ts',
    'website/src/lib/db/migration-0006-essay-owner.test.ts',
    'website/src/lib/db/ownership.test.ts',
    'website/src/lib/db/ownership.ts',
    'website/src/lib/db/ownership.typecheck.ts',
    'website/src/lib/db/schema.ts',
    'website/src/lib/db/sessions.test.ts',
    'website/src/lib/db/sessions.ts',
    'website/src/lib/db/users.test.ts',
    'website/src/lib/db/users.ts',
    'website/src/lib/domain/essay-submission-telemetry.test.ts',
    'website/src/lib/domain/essay-submission-telemetry.ts',
    'website/src/lib/domain/essay-submission.test.ts',
    'website/src/lib/domain/essay-submission.ts',
    'website/src/lib/domain/grading/orchestrate-grading.test.ts',
    'website/src/lib/domain/grading/start-grading.ts',
    'website/src/lib/domain/grading/telemetry.ts',
    'website/src/lib/domain/login.test.ts',
    'website/src/lib/domain/login.ts',
    'website/src/lib/domain/ownership.typecheck.ts',
    'website/src/lib/domain/rate-limit.test.ts',
    'website/src/lib/domain/rate-limit.ts',
    'website/src/lib/domain/registered-session.test.ts',
    'website/src/lib/request-body.ts',
    'website/src/test/db-fixtures.ts',
  ],
};

describe('real diffs, walked through the real map', () => {
  it('KAN-17: its dedicated hooks suites and its only e2e are selected (they were all orphaned before)', () => {
    const s = select(HISTORY['KAN-17 (bf021e6)']);
    expect(s.mode).toBe('subset');
    for (const t of [
      `${S}/hooks/use-pending-elapsed.test.ts`,
      `${S}/hooks/use-grading-status.test.ts`,
      `${S}/components/guest/GradingPreview.test.tsx`,
      `${S}/app/api/essays/[id]/grading/route.test.ts`,
    ]) {
      expect(s.unitTests).toContain(rel(t));
    }
    expect(s.e2eSpecs).toContain('tests/grading-preview.spec.ts');
  });

  it('KAN-41: the guest-session domain suite, its route, its db layer and its e2e', () => {
    const s = select(HISTORY['KAN-41 (04a00da)']);
    expect(s.mode).toBe('subset');
    for (const t of [`${S}/lib/domain/guest-session.test.ts`, `${S}/app/api/guest-session/route.test.ts`, `${S}/lib/db/guest-sessions.test.ts`]) {
      expect(s.unitTests).toContain(rel(t));
    }
    expect(s.e2eSpecs).toContain('tests/guest-session.spec.ts');
  });

  it('KAN-43: the pool-error suite, and the e2e that go through the real database', () => {
    const s = select(HISTORY['KAN-43 (7ad5532)']);
    expect(s.mode).toBe('subset');
    expect(s.unitTests).toContain(rel(`${S}/lib/db/client-pool-error.test.ts`));
    expect(s.e2eSpecs).toEqual(expect.arrayContaining(['tests/essay-entry.spec.ts', 'tests/guest-session.spec.ts']));
  });

  it('KAN-20 and KAN-52 touch schema.ts and the migrations, so they select everything', () => {
    for (const k of ['KAN-20 (fb217e2)', 'KAN-52 (aa58e70)']) {
      const s = select(HISTORY[k]);
      expect(s.mode, k).toBe('all');
      expect(s.reasons.join('\n'), k).toContain('schema.ts');
      expect(s.reasons.join('\n'), k).toContain('drizzle');
    }
  });

  // The run-everything set would mask a hole in the areas for those two big
  // diffs, so also walk them with the shared files removed: the areas alone
  // must still cover every test the story itself added or changed.
  it.each(['KAN-20 (fb217e2)', 'KAN-52 (aa58e70)'])('%s, shared files removed: the areas alone still select the story\'s own tests', (k) => {
    const areaLevel = HISTORY[k].filter((p) => p.startsWith(`${S}/`) && !matchesAny(p, RUN_EVERYTHING));
    const s = select(areaLevel);
    expect(s.mode).toBe('subset');
    const ownTests = HISTORY[k].filter((p) => isUnitTestFile(p) && tracked.includes(p) && !matchesAny(p, RUN_EVERYTHING));
    expect(ownTests.length).toBeGreaterThan(10);
    expect(ownTests.filter((t) => !s.unitTests.includes(rel(t)))).toEqual([]);
  });

  it.each(Object.keys(HISTORY))('%s: every test file the story touched is selected', (k) => {
    const s = select(HISTORY[k]);
    if (s.mode === 'all') return;
    const touched = HISTORY[k].filter((p) => isUnitTestFile(p) && tracked.includes(p));
    expect(touched.filter((t) => !s.unitTests.includes(rel(t)))).toEqual([]);
  });
});

// --- The CLI ------------------------------------------------------------------------

describe('select-tests CLI', () => {
  const cli = path.join(websiteDir, 'scripts', 'select-tests.ts');
  // `--import tsx` resolves from the cwd, so name it by absolute URL: the rename
  // test below runs the CLI inside a throwaway repo that has no node_modules.
  const tsx = pathToFileURL(require.resolve('tsx')).href;
  const run = (args: string[], input?: string, cwd: string = websiteDir) =>
    JSON.parse(
      execFileSync(process.execPath, ['--import', tsx, cli, ...args], { cwd, input, encoding: 'utf8' })
        .split('\n\n')
        .pop()!,
    ) as Record<string, string>;

  it('reads a diff from stdin', () => {
    const out = run([], `${S}/lib/same-origin.ts\n`);
    expect(out).toMatchObject({ mode: 'subset', areas: 'api-edge', run_unit: 'true' });
    expect(out.unit_files).toContain('src/lib/same-origin.test.ts');
  });

  it('an empty stdin selects everything', () => {
    expect(run([], '')).toMatchObject({ mode: 'all', run_unit: 'true', run_e2e: 'true' });
  });

  it('a base ref that does not exist selects everything instead of failing or selecting nothing', () => {
    expect(run(['--base', 'definitely-not-a-ref-0000000'])).toMatchObject({ mode: 'all', run_e2e: 'true' });
  });

  // `--no-renames` is load-bearing and nothing else pins it. Git's default
  // rename detection reports only the NEW path, so moving a file out of an area
  // would look like a change to the destination alone and the source area's
  // specs would stop running (measured: a page-components/About.tsx move lost
  // six marketing specs). Driven through a real two-commit rename rather than by
  // reading the argv, so it fails on the behaviour and not on the spelling.
  it('a rename out of one area selects the area it left as well as the one it entered', () => {
    const repo = mkdtempSync(path.join(tmpdir(), 'select-tests-rename-'));
    try {
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
          cwd: repo,
          encoding: 'utf8',
        }).trim();
      const from = `${S}/page-components/About.tsx`;
      const to = `${S}/components/layout/About.tsx`;
      git('init', '-q', '-b', 'main');
      mkdirSync(path.join(repo, path.dirname(from)), { recursive: true });
      mkdirSync(path.join(repo, path.dirname(to)), { recursive: true });
      // Identical content, so git's similarity check detects it as a rename.
      const body = 'export const About = () => null;\n'.repeat(20);
      writeFileSync(path.join(repo, from), body);
      // Specs are resolved against tracked files, so the one we assert on must exist.
      mkdirSync(path.join(repo, 'website/tests'), { recursive: true });
      writeFileSync(path.join(repo, 'website/tests/blog.spec.ts'), '');
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD');
      git('mv', from, to);
      git('commit', '-q', '-m', 'move');
      // Precondition: git really does collapse this into a rename by default,
      // so the assertion below is about the flag and not about a lucky diff.
      expect(git('diff', '--name-only', `${base}...HEAD`).split('\n')).toEqual([to]);

      const out = run(['--base', base], undefined, repo);
      expect(out.mode).toBe('subset');
      expect(out.areas.split(',').sort()).toEqual(['marketing', 'shell']);
      // A spec only the area that was LEFT runs.
      expect(out.e2e_files).toContain('tests/blog.spec.ts');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
