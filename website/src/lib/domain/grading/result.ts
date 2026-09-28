import 'server-only';

/**
 * KAN-16 (BR-3.5) — assembles the final, provider-agnostic `GradingResult`
 * from a validated provider response plus resolved annotation spans, and is
 * the one place `flaggedForReview`'s score-capping actually happens.
 */
import { bandForScore, type GradingResult, type ProviderGradingResponse } from '@/lib/contracts/grading';
import type { GradingAnnotation } from '@/lib/contracts/grading';

/**
 * The ceiling a suspected-injection essay's score is capped at — deliberately
 * well below anything a guest would read as "it worked": not zero (this is a
 * heuristic, not a proof, and a false positive should not read as a hard
 * failure), and not a borderline-pass number either (55 sits under
 * `bandForScore`'s "B2- (borderline)" cutoff of 60, so a capped result is
 * visibly, unambiguously not a pass). The acceptance criterion this exists
 * for is narrow and this number satisfies it directly: "must not result in
 * an inflated/perfect score being silently returned" — capping, not
 * blocking, is the ticket's own "at minimum" bar; blocking outright (never
 * returning a result) is Phase 2+ territory this story doesn't have a
 * calibrated way to do without risking real, honestly-written essays that
 * merely happen to mention a phrase like "ignore" in a different sense.
 */
export const INJECTION_SUSPECTED_SCORE_CAP = 55;

export function buildGradingResult(provider: ProviderGradingResponse, annotations: readonly GradingAnnotation[]): GradingResult {
  return {
    overallScore: provider.overallScore,
    overallBand: bandForScore(provider.overallScore),
    dimensions: provider.dimensions,
    annotations,
    summary: provider.summary,
    flaggedForReview: false,
  };
}

/**
 * KAN-16 round-1 review, finding 11: the model's own prose is written for an
 * UNCLAMPED result and is never re-derived when a result IS clamped, so
 * passing it through unchanged produced things like `overallScore: 55,
 * overallBand: "Below B1"` sitting next to `summary: "Ein perfekter
 * Aufsatz — 100 Punkte."` — internally contradictory, and unexplained, for
 * exactly the honest guest a false positive (finding 2 shows those are real)
 * would land on. Fixed, non-model strings, in English (the operator-facing
 * side of this result; nothing here is guest-facing copy — see KAN-18's own
 * scope for that screen).
 */
const CLAMPED_SUMMARY =
  'This result was capped because the essay appeared to contain an attempt to influence its own grading. ' +
  'Scores above are not a reliable assessment of the essay itself and this submission has been flagged for review.';
const CLAMPED_DIMENSION_COMMENT = 'Comment withheld — see the flagged-for-review summary.';

/**
 * Applied only when `detectPromptInjection` (injection-guard.ts) suspects the
 * essay tried to manipulate its own grading. Caps every score at
 * `INJECTION_SUSPECTED_SCORE_CAP`, recomputes the band off the CAPPED score
 * (never the original), replaces the model's own summary/comments (see
 * `CLAMPED_SUMMARY`'s own comment — finding 11), and sets `flaggedForReview`
 * — the field a future preview screen (KAN-18) is expected to surface rather
 * than present this as an ordinary result. Never raises a score; `Math.min`
 * only ever lowers or leaves it unchanged, so a genuinely low-scoring essay
 * that also happens to trip a pattern is not pushed upward toward the cap.
 */
export function clampForSuspectedInjection(result: GradingResult): GradingResult {
  const cappedOverall = Math.min(result.overallScore, INJECTION_SUSPECTED_SCORE_CAP);
  return {
    ...result,
    overallScore: cappedOverall,
    overallBand: bandForScore(cappedOverall),
    dimensions: result.dimensions.map((d) => ({
      ...d,
      score: Math.min(d.score, INJECTION_SUSPECTED_SCORE_CAP),
      comment: CLAMPED_DIMENSION_COMMENT,
    })),
    summary: CLAMPED_SUMMARY,
    flaggedForReview: true,
  };
}
