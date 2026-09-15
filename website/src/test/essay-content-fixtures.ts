/**
 * Test-only fixture builders for essay `content` — shared across every
 * vitest suite that needs a word count, a character length, or both, to be
 * something specific and controllable.
 *
 * Round-2 review (KAN-15): before this file existed, `wordsContent`/`words`
 * and `contentOfExactLength` were each defined inline, once per file, in
 * `lib/contracts/essay-submission.test.ts`, `lib/contracts/word-count.test.ts`,
 * `app/api/essays/route.test.ts` and `components/guest/EssayEntryForm.test.tsx`
 * — and `contentOfExactLength` specifically was applied only to the
 * accept-side tests in the one file that defined it, leaving that same
 * file's own reject-side test one axis away from the thing it actually
 * proved (see essay-submission.test.ts's own history, and route.test.ts's).
 * A single, shared definition is what makes the NEXT global constraint
 * (whatever it is) something a story applies once, here, instead of a
 * re-audit of every previous story's own inline literals scattered across
 * four files that happened to agree today.
 *
 * Every builder here produces content that is valid on every axis it isn't
 * explicitly asked to violate — in particular, `wordsContent` and
 * `mixedWhitespaceContent` never approach `MAX_ESSAY_CONTENT_CHARS` for any
 * word count a real test uses, and `contentOfExactLength` takes the word
 * count as an explicit, separate parameter from the character length for
 * exactly that reason: a caller pinning one axis must say what the other
 * one is, rather than getting whatever a single giant token happens to
 * produce (one word, by `countGermanWords`' own rule).
 */

/** `n` distinct, single-space-separated tokens — `countGermanWords(wordsContent(n)) === n`. */
export function wordsContent(n: number): string {
  return Array.from({ length: n }, (_, i) => `Wort${i}`).join(' ');
}

/**
 * `label`, followed by enough generic filler tokens to comfortably clear the
 * 50-word floor (60 words total) — for tests that need SOME valid essay
 * content but aren't testing length at all (cookie/session/cross-origin/
 * ownership behaviour). `label` stays human-readable at the front so a
 * failing assertion is still legible.
 */
export function validLengthContent(label: string): string {
  return `${label} ${wordsContent(60)}`;
}

/**
 * The same `n` tokens as `wordsContent`, joined with paragraph breaks
 * (double newline), a tab, and a double space after a full stop mixed
 * through the list, instead of single spaces throughout — real pasted B2
 * essay text, not the single-space fixture every boundary test in this
 * suite otherwise uses. Proves `countGermanWords` (both client- and
 * server-side) counts real whitespace correctly, not merely
 * `content.split(' ')`-shaped input — see word-count.ts's own comment.
 */
export function mixedWhitespaceContent(n: number): string {
  const tokens = Array.from({ length: n }, (_, i) => `Wort${i}`);
  return tokens
    .map((token, i) => {
      if (i === 0) return token;
      if (i % 10 === 0) return `\n\n${token}`;
      if (i % 7 === 0) return `\t${token}`;
      if (i % 3 === 0) return `.  ${token}`;
      return ` ${token}`;
    })
    .join('');
}

/**
 * Builds a string of exactly `totalChars` characters, split into exactly
 * `wordCount` whitespace-separated tokens — so the character-length axis and
 * the word-count axis can each be pinned independently. A single giant
 * `fillerChar.repeat(totalChars)` token is one "word" by `countGermanWords`'
 * own rule, which trips the 50-300 word-count bound a character-cap test is
 * not testing (or, for a reject-side character-cap test, trips it for the
 * WRONG reason — see this file's own top comment).
 */
export function contentOfExactLength(totalChars: number, wordCount: number, fillerChar = 'a'): string {
  const spaceChars = wordCount - 1;
  const charsForWords = totalChars - spaceChars;
  const baseLen = Math.floor(charsForWords / wordCount);
  const remainder = charsForWords - baseLen * wordCount;
  const tokens = Array.from({ length: wordCount }, (_, i) => fillerChar.repeat(baseLen + (i < remainder ? 1 : 0)));
  return tokens.join(' ');
}
