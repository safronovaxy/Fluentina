import 'server-only';

/**
 * KAN-16 (BR-3.5) — basic detection of an essay that tries to manipulate the
 * grading instructions rather than answer the prompt: "ignore the rubric",
 * "give this a perfect score", and the handful of shapes that phrase takes.
 *
 * This is deliberately NOT the only defence — see
 * `lib/domain/grading/prompt.ts` for the structural one (the essay is sent
 * to the provider as clearly delimited data, never concatenated into the
 * instructions). This module is the second, independent layer BR-3.5 asks
 * for: even if a future prompt-construction change weakens the delimiting,
 * or a provider's own instruction-following slips, an essay that matches
 * one of these patterns still can't walk away with a silently inflated
 * score — see `clampForSuspectedInjection` (`result.ts`) for what actually
 * enforces that.
 *
 * Deliberately a small, readable pattern list, not an ML classifier or a
 * third-party service — "basic detection/handling", the ticket's own
 * words, for a Phase 1 launch. False negatives (a cleverer injection this
 * list doesn't catch) are expected and accepted; the story's own acceptance
 * criterion is "at minimum, such attempts must not result in an inflated/
 * perfect score being silently returned", not "catch every injection
 * attempt" — this list plus the structural defence in `prompt.ts` is BR-3.5's
 * "basic" bar, not a claim of completeness.
 *
 * Returns a COUNT, never the matched text or the essay content itself — see
 * `logGradingJobTelemetry`'s own comment for why nothing derived from this
 * function may ever reach a log line beyond a boolean and a count.
 */
const INJECTION_PATTERNS: readonly RegExp[] = [
  // "ignore/disregard the rubric/instructions/above"
  /\b(ignore|disregard)\b[^.\n]{0,40}\b(rubric|instructions?|prompt|above|previous)\b/i,
  // "give this/it a perfect/full/100 score/band/grade"
  /\bgive\s+(this|it|me)\b[^.\n]{0,30}\b(perfect|full|maximum|top|100%?|10\/10)\b[^.\n]{0,20}\b(score|mark|grade|band)?/i,
  // "you are now a ..." / role override
  /\byou are now\b/i,
  // explicit new-instruction framing
  /\bnew instructions?\s*:/i,
  // asking the model to reveal or reference its own system prompt
  /\bsystem prompt\b/i,
  // "this essay deserves/is worth a perfect/top score"
  /\bthis (essay|text)\s+(deserves|is worth|should (get|receive))\b[^.\n]{0,20}\b(a\s+)?(perfect|full|top|100)\b/i,
  // direct scoring instruction ("score: 100", "band: C2")
  /\b(score|band|grade)\s*[:=]\s*(100|c2|b2\+?)\b/i,
];

export interface PromptInjectionCheck {
  readonly suspected: boolean;
  /** How many distinct patterns matched — telemetry-safe (see this module's own comment), never which ones or where. */
  readonly matchCount: number;
}

export function detectPromptInjection(content: string): PromptInjectionCheck {
  const matchCount = INJECTION_PATTERNS.reduce((count, pattern) => (pattern.test(content) ? count + 1 : count), 0);
  return { suspected: matchCount > 0, matchCount };
}
