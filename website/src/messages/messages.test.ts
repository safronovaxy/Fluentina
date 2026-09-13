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

describe('message catalogues stay in sync (KAN-9)', () => {
  it('en.json and de.json declare exactly the same keys', () => {
    const enKeys = flattenKeys(en).sort();
    const deKeys = flattenKeys(de).sort();
    expect(deKeys).toEqual(enKeys);
  });

  it('no message value is an empty string (an untranslated key left as a placeholder)', () => {
    for (const [locale, messages] of [['en', en], ['de', de]] as const) {
      for (const key of flattenKeys(messages)) {
        const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], messages);
        expect(typeof value === 'string' && value.trim().length > 0, `${locale}: "${key}"`).toBe(true);
      }
    }
  });
});
