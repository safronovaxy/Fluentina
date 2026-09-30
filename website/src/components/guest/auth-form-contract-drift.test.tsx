import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import { RegistrationForm, type RegistrationFormStrings } from './RegistrationForm';
import { SignInForm, type SignInFormStrings } from './SignInForm';
import { emptyRegistrationValues, validateRegistration, validateSignIn, type RegistrationFormValues } from './auth-form-model';
import { REQUIRED_CONSENT_KINDS } from '@/lib/contracts/consent';

/**
 * KAN-55 — what the forms do when the server's request schema refuses values
 * for a reason no field accounts for.
 *
 * Not reachable with the schema as it stands: the form supplies every field the
 * schema names. It is what the NEXT contract change reaches — a new required
 * top-level field, or an object-level issue at `['consent']` — and the module
 * header of `auth-form-model.ts` promises the form and the route cannot
 * disagree silently. Validity held that promise; the error MAPPING did not: an
 * `ok: false` whose issues all fell through came back with an empty error map,
 * which React Hook Form reads as valid, so `onValid` ran with `{}` and the
 * request builder threw on it, with no field marked.
 *
 * So the real schemas are wrapped here with a `superRefine` that adds the
 * issues a future contract would, and everything else is the real model, the
 * real forms and the real catalogue.
 */
const drift = vi.hoisted(() => ({ issues: [] as Array<{ path: Array<string | number> }> }));
vi.mock('@/lib/contracts/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/contracts/auth')>();
  const addDrift = (_value: unknown, ctx: import('zod').RefinementCtx) => {
    for (const issue of drift.issues) ctx.addIssue({ code: 'custom', message: 'drift', path: issue.path });
  };
  return {
    ...real,
    registerRequestSchema: real.registerRequestSchema.superRefine(addDrift),
    loginRequestSchema: real.loginRequestSchema.superRefine(addDrift),
  };
});

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

const REGISTER = enMessages.chrome.guest.register as unknown as RegistrationFormStrings;
const SIGN_IN = enMessages.chrome.guest.signIn as unknown as SignInFormStrings;

const UNMAPPED_PATHS: ReadonlyArray<[string, Array<string | number>]> = [
  ['a required top-level field added to the contract', ['displayName']],
  ['an object-level issue on consent, which names no kind', ['consent']],
  ['an issue at the root', []],
];

function validRegistration(): RegistrationFormValues {
  const empty = emptyRegistrationValues();
  const consent = { ...empty.consent };
  for (const kind of REQUIRED_CONSENT_KINDS) consent[kind] = true;
  return { email: 'guest@example.test', password: 'correct horse battery staple', consent };
}

beforeEach(() => {
  drift.issues = [];
  replace.mockClear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('validateRegistration / validateSignIn — a refusal that maps to no field is still a refusal', () => {
  it.each(UNMAPPED_PATHS)('registration, %s: ok is false and the errors say so, not {}', (_label, path) => {
    drift.issues = [{ path }];

    const result = validateRegistration(validRegistration());

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.errors).toEqual({ form: 'unmapped' });
  });

  it.each(UNMAPPED_PATHS)('sign-in, %s: ok is false and the errors say so, not {}', (_label, path) => {
    drift.issues = [{ path }];

    const result = validateSignIn({ email: 'guest@example.test', password: 'x' });

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.errors).toEqual({ form: 'unmapped' });
  });

  it('registration: an unmapped issue alongside a mapped one keeps both, so neither hides the other', () => {
    drift.issues = [{ path: ['displayName'] }];

    const result = validateRegistration({ ...validRegistration(), email: 'nope' });

    expect(result.ok ? null : result.errors).toEqual({ email: 'invalid', form: 'unmapped' });
  });

  it('registration: an issue on the OPTIONAL consent kind is not silently dropped either — only the three required kinds map to a box', () => {
    drift.issues = [{ path: ['consent', 'marketingEmail'] }];

    const result = validateRegistration(validRegistration());

    expect(result.ok ? null : result.errors).toEqual({ form: 'unmapped' });
  });

  it('registration: a mapped issue alone does not raise the form-level error', () => {
    drift.issues = [{ path: ['consent', 'termsOfService'] }];

    const result = validateRegistration(validRegistration());

    expect(result.ok ? null : result.errors).toEqual({ consent: { termsOfService: 'required' } });
  });

  it('with no drift, both still accept good values (the wrapper alone changes nothing)', () => {
    expect(validateRegistration(validRegistration()).ok).toBe(true);
    expect(validateSignIn({ email: 'guest@example.test', password: 'x' }).ok).toBe(true);
  });
});

describe('the forms — refuse, say so, and send nothing', () => {
  function renderRegistration() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={enMessages}>
          <RegistrationForm strings={REGISTER} />
        </IntlProvider>
      </QueryClientProvider>,
    );
  }

  function renderSignIn() {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <IntlProvider locale="en" messages={enMessages}>
          <SignInForm strings={SIGN_IN} />
        </IntlProvider>
      </QueryClientProvider>,
    );
  }

  it.each(UNMAPPED_PATHS)('registration, %s: a form-level alert, no request, no navigation, no field marked', async (_label, path) => {
    drift.issues = [{ path }];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderRegistration();

    fireEvent.change(screen.getByLabelText(REGISTER.emailLabel), { target: { value: 'guest@example.test' } });
    fireEvent.change(screen.getByLabelText(REGISTER.passwordLabel), { target: { value: 'correct horse battery staple' } });
    for (const kind of REQUIRED_CONSENT_KINDS) {
      fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(REGISTER.consent[kind].label.split('{link}')[0]) }));
    }
    fireEvent.click(screen.getByRole('button', { name: REGISTER.submitCta }));

    expect(await screen.findByRole('alert')).toHaveTextContent(REGISTER.invalidSubmissionError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText(REGISTER.emailLabel)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText(REGISTER.passwordLabel)).toHaveAttribute('aria-invalid', 'false');
  });

  it.each(UNMAPPED_PATHS)('sign-in, %s: a form-level alert, no request, no navigation, no field marked', async (_label, path) => {
    drift.issues = [{ path }];
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    renderSignIn();

    fireEvent.change(screen.getByLabelText(SIGN_IN.emailLabel), { target: { value: 'guest@example.test' } });
    fireEvent.change(screen.getByLabelText(SIGN_IN.passwordLabel), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submitCta }));

    expect(await screen.findByRole('alert')).toHaveTextContent(SIGN_IN.errorGeneric);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText(SIGN_IN.emailLabel)).toHaveAttribute('aria-invalid', 'false');
  });

  it('once the contract stops refusing, the same form submits (the refusal was the drift, not a stuck form)', async () => {
    drift.issues = [{ path: ['displayName'] }];
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    renderSignIn();
    fireEvent.change(screen.getByLabelText(SIGN_IN.emailLabel), { target: { value: 'guest@example.test' } });
    fireEvent.change(screen.getByLabelText(SIGN_IN.passwordLabel), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submitCta }));
    await screen.findByRole('alert');

    drift.issues = [];
    fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submitCta }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
