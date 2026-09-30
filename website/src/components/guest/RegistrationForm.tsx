'use client';

/**
 * KAN-55 — the registration form: email, password and four consent boxes,
 * nothing else (no name, no profile fields). It is the other end of
 * `POST /api/auth/register` (KAN-20), which enforces every rule below on its
 * own; this form renders against them and never restates them.
 *
 * Same convention as `EssayEntryForm`, for the same reason: not under
 * `chrome/`, so it cannot import `next-intl` (eslint.config.js) — every
 * catalogue string arrives translated as `strings` from the Server Component
 * page. React Hook Form drives the fields (the repo's form library; this form
 * has five inputs and per-field errors, unlike the single-textarea essay
 * form), but its validation is one resolver that runs the values through
 * `validateRegistration` (`auth-form-model.ts`) — the server's own request
 * schema — so there is exactly one guard and it is the server's.
 *
 * CONSENT (GDPR). Three required boxes and one optional, all unticked on first
 * render (`emptyRegistrationValues`), rendered from `CONSENT_FIELDS` — which
 * is derived from `lib/contracts/consent.ts`, the module that also supplies the
 * version each record is sent with. The marketing box is its own fieldset with
 * its own legend and a divider, a separate RHF field, and nothing in this file
 * reads or writes it except its own `onChange`: there is no "accept all", no
 * effect that ticks one box from another, and its value never enters
 * validation. Each box carries `data-consent-version`, the version it was
 * rendered and will be recorded under. Those are currently the placeholder
 * `UNPUBLISHED-DRAFT` (a launch blocker tracked elsewhere) and are not shown to
 * the person; the attribute is there so what is on screen is checkable against
 * what is sent.
 *
 * ERRORS. `reasonMessages` is exhaustive over `RejectionReason`, the
 * compile-or-else mechanism `EssayEntryForm` documents. Two of those entries
 * are choices worth stating:
 *  - `emailAlreadyRegistered` is a PLAIN message. No "sign in instead" link,
 *    no button: a guest who signs in with an existing account has their
 *    guest-owned essay orphaned (`resolveOwnerActor` resolves the registered
 *    session first and never consults the guest cookie — KAN-52), so a helpful
 *    link would walk them into it. It is a form-level alert, not attached to
 *    the email field, so nothing about it is styled or announced differently
 *    from any other refusal.
 *  - `staleConsentVersion` (the register route's answer when the ONLY schema
 *    failures are on `consent.*.version`) says the terms may have changed, and
 *    to reload. `invalidSubmission` is a different string on purpose: the form
 *    validates with the server's own schema and sends the versions in force in
 *    its bundle, so it can only get `invalidSubmission` when the page's bundle
 *    and the server disagree about something OTHER than (or as well as) a
 *    consent version — a deploy while the tab was open that tightened the
 *    password policy or added a consent kind. Reloading fixes that too, but
 *    "the terms may have changed" would be untrue there.
 * The form makes NO request before submit: no availability check, no inline
 * or on-blur lookup of the address. Registration is already an
 * email-enumeration oracle (see `emailAlreadyRegistered`'s own comment in
 * `rejection-reason.ts`); this must not be a friendlier one than a raw POST.
 *
 * ON SUCCESS the person is already signed in (the response set the session
 * cookie). Before navigating, the cached grading status is evicted: it is a
 * `locked` report fetched as a guest, and showing it again for a moment on the
 * page that is supposed to be unlocked is exactly what the guest came here to
 * end. `essayId`, when present, is the guest's own essay from the CTA's link
 * (the page has already checked it is a UUID); the landing route is built from
 * it here, so the destination is never a caller-supplied path.
 */
import { useState, type ReactNode } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { GRADING_STATUS_QUERY_KEY } from '@/hooks/use-grading-status';
import { AuthRequestError, postAuth } from '@/lib/auth-client';
import { CURRENT_CONSENT_VERSIONS, type ConsentKind } from '@/lib/contracts/consent';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/contracts/auth';
import type { RejectionReason } from '@/lib/contracts/rejection-reason';
import {
  buildRegisterRequest,
  CONSENT_FIELDS,
  emptyRegistrationValues,
  fillPlaceholders,
  validateRegistration,
  type RegistrationFormValues,
} from './auth-form-model';

/**
 * Where each consent document lives. The marketing site's own pages, which are
 * unlocalised and English-only (KAN-9), so a plain anchor and not the locale
 * `Link` — that would point a German guest at `/de/privacy`, which does not
 * exist. Opened in a new tab so reading them does not throw away the form.
 */
export const CONSENT_DOCUMENT_HREFS: Partial<Record<ConsentKind, string>> = {
  termsOfService: '/terms',
  privacyPolicy: '/privacy',
};

export interface ConsentStrings {
  /** Carries a `{link}` placeholder where the document link goes, for the two kinds that have one. */
  readonly label: string;
  /** The link's text; present exactly for the kinds in `CONSENT_DOCUMENT_HREFS`. */
  readonly linkText?: string;
  /** Present for the three required kinds, absent for `marketingEmail`. */
  readonly requiredError?: string;
}

export interface RegistrationFormStrings {
  readonly emailLabel: string;
  readonly emailRequiredError: string;
  readonly emailInvalidError: string;
  readonly passwordLabel: string;
  /** Carries `{min}` and `{max}`. Shown before the person types, not only after they fail. */
  readonly passwordHint: string;
  readonly passwordRequiredError: string;
  /** Carries `{min}`. */
  readonly passwordTooShortError: string;
  /** Carries `{max}`. */
  readonly passwordTooLongError: string;
  readonly requiredConsentLegend: string;
  readonly optionalConsentLegend: string;
  readonly consent: Readonly<Record<ConsentKind, ConsentStrings>>;
  readonly submitCta: string;
  readonly submittingCta: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly errorGeneric: string;
  readonly invalidSubmissionError: string;
  readonly staleConsentVersionError: string;
  readonly rateLimitedError: string;
  readonly emailAlreadyRegisteredError: string;
}

export interface RegistrationFormProps {
  readonly strings: RegistrationFormStrings;
  /** The guest's own essay, if they came from its report. Already validated as a UUID by the page. */
  readonly essayId?: string;
}

function renderConsentLabel(kind: ConsentKind, strings: ConsentStrings): ReactNode {
  const href = CONSENT_DOCUMENT_HREFS[kind];
  if (!href || !strings.linkText) return strings.label;
  const [before, after = ''] = strings.label.split('{link}');
  return (
    <>
      {before}
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {strings.linkText}
      </a>
      {after}
    </>
  );
}

export function RegistrationForm({ strings, essayId }: RegistrationFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<RejectionReason | 'unknown' | null>(null);

  const passwordBounds = { min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH };

  const resolver: Resolver<RegistrationFormValues> = async (values) => {
    const result = validateRegistration(values);
    if (result.ok) return { values, errors: {} };

    const { email, password, consent } = result.errors;
    const fieldError = (message: string) => ({ type: 'validate', message });
    return {
      values: {},
      errors: {
        ...(email && {
          email: fieldError(email === 'required' ? strings.emailRequiredError : strings.emailInvalidError),
        }),
        ...(password && {
          password: fieldError(
            password === 'required'
              ? strings.passwordRequiredError
              : password === 'tooShort'
                ? fillPlaceholders(strings.passwordTooShortError, passwordBounds)
                : fillPlaceholders(strings.passwordTooLongError, passwordBounds),
          ),
        }),
        ...(consent && {
          consent: Object.fromEntries(
            Object.keys(consent).map((kind) => [kind, fieldError(strings.consent[kind as ConsentKind].requiredError ?? '')]),
          ),
        }),
      },
    };
  };

  const form = useForm<RegistrationFormValues>({
    resolver,
    defaultValues: emptyRegistrationValues(),
    // Nothing is judged until the first submit, and after that each field is
    // re-judged as it changes — an empty form must not shout at someone who has
    // done nothing yet (the same call `EssayEntryForm` makes).
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const mutation = useMutation({
    mutationFn: (values: RegistrationFormValues) => postAuth('/api/auth/register', buildRegisterRequest(values)),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: GRADING_STATUS_QUERY_KEY });
      router.replace(essayId ? { pathname: '/practice/preview', query: { essay: essayId } } : '/practice');
    },
    onError: (error) => setFailure(error instanceof AuthRequestError && error.reason ? error.reason : 'unknown'),
  });

  const reasonMessages: Record<RejectionReason, string> = {
    // Plain and form-level on purpose — see the file comment.
    emailAlreadyRegistered: strings.emailAlreadyRegisteredError,
    rateLimited: strings.rateLimitedError,
    // The terms in force are not the ones this page rendered: reload.
    staleConsentVersion: strings.staleConsentVersionError,
    // A stale bundle that disagrees with the server about more than a consent
    // version (see the file comment): reload, without blaming the terms.
    invalidSubmission: strings.invalidSubmissionError,
    // Reachable only by a caller that bypasses this form (it is same-origin and
    // cannot be submitted invalid against its own bundle's schema), or a
    // server fault: nothing more specific to say.
    crossOrigin: strings.errorGeneric,
    invalidSessionCookie: strings.errorGeneric,
    bodyTooLarge: strings.errorGeneric,
    invalidJson: strings.errorGeneric,
    gradingJobNotFound: strings.errorGeneric,
    internalError: strings.errorGeneric,
    tooShort: strings.errorGeneric,
    tooLong: strings.errorGeneric,
    // Sign-in's reason; `POST /api/auth/register` never produces it.
    invalidCredentials: strings.errorGeneric,
  };

  if (mutation.isSuccess) {
    return (
      <div role="status" className="rounded-lg border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold">{strings.successTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{strings.successBody}</p>
      </div>
    );
  }

  const requiredFields = CONSENT_FIELDS.filter((field) => field.required);
  const optionalFields = CONSENT_FIELDS.filter((field) => !field.required);

  const consentField = (kind: ConsentKind) => (
    <FormField
      key={kind}
      control={form.control}
      name={`consent.${kind}`}
      render={({ field }) => (
        <FormItem>
          <div className="flex items-start gap-3">
            <FormControl>
              <Checkbox
                ref={field.ref}
                name={field.name}
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                onBlur={field.onBlur}
                // Named by its label explicitly: a `<button role="checkbox">`
                // is labelled by `label[for]` in browsers, but not by every
                // assistive-technology and test-tooling implementation, and the
                // label here also carries a link.
                aria-labelledby={`consent-label-${kind}`}
                data-consent-version={CURRENT_CONSENT_VERSIONS[kind]}
                className="mt-0.5"
              />
            </FormControl>
            <FormLabel id={`consent-label-${kind}`} className="text-sm font-normal leading-snug">{renderConsentLabel(kind, strings.consent[kind])}</FormLabel>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="space-y-5">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.emailLabel}</FormLabel>
              <FormControl>
                <Input {...field} type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{strings.passwordLabel}</FormLabel>
              <FormControl>
                <Input {...field} type="password" autoComplete="new-password" />
              </FormControl>
              <p className="text-sm text-muted-foreground">{fillPlaceholders(strings.passwordHint, passwordBounds)}</p>
              <FormMessage />
            </FormItem>
          )}
        />

        <fieldset className="space-y-3" data-testid="consent-required">
          <legend className="mb-1 text-sm font-medium">{strings.requiredConsentLegend}</legend>
          {requiredFields.map(({ kind }) => consentField(kind))}
        </fieldset>

        {/* Its own group, legend and divider — visibly not part of the three above. */}
        <fieldset className="space-y-3 border-t pt-4" data-testid="consent-optional">
          <legend className="mb-1 text-sm font-medium text-muted-foreground">{strings.optionalConsentLegend}</legend>
          {optionalFields.map(({ kind }) => consentField(kind))}
        </fieldset>

        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure === 'unknown' ? strings.errorGeneric : reasonMessages[failure]}
          </p>
        )}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? strings.submittingCta : strings.submitCta}
        </Button>
      </form>
    </Form>
  );
}
