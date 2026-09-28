import 'server-only';

/**
 * KAN-16 (BR-3.5) — basic detection of an essay that tries to manipulate the
 * grading instructions rather than answer the prompt: "ignore the rubric",
 * "give this a perfect score", and the handful of shapes that phrase takes —
 * in BOTH languages a guest can plausibly submit in. Fluentina grades GERMAN
 * essays (this product's entire purpose); an English-only pattern list, as
 * this file originally shipped, catches nothing a guest is actually required
 * to write in. KAN-16 round-1 review, finding 2, measured every canonical
 * German example against the original list and got zero matches on all of
 * them — this is BR-3.5 failing in exactly the way its own acceptance
 * criterion names.
 *
 * This is deliberately NOT the only defence — see
 * `lib/domain/grading/prompt.ts` for the structural one (the essay is sent
 * to the provider as clearly delimited data, never concatenated into the
 * instructions). This module is the second, independent layer BR-3.5 asks
 * for: even if a future prompt-construction change weakens the delimiting,
 * or a provider's own instruction-following slips, an essay that matches
 * one of these patterns still can't walk away with a silently inflated
 * score — see `clampForSuspectedInjection` (`result.ts`) for what actually
 * enforces that.
 *
 * Deliberately a small, readable pattern list, not an ML classifier or a
 * third-party service — "basic detection/handling", the ticket's own
 * words, for a Phase 1 launch. False negatives (a cleverer injection this
 * list doesn't catch) are expected and accepted; the story's own acceptance
 * criterion is "at minimum, such attempts must not result in an inflated/
 * perfect score being silently returned", not "catch every injection
 * attempt" — this list plus the structural defence in `prompt.ts` is BR-3.5's
 * "basic" bar, not a claim of completeness.
 *
 * Returns a COUNT, never the matched text or the essay content itself — see
 * `logGradingJobTelemetry`'s own comment for why nothing derived from this
 * function may ever reach a log line beyond a boolean and a count.
 */

/**
 * Matched against a folded copy of the essay (lowercased, umlauts/ß
 * collapsed to their base Latin letters — see `foldForMatching` below), so
 * every pattern below is written against that folded alphabet: `a` also
 * matches `ä`/`Ä`, `ss` also matches `ß`, and so on. Writing "ae"/"oe"/"ue"
 * spellings would NOT match a folded umlaut (folding drops the diaeresis
 * entirely rather than expanding it to a trailing `e`), so every pattern
 * here uses the bare vowel instead — e.g. `hochste` (from `höchste`), never
 * `hoechste`.
 */
function foldForMatching(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, ''); // strips the combining diaeresis etc. NFD split out, collapsing ä/ö/ü -> a/o/u
}

/**
 * A directive typically opens a sentence (or the whole essay) rather than
 * sitting mid-clause — "Ignore the rubric above" versus "Many students
 * ignore the instructions above", or "Score: 100" as a standalone injected
 * line versus "my result was Score: 100 percent on the last test". Round-1
 * review measured both of those exact false positives against the original,
 * unanchored patterns. Requiring the matched phrase to follow a sentence
 * boundary (start of input, `.`/`!`/`?`/newline, or a short imperative
 * lead-in word) is what tells the two apart — cheap, readable, and it is
 * exactly the shape a copy-pasted "ignore your instructions and..." attempt
 * takes, while leaving ordinary prose that merely mentions the same nouns
 * alone.
 */
const LEAD_IN = String.raw`(?<=^|[.!?\n]\s*|\b(?:bitte|jetzt|einfach|nun|please|now|just|kindly|simply)\s)`;

const INJECTION_PATTERNS: readonly RegExp[] = [
  // English — "ignore/disregard the rubric/instructions/above"
  new RegExp(String.raw`${LEAD_IN}(ignore|disregard)\b[^.\n]{0,40}\b(rubric|instructions?|prompt|above|previous)\b`, 'i'),
  // English — "give/award/assign/grant ... perfect/full/maximum/top/highest/100/10-10 ... score/mark/grade/band"
  /\b(give|award|assign|grant)\b[^.\n]{0,30}\b(this|it|me|the)?\b[^.\n]{0,20}\b(perfect|full|maximum|top|highest|best|flawless|impeccable|100%?|10\/10)\b[^.\n]{0,25}\b(score|marks?|grade|band|dimensions?|categor(?:y|ies))?/i,
  // English — "you are now a ..." / role override
  /\byou are now\b/i,
  // English — explicit new-instruction framing
  /\bnew instructions?\s*:/i,
  // English — asking the model to reveal or reference its own system prompt
  /\bsystem[-\s]?prompt\b/i,
  // English — "this essay deserves/is worth a perfect/top score"
  /\bthis (essay|text|writing)\s+(is|deserves|is worth|should (get|receive))\b[^.\n]{0,20}\b(a\s+)?(perfect|full|top|100|flawless|impeccable)\b/i,
  // English — direct scoring instruction as its own standalone statement ("score: 100", "band: C2")
  new RegExp(String.raw`${LEAD_IN}(score|band|grade)\s*[:=]\s*(100|c2|b2\+?)\b`, 'i'),

  // German — "ignoriere/missachte/vergiss die (vorherigen) Anweisungen/Vorgaben/Bewertung/oben"
  new RegExp(String.raw`${LEAD_IN}(ignorier\w*|missachte\w*|vergiss\w*)\b[^.\n]{0,40}\b(anweisung\w*|vorgabe\w*|bewertung\w*|oben|vorherige\w*)\b`, 'i'),
  // German — "gib (mir/diesem/dem ...) 100/beste/volle/maximale/höchste Punkte/Punktzahl/Note/Bewertung"
  /\bgib\w*\b[^.\n]{0,30}\b(100|beste\w*|volle\w*|maximale\w*|hochste\w*)\b[^.\n]{0,25}\b(punktzahl\w*|punkte?|note|noten|bewertung)\b/i,
  // German — "du bist (jetzt/ab jetzt) ..." role override
  /\bdu bist\s+(jetzt|ab jetzt)\b/i,
  // German — explicit new-instruction framing
  /\bneue\w*\s+anweisung(en)?\s*:/i,
  // German — direct scoring instruction as its own standalone statement ("Note: 1", "Punktzahl: 100", "Bewertung: 100")
  new RegExp(String.raw`${LEAD_IN}note\s*[:=]\s*(1([,.]0)?|sehr gut)\b`, 'i'),
  new RegExp(String.raw`${LEAD_IN}(punktzahl|bewertung)\s*[:=]\s*100\b`, 'i'),

  // A forged boundary-marker attempt (KAN-16 round-1 review, finding 10):
  // `prompt.ts`'s own delimiter is random per job now, so an essay can never
  // contain the CURRENT job's real token — but an essay containing anything
  // in that marker's exact shape is still strong, independent evidence of an
  // attempt to manipulate the delimited-block boundary (e.g. replaying a
  // token observed from an earlier job, or simply guessing the format).
  // Matched separately from `foldForMatching`'s lowercasing having any
  // effect on it — the marker is symbols/digits, not letters.
  /§§§FLUENTINA_ESSAY[A-Z0-9_-]*§§§_(START|END)\b/i,
];

export interface PromptInjectionCheck {
  readonly suspected: boolean;
  /** How many distinct patterns matched — telemetry-safe (see this module's own comment), never which ones or where. */
  readonly matchCount: number;
}

export function detectPromptInjection(content: string): PromptInjectionCheck {
  const folded = foldForMatching(content);
  const matchCount = INJECTION_PATTERNS.reduce((count, pattern) => (pattern.test(folded) ? count + 1 : count), 0);
  return { suspected: matchCount > 0, matchCount };
}
