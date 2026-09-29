/**
 * Test-only helpers for the KAN-20 suites. Like `db-fixtures.ts`, this lives
 * in `src/test` so no production module graph can reach it.
 */
import { randomUUID } from 'node:crypto';
import { CURRENT_CONSENT_VERSIONS } from '@/lib/contracts/consent';
import { emailSchema, type RegisterRequest } from '@/lib/contracts/auth';
import type { GuestSessionId, RegisteredSessionToken } from '@/lib/contracts/actor';
import { registerAccount } from '@/lib/domain/registration';
import { findUserForLogin } from '@/lib/db/users';

export const TEST_PASSWORD = 'correct horse battery staple';

export function uniqueEmail(): string {
  return `user-${randomUUID()}@example.test`;
}

/** The wire shape a form posts: what `registerRequestSchema` accepts, un-normalised. */
export function registrationBody(overrides: {
  email?: string;
  password?: string;
  marketing?: boolean;
} = {}) {
  return {
    email: overrides.email ?? uniqueEmail(),
    password: overrides.password ?? TEST_PASSWORD,
    consent: {
      termsOfService: { version: CURRENT_CONSENT_VERSIONS.termsOfService, granted: true },
      privacyPolicy: { version: CURRENT_CONSENT_VERSIONS.privacyPolicy, granted: true },
      ageDeclaration16Plus: { version: CURRENT_CONSENT_VERSIONS.ageDeclaration16Plus, granted: true },
      marketingEmail: { version: CURRENT_CONSENT_VERSIONS.marketingEmail, granted: overrides.marketing ?? false },
    },
  };
}

export interface TestAccount {
  readonly email: string;
  readonly password: string;
  readonly userId: string;
  readonly token: RegisteredSessionToken;
}

/**
 * Registers a real, loginable account through the domain function — real
 * scrypt, real transaction. `guestSessionId` converts that guest's session.
 */
export async function registerTestAccount(
  options: { email?: string; password?: string; guestSessionId?: GuestSessionId } = {},
): Promise<TestAccount> {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? TEST_PASSWORD;
  const request: RegisterRequest = {
    ...(registrationBody({ email, password }) as unknown as RegisterRequest),
    email: emailSchema.parse(email),
  };
  const outcome = await registerAccount(request, {
    guestSessionId: options.guestSessionId ?? null,
    presentedSessionToken: null,
  });
  if (outcome.status !== 'registered') throw new Error('fixture registration unexpectedly failed');
  const user = await findUserForLogin(emailSchema.parse(email));
  if (!user) throw new Error('fixture user missing after registration');
  return { email, password, userId: user.id, token: outcome.token };
}
