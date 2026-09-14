import { describe, expect, it } from 'vitest';
import {
  essaySubmissionRequestSchema,
  MAX_ESSAY_CONTENT_CHARS,
  MAX_REQUEST_BODY_BYTES,
} from './essay-submission';

// Round-1 review (should-fix): there was no contract test file at all before
// this — the boundary was asserted only at the route level
// (route.test.ts), and that suite explicitly deferred the exact-character
// boundary to "the schema-level test", which didn't exist. This file is
// that test, and pins the thing the route-level suite cannot: that the two
// caps are genuinely different limits, not the same number read two ways
// (see this schema's own comment for the German-umlaut bug that happened
// when they were).
describe('essaySubmissionRequestSchema — the character cap', () => {
  it('accepts content exactly at the character cap', () => {
    const content = 'a'.repeat(MAX_ESSAY_CONTENT_CHARS);

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
    const content = 'ü'.repeat(11_000);

    expect(essaySubmissionRequestSchema.safeParse({ content }).success).toBe(true);
  });
});

describe('MAX_ESSAY_CONTENT_CHARS and MAX_REQUEST_BODY_BYTES — two different limits, not one number in two units', () => {
  it('the transport guard is a distinctly larger number than the character cap, not the same one', () => {
    expect(MAX_REQUEST_BODY_BYTES).toBeGreaterThan(MAX_ESSAY_CONTENT_CHARS);
  });

  it('the transport guard has enough headroom for the character cap worth of content even in the most expensive encoding a UTF-16 code unit can take (3 bytes, e.g. many non-Latin scripts), plus the JSON envelope', () => {
    const worstCaseContentBytes = MAX_ESSAY_CONTENT_CHARS * 3;
    const envelopeOverhead = Buffer.byteLength(JSON.stringify({ content: '' }), 'utf8');

    expect(worstCaseContentBytes + envelopeOverhead).toBeLessThan(MAX_REQUEST_BODY_BYTES);
  });
});
