import 'server-only';

/**
 * KAN-24 (BR-7.1) — "an approximate token count / cost estimate", the
 * ticket's own words: approximate, for telemetry, not a billing
 * reconciliation. Prices are current published per-token list prices at the
 * time this story was written, in USD, per single token (not per 1K/1M) —
 * a rough, occasionally-stale planning number a human reviewing KAN-24's
 * dashboard can sanity-check spend against, nothing this codebase bills
 * against directly.
 */
import type { GradingProviderName } from './provider';

/**
 * `Record<GradingProviderName, ...>`, not `Record<string, ...>` (KAN-16
 * round-1 review, finding 14) — a mapped type over the exhaustive provider
 * union, so a provider added to `provider.ts` without a matching entry here
 * fails `npm run typecheck`, not silently at runtime with every one of its
 * jobs logging `costEstimateUsd: 0`.
 */
const APPROX_USD_PER_TOKEN: Readonly<Record<GradingProviderName, { readonly prompt: number; readonly completion: number }>> = {
  // Claude Opus 5.5 (`claude-opus-5-5`, the model `claude-provider.ts` sends) —
  // $4 / $20 per MTok input/output, from the Claude models overview and
  // pricing pages. The completion rate applies to THINKING tokens too:
  // `usage.output_tokens` includes them and they are billed as output, so
  // `claude-provider.ts` reports that figure as its completion count. Change
  // this together with `CLAUDE_MODEL` there; no prompt caching is used, so
  // cache read/write rates are deliberately absent.
  claude: { prompt: 4 / 1_000_000, completion: 20 / 1_000_000 },
  // Mistral Large — published list price, prompt/completion split.
  mistral: { prompt: 2 / 1_000_000, completion: 6 / 1_000_000 },
  // The fake provider costs nothing — see fake-provider.ts, which always
  // reports zero tokens anyway, but this keeps the lookup total either way.
  fake: { prompt: 0, completion: 0 },
};

export function estimateCostUsd(provider: GradingProviderName, promptTokens: number, completionTokens: number): number {
  const rates = APPROX_USD_PER_TOKEN[provider];
  return promptTokens * rates.prompt + completionTokens * rates.completion;
}
