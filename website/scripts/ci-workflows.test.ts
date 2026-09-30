/**
 * Guards on the CI workflow files themselves.
 *
 * Nothing here can prove a workflow *runs* — only GitHub can. What it can do is
 * pin the contracts between the files, which are the ones that break silently:
 * the full job's name is simultaneously a branch-protection required check and
 * the string verify-ci looks for, and a rename of either side leaves the other
 * green while the gate it implements has gone.
 *
 * What it cannot do is see branch protection. That is repo settings, not a file.
 * Two of the three copies of the name are pinned here (ci.yml and both verify-ci
 * scripts); the third is latched only indirectly, through
 * .github/required-checks.json, which a rename is forced to touch. Nothing
 * proves the settings were changed. It also executes verify-ci's
 * real script text against a fake GitHub API, since that script is the one
 * piece of tier logic that decides whether a commit may ship.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const workflowsDir = path.resolve(__dirname, '../../.github/workflows');
const load = (name: string) => parse(readFileSync(path.join(workflowsDir, name), 'utf8'));

const ci = load('ci.yml');
const deployWebsite = load('deploy-website.yml');
const deployCms = load('deploy-cms.yml');

const requiredChecks = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../.github/required-checks.json'), 'utf8'),
) as { jobs: Record<string, string> };

const FULL_JOB_NAME = 'Website — lint, typecheck, test, build, e2e';
const full = ci.jobs.website;
const smoke = ci.jobs['website-smoke'];
const stepNamed = (job: any, name: string) => job.steps.find((s: any) => s.name === name);

describe('ci.yml: selection never hides a run', () => {
  it('has no paths or paths-ignore filter on any trigger', () => {
    // Two incidents, both recorded in ci.yml's own comments: a paths filter
    // that produced no run, so a PR editing the verify-ci gate ran no CI at all;
    // and a docs-only commit that matched no path and left main undeployable.
    for (const [event, cfg] of Object.entries(ci.on) as Array<[string, any]>) {
      expect(cfg?.paths, event).toBeUndefined();
      expect(cfg?.['paths-ignore'], event).toBeUndefined();
    }
  });

  it('still triggers on pull_request, push to main, a daily schedule and manual dispatch', () => {
    expect(Object.keys(ci.on).sort()).toEqual(['pull_request', 'push', 'schedule', 'workflow_dispatch']);
    expect(ci.on.push.branches).toEqual(['main']);
    expect(ci.on.schedule).toHaveLength(1);
    expect(ci.on.schedule[0].cron).toMatch(/^\S+ \S+ \* \* \*$/);
  });

  it('gives the scheduled run its own concurrency group, so it cannot displace a push run', () => {
    expect(ci.concurrency.group).toContain("github.event_name == 'schedule'");
  });
});

describe('ci.yml: the full tier is what gates, and it always runs', () => {
  it('keeps the job name that branch protection and verify-ci both depend on', () => {
    expect(full.name).toBe(FULL_JOB_NAME);
  });

  // The latch. This cannot see branch protection (it is repo settings), and it
  // does not claim to: it makes a rename of either required job fail here, so
  // whoever renames it has to open the file that says "change branch protection
  // in lockstep" — and, for the full job, must also have updated FULL_JOB in
  // both deploy workflows for the test above to pass.
  it('records the same names as required-checks.json, so a rename must touch the file that says to change branch protection', () => {
    expect(requiredChecks.jobs.website).toBe(ci.jobs.website.name);
    expect(requiredChecks.jobs.cms).toBe(ci.jobs.cms.name);
    expect(Object.keys(requiredChecks.jobs).sort()).toEqual(['cms', 'website']);
  });

  it('has no `if:` and no `needs:`: every event, including every push to main, runs it in full', () => {
    expect(full.if).toBeUndefined();
    expect(full.needs).toBeUndefined();
  });

  it('runs e2e with no --project flag, so the project list stays in playwright.config.ts alone', () => {
    const e2e = stepNamed(full, 'E2E (Playwright, no CMS)');
    expect(e2e.run).toContain('npx playwright test --grep-invert "@cms"');
    expect(e2e.run).not.toContain('--project');
  });

  it('runs the unit suite unfiltered', () => {
    expect(stepNamed(full, 'Unit & integration tests').run.trim()).toBe('npm run test');
  });
});

describe('ci.yml: the smoke tier is additional and gates nothing', () => {
  it('runs on pull requests only', () => {
    expect(smoke.if).toBe("github.event_name == 'pull_request'");
  });

  it('is not depended on by any job, so it cannot gate the grading-regression job or anything else', () => {
    for (const [name, job] of Object.entries(ci.jobs) as Array<[string, any]>) {
      const needs = [job.needs ?? []].flat();
      expect(needs, name).not.toContain('website-smoke');
    }
  });

  it('selects inside the job, from the real diff, before it runs any test', () => {
    const names = smoke.steps.map((s: any) => s.name).filter(Boolean);
    const select = stepNamed(smoke, 'Select tests from the diff');
    expect(select.id).toBe('select');
    expect(select.run).toContain('scripts/select-tests.ts --base');
    expect(names.indexOf('Select tests from the diff')).toBeLessThan(names.indexOf('Unit & integration tests (selected)'));
    expect(smoke.steps[0].with['fetch-depth']).toBe(0);
  });

  it('runs lint and typecheck unconditionally', () => {
    expect(stepNamed(smoke, 'Lint').if).toBeUndefined();
    expect(stepNamed(smoke, 'Typecheck').if).toBeUndefined();
  });

  it('names chromium-desktop and excludes @cms in its e2e step, and skips only on run_e2e', () => {
    const e2e = stepNamed(smoke, 'E2E (Playwright, selected, chromium-desktop)');
    expect(e2e.run).toContain('--project=chromium-desktop');
    expect(e2e.run).toContain('--grep-invert "@cms"');
    expect(e2e.if).toBe("steps.select.outputs.run_e2e != 'false'");
    expect(stepNamed(smoke, 'Unit & integration tests (selected)').if).toBe("steps.select.outputs.run_unit != 'false'");
  });

  // Every rule in test-tiers.ts fails open; the `if:` lines must too. `== 'true'`
  // skips on any other value, including an absent output, so a select step that
  // wrote nothing would leave a job that ran only lint and typecheck and went
  // green. `!= 'false'` skips only on the one string toOutputs emits to mean it.
  it('gates every selection-dependent step so that only the literal "false" skips it', () => {
    const gated = smoke.steps.filter((s: any) => String(s.if ?? '').includes('steps.select.outputs'));
    expect(gated.map((s: any) => s.name)).toEqual([
      'Unit & integration tests (selected)',
      'Build',
      'Install Playwright browser',
      'Generate self-signed TLS certificate',
      'Start built app',
      'Start TLS proxy in front of the built app',
      'E2E (Playwright, selected, chromium-desktop)',
      'Stop TLS proxy',
      'Stop built app',
    ]);
    for (const step of gated) {
      expect(step.if, step.name).toMatch(/steps\.select\.outputs\.run_(unit|e2e) != 'false'$/);
      expect(step.if, step.name).not.toContain("== 'true'");
    }
  });

  it('expands selected files from an array, never unquoted (route paths contain [id])', () => {
    expect(stepNamed(smoke, 'Unit & integration tests (selected)').run).toContain('"${files[@]}"');
    expect(stepNamed(smoke, 'E2E (Playwright, selected, chromium-desktop)').run).toContain('"${files[@]}"');
  });

  // The prologue is a copy of the full job's, kept so this PR does not touch
  // the job that gates merge. A copy drifts; this is the thing that says so.
  it('keeps its prologue identical to the full job\'s', () => {
    const shared = [
      'Install dependencies',
      'Lint',
      'Typecheck',
      'Apply database migrations',
      'Migrations match the schema',
      'Build',
      'Generate self-signed TLS certificate',
      'Start built app',
      'Start TLS proxy in front of the built app',
      'Stop TLS proxy',
      'Stop built app',
    ];
    for (const name of shared) {
      const a = stepNamed(full, name);
      const b = stepNamed(smoke, name);
      expect(b, name).toBeDefined();
      expect(b.run, name).toBe(a.run);
      expect(b.env ?? {}, name).toEqual(a.env ?? {});
      expect(b['working-directory'], name).toBe(a['working-directory']);
    }
    expect(smoke.services).toEqual(full.services);
    expect(smoke.env).toEqual(full.env);
  });

  // The list above catches a step whose body drifted; it cannot see a step that
  // only one job has. Literal on purpose, not derived: a step added to one job
  // only shows up as a change to these two arrays, which a reviewer must read.
  it('differs from the full job by exactly these steps, in both directions', () => {
    const names = (job: any) => job.steps.map((s: any) => s.name).filter(Boolean) as string[];
    const minus = (a: string[], b: string[]) => a.filter((n) => !b.includes(n));
    expect(minus(names(full), names(smoke))).toEqual([
      'Unit & integration tests',
      'Install Playwright browsers',
      'E2E (Playwright, no CMS)',
    ]);
    expect(minus(names(smoke), names(full))).toEqual([
      'Select tests from the diff',
      'Unit & integration tests (selected)',
      'Install Playwright browser',
      'E2E (Playwright, selected, chromium-desktop)',
    ]);
  });

  // `uses:` steps carry no name, so the list above never reached them: a bumped
  // node-version or cache-dependency-path on one job would drift silently.
  it('uses the same actions with the same inputs as the full job, but for smoke\'s fetch-depth', () => {
    const uses = (job: any) => job.steps.filter((s: any) => s.uses && !s.name);
    expect(uses(smoke).map((s: any) => s.uses)).toEqual(uses(full).map((s: any) => s.uses));
    expect(uses(full).map((s: any) => s.uses)).toEqual(['actions/checkout@v4', 'actions/setup-node@v4']);
    uses(full).forEach((a: any, i: number) => {
      const { ['fetch-depth']: depth, ...rest } = uses(smoke)[i].with ?? {};
      expect(rest, a.uses).toEqual(a.with ?? {});
      // The one deliberate difference: smoke needs both ends of the PR's diff.
      if (a.uses.startsWith('actions/checkout')) expect(depth).toBe(0);
      else expect(depth).toBeUndefined();
    });
    const artifact = (job: any) => stepNamed(job, 'Upload Playwright report on failure');
    expect(artifact(smoke).uses).toBe(artifact(full).uses);
    expect(artifact(smoke).if).toBe(artifact(full).if);
    expect(artifact(smoke).with.path).toBe(artifact(full).with.path);
    expect(artifact(smoke).with['retention-days']).toBe(artifact(full).with['retention-days']);
  });
});

describe('ci.yml: grading-regression stays off the schedule', () => {
  // Irina deferred the trigger scope for this job until KAN-39 makes it spend
  // live API money (grading-regression.yml's own header). A daily trigger would
  // decide it for her.
  it('does not run on the daily schedule', () => {
    expect(ci.jobs['grading-regression'].if).toBe("github.event_name != 'schedule'");
  });
});

describe('the docs name the jobs as ci.yml does', () => {
  it('CLAUDE.md cites the real job names', () => {
    const doc = readFileSync(path.resolve(__dirname, '../../CLAUDE.md'), 'utf8');
    expect(doc).toContain(full.name);
    expect(doc).toContain(smoke.name);
  });
});

describe('deploy workflows: verify-ci recognises the full run specifically', () => {
  it('both deploy gates name the same job ci.yml calls its full tier', () => {
    for (const wf of [deployWebsite, deployCms]) {
      const script = wf.jobs['verify-ci'].steps[0].with.script as string;
      expect(script).toContain(`const FULL_JOB = '${FULL_JOB_NAME}';`);
    }
  });

  // Runs the real script text from the workflow file against a fake API.
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  type Run = { id: number; conclusion: string; event: string; head_branch: string; html_url?: string };
  async function verify(wf: any, runs: Run[], jobsByRun: Record<number, Array<{ name: string; conclusion: string }>>, ref = 'refs/heads/main') {
    const failures: string[] = [];
    const script = wf.jobs['verify-ci'].steps[0].with.script as string;
    const github = {
      rest: {
        actions: {
          listWorkflowRuns: async () => ({ data: { workflow_runs: runs } }),
          listJobsForWorkflowRun: async ({ run_id }: { run_id: number }) => ({ data: { jobs: jobsByRun[run_id] ?? [] } }),
        },
      },
    };
    const context = { ref, sha: 'abc123', repo: { owner: 'o', repo: 'r' } };
    const core = { setFailed: (m: string) => failures.push(m), info: () => {} };
    await new AsyncFunction('github', 'context', 'core', script)(github, context, core);
    return failures;
  }
  const pushRun: Run = { id: 1, conclusion: 'success', event: 'push', head_branch: 'main' };
  const fullOk = [{ name: FULL_JOB_NAME, conclusion: 'success' }, { name: 'CMS — install & build smoke check', conclusion: 'success' }];

  describe.each([['deploy-website.yml', deployWebsite], ['deploy-cms.yml', deployCms]])('%s', (_name, wf) => {
    it('accepts a push run on main in which the full job succeeded', async () => {
      expect(await verify(wf, [pushRun], { 1: fullOk })).toEqual([]);
    });

    it('accepts a manual dispatch on main in which the full job succeeded (the recovery path)', async () => {
      expect(await verify(wf, [{ ...pushRun, event: 'workflow_dispatch' }], { 1: fullOk })).toEqual([]);
    });

    it('REFUSES a run that succeeded overall but whose full job was skipped, even with smoke green', async () => {
      const jobs = [
        { name: FULL_JOB_NAME, conclusion: 'skipped' },
        { name: 'Website smoke — selected tests, chromium-desktop only', conclusion: 'success' },
        { name: 'CMS — install & build smoke check', conclusion: 'success' },
      ];
      expect(await verify(wf, [pushRun], { 1: jobs })).toHaveLength(1);
    });

    it('refuses a run with only a smoke job and no full job at all', async () => {
      const jobs = [{ name: 'Website smoke — selected tests, chromium-desktop only', conclusion: 'success' }];
      expect(await verify(wf, [pushRun], { 1: jobs })).toHaveLength(1);
    });

    it('refuses a run whose full job failed, however the run was concluded', async () => {
      expect(await verify(wf, [pushRun], { 1: [{ name: FULL_JOB_NAME, conclusion: 'failure' }] })).toHaveLength(1);
    });

    it('refuses a scheduled run and a pull_request run even with the full job green', async () => {
      const runs: Run[] = [
        { id: 2, conclusion: 'success', event: 'schedule', head_branch: 'main' },
        { id: 3, conclusion: 'success', event: 'pull_request', head_branch: 'feature/x' },
      ];
      expect(await verify(wf, runs, { 2: fullOk, 3: fullOk })).toHaveLength(1);
    });

    it('finds the good run when an earlier one is a skipped-full run', async () => {
      const runs: Run[] = [{ ...pushRun, id: 5 }, { ...pushRun, id: 6, event: 'workflow_dispatch' }];
      const jobs = { 5: [{ name: FULL_JOB_NAME, conclusion: 'skipped' }], 6: fullOk };
      expect(await verify(wf, runs, jobs)).toEqual([]);
    });

    it('still refuses to deploy from a ref other than main', async () => {
      expect(await verify(wf, [pushRun], { 1: fullOk }, 'refs/heads/feature/x')).toHaveLength(1);
    });
  });
});
