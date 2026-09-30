'use client';

/**
 * KAN-55 — the sign-in form: email and password. The other end of
 * `POST /api/auth/login` (KAN-20). Same conventions as `RegistrationForm`
 * (strings as props, one RHF resolver that is the server's own request
 * schema); read that file's comment for the reasoning, which is not repeated.
 *
 * WHAT THIS FORM MUST NOT DO: undo `invalidCredentials`. The server returns one
 * status, one reason and one message for "no such account" and "wrong
 * password", and does the same scrypt work for both (`lib/domain/login.ts`)
 * so the timing does not tell them apart either. So here:
 *  - `invalidCredentials` maps to ONE string, rendered in one place, in one
 *    style. It is form-level, not attached to either field, so it cannot say
 *    "this email" or "this password".
 *  - Nothing in the submit path branches on anything but the `reason`, and no
 *    delay, retry or animation is added on any outcome — a faster or slower
 *    UI for one case would rebuild the oracle the server took trouble to
 *    remove. The fields keep their values after a refusal, identically for both.
 *  - The client-side check runs the server's `loginRequestSchema`, which
 *    applies no password MINIMUM: an account created under an older policy must
 *    not be told "too short" by a form that would then behave differently from
 *    the server for it.
 *
 * ON SUCCESS the person lands back on their essay's report when they came from
 * one, and on the practice landing page otherwise. Signing in ADOPTS the guest
 * essay the browser is holding (KAN-52: `login()` is handed the guest cookie and
 * `signInUser` moves the session's essays to the account in the same
 * transaction that creates the registered session), so the report is theirs by
 * the time they arrive and opens in full. `essayId`, when present, is that
 * essay's id from the register page's link (the page has already checked it is
 * a UUID); the landing route is built from it here, so the destination is never
 * a caller-supplied path. If it is NOT theirs — someone else's link — the
 * preview page's ownership read answers 404, exactly as for any other visitor.
 */
import { useState } from 'react';
import { useForm, type FieldErrors, type Resolver } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { GRADING_STATUS_QUERY_KEY } from '@/hooks/use-grading-status';
import { AuthRequestError, postAuth } from '@/lib/auth-client';
import { PASSWORD_MAX_LENGTH } from '@/lib/contracts/auth';
import type { RejectionReason } from '@/lib/contracts/rejection-reason';
import { fillPlaceholders, FORM_LEVEL_ERROR_KEY, validateSignIn } from './auth-form-model';

export interface SignInFormStrings {
  readonly emailLabel: string;
  readonly emailRequiredError: string;
  readonly emailInvalidError: string;
  readonly passwordLabel: string;
  readonly passwordRequiredError: string;
  /** Carries `{max}`. */
  readonly passwordTooLongError: string;
  readonly submitCta: string;
  readonly submittingCta: string;
  readonly successTitle: string;
  readonly successBody: string;
  readonly errorGeneric: string;
  /** The one message for an unknown email AND a wrong password. */
  readonly invalidCredentialsError: string;
  readonly rateLimitedError: string;
}

interface SignInFormValues {
  email: string;
  password: string;
}

export interface SignInFormProps {
  readonly strings: SignInFormStrings;
  /** The guest's own essay, if they came from its report. Already validated as a UUID by the page. */
  readonly essayId?: string;
}

export function SignInForm({ strings, essayId }: SignInFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<RejectionReason | 'unknown' | null>(null);

  const resolver: Resolver<SignInFormValues> = async (values) => {
    const result = validateSignIn(values);
    if (result.ok) return { values, errors: {} };

    const { email, password, form } = result.errors;
    const fieldError = (message: string) => ({ type: 'validate', message });
    return {
      values: {},
      errors: {
        // A refusal no field accounts for still has to refuse: see `FORM_LEVEL_ERROR_KEY`.
        ...(form && { [FORM_LEVEL_ERROR_KEY]: fieldError(strings.errorGeneric) }),
        ...(email && { email: fieldError(email === 'required' ? strings.emailRequiredError : strings.emailInvalidError) }),
        ...(password && {
          password: fieldError(
            password === 'required'
              ? strings.passwordRequiredError
              : fillPlaceholders(strings.passwordTooLongError, { max: PASSWORD_MAX_LENGTH }),
          ),
        }),
      } as FieldErrors<SignInFormValues>,
    };
  };

  const form = useForm<SignInFormValues>({
    resolver,
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const mutation = useMutation({
    mutationFn: (values: SignInFormValues) => postAuth('/api/auth/login', values),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      // A different identity now: what was cached for the guest is not theirs to see again.
      queryClient.removeQueries({ queryKey: GRADING_STATUS_QUERY_KEY });
      router.replace(essayId ? { pathname: '/practice/preview', query: { essay: essayId } } : '/practice');
    },
    onError: (error) => setFailure(error instanceof AuthRequestError && error.reason ? error.reason : 'unknown'),
  });

  const reasonMessages: Record<RejectionReason, string> = {
    // One string for both credential failures — see the file comment. Do not split.
    invalidCredentials: strings.invalidCredentialsError,
    rateLimited: strings.rateLimitedError,
    // Everything else is a caller that bypassed this form, or a server fault.
    invalidSubmission: strings.errorGeneric,
    crossOrigin: strings.errorGeneric,
    invalidSessionCookie: strings.errorGeneric,
    bodyTooLarge: strings.errorGeneric,
    invalidJson: strings.errorGeneric,
    gradingJobNotFound: strings.errorGeneric,
    internalError: strings.errorGeneric,
    tooShort: strings.errorGeneric,
    tooLong: strings.errorGeneric,
    // Registration's reasons; `POST /api/auth/login` never produces them.
    emailAlreadyRegistered: strings.errorGeneric,
    staleConsentVersion: strings.errorGeneric,
  };

  // See RegistrationForm: the form-level refusal for a failure no field accounts for.
  const formLevelMessage = (form.formState.errors as Record<string, { message?: string } | undefined>)[FORM_LEVEL_ERROR_KEY]?.message;

  if (mutation.isSuccess) {
    return (
      <div role="status" className="rounded-lg border bg-card p-6 text-center">
        <h2 className="text-lg font-semibold">{strings.successTitle}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{strings.successBody}</p>
      </div>
    );
  }

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
                <Input {...field} type="password" autoComplete="current-password" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {(formLevelMessage || failure) && (
          <p role="alert" className="text-sm text-destructive">
            {formLevelMessage ?? (failure === 'unknown' ? strings.errorGeneric : reasonMessages[failure!])}
          </p>
        )}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? strings.submittingCta : strings.submitCta}
        </Button>
      </form>
    </Form>
  );
}
