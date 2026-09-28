import 'server-only';

/**
 * KAN-16 (BR-3.3) — turns a provider's `quote`-based annotations into
 * verified `start`/`end` character offsets into the guest's ACTUAL essay
 * text, and is therefore also the "span validation" KAN-24's telemetry
 * (`spanValidationPassed`) reports on.
 *
 * Why quotes, not offsets, cross the wire from the provider: see
 * `lib/contracts/grading.ts`'s own top comment. This is the other half of
 * that decision — resolving a quote against the real string with
 * `String.prototype.indexOf`, which either finds an exact, unambiguous
 * substring or it doesn't; there is no interpretation step where a
 * fabricated span could sneak through.
 *
 * An annotation whose quote is not found verbatim in `essayContent` is
 * DROPPED, not kept with a best-guess span — a wrong span pointing at the
 * wrong part of a guest's own essay is worse than no annotation at all for
 * "specific errors tied to exact spans" (BR-3.3). `allSpansValid` reports
 * whether every annotation resolved cleanly, for KAN-24's telemetry — false
 * whenever at least one was dropped, which is exactly what a caller
 * verifying grading quality (Irina's BR-3.4 sanity check) needs to know: a
 * provider that frequently fabricates quotes shows up here, in aggregate,
 * without anyone reading essay text to notice it.
 *
 * Round-1 self-review: `indexOf` finds the FIRST occurrence only. A quote
 * that legitimately repeats in the essay (a repeated word or short phrase)
 * resolves to its first occurrence, which may not be the one the provider
 * meant — an accepted limitation, not a silent wrong answer: the resolved
 * span still points at a real, verbatim occurrence of that exact text in
 * the guest's own essay, which is what BR-3.3 actually asks for ("tied to
 * exact spans of the guest's own submitted text"), not "the specific
 * occurrence the model had in mind".
 */
import type { GradingAnnotation, ProviderAnnotation } from '@/lib/contracts/grading';

export interface ResolvedAnnotations {
  readonly annotations: readonly GradingAnnotation[];
  /** False whenever at least one provider annotation's quote could not be found verbatim in the essay. True (vacuously) when there were zero annotations to resolve. */
  readonly allSpansValid: boolean;
}

export function resolveAnnotationSpans(raw: readonly ProviderAnnotation[], essayContent: string): ResolvedAnnotations {
  const annotations: GradingAnnotation[] = [];
  let allSpansValid = true;

  for (const item of raw) {
    const start = essayContent.indexOf(item.quote);
    if (start === -1) {
      allSpansValid = false;
      continue;
    }
    annotations.push({
      start,
      end: start + item.quote.length,
      dimension: item.dimension,
      severity: item.severity,
      message: item.message,
      suggestion: item.suggestion ?? null,
    });
  }

  return { annotations, allSpansValid };
}
