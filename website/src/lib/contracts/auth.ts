/**
 * KAN-20 — the request shapes for registration and login, and the two rules
 * (email normalisation, password policy) the browser and the server must
 * agree on. In `lib/contracts` for the same reason `word-count.ts` is: a client
 * that tells someone "that password is fine" and a server that then rejects
 * it are the failure a single shared module exists to prevent.
 *
 * EMAIL. Normalised here — trimmed and lower-cased — and stored normalised,
 * so the plain `unique` constraint on `users.email` is a case-insensitive
 * uniqueness rule without a functional index. The brand makes "this email has
 * been through the schema" a type: `findUserForLogin` and the login rate
 * limiter take a `NormalisedEmail`, so a raw request string cannot reach the
 * lookup or the bucket key un-normalised (which would give `A@x.com` and
 * `a@x.com` two separate rate-limit buckets).
 *
 * PASSWORD POLICY: minimum 10, maximum 128 characters, no composition rules.
 * Length is counted in code points after NFKC normalisation — the same form
 * `lib/domain/password.ts` hashes — so what the policy counts is what gets
 * hashed. The maximum is a bound on work and body size, not a security
 * property. NOT in this story: a common-password blocklist, a breached-
 * password check. A password of `aaaaaaaaaa` passes the policy today.
 *
 * Login does not apply the minimum: it accepts any non-empty password up to
 * the maximum and lets the hash comparison decide. A policy change must never
 * turn "wrong password" into a different, distinguishable error for accounts
 * created under the old policy.
 */
import { z } from 'zod';
import { CURRENT_CONSENT_VERSIONS } from './consent';

export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

export const emailSchema = z.string().trim().toLowerCase().email().max(EMAIL_MAX_LENGTH).brand<'NormalisedEmail'>();
export type NormalisedEmail = z.infer<typeof emailSchema>;

/** Password length as the policy and the hash both see it: code points of the NFKC form. */
export function passwordLength(password: string): number {
  return Array.from(password.normalize('NFKC')).length;
}

export const passwordSchema = z.string().superRefine((password, ctx) => {
  const length = passwordLength(password);
  if (length < PASSWORD_MIN_LENGTH) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `password must be at least ${PASSWORD_MIN_LENGTH} characters` });
  } else if (length > PASSWORD_MAX_LENGTH) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `password must be at most ${PASSWORD_MAX_LENGTH} characters` });
  }
});

const loginPasswordSchema = z.string().superRefine((password, ctx) => {
  const length = passwordLength(password);
  if (length < 1 || length > PASSWORD_MAX_LENGTH) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid password' });
  }
});

/**
 * One consent decision as the client presents it back: the version it rendered
 * and whether the box was ticked. The three required kinds must be `true` —
 * an unticked required box is a request that must not create an account — and
 * the version must be the one currently in force (`consent.ts`).
 */
function requiredConsent<V extends string>(version: V) {
  return z.object({ version: z.literal(version), granted: z.literal(true) });
}

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  consent: z.object({
    termsOfService: requiredConsent(CURRENT_CONSENT_VERSIONS.termsOfService),
    privacyPolicy: requiredConsent(CURRENT_CONSENT_VERSIONS.privacyPolicy),
    ageDeclaration16Plus: requiredConsent(CURRENT_CONSENT_VERSIONS.ageDeclaration16Plus),
    // Independent of the three above and optional to GRANT — but the field
    // itself is required, and `granted` must be an explicit boolean. A client
    // that omits it never presented the choice, and the server will not
    // manufacture "presented and declined" evidence on its behalf.
    marketingEmail: z.object({
      version: z.literal(CURRENT_CONSENT_VERSIONS.marketingEmail),
      granted: z.boolean(),
    }),
  }),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * True when a failed `registerRequestSchema` parse failed ONLY because a
 * consent `version` is not the one in force: every issue is an
 * `invalid_literal` at `consent.<kind>.version` whose received value is a
 * string. The route answers that with `staleConsentVersion` (reload the page)
 * instead of `invalidSubmission` (fix a field).
 *
 * All three conditions matter. A version that is ABSENT is a malformed
 * request, not a stale page, so `received` must be a string; and a request
 * that is stale AND has another problem (a short password, an unticked box)
 * stays `invalidSubmission`, because reloading would not fix the other
 * problem and a client acting on the more specific reason would lose it.
 */
export function isStaleConsentVersionFailure(error: z.ZodError): boolean {
  return (
    error.issues.length > 0 &&
    error.issues.every(
      (issue) =>
        issue.code === z.ZodIssueCode.invalid_literal &&
        typeof issue.received === 'string' &&
        issue.path[0] === 'consent' &&
        issue.path[2] === 'version',
    )
  );
}
