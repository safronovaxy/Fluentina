/**
 * KAN-55 — what the registration and sign-in forms decide, and nothing else.
 *
 * The forms do not carry rules of their own. Whether an email is well formed,
 * whether a password meets the policy, and whether the three required consent
 * boxes are ticked are all answered by running the form's values through the
 * SAME request schemas `POST /api/auth/register` and `/login` parse with
 * (`lib/contracts/auth.ts`). A value this module calls valid is, by
 * construction, a value the server's schema accepts, and the reverse — the
 * `word-count.ts` precedent, and the reason there is no hand-copied
 * `PASSWORD_MIN_LENGTH` anywhere in a component. Two things are decided here
 * and not in the schema, and both only pick WHICH message to show for a
 * failure the schema already found: password too short versus too long (from
 * `passwordLength` and the exported bounds, not from the schema's English
 * message text), and empty versus malformed email.
 *
 * Consent: the request's `version` for each kind is read from
 * `CURRENT_CONSENT_VERSIONS` here, at the moment the request is built, and the
 * checkboxes are rendered from `CONSENT_FIELDS`, so the list of boxes the form
 * shows and the list of records it sends cannot drift apart. `marketingEmail`
 * is in that list but is NOT in `REQUIRED_CONSENT_KINDS`: its value goes to the
 * server as whatever the box says, `false` included (see `consent.ts` for why
 * a declined row is written), and it never influences validity.
 *
 * No server round trip happens before submit, deliberately: there is no
 * "is this email taken" check, inline or on blur. Registration is already an
 * email-enumeration oracle (see `emailAlreadyRegistered` in
 * `rejection-reason.ts`); the form must not be a more convenient one than a
 * plain POST.
 */
import {
  CONSENT_KINDS,
  CURRENT_CONSENT_VERSIONS,
  REQUIRED_CONSENT_KINDS,
  type ConsentKind,
} from '@/lib/contracts/consent';
import {
  loginRequestSchema,
  passwordLength,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@/lib/contracts/auth';

/**
 * The boxes, in the order they are shown: the three required ones first, then
 * the optional one. Derived from `consent.ts`, so a fifth kind added there is
 * a compile error in `buildRegisterRequest` (and a missing box here) rather
 * than a consent nobody was asked for.
 */
export const CONSENT_FIELDS = [
  ...REQUIRED_CONSENT_KINDS.map((kind) => ({ kind, required: true as const })),
  ...CONSENT_KINDS.filter((kind) => !(REQUIRED_CONSENT_KINDS as readonly ConsentKind[]).includes(kind)).map((kind) => ({
    kind,
    required: false as const,
  })),
] as const;

export interface RegistrationFormValues {
  email: string;
  password: string;
  consent: Record<ConsentKind, boolean>;
}

/** Every box unticked. The one place "unticked by default" is decided. */
export function emptyRegistrationValues(): RegistrationFormValues {
  return {
    email: '',
    password: '',
    consent: Object.fromEntries(CONSENT_KINDS.map((kind) => [kind, false])) as Record<ConsentKind, boolean>,
  };
}

export type EmailFieldError = 'required' | 'invalid';
export type PasswordFieldError = 'required' | 'tooShort' | 'tooLong';

/**
 * What a form does when the schema refused the values for a reason no field
 * accounts for: a required top-level field added to the contract after the form
 * was written, or an object-level issue (path `['consent']`, where there is no
 * kind to name). The form cannot say which field to fix, but it must still
 * refuse. Without this an `ok: false` whose issues all fell through the mapping
 * below came back as an empty error map, which React Hook Form reads as VALID —
 * `onValid` ran with `{}` and the request builder threw on it.
 */
export type FormLevelError = 'unmapped';

export interface RegistrationFieldErrors {
  email?: EmailFieldError;
  password?: PasswordFieldError;
  /** Only ever set for the three required kinds. */
  consent?: Partial<Record<ConsentKind, 'required'>>;
  form?: FormLevelError;
}

export interface SignInFieldErrors {
  email?: EmailFieldError;
  password?: 'required' | 'tooLong';
  form?: FormLevelError;
}

/**
 * Where a resolver puts a `form` error so React Hook Form blocks the submit.
 * NOT `root`: `handleSubmit` unsets `errors.root` before it decides whether the
 * form is valid, so a resolver-supplied root error is silently discarded and the
 * submit goes ahead.
 */
export const FORM_LEVEL_ERROR_KEY = 'form';

export type Validation<TRequest, TErrors> =
  | { readonly ok: true; readonly request: TRequest }
  | { readonly ok: false; readonly errors: TErrors };

export function buildRegisterRequest(values: RegistrationFormValues) {
  return {
    email: values.email,
    password: values.password,
    consent: Object.fromEntries(
      CONSENT_KINDS.map((kind) => [kind, { version: CURRENT_CONSENT_VERSIONS[kind], granted: values.consent[kind] }]),
    ) as Record<ConsentKind, { version: string; granted: boolean }>,
  };
}

function isRequiredConsentKind(kind: unknown): kind is ConsentKind {
  return typeof kind === 'string' && (REQUIRED_CONSENT_KINDS as readonly string[]).includes(kind);
}

function emailError(email: string): EmailFieldError {
  return email.trim() === '' ? 'required' : 'invalid';
}

export function validateRegistration(values: RegistrationFormValues): Validation<RegisterRequest, RegistrationFieldErrors> {
  const parsed = registerRequestSchema.safeParse(buildRegisterRequest(values));
  if (parsed.success) return { ok: true, request: parsed.data };

  const errors: RegistrationFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const [field, kind] = issue.path;
    if (field === 'email') {
      errors.email ??= emailError(values.email);
    } else if (field === 'password') {
      const length = passwordLength(values.password);
      errors.password ??= length === 0 ? 'required' : length < PASSWORD_MIN_LENGTH ? 'tooShort' : 'tooLong';
    } else if (field === 'consent' && isRequiredConsentKind(kind)) {
      // Only the three required kinds can fail: `marketingEmail`'s schema
      // accepts any boolean, and the form only ever sends one.
      (errors.consent ??= {})[kind] = 'required';
    } else {
      errors.form = 'unmapped';
    }
  }
  return { ok: false, errors };
}

export function validateSignIn(values: { email: string; password: string }): Validation<LoginRequest, SignInFieldErrors> {
  const parsed = loginRequestSchema.safeParse(values);
  if (parsed.success) return { ok: true, request: parsed.data };

  const errors: SignInFieldErrors = {};
  for (const issue of parsed.error.issues) {
    if (issue.path[0] === 'email') errors.email ??= emailError(values.email);
    else if (issue.path[0] === 'password') {
      errors.password ??= passwordLength(values.password) > PASSWORD_MAX_LENGTH ? 'tooLong' : 'required';
    } else errors.form = 'unmapped';
  }
  return { ok: false, errors };
}

/** Replaces `{name}` placeholders in a catalogue string — the same idiom `GradingPreview` uses for `{shown}`. */
export function fillPlaceholders(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), template);
}
