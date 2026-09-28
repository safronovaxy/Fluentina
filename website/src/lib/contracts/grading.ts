/**
 * KAN-16 — the provider-agnostic grading result shape (ADR-5), and the Zod
 * schema a `GradingProvider` implementation's raw output is validated
 * against before anything downstream trusts it.
 *
 * Two schemas live here, deliberately not one:
 *
 * - `providerGradingResponseSchema` validates what a provider hands back —
 *   annotations carry a `quote` (the exact substring of the guest's essay
 *   the annotation is about), never a `start`/`end` offset the model itself
 *   computed. A model is unreliable at character-offset arithmetic over its
 *   own output; asking it to quote instead, and resolving that quote against
 *   the ACTUAL essay text ourselves (`resolveAnnotationSpans`, in
 *   `lib/domain/grading/span-resolution.ts`), is what makes "tied to exact
 *   spans of the guest's own submitted text" (BR-3.3) a claim this codebase
 *   can verify rather than one it has to trust the provider on. An
 *   annotation whose quote can't be found verbatim in the essay is dropped,
 *   not guessed at — see that module's own comment.
 * - `GradingResult` is OUR shape, after span resolution: annotations here
 *   carry real, verified `start`/`end` character offsets into the essay,
 *   never a `quote` a caller would have to re-search for. `overallBand` is
 *   also ours, not the provider's prose — see `bandForScore` — so the band
 *   boundaries are one deterministic function, not whatever wording each
 *   provider happens to produce.
 */
import { z } from 'zod';

/** BR-3.1 — the four Goethe B2 rubric dimensions this story scores every essay on, and only these. */
export const RUBRIC_DIMENSIONS = [
  'textStructureCohesion',
  'vocabularyLexicalDensity',
  'grammarSyntax',
  'topicRelevanceContentCoverage',
] as const;
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export const GRADING_ANNOTATION_SEVERITIES = ['minor', 'moderate', 'major'] as const;
export type GradingAnnotationSeverity = (typeof GRADING_ANNOTATION_SEVERITIES)[number];

/**
 * Sanity caps on a provider's raw response — not a product rule, a defence
 * against a malformed or runaway completion (e.g. a model that echoes the
 * whole essay back as one giant "quote", or hallucinates hundreds of
 * annotations). Generous relative to a real 300-word essay.
 */
const MAX_ANNOTATIONS = 60;
const MAX_QUOTE_CHARS = 1000;
const MAX_SUMMARY_CHARS = 2000;
const MAX_COMMENT_CHARS = 1000;

/** One rubric dimension's score, as a provider reports it — 0-100, with a short justification. */
const providerDimensionScoreSchema = z.object({
  dimension: z.enum(RUBRIC_DIMENSIONS),
  score: z.number().min(0).max(100),
  comment: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
});

/**
 * One error/observation, as a provider reports it. `quote` is REQUIRED and
 * must be non-empty — an annotation with no quote has no span to verify and
 * is meaningless under BR-3.3's "tied to exact spans" requirement; the
 * schema refuses to accept the shape rather than let `resolveAnnotationSpans`
 * silently drop every annotation from a provider that stopped including one.
 */
const providerAnnotationSchema = z.object({
  quote: z.string().trim().min(1).max(MAX_QUOTE_CHARS),
  dimension: z.enum(RUBRIC_DIMENSIONS),
  severity: z.enum(GRADING_ANNOTATION_SEVERITIES),
  message: z.string().trim().min(1).max(MAX_COMMENT_CHARS),
  suggestion: z.string().trim().min(1).max(MAX_COMMENT_CHARS).optional(),
});

/**
 * The full shape a `GradingProvider` implementation's parsed JSON output must
 * satisfy. `dimensions` must cover exactly the four `RUBRIC_DIMENSIONS`, each
 * exactly once — checked in `.superRefine`, not just `.length(4)`, since
 * `.length(4)` alone would accept four scores for the SAME dimension and
 * silently drop the other three from the response `GradingResult` assumes
 * exist.
 */
export const providerGradingResponseSchema = z
  .object({
    overallScore: z.number().min(0).max(100),
    dimensions: z.array(providerDimensionScoreSchema).length(RUBRIC_DIMENSIONS.length),
    annotations: z.array(providerAnnotationSchema).max(MAX_ANNOTATIONS),
    summary: z.string().trim().min(1).max(MAX_SUMMARY_CHARS),
  })
  .superRefine((value, ctx) => {
    const seen = new Set(value.dimensions.map((d) => d.dimension));
    for (const dimension of RUBRIC_DIMENSIONS) {
      if (!seen.has(dimension)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing a score for rubric dimension "${dimension}"`,
        });
      }
    }
    if (seen.size !== value.dimensions.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'duplicate rubric dimension in provider response',
      });
    }
  });

export type ProviderGradingResponse = z.infer<typeof providerGradingResponseSchema>;
export type ProviderAnnotation = z.infer<typeof providerAnnotationSchema>;

/** One error/observation, AFTER span resolution — `start`/`end` are verified character offsets into the essay's own content, computed by us (see this file's own top comment), never taken from the provider. */
export interface GradingAnnotation {
  readonly start: number;
  readonly end: number;
  readonly dimension: RubricDimension;
  readonly severity: GradingAnnotationSeverity;
  readonly message: string;
  readonly suggestion: string | null;
}

export interface RubricDimensionScore {
  readonly dimension: RubricDimension;
  readonly score: number;
  readonly comment: string;
}

/**
 * The provider-agnostic grading result (ADR-5). This is what a guest's
 * status poll eventually receives, what `lib/db/grading-jobs.ts` persists as
 * the structured `result` column, and what any future `GradingProvider`
 * implementation (Claude, or a Phase 3 self-hosted model) must be able to
 * produce, regardless of its own wire format.
 */
export interface GradingResult {
  readonly overallScore: number;
  /** Derived deterministically from `overallScore` by `bandForScore` — never taken from provider prose. */
  readonly overallBand: string;
  /** Exactly `RUBRIC_DIMENSIONS.length` entries, one per dimension. */
  readonly dimensions: readonly RubricDimensionScore[];
  /** Only annotations whose quote was found verbatim in the essay — see `resolveAnnotationSpans`. */
  readonly annotations: readonly GradingAnnotation[];
  readonly summary: string;
  /**
   * BR-3.5 — true whenever the essay text tripped the prompt-injection
   * heuristic (`lib/domain/grading/injection-guard.ts`) and this result's
   * scores were therefore capped rather than trusted as-is. Never invisible
   * to the guest: a caller (KAN-18's preview screen) is expected to
   * surface this rather than present a flagged result as an ordinary one.
   */
  readonly flaggedForReview: boolean;
}

/**
 * Deterministic score -> band label, so "the overall band score" (BR-3.2) is
 * one function's output, not a string each provider is trusted to phrase
 * consistently. Boundaries are a reasonable placeholder for a Goethe B2
 * practice tool, not a calibrated cut score — that calibration is explicitly
 * BR-3.4's job (Irina's sanity check, then the Phase 2 study), not this
 * story's to invent.
 */
export function bandForScore(score: number): string {
  if (score >= 90) return 'B2+ (strong pass)';
  if (score >= 75) return 'B2 (pass)';
  if (score >= 60) return 'B2- (borderline)';
  if (score >= 40) return 'B1 (below target)';
  return 'Below B1';
}

/**
 * KAN-16's own stable reason codes for a grading job's outcome — the same
 * "reason travels as data, not English prose" shape KAN-31 established for
 * request rejections (`lib/contracts/rejection-reason.ts`), applied to a
 * job's async OUTCOME rather than an HTTP request's immediate one. Not
 * folded into `RejectionReason` itself: these describe why a JOB failed,
 * discovered long after the triggering HTTP request already returned 201 —
 * a different axis than "why was this request rejected".
 */
export const GRADING_FAILURE_REASONS = [
  /**
   * This story's own re-check (see `lib/domain/grading/orchestrate-grading.ts`'s
   * own top comment on why this exists independently of KAN-15's request-time
   * check) found the stored essay outside the 50-300 word bound at grading
   * time. Should be unreachable in production today — see that module's
   * comment for exactly why it is not, and why the check runs here anyway.
   */
  'wordCountOutOfBounds',
  /** The provider call itself failed — network error, non-2xx response, or a response that isn't valid JSON at all. */
  'providerError',
  /** The provider responded, but its JSON didn't satisfy `providerGradingResponseSchema`. */
  'invalidProviderResponse',
  /** The essay row this job pointed at no longer exists (e.g. a right-to-erasure or retention deletion raced the job). */
  'essayMissing',
  /** Anything else — caught, never re-thrown with essay content or provider response bodies attached (see the orchestrator's own comment). */
  'unknown',
] as const;
export type GradingFailureReason = (typeof GRADING_FAILURE_REASONS)[number];

export function isGradingFailureReason(value: unknown): value is GradingFailureReason {
  return (GRADING_FAILURE_REASONS as readonly unknown[]).includes(value);
}
