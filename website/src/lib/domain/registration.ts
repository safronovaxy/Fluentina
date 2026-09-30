import 'server-only';

/**
 * KAN-20 — registration, from a validated request to a signed-in account.
 *
 * Also the substance of KAN-21 (separate consent choices) and KAN-22 (which
 * version and consent state each user agreed to, with timestamps): registration
 * is the moment consent is captured, so it could not be built without deciding
 * what it writes. It writes four `consent_records` rows — terms of service,
 * privacy policy, the 16+ declaration and marketing email — each with the
 * version the client rendered, in the same transaction as the user. Marketing's
 * row is written even when unticked, with `granted = false`.
 *
 * The password is hashed BEFORE the transaction opens (about 90 ms of scrypt
 * must not hold a pooled connection and row locks), and the token is generated
 * here, not in the database layer, so the only thing that reaches `lib/db` is
 * the hash of it.
 *
 * Auto sign-in is Irina's decision (2026-09-29): the guest is signed in and the
 * report unlocks immediately; email verification is sent by a later story
 * (KAN-51) and does not block. A direct consequence, recorded rather than
 * hidden: this cannot return a neutral response for an address that already
 * has an account, so `emailAlreadyRegistered` makes registration an
 * email-enumeration oracle. The per-IP cap (`checkRegistrationRateLimit`) is
 * the mitigation.
 */
import type { GuestSessionId, RegisteredSessionToken } from '@/lib/contracts/actor';
import type { RegisterRequest } from '@/lib/contracts/auth';
import { CONSENT_KINDS } from '@/lib/contracts/consent';
import { registerUser } from '@/lib/db/users';
import type { ConsentDecision } from '@/lib/db/consent-records';
import { hashPassword } from './password';
import { generateRegisteredSessionToken, hashRegisteredSessionToken } from './registered-session-token';
import { findPresentedSession } from './registered-session';

export interface RegistrationContext {
  /** The well-formed guest cookie value the request carried, if any. Never resolved (which would mint) — only offered to conversion. */
  readonly guestSessionId: GuestSessionId | null;
  /** The registered-session cookie value the request carried, if any — its row is deleted in the registration transaction. */
  readonly presentedSessionToken: RegisteredSessionToken | null;
}

export type RegistrationOutcome =
  | { readonly status: 'registered'; readonly token: RegisteredSessionToken }
  | { readonly status: 'emailAlreadyRegistered' };

export async function registerAccount(request: RegisterRequest, context: RegistrationContext): Promise<RegistrationOutcome> {
  const passwordHash = await hashPassword(request.password);

  const token = generateRegisteredSessionToken();
  const sessionTokenHash = hashRegisteredSessionToken(token);

  const presented = context.presentedSessionToken ? await findPresentedSession(context.presentedSessionToken) : null;

  // One row per kind, in a fixed order, each carrying the version the request
  // presented (the schema has already required it to be the version in force).
  const consent: ConsentDecision[] = CONSENT_KINDS.map((kind) => ({
    kind,
    documentVersion: request.consent[kind].version,
    granted: request.consent[kind].granted,
  }));

  const result = await registerUser({
    email: request.email,
    passwordHash,
    consent,
    guest: context.guestSessionId ? { kind: 'guest', sessionId: context.guestSessionId } : null,
    sessionTokenHash,
    replacing: presented ? { actor: presented.actor, tokenHash: presented.tokenHash } : null,
  });

  if (result.status === 'emailAlreadyRegistered') return result;
  // `result.guestConversion` is deliberately not surfaced: `nothingToConvert`
  // is also what retention deletion produces, so nothing may count it as a
  // conversion metric.
  return { status: 'registered', token };
}
