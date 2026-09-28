/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { resolveAnnotationSpans } from './span-resolution';
import type { ProviderAnnotation } from '@/lib/contracts/grading';

function annotation(overrides: Partial<ProviderAnnotation> = {}): ProviderAnnotation {
  return {
    quote: 'ein Fehler',
    dimension: 'grammarSyntax',
    severity: 'minor',
    message: 'A grammar issue.',
    ...overrides,
  };
}

describe('resolveAnnotationSpans — BR-3.3 span verification', () => {
  it('resolves a quote that appears verbatim in the essay to the correct start/end offsets', () => {
    const essay = 'Das war ein Fehler von mir.';
    const { annotations, allSpansValid } = resolveAnnotationSpans([annotation({ quote: 'ein Fehler' })], essay);

    expect(allSpansValid).toBe(true);
    expect(annotations).toHaveLength(1);
    const [a] = annotations;
    expect(essay.slice(a.start, a.end)).toBe('ein Fehler');
  });

  it('BR-3.5/BR-3.3: drops an annotation whose quote was fabricated — not found verbatim in the essay — rather than guessing a span', () => {
    const essay = 'Das war ein Fehler von mir.';
    const { annotations, allSpansValid } = resolveAnnotationSpans(
      [annotation({ quote: 'this text does not appear in the essay at all' })],
      essay,
    );

    expect(annotations).toHaveLength(0);
    expect(allSpansValid).toBe(false);
  });

  it('keeps valid annotations and drops only the invalid ones, reporting the batch as invalid overall', () => {
    const essay = 'Das war ein Fehler von mir.';
    const { annotations, allSpansValid } = resolveAnnotationSpans(
      [annotation({ quote: 'ein Fehler' }), annotation({ quote: 'fabricated quote' })],
      essay,
    );

    expect(annotations).toHaveLength(1);
    expect(allSpansValid).toBe(false);
  });

  it('reports validity as vacuously true for zero annotations', () => {
    const { annotations, allSpansValid } = resolveAnnotationSpans([], 'Any essay text.');
    expect(annotations).toEqual([]);
    expect(allSpansValid).toBe(true);
  });

  it('preserves dimension/severity/message/suggestion on a resolved annotation', () => {
    const essay = 'Ein Beispiel Satz.';
    const { annotations } = resolveAnnotationSpans(
      [annotation({ quote: 'Beispiel', dimension: 'vocabularyLexicalDensity', severity: 'major', message: 'msg', suggestion: 'sug' })],
      essay,
    );
    expect(annotations[0]).toMatchObject({ dimension: 'vocabularyLexicalDensity', severity: 'major', message: 'msg', suggestion: 'sug' });
  });

  it('maps a missing optional suggestion to null, never undefined, on the resolved annotation', () => {
    const essay = 'Ein Beispiel Satz.';
    const { annotations } = resolveAnnotationSpans([annotation({ quote: 'Beispiel', suggestion: undefined })], essay);
    expect(annotations[0].suggestion).toBeNull();
  });

  // KAN-16 round-1 review, finding 18: this file's own top comment documents
  // "indexOf finds the FIRST occurrence only" as an accepted limitation, but
  // nothing pinned it — switching to `lastIndexOf` (or any other occurrence)
  // would go unnoticed. Pinned directly against a quote that repeats.
  it('resolves a repeated quote to its FIRST occurrence, per this file\'s own documented limitation', () => {
    const essay = 'ein Fehler taucht hier auf, und dann taucht ein Fehler noch einmal auf.';
    const firstOccurrenceStart = essay.indexOf('ein Fehler');
    const secondOccurrenceStart = essay.indexOf('ein Fehler', firstOccurrenceStart + 1);
    expect(secondOccurrenceStart).toBeGreaterThan(firstOccurrenceStart); // sanity: the essay really does repeat the quote

    const { annotations } = resolveAnnotationSpans([annotation({ quote: 'ein Fehler' })], essay);

    expect(annotations[0].start).toBe(firstOccurrenceStart);
    expect(annotations[0].start).not.toBe(secondOccurrenceStart);
  });
});
