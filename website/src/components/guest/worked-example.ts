/**
 * KAN-18 (BR-4.1) — picks the one annotation to show as the guest's "fully
 * worked example" and cuts the sentence around it out of their own essay.
 *
 * Pure, and deliberately does no offset arithmetic of its own about WHERE an
 * error is: `start`/`end` arrive already resolved verbatim against the real
 * essay text by `resolveAnnotationSpans` (an annotation whose quote could not
 * be located was dropped there, never guessed at). The only thing done here
 * is a bounds check — the essay text this runs against is a separate read
 * from the grading result's, and a span that does not fit it is skipped
 * rather than rendered as a highlight over the wrong words.
 *
 * Kept free of React and of `next-intl` so it can sit next to the component
 * that needs it and be tested without a DOM.
 */
import type { GradingAnnotation, GradingAnnotationSeverity } from '@/lib/contracts/grading';

export interface WorkedExample {
  readonly annotation: GradingAnnotation;
  /** The sentence text before the highlighted span — may be empty. */
  readonly before: string;
  /** Exactly `essay.slice(annotation.start, annotation.end)`. */
  readonly highlighted: string;
  /** The sentence text after the highlighted span — may be empty. */
  readonly after: string;
}

const SEVERITY_RANK: Record<GradingAnnotationSeverity, number> = { major: 3, moderate: 2, minor: 1 };

/** Context on either side of the highlight beyond this is trimmed to a word boundary — a run-on sentence should not become a wall of text. */
const MAX_CONTEXT_CHARS = 120;

function isSentenceTerminator(ch: string): boolean {
  return ch === '.' || ch === '!' || ch === '?';
}

function isLineBreak(ch: string): boolean {
  return ch === '\n' || ch === '\r';
}

/** Index of the first character of the sentence containing `index`. */
function sentenceStart(text: string, index: number): number {
  let i = index;
  while (i > 0) {
    const prev = text[i - 1];
    if (isLineBreak(prev)) break;
    // A terminator only ends the previous sentence when whitespace follows
    // it ("3.5", "z.B." and the like must not split a sentence).
    if (isSentenceTerminator(prev) && i < text.length && /\s/.test(text[i])) break;
    i -= 1;
  }
  while (i < index && /\s/.test(text[i])) i += 1;
  return i;
}

/** Index one past the last character of the sentence that contains `index - 1`, terminator included. */
function sentenceEnd(text: string, index: number): number {
  let i = index;
  // The span may itself end on the terminator — then the sentence is already over.
  if (i > 0 && isSentenceTerminator(text[i - 1])) return i;
  while (i < text.length) {
    if (isLineBreak(text[i])) return i;
    if (isSentenceTerminator(text[i]) && (i + 1 >= text.length || /\s/.test(text[i + 1]))) return i + 1;
    i += 1;
  }
  return i;
}

function trimContextStart(context: string): string {
  if (context.length <= MAX_CONTEXT_CHARS) return context;
  const cut = context.slice(context.length - MAX_CONTEXT_CHARS);
  const firstSpace = cut.search(/\s/);
  return `…${firstSpace === -1 ? cut : cut.slice(firstSpace + 1)}`;
}

function trimContextEnd(context: string): string {
  if (context.length <= MAX_CONTEXT_CHARS) return context;
  const cut = context.slice(0, MAX_CONTEXT_CHARS);
  const lastSpace = cut.search(/\s\S*$/);
  return `${lastSpace === -1 ? cut : cut.slice(0, lastSpace)}…`;
}

function isUsable(annotation: GradingAnnotation, essay: string): boolean {
  return (
    Number.isInteger(annotation.start) &&
    Number.isInteger(annotation.end) &&
    annotation.start >= 0 &&
    annotation.end <= essay.length &&
    annotation.start < annotation.end &&
    essay.slice(annotation.start, annotation.end).trim() !== ''
  );
}

/**
 * The most instructive annotation first: highest severity, then one that
 * comes with a suggested fix (a "worked" example shows the correction, not
 * just the complaint), then earliest in the essay so the choice is stable.
 */
function compareAnnotations(a: GradingAnnotation, b: GradingAnnotation): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    Number(b.suggestion !== null) - Number(a.suggestion !== null) ||
    a.start - b.start
  );
}

/** `null` when no annotation can be honestly anchored in `essay` — the caller must say so rather than invent an example. */
export function pickWorkedExample(essay: string, annotations: readonly GradingAnnotation[]): WorkedExample | null {
  const best = annotations.filter((a) => isUsable(a, essay)).sort(compareAnnotations)[0];
  if (!best) return null;

  const from = sentenceStart(essay, best.start);
  const to = sentenceEnd(essay, best.end);
  return {
    annotation: best,
    before: trimContextStart(essay.slice(from, best.start)),
    highlighted: essay.slice(best.start, best.end),
    after: trimContextEnd(essay.slice(best.end, to)),
  };
}
