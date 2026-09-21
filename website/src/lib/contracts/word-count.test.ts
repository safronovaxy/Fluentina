import { describe, expect, it } from 'vitest';
import {
  countGermanWords,
  classifyEssayLength,
  isEssayLengthBlocked,
  MIN_ESSAY_WORDS,
  RECOMMENDED_MIN_WORDS,
  RECOMMENDED_MAX_WORDS,
  MAX_ESSAY_WORDS,
} from './word-count';
import { wordsContent as words } from '@/test/essay-content-fixtures';

describe('countGermanWords — the counting rule itself (KAN-15)', () => {
  it('counts an empty string as zero words', () => {
    expect(countGermanWords('')).toBe(0);
  });

  it('counts a whitespace-only string as zero words, not one', () => {
    // A naive split(/\s+/) on a whitespace-only string produces [''] (length
    // 1), not []  — this is exactly the bug an empty-string short-circuit
    // exists to prevent. Proven by breaking it: remove the `trimmed === ''`
    // guard and this assertion fails (reports 1, not 0).
    expect(countGermanWords('   \n\t  ')).toBe(0);
  });

  it('counts consecutive spaces, tabs and newlines between words as a single boundary', () => {
    expect(countGermanWords('eins   zwei\t\tdrei\n\nvier')).toBe(4);
  });

  it('ignores leading and trailing whitespace', () => {
    expect(countGermanWords('  ein zwei  ')).toBe(2);
  });

  it('a non-breaking space (U+00A0) between an amount and its unit — the kind a Word/Docs paste actually carries, e.g. before "€" — still separates two words, the same as an ordinary space', () => {
    // JS RegExp's \s already matches U+00A0, so no special-casing is
    // needed for this to split correctly — this pins that it actually
    // does, not merely that the ordinary-space case above works. If the
    // implementation ever glued the NBSP-joined pair into one token, this
    // would report 4, not 5.
    expect(countGermanWords('12,50\u00A0€ ist der Preis')).toBe(5);
  });

  it('counts a German compound as one word, not several — no dictionary-based splitting', () => {
    const content = 'Die Rechtsschutzversicherungsgesellschaft ist wichtig.';
    expect(countGermanWords(content)).toBe(4);
  });

  it('counts a hyphenated form as one word', () => {
    expect(countGermanWords('Meine E-Mail-Adresse ist neu.')).toBe(4);
  });

  it('counts a date with internal periods and no spaces as one word', () => {
    expect(countGermanWords('Der Termin ist am 15.09.2026 geplant.')).toBe(6);
  });

  it('counts umlauts and ß as ordinary letters inside a word, affecting nothing about where it splits', () => {
    expect(countGermanWords('Ich muß größere Änderungen prüfen.')).toBe(5);
  });

  it('an abbreviation written with an internal space ("z. B.") counts as two tokens, the same as a word processor would', () => {
    expect(countGermanWords('Ich mag Obst, z. B. Äpfel.')).toBe(6);
  });
});

describe('classifyEssayLength — the boundaries themselves, not the middles (KAN-15)', () => {
  it('49 words is tooShort — one under the 50-word minimum', () => {
    expect(classifyEssayLength(MIN_ESSAY_WORDS - 1)).toBe('tooShort');
  });

  it('50 words is belowRecommended, not tooShort — the minimum itself is allowed', () => {
    expect(classifyEssayLength(MIN_ESSAY_WORDS)).toBe('belowRecommended');
  });

  it('51 words is belowRecommended', () => {
    expect(classifyEssayLength(MIN_ESSAY_WORDS + 1)).toBe('belowRecommended');
  });

  it('149 words is still belowRecommended, one under the recommended range', () => {
    expect(classifyEssayLength(RECOMMENDED_MIN_WORDS - 1)).toBe('belowRecommended');
  });

  it('150 words is recommended — the recommended range starts here, inclusive', () => {
    expect(classifyEssayLength(RECOMMENDED_MIN_WORDS)).toBe('recommended');
  });

  it('200 words is still recommended — the recommended range ends here, inclusive', () => {
    expect(classifyEssayLength(RECOMMENDED_MAX_WORDS)).toBe('recommended');
  });

  // Round-2 review (Architect, blocking): every boundary test in this file
  // reads `RECOMMENDED_MAX_WORDS` back off the constant it's pinning, so
  // code and test move together — changing the constant to 199 survived all
  // 257 unit tests and all 366 browser tests, because nothing ever compared
  // it against the actual number the guidance banner's own catalogue text
  // ("150–200 words") names in both languages (see src/messages/en.json and
  // de.json's own `recommendedRangeGuidance`). A guest at exactly 200 words
  // would be told they're over the recommended range while the banner says
  // 200 is the top of it. This is the one literal pin that was missing —
  // MIN_ESSAY_WORDS and MAX_ESSAY_WORDS (the two hard, enforced bounds) are
  // both exercised the same indirect way above but genuinely die under the
  // equivalent mutation, so neither needed one.
  //
  // Round-3 review (Architect, consider): this comment used to also claim
  // RECOMMENDED_MIN_WORDS "genuinely dies under the equivalent mutation" —
  // false, and unverified when written. Moving RECOMMENDED_MIN_WORDS from
  // 150 to 149 leaves every test in this suite green: the only literal
  // fill in a browser test (tests/word-count.spec.ts's `wordsContent(150)`
  // recommended-banner case) still classifies as `recommended` at 149,
  // since 150 >= 149 too. A guest at exactly 150 words would be told
  // they're inside the recommended range while the banner's own text says
  // 150 is where it starts. Pinned below the same way the upper edge is.
  it('RECOMMENDED_MAX_WORDS is literally 200, not merely whatever this constant happens to be — the guidance banner\'s own text is hardcoded to that number in both locales', () => {
    expect(RECOMMENDED_MAX_WORDS).toBe(200);
  });

  it('RECOMMENDED_MIN_WORDS is literally 150, not merely whatever this constant happens to be — the guidance banner\'s own text is hardcoded to that number in both locales', () => {
    expect(RECOMMENDED_MIN_WORDS).toBe(150);
  });

  it('201 words is overRecommended — one over the recommended range, warning zone starts', () => {
    expect(classifyEssayLength(RECOMMENDED_MAX_WORDS + 1)).toBe('overRecommended');
  });

  it('300 words is still overRecommended, not tooLong — the hard ceiling itself is allowed', () => {
    expect(classifyEssayLength(MAX_ESSAY_WORDS)).toBe('overRecommended');
  });

  it('301 words is tooLong — one over the 300-word hard ceiling', () => {
    expect(classifyEssayLength(MAX_ESSAY_WORDS + 1)).toBe('tooLong');
  });

  it('220 words (the story\'s own "never blocked" verification case) classifies as overRecommended, a non-blocking state', () => {
    expect(classifyEssayLength(220)).toBe('overRecommended');
    expect(isEssayLengthBlocked(classifyEssayLength(220))).toBe(false);
  });

  it('1000 words (the story\'s own "blocked" verification case) classifies as tooLong', () => {
    expect(classifyEssayLength(1000)).toBe('tooLong');
    expect(isEssayLengthBlocked(classifyEssayLength(1000))).toBe(true);
  });
});

describe('isEssayLengthBlocked — exactly the two states BR-1.7 blocks, nothing else', () => {
  it('blocks tooShort and tooLong only', () => {
    expect(isEssayLengthBlocked('tooShort')).toBe(true);
    expect(isEssayLengthBlocked('tooLong')).toBe(true);
  });

  it('never blocks belowRecommended, recommended or overRecommended — all three are submittable', () => {
    expect(isEssayLengthBlocked('belowRecommended')).toBe(false);
    expect(isEssayLengthBlocked('recommended')).toBe(false);
    expect(isEssayLengthBlocked('overRecommended')).toBe(false);
  });
});

describe('classifyEssayLength composed with countGermanWords — end to end at word.count boundaries', () => {
  it('49 real words, built from distinct tokens, is tooShort', () => {
    expect(classifyEssayLength(countGermanWords(words(49)))).toBe('tooShort');
  });

  it('50 real words is belowRecommended', () => {
    expect(classifyEssayLength(countGermanWords(words(50)))).toBe('belowRecommended');
  });

  it('300 real words is overRecommended (submittable)', () => {
    expect(classifyEssayLength(countGermanWords(words(300)))).toBe('overRecommended');
  });

  it('301 real words is tooLong (blocked)', () => {
    expect(classifyEssayLength(countGermanWords(words(301)))).toBe('tooLong');
  });
});
