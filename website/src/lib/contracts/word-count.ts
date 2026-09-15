/**
 * KAN-15 — the single, shared German word-counting rule. Everything that
 * needs to know how long an essay is — the live counter (`WordCountLabel`),
 * the 150-200 recommended-range guidance, the 201-300 non-blocking warning,
 * and the <50/>300 hard blocks, on BOTH the client (`EssayEntryForm`) and
 * the server (`essaySubmissionRequestSchema`'s `.superRefine`, the seam that
 * schema's own comment names) — reads off `countGermanWords` and the
 * thresholds below, and only these. A second implementation anywhere would
 * mean a guest the client told "you're fine" gets rejected by the server
 * for a count the two never agreed on; this file exists so that can't
 * happen.
 *
 * lib/contracts, not lib/domain: this needs to run in the browser, on every
 * keystroke, and `lib/domain` is `server-only` by convention (see
 * essay-submission.ts, lib/domain) — importing it from a client component
 * fails the build. `countGermanWords` and `classifyEssayLength` are pure
 * functions with no database, no actor and no side effects, which is the
 * same class of thing `MAX_ESSAY_CONTENT_CHARS` already is in this
 * directory, not the kind of business logic (row ownership, persistence)
 * `lib/contracts` is otherwise kept free of — see CONTRIBUTING.md's layering
 * table for that line.
 *
 * THE WORD-COUNTING RULE, AND WHY: split on runs of whitespace after
 * trimming, and count the resulting non-empty tokens. That's it — the same
 * rule a word processor's own word count uses, and the number every B2
 * learner is already calibrated to from having written essays before. JS's
 * `\s` in a RegExp already covers tabs, newlines and the non-breaking space
 * (U+00A0) a paste from Word or Google Docs carries, so nothing extra is
 * needed for that. Deliberately NOT restricted to a particular alphabet or
 * script, nor aware of German morphology at all — that's what makes it
 * correct for German specifically, not despite it:
 *
 *  - Compounds ("Rechtsschutzversicherungsgesellschaft") count as ONE word.
 *    Correct: German legitimately treats a compound as a single word, and a
 *    "smarter" tokenizer that split compounds into their constituent parts
 *    would need a dictionary this product doesn't have, and would inflate
 *    every learner's count relative to what they actually wrote and relative
 *    to how the Goethe exam itself counts.
 *  - Hyphenated forms ("E-Mail", "Frankfurt-Hauptbahnhof") count as ONE word,
 *    for the same reason: no internal whitespace, and that's how a human
 *    counting by hand would count them too.
 *  - Numbers and dates ("1.000", "15.09.2026") count as ONE token each — no
 *    internal whitespace to split on.
 *  - Abbreviations with an internal period, written with a space per German
 *    style ("z. B.", "u. a."), count as TWO tokens — an accepted, minor
 *    over-count, and the same one a word processor's own count produces for
 *    the same text.
 *  - ß and the umlauts (äöüÄÖÜ) need no special
 *    case at all: they're ordinary letters inside a token, never whitespace,
 *    so they never influence where a split happens.
 *  - A non-breaking space (U+00A0) — what a paste from Word or Google Docs
 *    often inserts between an amount and its unit — is still whitespace as
 *    far as counting goes: JS's `\s` in a RegExp matches U+00A0 the same as
 *    an ordinary space, so it still separates two tokens rather than
 *    gluing them into one. A non-breaking space changes how a browser is
 *    allowed to LINE-WRAP text, not whether it separates two words when
 *    counting them — those are different questions, and only the second
 *    one is this function's concern.
 *
 * Known, accepted edge case: a lone hyphen or dash surrounded by spaces
 * ("der Vortrag - kurz gesagt -") counts as its own "word". Rare in a real
 * B2 essay, and fixing it would need punctuation-aware tokenisation this
 * product has no other use for — not worth the complexity for an edge case
 * that, if anything, makes the count a small OVER-estimate, never an
 * under-estimate that could block a guest who is actually within range.
 */

/** Counts words in `content` by the rule this file documents above. */
export function countGermanWords(content: string): number {
  const trimmed = content.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * BR-1.4 through BR-1.7's thresholds, in one place. `MIN_ESSAY_WORDS` and
 * `MAX_ESSAY_WORDS` are the two enforced (client AND server) hard bounds;
 * `RECOMMENDED_MIN_WORDS`/`RECOMMENDED_MAX_WORDS` are guidance only and
 * never block a submission on their own.
 */
export const MIN_ESSAY_WORDS = 50;
export const RECOMMENDED_MIN_WORDS = 150;
export const RECOMMENDED_MAX_WORDS = 200;
export const MAX_ESSAY_WORDS = 300;

/**
 * The five length states an essay's word count can be in. Boundaries are
 * all inclusive on their lower edge, per the acceptance criteria's own
 * wording ("150 to 200 words" reads as the recommended banner starting
 * exactly at 150 and still showing at exactly 200; "201 to 300" as the
 * warning starting exactly at 201):
 *
 *   < 50            -> tooShort        (blocked)
 *   50  - 149       -> belowRecommended (no guidance shown at all)
 *   150 - 200       -> recommended      (guidance banner)
 *   201 - 300       -> overRecommended  (non-blocking warning, still submittable)
 *   > 300           -> tooLong         (blocked)
 */
export type EssayLengthStatus = 'tooShort' | 'belowRecommended' | 'recommended' | 'overRecommended' | 'tooLong';

export function classifyEssayLength(wordCount: number): EssayLengthStatus {
  if (wordCount < MIN_ESSAY_WORDS) return 'tooShort';
  if (wordCount < RECOMMENDED_MIN_WORDS) return 'belowRecommended';
  if (wordCount <= RECOMMENDED_MAX_WORDS) return 'recommended';
  if (wordCount <= MAX_ESSAY_WORDS) return 'overRecommended';
  return 'tooLong';
}

/** `true` for exactly the two states BR-1.7 says must block submission. */
export function isEssayLengthBlocked(status: EssayLengthStatus): boolean {
  return status === 'tooShort' || status === 'tooLong';
}
