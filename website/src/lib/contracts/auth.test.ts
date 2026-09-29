import { describe, expect, it } from 'vitest';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  emailSchema,
  loginRequestSchema,
  passwordLength,
  passwordSchema,
  registerRequestSchema,
} from './auth';
import { CURRENT_CONSENT_VERSIONS } from './consent';

const validConsent = () => ({
  termsOfService: { version: CURRENT_CONSENT_VERSIONS.termsOfService, granted: true },
  privacyPolicy: { version: CURRENT_CONSENT_VERSIONS.privacyPolicy, granted: true },
  ageDeclaration16Plus: { version: CURRENT_CONSENT_VERSIONS.ageDeclaration16Plus, granted: true },
  marketingEmail: { version: CURRENT_CONSENT_VERSIONS.marketingEmail, granted: false },
});

const validRequest = () => ({ email: 'a@example.com', password: 'x'.repeat(PASSWORD_MIN_LENGTH), consent: validConsent() });

describe('emailSchema — normalised at the boundary, stored normalised', () => {
  it('trims and lower-cases, so the plain unique constraint is a case-insensitive rule', () => {
    expect(emailSchema.parse('  Ada.Lovelace@Example.COM  ')).toBe('ada.lovelace@example.com');
  });

  it('rejects something that is not an email', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });

  it(`accepts up to ${EMAIL_MAX_LENGTH} characters and rejects one more`, () => {
    const local = 'a'.repeat(64);
    // Build addresses of exact lengths from 63-character labels so the string
    // stays a syntactically valid email at both boundaries.
    const build = (total: number): string => {
      const labels: string[] = [];
      let remaining = total - local.length - 1; // '@'
      while (remaining > 0) {
        const take = Math.min(remaining, 63);
        labels.push('c'.repeat(take));
        remaining -= take + 1; // '.'
      }
      return `${local}@${labels.join('.')}`;
    };
    const atLimit = build(EMAIL_MAX_LENGTH);
    expect(atLimit.length).toBe(EMAIL_MAX_LENGTH);
    expect(emailSchema.safeParse(atLimit).success).toBe(true);
    expect(emailSchema.safeParse(build(EMAIL_MAX_LENGTH + 1)).success).toBe(false);
  });
});

describe('the password policy — min 10, max 128, no composition rules', () => {
  it.each([
    [PASSWORD_MIN_LENGTH - 1, false],
    [PASSWORD_MIN_LENGTH, true],
    [PASSWORD_MAX_LENGTH, true],
    [PASSWORD_MAX_LENGTH + 1, false],
  ])('a %i-character password: valid=%s', (length, valid) => {
    expect(passwordSchema.safeParse('a'.repeat(length)).success).toBe(valid);
  });

  it('has no composition rules: all one repeated lower-case letter passes (a blocklist is NOT part of this story)', () => {
    expect(passwordSchema.safeParse('aaaaaaaaaa').success).toBe(true);
    expect(passwordSchema.safeParse('password12').success).toBe(true);
  });

  it('does not trim — surrounding spaces are part of the password and count towards its length', () => {
    expect(passwordSchema.safeParse('         a').success).toBe(true);
  });

  it('counts code points, not UTF-16 units: ten emoji is ten characters, not twenty', () => {
    expect(passwordLength('😀'.repeat(10))).toBe(10);
    expect(passwordSchema.safeParse('😀'.repeat(9)).success).toBe(false);
    expect(passwordSchema.safeParse('😀'.repeat(10)).success).toBe(true);
    expect(passwordSchema.safeParse('😀'.repeat(129)).success).toBe(false);
  });

  it('counts the NFKC form, the same one that gets hashed: a decomposed ü is one character, not two', () => {
    const decomposed = 'ü'.repeat(10); // ten ü written as u + combining diaeresis
    expect(decomposed.length).toBe(20);
    expect(passwordLength(decomposed)).toBe(10);
    expect(passwordSchema.safeParse(decomposed).success).toBe(true);
  });
});

describe('registerRequestSchema — KAN-21: separate consent choices, required ones must be ticked', () => {
  it('accepts a complete request with marketing unticked', () => {
    expect(registerRequestSchema.safeParse(validRequest()).success).toBe(true);
  });

  it('accepts a complete request with marketing ticked — it is independent of the other three', () => {
    const request = validRequest();
    request.consent.marketingEmail.granted = true;
    expect(registerRequestSchema.safeParse(request).success).toBe(true);
  });

  it.each(['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus'] as const)(
    'blocks account creation when %s is unticked',
    (kind) => {
      const request = validRequest();
      request.consent[kind].granted = false;
      expect(registerRequestSchema.safeParse(request).success).toBe(false);
    },
  );

  it.each(['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus', 'marketingEmail'] as const)(
    'rejects a request that omits the %s decision entirely',
    (kind) => {
      const request = validRequest();
      const consent: Record<string, unknown> = { ...request.consent };
      delete consent[kind];
      expect(registerRequestSchema.safeParse({ ...request, consent }).success).toBe(false);
    },
  );

  it('rejects a marketing decision whose `granted` is not an explicit boolean — an absent choice is not "presented and declined"', () => {
    const request = validRequest();
    expect(
      registerRequestSchema.safeParse({ ...request, consent: { ...request.consent, marketingEmail: { version: CURRENT_CONSENT_VERSIONS.marketingEmail } } }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ ...request, consent: { ...request.consent, marketingEmail: { version: CURRENT_CONSENT_VERSIONS.marketingEmail, granted: 'no' } } }).success,
    ).toBe(false);
  });

  it.each(['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus', 'marketingEmail'] as const)(
    'refuses a %s version that is not the one in force, so a stale form is not recorded as agreement to current text',
    (kind) => {
      const request = validRequest();
      request.consent[kind].version = '1999-01-01' as never;
      expect(registerRequestSchema.safeParse(request).success).toBe(false);
    },
  );

  it('rejects a password below the policy minimum', () => {
    expect(registerRequestSchema.safeParse({ ...validRequest(), password: 'short' }).success).toBe(false);
  });

  it('normalises the email it parses', () => {
    const parsed = registerRequestSchema.parse({ ...validRequest(), email: ' A@Example.com ' });
    expect(parsed.email).toBe('a@example.com');
  });
});

describe('loginRequestSchema', () => {
  it('accepts any non-empty password up to the maximum without applying the registration minimum', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: 'x' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: 'x'.repeat(PASSWORD_MAX_LENGTH) }).success).toBe(true);
  });

  it('rejects an empty or over-long password, and a malformed email', () => {
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: '' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: 'a@example.com', password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ email: 'nope', password: 'x' }).success).toBe(false);
  });

  it('normalises the email, so login and registration agree on what a given address is', () => {
    expect(loginRequestSchema.parse({ email: ' A@Example.com ', password: 'x' }).email).toBe('a@example.com');
  });
});
