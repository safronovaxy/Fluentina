import { describe, expect, it } from 'vitest';
import {
  CONSENT_KINDS,
  CONSENT_VERSION_REGISTRY,
  CURRENT_CONSENT_VERSIONS,
  PROVISIONAL_CONSENT_VERSION,
  REQUIRED_CONSENT_KINDS,
  hasProvisionalConsentVersions,
  isConsentKind,
} from './consent';

// Publication date, YYYY-MM-DD, with -vN only for a same-day correction — or
// the one deliberately-not-a-date placeholder.
const VERSION_FORMAT = /^\d{4}-\d{2}-\d{2}(-v\d+)?$/;

describe('consent kinds — KAN-21', () => {
  it('are exactly these four, each its own record: two documents, the 16+ declaration, and marketing', () => {
    expect([...CONSENT_KINDS]).toEqual(['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus', 'marketingEmail']);
  });

  it('require the three account-creation kinds and never marketing', () => {
    expect([...REQUIRED_CONSENT_KINDS]).toEqual(['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus']);
    expect((REQUIRED_CONSENT_KINDS as readonly string[]).includes('marketingEmail')).toBe(false);
  });

  it('are recognised by isConsentKind and nothing else is', () => {
    for (const kind of CONSENT_KINDS) expect(isConsentKind(kind)).toBe(true);
    expect(isConsentKind('newsletter')).toBe(false);
    expect(isConsentKind(undefined)).toBe(false);
  });
});

describe('consent versions — the registry the "who still needs to re-accept?" question is asked of', () => {
  it.each(CONSENT_KINDS)('%s: the current version is the last registry entry', (kind) => {
    const entries = CONSENT_VERSION_REGISTRY[kind];
    expect(entries.at(-1)?.version).toBe(CURRENT_CONSENT_VERSIONS[kind]);
  });

  it.each(CONSENT_KINDS)('%s: every version is a publication date or the provisional placeholder, and every entry says why and whether re-consent is needed', (kind) => {
    for (const entry of CONSENT_VERSION_REGISTRY[kind]) {
      expect(entry.version === PROVISIONAL_CONSENT_VERSION || VERSION_FORMAT.test(entry.version)).toBe(true);
      expect(typeof entry.requiresReconsent).toBe('boolean');
      expect(entry.summary.length).toBeGreaterThan(0);
    }
  });

  it('does not put the document name in the version string — `kind` is already a column', () => {
    for (const kind of CONSENT_KINDS) {
      expect(CURRENT_CONSENT_VERSIONS[kind].toLowerCase()).not.toMatch(/privacy|terms/);
    }
  });

  it('the placeholder is obviously not a date, so it cannot be mistaken for a real publication date', () => {
    expect(VERSION_FORMAT.test(PROVISIONAL_CONSENT_VERSION)).toBe(false);
  });

  // This is a statement of fact about the branch, not an aspiration: while it
  // holds, a consent row means "agreed to a draft" and launch is blocked on a
  // human replacing the values. When the real dates land this test is meant to
  // be deleted in the same change.
  it('reports that every current version is still provisional — a launch blocker until replaced', () => {
    expect(hasProvisionalConsentVersions()).toBe(true);
  });
});
