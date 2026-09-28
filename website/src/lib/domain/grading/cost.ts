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
const APPROX_USD_PER_TOKEN: Readonly<Record<string, { readonly prompt: number; readonly completion: number }>> = {
  // Mistral Large — published list price, prompt/completion split.
  mistral: { prompt: 2 / 1_000_000, completion: 6 / 1_000_000 },
  // The fake provider costs nothing — see fake-provider.ts, which always
  // reports zero tokens anyway, but this keeps the lookup total either way.
  fake: { prompt: 0, completion: 0 },
};

export function estimateCostUsd(provider: string, promptTokens: number, completionTokens: number): number {
  const rates = APPROX_USD_PER_TOKEN[provider];
  if (!rates) return 0;
  return promptTokens * rates.prompt + completionTokens * rates.completion;
}
