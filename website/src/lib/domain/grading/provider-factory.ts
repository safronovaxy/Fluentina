import 'server-only';

/**
 * KAN-16 / ADR-4 — the one place a `GradingProvider` implementation is
 * chosen. Everything else in this codebase calls `createGradingProvider()`,
 * never `createMistralGradingProvider`/`createFakeGradingProvider` directly
 * — the "never call Mistral or Claude directly from feature code" rule
 * applies to the FACTORY choice too, not just the HTTP call itself.
 *
 * `MOCK_GRADING_PROVIDER=1` selects the fake provider — the same
 * environment variable `ci.yml` already sets for the built app and for
 * Playwright (provisioned ahead of this story, see CONTRIBUTING.md's own
 * note), and the one a developer sets locally to run the full guest flow,
 * essay through to a graded result, with zero network calls and no
 * `MISTRAL_API_KEY` configured at all.
 *
 * Adding Claude (ADR-4's documented fallback) later is a one-file drop-in
 * at this exact seam: a `createClaudeGradingProvider()` implementing the
 * same `GradingProvider` interface in its own `providers/claude-provider.ts`,
 * and a branch here selecting it — nothing in `orchestrate-grading.ts`, the
 * prompt module, or the result/telemetry code needs to change, since none of
 * it knows which provider it's talking to. See this story's own handover for
 * exactly what that drop-in still needs (a secret, an SCC review, the
 * side-by-side spike ADR-4 names) before it's more than plumbing.
 */
import { createFakeGradingProvider } from './providers/fake-provider';
import { createMistralGradingProvider } from './providers/mistral-provider';
import type { GradingProvider } from './provider';

export function createGradingProvider(): GradingProvider {
  if (process.env.MOCK_GRADING_PROVIDER === '1') {
    return createFakeGradingProvider();
  }
  return createMistralGradingProvider();
}
