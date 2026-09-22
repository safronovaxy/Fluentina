import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import { WordCountLabel } from './WordCountLabel';

afterEach(() => {
  cleanup();
});

/**
 * KAN-15 — the live counter's own text. Deliberately checked against the
 * REAL catalogues (en.json/de.json) via renderWithIntl, not a hand-rolled
 * stub message — a typo in the actual ICU `plural` string (e.g. the wrong
 * case name) would still pass a test asserting against its own stub, but
 * fails here, the same reasoning renderWithIntl's own comment gives for
 * every other chrome component's test.
 */
describe('WordCountLabel — pluralisation (KAN-15)', () => {
  it('English: renders "0 words" for zero — the "other" plural form, not "word"', () => {
    renderWithIntl(<WordCountLabel count={0} />, { locale: 'en' });
    expect(screen.getByText('0 words')).toBeInTheDocument();
  });

  it('English: renders "1 word" — the singular "one" plural form', () => {
    renderWithIntl(<WordCountLabel count={1} />, { locale: 'en' });
    expect(screen.getByText('1 word')).toBeInTheDocument();
  });

  it('English: renders "82 words" for a count of 82', () => {
    renderWithIntl(<WordCountLabel count={82} />, { locale: 'en' });
    expect(screen.getByText('82 words')).toBeInTheDocument();
  });

  it('German: renders "0 Wörter" for zero', () => {
    renderWithIntl(<WordCountLabel count={0} />, { locale: 'de' });
    expect(screen.getByText('0 Wörter')).toBeInTheDocument();
  });

  it('German: renders "1 Wort" — the singular form, distinct from the plural "Wörter"', () => {
    renderWithIntl(<WordCountLabel count={1} />, { locale: 'de' });
    expect(screen.getByText('1 Wort')).toBeInTheDocument();
  });

  it('German: renders "220 Wörter" for the story\'s own "never blocked" verification count', () => {
    renderWithIntl(<WordCountLabel count={220} />, { locale: 'de' });
    expect(screen.getByText('220 Wörter')).toBeInTheDocument();
  });

  // KAN-30 round-3 review: pins the grouping behaviour the KAN-30
  // investigation found — the ICU `#` placeholder formats through the
  // locale's Intl.NumberFormat, grouping included, so a four-digit count is
  // "1,000 words" / "1.000 Wörter", never the un-grouped "1000" a naive
  // `${n}` would produce — at this layer, on every unit run, rather than
  // only in tests/word-count.spec.ts's Safari-gated browser suite. Written
  // as a literal, like every other case in this file, not computed via
  // `toLocaleString`, so a regression in the grouping itself can't also
  // launder the assertion that's supposed to catch it.
  it('English: renders "1,000 words" for a four-digit count — grouped, not "1000"', () => {
    renderWithIntl(<WordCountLabel count={1000} />, { locale: 'en' });
    expect(screen.getByText('1,000 words')).toBeInTheDocument();
  });

  it('German: renders "1.000 Wörter" for a four-digit count — grouped, not "1000"', () => {
    renderWithIntl(<WordCountLabel count={1000} />, { locale: 'de' });
    expect(screen.getByText('1.000 Wörter')).toBeInTheDocument();
  });

  it('re-renders with an updated count — proves this reflects a live prop, not a value fixed at mount (guards against a vacuous "some number is on screen" test)', () => {
    // Rerendering through renderWithIntl's own `rerender` would replace the
    // whole tree, IntlProvider included, and lose context — wrapping
    // manually here so the SAME provider instance survives the rerender,
    // the way it actually would in the browser as EssayEntryForm's
    // `content` state (and therefore `wordCount`) changes on every
    // keystroke.
    const { rerender } = render(
      <IntlProvider locale="en" messages={enMessages}>
        <WordCountLabel count={5} />
      </IntlProvider>,
    );
    expect(screen.getByText('5 words')).toBeInTheDocument();

    rerender(
      <IntlProvider locale="en" messages={enMessages}>
        <WordCountLabel count={6} />
      </IntlProvider>,
    );
    expect(screen.queryByText('5 words')).toBeNull();
    expect(screen.getByText('6 words')).toBeInTheDocument();
  });
});
