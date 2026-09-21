'use client';

import { useTranslations } from 'next-intl';

export interface WordCountLabelProps {
  /** The current word count, by `countGermanWords` (lib/contracts/word-count.ts) — EssayEntryForm's job, not this component's, to compute. */
  readonly count: number;
}

/**
 * KAN-15 — the live word counter's own localised text ("82 words" / "82
 * Wörter"), e.g. "1 word" vs "82 words" in English, "1 Wort" vs "82 Wörter"
 * in German. A `chrome/` component specifically so it CAN call
 * `useTranslations` (see the eslint allow-list's own comment for why
 * `chrome/` and nowhere else in `components/guest/`) and use next-intl's
 * ICU `plural` support for that — `EssayEntryForm` itself owns the essay
 * text and the word-count arithmetic (`countGermanWords`,
 * `lib/contracts/word-count.ts`) and passes down only the resulting
 * number, never the essay text, so nothing essay-shaped ever reaches a
 * next-intl call. The banner strings around this one (recommended-range
 * guidance, the 201-300 warning, the two block messages) don't need a
 * formatter at all — they're static per state, not per-keystroke — so they
 * stay plain translated props on `EssayEntryForm`, the same pattern KAN-14
 * already established for `requiredError` etc.; only the number itself
 * needed pulling out into its own chrome component.
 */
export function WordCountLabel({ count }: WordCountLabelProps) {
  const t = useTranslations('chrome.guest.write');
  return <span>{t('wordCount', { count })}</span>;
}
