import { describe, it, expect } from 'vitest';
import en from './en.json';
import de from './de.json';

/**
 * KAN-9 — "architecture supports adding further locales later without
 * structural rework" only holds if the catalogues themselves can't silently
 * drift apart. Without this, a key added to en.json and never copied to
 * de.json fails only at the moment a German guest actually reaches that
 * screen (see IntlProvider/request.ts's fail-loudly `onError`) — this
 * catches it at test time instead, for both directions (added AND removed).
 */
function flattenKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([key, value]) =>
    flattenKeys(value, prefix ? `${prefix}.${key}` : key),
  );
}

function getMessage(messages: unknown, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages);
}

/**
 * Top-level ICU placeholder names in a message value — e.g. `index`,
 * `total`, `label` and `completed` out of `chrome.guest.stepAriaLabel`'s
 * `"{label}{completed, select, yes {, completed} other {}}"`. Deliberately
 * only matches `{` immediately followed by a word character: the `{` that
 * opens an ICU `select`/`plural` case body (e.g. the `{` in `yes {, completed}`)
 * is always followed by a literal or another `{`, never a bare identifier
 * character, so it's never mistaken for a placeholder declaration.
 */
function extractPlaceholderTokens(value: string): string[] {
  return [...value.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

describe('message catalogues stay in sync (KAN-9)', () => {
  it('en.json and de.json declare exactly the same keys', () => {
    const enKeys = flattenKeys(en).sort();
    const deKeys = flattenKeys(de).sort();
    expect(deKeys).toEqual(enKeys);
  });

  it('no message value is an empty string (an untranslated key left as a placeholder)', () => {
    for (const [locale, messages] of [['en', en], ['de', de]] as const) {
      for (const key of flattenKeys(messages)) {
        const value = getMessage(messages, key);
        expect(typeof value === 'string' && value.trim().length > 0, `${locale}: "${key}"`).toBe(true);
      }
    }
  });

  it('en.json and de.json use the same interpolation placeholders per key', () => {
    // Key parity (above) only proves the two catalogues have the same
    // shape, not that a translated value still interpolates the same
    // values. A German value that dropped `{total}` from stepAriaLabel, say
    // — a typo, not a missing key — would pass every other test here and
    // silently render "Step 1 of : Thema" instead of failing loudly, since
    // a message with fewer placeholders than expected isn't a next-intl
    // error at all, just a value substituted for nothing.
    for (const key of flattenKeys(en)) {
      const enValue = getMessage(en, key) as string;
      const deValue = getMessage(de, key) as string;
      expect(extractPlaceholderTokens(deValue), `"${key}" (de)`).toEqual(
        extractPlaceholderTokens(enValue),
      );
    }
  });
});
