/**
 * Fixtures for the KAN-19 tests that decide what a caller may be told about a
 * finished grade (`grading-status.test.ts`, the grading route's test).
 *
 * Every string that must NOT reach a guest is a distinct, greppable marker, so
 * "the serialised response contains none of these" is an allow-list check
 * that a leak fails whichever field it goes through. The shown example's own
 * message and suggestion are the only marker strings a guest may see.
 */
import { RUBRIC_DIMENSIONS, bandForScore, type GradingAnnotation, type GradingResult } from '@/lib/contracts/grading';

export const REPORT_ESSAY =
  'Ich gehe heute ins Kino. Gestern bin ich zu Hause geblieben, weil es regnete. Morgen fahre ich nach Berlin und besuche meine Freundin.';

function span(quote: string, overrides: Omit<GradingAnnotation, 'start' | 'end'>): GradingAnnotation {
  const start = REPORT_ESSAY.indexOf(quote);
  if (start === -1) throw new Error(`fixture quote not in essay: ${quote}`);
  return { start, end: start + quote.length, ...overrides };
}

/** What the guest IS shown: highest severity, and it has a suggestion. */
export const SHOWN_MESSAGE = 'SHOWN-MESSAGE verb position';
export const SHOWN_SUGGESTION = 'SHOWN-SUGGESTION Gestern bin ich zu Hause geblieben';

export const REPORT_ANNOTATIONS: readonly GradingAnnotation[] = [
  span('heute', { dimension: 'grammarSyntax', severity: 'minor', message: 'HIDDEN-MESSAGE-3', suggestion: null }),
  span('bin ich zu Hause geblieben', { dimension: 'grammarSyntax', severity: 'major', message: SHOWN_MESSAGE, suggestion: SHOWN_SUGGESTION }),
  span('besuche', { dimension: 'vocabularyLexicalDensity', severity: 'moderate', message: 'HIDDEN-MESSAGE-2', suggestion: 'HIDDEN-SUGGESTION-2' }),
  span('Berlin', { dimension: 'topicRelevanceContentCoverage', severity: 'minor', message: 'HIDDEN-MESSAGE-4', suggestion: null }),
  span('weil', { dimension: 'textStructureCohesion', severity: 'minor', message: 'HIDDEN-MESSAGE-5', suggestion: 'HIDDEN-SUGGESTION-5' }),
];

/** Grammar 2, vocabulary 1, topic 1, structure 1 — five in all. */
export const REPORT_COUNTS_BY_DIMENSION = {
  textStructureCohesion: 1,
  vocabularyLexicalDensity: 1,
  grammarSyntax: 2,
  topicRelevanceContentCoverage: 1,
} as const;

export const REPORT_SUMMARY = 'HIDDEN-SUMMARY Eine ausführliche Zusammenfassung des Aufsatzes.';

export function reportDimensionComment(dimension: string): string {
  return `HIDDEN-COMMENT-${dimension}`;
}

export function richResult(overrides: Partial<GradingResult> = {}): GradingResult {
  return {
    overallScore: 82,
    overallBand: bandForScore(82),
    dimensions: RUBRIC_DIMENSIONS.map((dimension, i) => ({ dimension, score: 70 + i, comment: reportDimensionComment(dimension) })),
    annotations: REPORT_ANNOTATIONS,
    summary: REPORT_SUMMARY,
    flaggedForReview: false,
    ...overrides,
  };
}

/** Every marker a guest must never receive. */
export function withheldFromGuest(result: GradingResult = richResult()): string[] {
  return [
    result.summary,
    ...result.dimensions.map((d) => d.comment),
    ...result.annotations.filter((a) => a.message !== SHOWN_MESSAGE).map((a) => a.message),
    ...result.annotations.map((a) => a.suggestion).filter((s): s is string => s !== null && s !== SHOWN_SUGGESTION),
  ];
}

/** Essay text that belongs to withheld annotations' spans and lies outside the shown sentence. */
export const WITHHELD_SPAN_TEXT = ['heute', 'besuche', 'Berlin'] as const;
