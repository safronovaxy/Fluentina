/**
 * Guards on the CI workflow files themselves.
 *
 * Nothing here can prove a workflow *runs* — only GitHub can. What it can do is
 * pin the contracts between the files, which are the ones that break silently:
 * the full job's name is simultaneously a branch-protection required check and
 * the string verify-ci looks for, and a rename of either side leaves the other
 * green while the gate it implements has gone. It also executes verify-ci's
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
    expect(e2e.if).toBe("steps.select.outputs.run_e2e == 'true'");
    expect(stepNamed(smoke, 'Unit & integration tests (selected)').if).toBe("steps.select.outputs.run_unit == 'true'");
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
