import { describe, expect, it } from 'vitest';
import {
  essaySubmissionRequestSchema,
  MAX_ESSAY_CONTENT_CHARS,
  MAX_REQUEST_BODY_BYTES,
} from './essay-submission';
import { MIN_ESSAY_WORDS, MAX_ESSAY_WORDS, RECOMMENDED_MIN_WORDS, RECOMMENDED_MAX_WORDS } from './word-count';

/**
 * Builds a string of exactly `totalChars` characters, split into exactly
 * `wordCount` whitespace-separated tokens.
 *
 * KAN-15: the character-cap tests below used to build content with a
 * single giant `'a'.repeat(N)` token — one "word" by `countGermanWords`'s
 * own rule. Now that the schema also enforces the 50-300 word-count bound
 * in the same pass (see essaySubmissionRequestSchema's own comment), that
 * single-token construction trips the NEW <50-word block too, which is not
 * what these tests exist to pin. This builds content that hits an exact
 * character length while keeping word count wherever the caller wants it,
 * so the character-cap boundary can still be tested in isolation.
 */
function contentOfExactLength(totalChars: number, wordCount: number, fillerChar = 'a'): string {
  const spaceChars = wordCount - 1;
  const charsForWords = totalChars - spaceChars;
  const baseLen = Math.floor(charsForWords / wordCount);
  const remainder = charsForWords - baseLen * wordCount;
  const tokens = Array.from({ length: wordCount }, (_, i) => fillerChar.repeat(baseLen + (i < remainder ? 1 : 0)));
  return tokens.join(' ');
}

// Round-1 review (should-fix): there was no contract test file at all before
// this — the boundary was asserted only at the route level
// (route.test.ts), and that suite explicitly deferred the exact-character
// boundary to "the schema-level test", which didn't exist. This file is
// that test, and pins the thing the route-level suite cannot: that the two
// caps are genuinely different limits, not the same number read two ways
// (see this schema's own comment for the German-umlaut bug that happened
// when they were).
describe('essaySubmissionRequestSchema — the character cap', () => {
  it('accepts content exactly at the character cap, with a word count safely inside the KAN-15 bounds', () => {
    const content = contentOfExactLength(MAX_ESSAY_CONTENT_CHARS, 250);
    expect(content.length).toBe(MAX_ESSAY_CONTENT_CHARS);

    expect(essaySubmissionRequestSchema.safeParse({ content }).success).toBe(true);
  });

  it('rejects content one character over the cap', () => {
    const content = 'a'.repeat(MAX_ESSAY_CONTENT_CHARS + 1);

    expect(essaySubmissionRequestSchema.safeParse({ content }).success).toBe(false);
  });

  it('counts UTF-16 code units, not UTF-8 bytes — 11,000 German umlauts (22,000 bytes) is comfortably under the 20,000-character cap', () => {
    // An umlaut is 1 character (1 UTF-16 code unit) but 2 bytes in UTF-8.
    // 11,000 of them is half the character cap, and would have tripped the
    // old, single MAX_ESSAY_CONTENT_BYTES=20,000 read as a byte count.
    const content = contentOfExactLength(11_000, 200, 'ü');

    expect(essaySubmissionRequestSchema.safeParse({ content }).success).toBe(true);
  });
});

describe('MAX_ESSAY_CONTENT_CHARS and MAX_REQUEST_BODY_BYTES — two different limits, not one number in two units', () => {
  it('the transport guard is a distinctly larger number than the character cap, not the same one', () => {
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(MAX_ESSAY_CONTENT_CHARS);
  });

  it('the transport guard has enough headroom for the character cap worth of content even in the most expensive encoding a JSON-escaped character can take (6 bytes — a control character other than the common whitespace ones escapes to `\\u00XX`, not merely the 3-byte raw-UTF-8 worst case — round-2 review), plus the JSON envelope', () => {
    const worstCaseContentBytes = MAX_ESSAY_CONTENT_CHARS * 6;
    const envelopeOverhead = Buffer.byteLength(JSON.stringify({ content: '' }), 'utf8');

    expect(worstCaseContentBytes + envelopeOverhead).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });

  it('a real JSON body of control characters at the character cap does not exceed the transport guard — the invariant above pinned against the actual worst-case encoding, not merely asserted arithmetically (round-2 review)', () => {
    // U+0001 (start of heading) is a control character outside the
    // \b \f \n \r \t set JSON.stringify escapes to 2 bytes — it costs the
    // full 6-byte \u00XX escape, the worst case this guard is sized for.
    const content = '\u0001'.repeat(MAX_ESSAY_CONTENT_CHARS);
    const body = JSON.stringify({ content });

    expect(content.length).toBe(MAX_ESSAY_CONTENT_CHARS);
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });
});

/**
 * KAN-15 (BR-1.4 through BR-1.7) — the real word-count rule, at the schema
 * level. This is the layer route.test.ts's own "bypasses the browser
 * entirely" tests build on: proving the RULE holds here, independent of
 * any particular HTTP request shape, is what makes the route-level tests
 * meaningful rather than circular. Boundaries only, per the story's own
 * instruction — 49/50/51, 150, 200/201, 300/301 — not the middles.
 */
describe('essaySubmissionRequestSchema — the KAN-15 word-count bounds', () => {
  function wordsContent(n: number): string {
    return Array.from({ length: n }, (_, i) => `Wort${i}`).join(' ');
  }

  it('rejects 49 words — one under the 50-word minimum — as too short to grade', () => {
    const result = essaySubmissionRequestSchema.safeParse({ content: wordsContent(MIN_ESSAY_WORDS - 1) });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.code === 'custom');
      expect(issue?.params?.reason).toBe('tooShort');
    }
  });

  it('accepts exactly 50 words — the minimum itself is allowed, not blocked', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(MIN_ESSAY_WORDS) }).success).toBe(true);
  });

  it('accepts 51 words', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(MIN_ESSAY_WORDS + 1) }).success).toBe(true);
  });

  it('accepts 150 words — the start of the recommended range, which is guidance only and never blocks', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(RECOMMENDED_MIN_WORDS) }).success).toBe(true);
  });

  it('accepts 200 words — the end of the recommended range', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(RECOMMENDED_MAX_WORDS) }).success).toBe(true);
  });

  it('accepts 201 words — over the recommended range, but only a non-blocking warning, not a rejection', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(RECOMMENDED_MAX_WORDS + 1) }).success).toBe(true);
  });

  it('accepts exactly 300 words — the hard ceiling itself is allowed, not blocked', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(MAX_ESSAY_WORDS) }).success).toBe(true);
  });

  it('rejects 301 words — one over the 300-word hard ceiling', () => {
    const result = essaySubmissionRequestSchema.safeParse({ content: wordsContent(MAX_ESSAY_WORDS + 1) });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.code === 'custom');
      expect(issue?.params?.reason).toBe('tooLong');
    }
  });

  it('accepts 220 words — the story\'s own "never blocked" verification case', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(220) }).success).toBe(true);
  });

  it('rejects 1000 words — the story\'s own "blocked" verification case', () => {
    expect(essaySubmissionRequestSchema.safeParse({ content: wordsContent(1000) }).success).toBe(false);
  });

  it('the too-short and too-long messages are distinct — never a generic error for either (BR-1.7)', () => {
    const tooShort = essaySubmissionRequestSchema.safeParse({ content: wordsContent(10) });
    const tooLong = essaySubmissionRequestSchema.safeParse({ content: wordsContent(500) });

    expect(tooShort.success).toBe(false);
    expect(tooLong.success).toBe(false);
    if (!tooShort.success && !tooLong.success) {
      const shortMessage = tooShort.error.issues.find((i) => i.code === 'custom')?.message;
      const longMessage = tooLong.error.issues.find((i) => i.code === 'custom')?.message;
      expect(shortMessage).toBeDefined();
      expect(longMessage).toBeDefined();
      expect(shortMessage).not.toBe(longMessage);
    }
  });

  // Round-1 review (should-fix #2): every fixture above, and in every other
  // KAN-15 suite, is single-space-separated tokens. The Test Lead proved
  // that's not incidental — swapping this schema's own call for a naive
  // `content.split(' ').filter(Boolean).length` left all 150 tests across
  // three suites green, because every one of them happens to build content
  // that a single-space split counts identically to countGermanWords. A
  // real B2 essay is paragraphs (newlines between them) and, often, pasted
  // word-processor text with two spaces after a full stop — content a
  // naive split miscounts. This fixture is deliberately NOT single-space:
  // paragraph breaks (double newline) every ten words, a tab, and a
  // double space after a full stop, mixed through the token list.
  function mixedWhitespaceContent(n: number): string {
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

  it('accepts 50 words separated by newlines, tabs and double spaces after a full stop — not the single-space fixture every other test in this suite uses', () => {
    const content = mixedWhitespaceContent(MIN_ESSAY_WORDS);
    expect(content).not.toMatch(/^\S+( \S+)*$/); // sanity: genuinely not single-space-only

    expect(essaySubmissionRequestSchema.safeParse({ content }).success).toBe(true);
  });

  it('rejects 49 words with the same mixed whitespace as too short — pins that the server side counts real pasted-essay whitespace correctly, not merely single-space fixtures', () => {
    const result = essaySubmissionRequestSchema.safeParse({ content: mixedWhitespaceContent(MIN_ESSAY_WORDS - 1) });

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.code === 'custom');
      expect(issue?.params?.reason).toBe('tooShort');
    }
  });

  // Round-1 review (should-fix #10): the rejection body is the schema's own
  // message, a static string today — but the essay content itself, and any
  // session identifier, must never end up in it regardless, matching the
  // "never logs essay text" rule this whole route is built against (see
  // route.test.ts's own console-output test for the same property at the
  // HTTP layer).
  it('the too-short rejection message contains neither the submitted content nor anything that looks like a session id', () => {
    const secretContent = wordsContent(10);
    const result = essaySubmissionRequestSchema.safeParse({ content: secretContent });

    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues.find((i) => i.code === 'custom')?.message ?? '';
      expect(message).not.toContain(secretContent);
      expect(message).not.toContain('Wort0');
    }
  });
});
