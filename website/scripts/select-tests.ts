/**
 * CLI for the smoke tier's test selection — the map and the rules live in
 * ./test-tiers.ts; this only gathers the diff, calls it, and reports.
 *
 *   tsx scripts/select-tests.ts --base <sha> [--head <sha>]   diff base...head
 *   git diff --name-only --no-renames ... | tsx scripts/select-tests.ts
 *
 * Prints the selection, and under GitHub Actions appends job outputs
 * ($GITHUB_OUTPUT) and a summary ($GITHUB_STEP_SUMMARY). Output is metadata
 * only: paths, area names, counts.
 *
 * Any failure to work out the diff selects everything rather than failing or
 * selecting nothing — same rule as the map itself.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { selectTests, toOutputs, type Selection } from './test-tiers';

function git(args: string[], cwd?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function describe(s: Selection): string {
  if (s.mode === 'all') {
    // "Everything" is per tier: in the smoke job this is every unit test and
    // every spec, but e2e still runs chromium-desktop only.
    return [
      'Selection: EVERYTHING (every unit test and e2e spec; smoke runs e2e in chromium-desktop only)',
      ...s.reasons.slice(0, 20).map((r) => `  - ${r}`),
    ].join('\n');
  }
  return [
    `Selection: subset — areas: ${s.areas.join(', ') || '(none)'}`,
    `  unit test files (${s.unitTests.length}):`,
    ...s.unitTests.map((f) => `    ${f}`),
    `  e2e specs (${s.e2eSpecs.length}):`,
    ...s.e2eSpecs.map((f) => `    ${f}`),
  ].join('\n');
}

function main(): void {
  let selection: Selection;
  try {
    const root = git(['rev-parse', '--show-toplevel']).trim();
    // --no-renames: a rename must report the OLD path too, or moving a file
    // out of an area would look like a change to the new path only.
    const base = arg('--base');
    const diff = base
      ? git(
          [
            '-c',
            'core.quotepath=off',
            'diff',
            '--name-only',
            '--no-renames',
            `${base}...${arg('--head') ?? 'HEAD'}`,
          ],
          root,
        )
      : readFileSync(0, 'utf8');
    // `git ls-files` from the root, not the cwd: it is relative to where it runs.
    const files = git(['-c', 'core.quotepath=off', 'ls-files'], root).split('\n').filter(Boolean);
    selection = selectTests(diff.split('\n'), files);
  } catch (err) {
    selection = {
      mode: 'all',
      reasons: [`could not determine the diff (${(err as Error).message.split('\n')[0]})`],
      areas: [],
      unitTests: [],
      e2eSpecs: [],
    };
  }

  const text = describe(selection);
  console.log(text);
  if (selection.mode === 'subset' && selection.unitTests.length + selection.e2eSpecs.length === 0) {
    console.log(
      '::warning::The selected areas resolve to no test at all; smoke ran lint and typecheck only.',
    );
  }

  if (process.env.GITHUB_OUTPUT) {
    const lines = Object.entries(toOutputs(selection)).map(([k, v]) => `${k}=${v}`);
    appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, '### Smoke selection\n\n```\n' + text + '\n```\n');
  }
  if (!process.env.GITHUB_OUTPUT) console.log('\n' + JSON.stringify(toOutputs(selection), null, 2));
}

main();
