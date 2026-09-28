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
 *    the intended default, which is visible in `grading_jobs.provider`.
 *
 * Neither real provider reads its credential at import or construction —
 * only inside `grade()` — so this factory never throws for a missing key.
 * `provider-factory.test.ts` pins that.
 */
import { createFakeGradingProvider } from './providers/fake-provider';
import { createClaudeGradingProvider } from './providers/claude-provider';
import { createMistralGradingProvider } from './providers/mistral-provider';
import type { GradingProvider } from './provider';

export function createGradingProvider(): GradingProvider {
  if (process.env.MOCK_GRADING_PROVIDER === '1') {
    return createFakeGradingProvider();
  }
  if (process.env.GRADING_PROVIDER === 'mistral') {
    return createMistralGradingProvider();
  }
  return createClaudeGradingProvider();
}
