import 'server-only';

/**
 * KAN-16 / ADR-4, amended by KAN-44 — the one place a `GradingProvider`
 * implementation is chosen. Everything else in this codebase calls
 * `createGradingProvider()`, never `createClaudeGradingProvider`/
 * `createMistralGradingProvider`/`createFakeGradingProvider` directly — the
 * "never call Mistral or Claude directly from feature code" rule applies to
 * the FACTORY choice too, not just the API call itself.
 *
 * Selection, in order:
 * 1. `MOCK_GRADING_PROVIDER=1` -> the fake provider. The same environment
 *    variable `ci.yml` already sets for the built app and for Playwright
 *    (and `vitest.config.ts` sets for the unit suite), and the one a
 *    developer sets locally to run the full guest flow, essay through to a
 *    graded result, with zero network calls and no API key configured at all.
 *    This branch wins over everything below, so no other setting can make a
 *    test or CI run reach a real provider.
 * 2. `GRADING_PROVIDER=mistral` -> Mistral, the deferred second step from
 *    KAN-44. Kept selectable rather than dead code.
 * 3. Anything else, including unset -> Claude, the Phase 1 primary. An
 *    unrecognised `GRADING_PROVIDER` value deliberately falls through to the
 *    primary rather than throwing: `orchestrate-grading.ts` calls this
 *    factory outside its `try`, after the job is claimed, so a throw here
 *    would strand the job in `processing`. The cost of a typo is grading on
 *    the intended default, which is visible in `grading_jobs.provider` —
 *    and, since that default is the more expensive provider, it also logs
 *    one structured warning (`warnUnrecognisedGradingProvider`). Roughly
 *    2-4.5x per attempt, not an order of magnitude: from `cost.ts`, Claude is
 *    $4/$20 per MTok prompt/completion against Mistral's $2/$6 — 2x on
 *    prompt, 3.3x on completion. At the output ceilings (Claude
 *    `MAX_OUTPUT_TOKENS` 4,000, Mistral `MAX_COMPLETION_TOKENS` 3,000) the
 *    completion side is 4,000 x $20/M = $0.080 against 3,000 x $6/M =
 *    $0.018, 4.4x; prompt cost (same prompt either way, so 2x) pulls a
 *    worst-case attempt down towards 2x (an asymptote, never reached) —
 *    illustrative and unmeasured, about 4.0x with a 2,000-token prompt. No
 *    real prompt-token count has ever been observed, so do not cite that
 *    figure as one. Still the more expensive provider, so a silent typo is worth
 *    warning about. Same shape as `rate-limit.ts`'s
 *    `warnRejectedEnvOverride`: a configuration problem for an operator to
 *    notice, with the operator-typed raw value.
 *    Unlike that one it fires per call, not once per process — this factory
 *    runs per job and route modules load lazily per instance, so there is no
 *    module-level seam to hang "once" on — and a misconfigured deployment
 *    should be loud on every job it affects.
 *
 * Neither real provider reads its credential at import or construction —
 * only inside `grade()` — so this factory never throws for a missing key.
 * `provider-factory.test.ts` pins that.
 */
import { createFakeGradingProvider } from './providers/fake-provider';
import { createClaudeGradingProvider } from './providers/claude-provider';
import { createMistralGradingProvider } from './providers/mistral-provider';
import type { GradingProvider } from './provider';

/** Values that select Claude on purpose — anything else non-empty is treated as a typo and warned about. */
const CLAUDE_ALIASES: ReadonlySet<string> = new Set(['claude']);

function warnUnrecognisedGradingProvider(raw: string, selected: GradingProvider['name']): void {
  console.warn(
    JSON.stringify({
      severity: 'WARNING',
      event: 'grading_provider_env_unrecognised',
      name: 'GRADING_PROVIDER',
      value: raw,
      selected,
    }),
  );
}

export function createGradingProvider(): GradingProvider {
  if (process.env.MOCK_GRADING_PROVIDER === '1') {
    return createFakeGradingProvider();
  }
  const raw = process.env.GRADING_PROVIDER;
  if (raw === 'mistral') {
    return createMistralGradingProvider();
  }
  // Exact match, as before: only a blank or absent value is "not set".
  if (raw !== undefined && raw.trim() !== '' && !CLAUDE_ALIASES.has(raw)) {
    warnUnrecognisedGradingProvider(raw, 'claude');
  }
  return createClaudeGradingProvider();
}
