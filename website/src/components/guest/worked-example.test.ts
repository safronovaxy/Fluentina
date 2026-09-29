import { describe, expect, it } from 'vitest';
import type { GradingAnnotation } from '@/lib/contracts/grading';
import { pickWorkedExample } from './worked-example';

const ESSAY = 'Ich gehe heute ins Kino. Gestern bin ich zu Hause geblieben, weil es regnete. Morgen fahre ich nach Berlin.';

/** An annotation over the first occurrence of `quote` in `essay` — what `resolveAnnotationSpans` would have produced. */
function annotate(
  quote: string,
  overrides: Partial<GradingAnnotation> = {},
  essay: string = ESSAY,
): GradingAnnotation {
  const start = essay.indexOf(quote);
  if (start === -1) throw new Error(`fixture quote not in essay: ${quote}`);
  return {
    start,
    end: start + quote.length,
    dimension: 'grammarSyntax',
    severity: 'moderate',
    message: 'Explanation.',
    suggestion: null,
    ...overrides,
  };
}

describe('pickWorkedExample — the sentence is cut out of the guest\'s own essay (KAN-18 AC: "a real sentence from their own essay")', () => {
  it('returns the sentence containing the error, split around the highlighted span', () => {
    const example = pickWorkedExample(ESSAY, [annotate('bin ich zu Hause geblieben')]);

    expect(example).toMatchObject({
      before: 'Gestern ',
      highlighted: 'bin ich zu Hause geblieben',
      after: ', weil es regnete.',
    });
  });

  it('the highlight is exactly the annotation span of the essay, never re-derived', () => {
    const annotation = annotate('regnete');
    const example = pickWorkedExample(ESSAY, [annotation]);

    expect(example?.highlighted).toBe(ESSAY.slice(annotation.start, annotation.end));
    expect(example?.annotation).toBe(annotation);
  });

  it('a span in the first sentence starts at the essay start, in the last ends at the essay end', () => {
    const first = pickWorkedExample(ESSAY, [annotate('heute')]);
    const last = pickWorkedExample(ESSAY, [annotate('Berlin')]);

    expect(first).toMatchObject({ before: 'Ich gehe ', after: ' ins Kino.' });
    expect(last).toMatchObject({ before: 'Morgen fahre ich nach ', after: '.' });
  });

  it('does not carry leading whitespace or the previous sentence into the example', () => {
    const essay = '  Erster Satz.   Zweiter Satz hat einen Fehler.';
    const example = pickWorkedExample(essay, [annotate('Fehler', {}, essay)]);

    expect(example?.before).toBe('Zweiter Satz hat einen ');
  });

  it('treats a line break as a sentence boundary — an essay of unpunctuated lines does not become one sentence', () => {
    const essay = 'Liebe Anna\nich habe dich vermisst\nBis bald';
    const example = pickWorkedExample(essay, [annotate('vermisst', {}, essay)]);

    expect(example).toMatchObject({ before: 'ich habe dich ', highlighted: 'vermisst', after: '' });
  });

  // Not a sentence-segmenter: an abbreviation followed by a space ("z. B. ")
  // still splits, which only shortens the context shown — the highlight
  // itself never depends on it. A full stop with no whitespace after it is
  // not treated as a boundary at all.
  it('does not split a sentence at a full stop that is not followed by whitespace ("3.5")', () => {
    const essay = 'Ich habe 3.5 Stunden Grammatik gelernt. Danach schlief ich.';
    const example = pickWorkedExample(essay, [annotate('Grammatik', {}, essay)]);

    expect(example).toMatchObject({ before: 'Ich habe 3.5 Stunden ', after: ' gelernt.' });
  });

  it('a span that itself ends on the terminator ends the sentence there', () => {
    const example = pickWorkedExample(ESSAY, [annotate('ins Kino.')]);

    expect(example).toMatchObject({ before: 'Ich gehe heute ', highlighted: 'ins Kino.', after: '' });
  });

  it('trims a very long lead-in and tail to a word boundary with an ellipsis, never mid-word', () => {
    const lead = 'wort '.repeat(60);
    const tail = ' ende'.repeat(60);
    const essay = `${lead}FEHLER${tail}.`;
    const example = pickWorkedExample(essay, [annotate('FEHLER', {}, essay)]);

    expect(example?.before.startsWith('…wort ')).toBe(true);
    expect(example?.before.length).toBeLessThanOrEqual(121);
    expect(example?.after.endsWith(' ende…')).toBe(true);
    expect(example?.highlighted).toBe('FEHLER');
  });
});

describe('pickWorkedExample — which annotation is chosen', () => {
  it('prefers the highest severity', () => {
    const minor = annotate('heute', { severity: 'minor' });
    const major = annotate('Berlin', { severity: 'major' });
    const moderate = annotate('regnete', { severity: 'moderate' });

    expect(pickWorkedExample(ESSAY, [minor, major, moderate])?.annotation).toBe(major);
    expect(pickWorkedExample(ESSAY, [minor, moderate])?.annotation).toBe(moderate);
  });

  it('among equal severities, prefers one that carries a suggested fix — a worked example shows the correction', () => {
    const bare = annotate('heute', { suggestion: null });
    const withFix = annotate('Berlin', { suggestion: 'nach Berlin' });

    expect(pickWorkedExample(ESSAY, [bare, withFix])?.annotation).toBe(withFix);
  });

  it('otherwise takes the earliest in the essay, whatever order they arrive in', () => {
    const early = annotate('heute');
    const late = annotate('Berlin');

    expect(pickWorkedExample(ESSAY, [late, early])?.annotation).toBe(early);
  });

  it('does not reorder the caller\'s array', () => {
    const annotations = [annotate('Berlin'), annotate('heute', { severity: 'major' })];
    const snapshot = [...annotations];

    pickWorkedExample(ESSAY, annotations);

    expect(annotations).toEqual(snapshot);
  });
});

describe('pickWorkedExample — never invents an example', () => {
  it('returns null when there are no annotations', () => {
    expect(pickWorkedExample(ESSAY, [])).toBeNull();
  });

  it.each([
    ['ends past the end of the essay', { start: 100, end: ESSAY.length + 5 }],
    ['starts before the essay', { start: -1, end: 4 }],
    // slice() counts a negative start from the END, so this one would
    // quietly highlight the essay's last three characters if not rejected.
    ['starts before the essay but would wrap around to real text', { start: -3, end: ESSAY.length }],
    ['is empty', { start: 5, end: 5 }],
    ['is inverted', { start: 9, end: 4 }],
    ['is fractional', { start: 1.5, end: 4 }],
    ['covers only whitespace', { start: ESSAY.indexOf(' '), end: ESSAY.indexOf(' ') + 1 }],
  ])('skips a span that %s, rather than highlighting the wrong words', (_label, span) => {
    const broken = { ...annotate('heute'), ...span, severity: 'major' as const };

    expect(pickWorkedExample(ESSAY, [broken])).toBeNull();
  });

  it('falls back to the next usable annotation when the best-ranked one does not fit the essay', () => {
    const broken = { ...annotate('heute'), start: 500, end: 510, severity: 'major' as const };
    const usable = annotate('Berlin', { severity: 'minor' });

    expect(pickWorkedExample(ESSAY, [broken, usable])?.annotation).toBe(usable);
  });
});
