/**
 * KAN-19 (BR-4.2) — what a browser is allowed to be told about a finished
 * grade, and the Zod schema the client parses that answer with.
 *
 * `GradingResult` (`./grading`) is the FULL result: the summary, four
 * dimension scores and comments, every annotation with its span. It is what
 * the worker persists and what only a registered owner may receive. A guest
 * gets a teaser — and "locked" here is enforced by what is SERIALISED, not by
 * what the UI chooses to draw: a visual lock over a full result the browser
 * already holds was explicitly declined.
 *
 * Hence a discriminated union, not one shape with optional fields. The
 * `locked` variant has no `result` key at all — structurally absent, not
 * `undefined` — so a leak cannot happen by omission. It can only happen by
 * someone writing `access: 'full'` on purpose, which a reviewer sees in a
 * diff and a grep finds. The one producer of these values is
 * `getGradingStatus` (`lib/domain/grading/grading-status.ts`).
 *
 * What `locked` carries: the score, the band, one worked example, and how
 * many annotations exist (total, INCLUDING the one shown — the UI derives
 * "1 of 7 shown") and where, by rubric dimension.
 *
 * What it must never carry: the summary in any form (not truncated, not a
 * first sentence, not a length), dimension scores or comments, and any
 * withheld annotation's span — not even `start`/`end` with the text
 * stripped. A list of the places an essay went wrong is self-diagnosable by
 * someone holding their own essay, which is a large part of the full
 * report's value. `WorkedExampleView` therefore carries the sentence already
 * cut into `before`/`highlighted`/`after`, and no offsets at all.
 *
 * `flaggedForReview` wins over every access level (`withheld`): what a
 * flagged result holds is operator-facing English placeholders and the
 * output of a model reading an essay the injection guard distrusts. Nothing
 * of it is sent to anyone.
 */
import { z } from 'zod';
import {
  GRADING_ANNOTATION_SEVERITIES,
  RUBRIC_DIMENSIONS,
  type GradingAnnotationSeverity,
  type GradingResult,
  type RubricDimension,
} from './grading';

/** One annotation, shown in full with its own sentence around it. No `start`/`end` — see the file comment. */
export interface WorkedExampleView {
  readonly dimension: RubricDimension;
  readonly severity: GradingAnnotationSeverity;
  readonly message: string;
  readonly suggestion: string | null;
  /** The sentence text before the highlighted span — pre-cut server-side, may be empty. */
  readonly before: string;
  /** Exactly the annotated span of the essay. */
  readonly highlighted: string;
  /** The sentence text after the highlighted span — pre-cut server-side, may be empty. */
  readonly after: string;
}

export type GradingReportView =
  | { readonly access: 'withheld'; readonly reason: 'flaggedForReview' }
  | {
      readonly access: 'locked';
      readonly overallScore: number;
      readonly overallBand: string;
      /** Every annotation the result has, including the one shown as `workedExample`. */
      readonly annotationCount: number;
      /** All `RUBRIC_DIMENSIONS` keys, always — zeros included. */
      readonly annotationCountByDimension: Readonly<Record<RubricDimension, number>>;
      readonly workedExample: WorkedExampleView | null;
    }
  | {
      readonly access: 'full';
      readonly result: GradingResult;
      readonly workedExample: WorkedExampleView | null;
    };

export type GradingReportAccess = GradingReportView['access'];

// ---------------------------------------------------------------------------
// The client's parse of the wire answer. The server never runs it — it builds
// `GradingReportView` values directly — so it can be as strict as the type
// says without a second opinion on what the server may send.
// ---------------------------------------------------------------------------

const dimensionSchema = z.enum(RUBRIC_DIMENSIONS);
const severitySchema = z.enum(GRADING_ANNOTATION_SEVERITIES);
const countSchema = z.number().int().nonnegative();

const workedExampleViewSchema = z.object({
  dimension: dimensionSchema,
  severity: severitySchema,
  message: z.string(),
  suggestion: z.string().nullable(),
  before: z.string(),
  highlighted: z.string(),
  after: z.string(),
});

const gradingResultSchema = z.object({
  overallScore: z.number(),
  overallBand: z.string(),
  dimensions: z.array(z.object({ dimension: dimensionSchema, score: z.number(), comment: z.string() })),
  annotations: z.array(
    z.object({
      start: z.number().int(),
      end: z.number().int(),
      dimension: dimensionSchema,
      severity: severitySchema,
      message: z.string(),
      suggestion: z.string().nullable(),
    }),
  ),
  summary: z.string(),
  flaggedForReview: z.boolean(),
});

/**
 * Spelled out key by key, not built from `RUBRIC_DIMENSIONS`: `z.record`
 * over an enum infers a `Partial`, and "all four keys always present" is the
 * contract. The `satisfies` below makes a fifth dimension added to
 * `RUBRIC_DIMENSIONS` a compile error here instead of a silently missing key.
 */
const countByDimensionSchema = z.object({
  textStructureCohesion: countSchema,
  vocabularyLexicalDensity: countSchema,
  grammarSyntax: countSchema,
  topicRelevanceContentCoverage: countSchema,
});
null satisfies Record<RubricDimension, number> extends z.infer<typeof countByDimensionSchema> ? null : never;

export const gradingReportViewSchema = z.discriminatedUnion('access', [
  z.object({ access: z.literal('withheld'), reason: z.literal('flaggedForReview') }),
  z.object({
    access: z.literal('locked'),
    overallScore: z.number(),
    overallBand: z.string(),
    annotationCount: countSchema,
    annotationCountByDimension: countByDimensionSchema,
    workedExample: workedExampleViewSchema.nullable(),
  }),
  z.object({
    access: z.literal('full'),
    result: gradingResultSchema,
    workedExample: workedExampleViewSchema.nullable(),
  }),
]);

// What the parse produces must fit the hand-written type the UI is written
// against — a field the schema forgot would otherwise be `undefined` at
// runtime under a type that says it is there. (One direction only: the
// type's `readonly` arrays are not assignable back to the schema's mutable ones.)
type Parsed = z.infer<typeof gradingReportViewSchema>;
null satisfies Parsed extends GradingReportView ? null : never;
