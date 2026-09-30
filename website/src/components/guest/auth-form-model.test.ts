import { describe, expect, it } from 'vitest';
import {
  buildRegisterRequest,
  CONSENT_FIELDS,
  emptyRegistrationValues,
  fillPlaceholders,
  validateRegistration,
  validateSignIn,
  type RegistrationFormValues,
} from './auth-form-model';
import { CONSENT_KINDS, CURRENT_CONSENT_VERSIONS, REQUIRED_CONSENT_KINDS, type ConsentKind } from '@/lib/contracts/consent';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, registerRequestSchema } from '@/lib/contracts/auth';

/**
 * KAN-55 — the form's decisions, pinned against the server's own schema. Every
 * "the browser rejects it" below is a claim that `registerRequestSchema` (the
 * module `POST /api/auth/register` parses with) rejects the same input, and the
 * route-level counterpart of this file (`auth-forms.integration.test.tsx`)
 * posts the same inputs to the real handler.
 */
const GOOD_PASSWORD = 'correct horse battery staple';

function ticked(overrides: Partial<Record<ConsentKind, boolean>> = {}): Record<ConsentKind, boolean> {
  return { termsOfService: true, privacyPolicy: true, ageDeclaration16Plus: true, marketingEmail: false, ...overrides };
}

function values(overrides: Partial<RegistrationFormValues> = {}): RegistrationFormValues {
  return { email: 'guest@example.test', password: GOOD_PASSWORD, consent: ticked(), ...overrides };
}

describe('consent boxes — three required, one optional, derived from the contract', () => {
  it('every box starts unticked, marketing included', () => {
    const empty = emptyRegistrationValues();

    expect(Object.keys(empty.consent).sort()).toEqual([...CONSENT_KINDS].sort());
    for (const kind of CONSENT_KINDS) expect(empty.consent[kind], kind).toBe(false);
  });

  it('CONSENT_FIELDS lists exactly the four kinds, the three required ones first and marketing last and optional', () => {
    expect(CONSENT_FIELDS.map((field) => field.kind)).toEqual([...REQUIRED_CONSENT_KINDS, 'marketingEmail']);
    expect(CONSENT_FIELDS.filter((field) => field.required).map((field) => field.kind)).toEqual([...REQUIRED_CONSENT_KINDS]);
    expect(CONSENT_FIELDS.find((field) => field.kind === 'marketingEmail')?.required).toBe(false);
  });

  it('sends the version currently in force for every kind — read from the contract, not restated', () => {
    const request = buildRegisterRequest(values());

    for (const kind of CONSENT_KINDS) expect(request.consent[kind].version, kind).toBe(CURRENT_CONSENT_VERSIONS[kind]);
  });

  it('sends the placeholder version as it is, and never a real-looking date', () => {
    const request = buildRegisterRequest(values());

    for (const kind of CONSENT_KINDS) expect(request.consent[kind].version).not.toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it('sends an unticked marketing box as an explicit `granted: false`, not by omitting it', () => {
    const request = buildRegisterRequest(values({ consent: ticked({ marketingEmail: false }) }));

    expect(request.consent.marketingEmail).toEqual({ version: CURRENT_CONSENT_VERSIONS.marketingEmail, granted: false });
    expect(registerRequestSchema.safeParse(request).success).toBe(true);
  });

  it('marketing is its own decision: ticking it changes nothing about the three, and ticking them does not tick it', () => {
    const three = buildRegisterRequest(values({ consent: ticked({ marketingEmail: false }) }));
    const withMarketing = buildRegisterRequest(values({ consent: ticked({ marketingEmail: true }) }));

    expect(withMarketing.consent.marketingEmail.granted).toBe(true);
    for (const kind of REQUIRED_CONSENT_KINDS) expect(withMarketing.consent[kind]).toEqual(three.consent[kind]);
    expect(three.consent.marketingEmail.granted).toBe(false);
  });
});

describe('registration is blocked without each mandatory box, and only for that box', () => {
  it.each(REQUIRED_CONSENT_KINDS)('%s unticked (the other two and marketing ticked) does not validate', (kind) => {
    const result = validateRegistration(values({ consent: ticked({ marketingEmail: true, [kind]: false }) }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toEqual({ consent: { [kind]: 'required' } });
  });

  it('all three unticked reports all three', () => {
    const result = validateRegistration(values({ consent: ticked({ termsOfService: false, privacyPolicy: false, ageDeclaration16Plus: false }) }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors.consent ?? {}).sort()).toEqual([...REQUIRED_CONSENT_KINDS].sort());
  });

  it('the untouched form validates as nothing but missing fields and consent — and marketing is never reported', () => {
    const result = validateRegistration(emptyRegistrationValues());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.email).toBe('required');
      expect(result.errors.password).toBe('required');
      expect(result.errors.consent).not.toHaveProperty('marketingEmail');
    }
  });

  it('marketing ticked or unticked never decides validity', () => {
    expect(validateRegistration(values({ consent: ticked({ marketingEmail: false }) })).ok).toBe(true);
    expect(validateRegistration(values({ consent: ticked({ marketingEmail: true }) })).ok).toBe(true);
  });

  it('everything ticked, however marketing is set, yields a request the server schema accepts, with the email normalised', () => {
    const result = validateRegistration(values({ email: '  Guest@Example.TEST ' }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.email).toBe('guest@example.test');
  });
});

describe('the password policy is the server\'s, so the browser rejects what the server would', () => {
  const passwordCases: ReadonlyArray<[string, string, boolean]> = [
    ['one under the minimum', 'a'.repeat(PASSWORD_MIN_LENGTH - 1), false],
    ['exactly the minimum', 'a'.repeat(PASSWORD_MIN_LENGTH), true],
    ['exactly the maximum', 'a'.repeat(PASSWORD_MAX_LENGTH), true],
    ['one over the maximum', 'a'.repeat(PASSWORD_MAX_LENGTH + 1), false],
    ['empty', '', false],
    // Length is code points, not UTF-16 units: ten emoji is ten characters,
    // though twenty units — a `maxLength` or `.length` check would disagree.
    ['ten astral characters (20 UTF-16 units)', '\u{1F600}'.repeat(PASSWORD_MIN_LENGTH), true],
    ['nine astral characters', '\u{1F600}'.repeat(PASSWORD_MIN_LENGTH - 1), false],
    // NFKC folds the ligature "ﬃ" (one code point) to "ffi" (three): counted
    // AFTER normalisation, as the hash sees it.
    ['nine characters that NFKC-expand past the minimum', 'a'.repeat(PASSWORD_MIN_LENGTH - 2) + 'ﬃ', true],
    ['spaces count', ' '.repeat(PASSWORD_MIN_LENGTH), true],
  ];

  it.each(passwordCases)('%s', (_label, password, accepted) => {
    const result = validateRegistration(values({ password }));

    expect(result.ok, 'browser').toBe(accepted);
    // And the server's own schema says the same about the wire shape.
    expect(registerRequestSchema.safeParse(buildRegisterRequest(values({ password }))).success, 'server schema').toBe(accepted);
  });

  it('says WHY: too short below the minimum, too long above the maximum, required when empty', () => {
    const reason = (password: string) => {
      const result = validateRegistration(values({ password }));
      return result.ok ? null : result.errors.password;
    };

    expect(reason('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toBe('tooShort');
    expect(reason('a'.repeat(PASSWORD_MAX_LENGTH + 1))).toBe('tooLong');
    expect(reason('')).toBe('required');
    expect(reason('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it('does not trim or otherwise alter the password it sends', () => {
    const padded = `  ${GOOD_PASSWORD}  `;

    expect(buildRegisterRequest(values({ password: padded })).password).toBe(padded);
  });
});

describe('email', () => {
  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['not-an-email', 'invalid'],
    ['a@b', 'invalid'],
    [`${'a'.repeat(250)}@example.test`, 'invalid'],
  ] as const)('%j is refused as %s', (email, expected) => {
    const result = validateRegistration(values({ email }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.email).toBe(expected);
  });
});

describe('sign-in applies no password minimum — an account made under an older policy must not be told "too short"', () => {
  it('accepts a one-character password (the server will simply refuse the credentials)', () => {
    expect(validateSignIn({ email: 'guest@example.test', password: 'x' }).ok).toBe(true);
  });

  it('refuses an empty password and one past the maximum, which the server refuses too', () => {
    const empty = validateSignIn({ email: 'guest@example.test', password: '' });
    const long = validateSignIn({ email: 'guest@example.test', password: 'a'.repeat(PASSWORD_MAX_LENGTH + 1) });

    expect(empty.ok || empty.errors.password).toBe('required');
    expect(long.ok || long.errors.password).toBe('tooLong');
  });

  it('refuses a missing or malformed email', () => {
    const missing = validateSignIn({ email: '', password: 'x' });
    const malformed = validateSignIn({ email: 'nope', password: 'x' });

    expect(missing.ok || missing.errors.email).toBe('required');
    expect(malformed.ok || malformed.errors.email).toBe('invalid');
  });
});

describe('fillPlaceholders', () => {
  it('fills every occurrence and leaves other text alone', () => {
    expect(fillPlaceholders('At least {min} characters, up to {max}. {min}!', { min: 10, max: 128 })).toBe(
      'At least 10 characters, up to 128. 10!',
    );
  });
});
