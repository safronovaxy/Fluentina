import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import deMessages from '@/messages/de.json';
import { SignInForm, type SignInFormStrings } from './SignInForm';
import { GRADING_STATUS_QUERY_KEY } from '@/hooks/use-grading-status';
import { PASSWORD_MAX_LENGTH } from '@/lib/contracts/auth';

/**
 * KAN-55 — the sign-in form. The property that matters most is negative: an
 * unknown email and a wrong password must look the same, because the server
 * takes real trouble (one status, one reason, one message, a dummy scrypt
 * derivation) to make them the same, and this form is the last place that could
 * quietly undo it. `auth-forms.integration.test.tsx` proves it end to end against
 * the real route; this file proves the form itself reads nothing that could differ.
 */
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/sign-in',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

beforeEach(() => replace.mockClear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const EN = enMessages.chrome.guest.signIn as unknown as SignInFormStrings;
const DE = deMessages.chrome.guest.signIn as unknown as SignInFormStrings;

function renderForm(options: { strings?: SignInFormStrings; locale?: 'en' | 'de'; client?: QueryClient } = {}) {
  const { strings = EN, locale = 'en', client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }) } = options;
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale={locale} messages={locale === 'de' ? deMessages : enMessages}>
        <SignInForm strings={strings} />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

function signIn(email: string, password: string, strings = EN) {
  fireEvent.change(screen.getByLabelText(strings.emailLabel), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(strings.passwordLabel), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: strings.submitCta }));
}

function stubFetch(reply: () => Response | Promise<Response>) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => reply());
  vi.stubGlobal('fetch', spy);
  return spy;
}

const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const refusal = (status: number, reason: string, error = 'x') => new Response(JSON.stringify({ error, reason }), { status });

/** The form's markup with the parts that legitimately differ per render (React ids, typed values) removed. */
function shape(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('input').forEach((input) => input.removeAttribute('value'));
  return clone.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
}

describe('SignInForm — email and password', () => {
  it('asks for those two and nothing else, with sign-in autofill hints', () => {
    const { container } = renderForm();

    expect(screen.getByLabelText(EN.emailLabel)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveAttribute('autocomplete', 'current-password');
    expect(container.querySelectorAll('input')).toHaveLength(2);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('posts them to the login route and nothing more', async () => {
    const fetchSpy = stubFetch(ok);
    renderForm();

    signIn('guest@example.test', 'hunter2');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/login');
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body))).toEqual({ email: 'guest@example.test', password: 'hunter2' });
  });

  it('applies no password minimum — a one-character password is sent, and the server decides', async () => {
    const fetchSpy = stubFetch(ok);
    renderForm();

    signIn('guest@example.test', 'x');

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/at least|mindestens/i)).toBeNull();
  });

  it.each([
    ['an empty email', '', 'pw', 'emailRequiredError'],
    ['a malformed email', 'nope', 'pw', 'emailInvalidError'],
    ['an empty password', 'guest@example.test', '', 'passwordRequiredError'],
  ] as const)('%s is refused in the browser and nothing is sent', async (_label, email, password, errorKey) => {
    const fetchSpy = stubFetch(ok);
    renderForm();

    signIn(email, password);

    expect(await screen.findByText(EN[errorKey])).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a password past the maximum is refused with the bound from the contract, and nothing is sent', async () => {
    const fetchSpy = stubFetch(ok);
    renderForm();

    signIn('guest@example.test', 'a'.repeat(PASSWORD_MAX_LENGTH + 1));

    expect(await screen.findByText(`Passwords can be at most ${PASSWORD_MAX_LENGTH} characters.`)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('makes no request before submit', async () => {
    const fetchSpy = stubFetch(ok);
    renderForm();
    const email = screen.getByLabelText(EN.emailLabel);

    fireEvent.change(email, { target: { value: 'guest@example.test' } });
    fireEvent.blur(email);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('SignInForm — invalidCredentials looks identical for an unknown email and a wrong password', () => {
  async function refusedPage(email: string, serverMessage: string) {
    const fetchSpy = stubFetch(() => refusal(401, 'invalidCredentials', serverMessage));
    const view = renderForm();
    signIn(email, 'some password');
    const alert = await screen.findByRole('alert');
    return { alert, markup: shape(view.container), fetchSpy, unmount: view.unmount };
  }

  it('shows the one catalogue message', async () => {
    const { alert } = await refusedPage('guest@example.test', 'x');

    expect(alert).toHaveTextContent(EN.invalidCredentialsError);
  });

  it('renders byte-identical markup whichever case it was — and whatever the server\'s own message text says', async () => {
    // If the form ever surfaced the server's message, or branched on anything
    // but the reason, these two would differ.
    const unknown = await refusedPage('nobody@example.test', 'no such account');
    unknown.unmount();
    cleanup();
    const wrong = await refusedPage('somebody@example.test', 'wrong password');

    expect(wrong.alert.outerHTML).toBe(unknown.alert.outerHTML);
    expect(wrong.markup).toBe(unknown.markup);
    expect(wrong.alert).not.toHaveTextContent('no such account');
    expect(wrong.alert).not.toHaveTextContent('wrong password');
  });

  it('makes exactly one request for either case — no retry, no second probe', async () => {
    const unknown = await refusedPage('nobody@example.test', 'x');
    const wrong = await (async () => {
      unknown.unmount();
      cleanup();
      return refusedPage('somebody@example.test', 'x');
    })();

    expect(unknown.fetchSpy).toHaveBeenCalledTimes(1);
    expect(wrong.fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('is form-level: neither field is marked invalid, so the message cannot point at the email or at the password', async () => {
    await refusedPage('nobody@example.test', 'x');

    expect(screen.getByLabelText(EN.emailLabel)).toHaveAttribute('aria-invalid', 'false');
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveAttribute('aria-invalid', 'false');
  });

  it('keeps both fields as typed after a refusal, the same in both cases', async () => {
    await refusedPage('nobody@example.test', 'x');

    expect(screen.getByLabelText(EN.emailLabel)).toHaveValue('nobody@example.test');
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveValue('some password');
  });

  it.each([['en', EN, /email/i, /password/i], ['de', DE, /E-Mail/, /Passwort/]] as const)(
    '%s: the message names the pair, never one half of it',
    (_locale, strings, emailWord, passwordWord) => {
      expect(strings.invalidCredentialsError).toMatch(emailWord);
      expect(strings.invalidCredentialsError).toMatch(passwordWord);
    },
  );

  it('the credentials message is not the generic one, in either language', () => {
    expect(EN.invalidCredentialsError).not.toBe(EN.errorGeneric);
    expect(DE.invalidCredentialsError).not.toBe(DE.errorGeneric);
  });
});

describe('SignInForm — other refusals', () => {
  it('a rate-limit refusal says to wait', async () => {
    stubFetch(() => refusal(429, 'rateLimited'));
    renderForm();

    signIn('guest@example.test', 'pw');

    expect(await screen.findByRole('alert')).toHaveTextContent(EN.rateLimitedError);
    expect(EN.rateLimitedError).not.toBe(EN.errorGeneric);
  });

  it.each([
    [500, 'internalError'],
    [400, 'invalidSubmission'],
    [400, 'crossOrigin'],
  ])('%i %s gets the generic message', async (status, reason) => {
    stubFetch(() => refusal(status, reason));
    renderForm();

    signIn('guest@example.test', 'pw');

    expect(await screen.findByRole('alert')).toHaveTextContent(EN.errorGeneric);
  });

  it('a dropped connection and a non-JSON body get the generic message', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderForm();
    signIn('guest@example.test', 'pw');
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.errorGeneric);

    cleanup();
    stubFetch(() => new Response('<html>502</html>', { status: 502 }));
    renderForm();
    signIn('guest@example.test', 'pw');
    expect(await screen.findByRole('alert')).toHaveTextContent(EN.errorGeneric);
  });

  it('cannot be submitted twice while a request is in flight', async () => {
    const fetchSpy = stubFetch(() => new Promise<Response>(() => {}));
    renderForm();

    signIn('guest@example.test', 'pw');
    const busy = await screen.findByRole('button', { name: EN.submittingCta });
    fireEvent.click(busy);

    expect(busy).toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('SignInForm — success', () => {
  it('lands on the practice landing page, not on any essay (KAN-52: a guest essay would be orphaned)', async () => {
    stubFetch(ok);
    renderForm();

    signIn('guest@example.test', 'pw');

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/practice');
  });

  it('stays under /de for a German visitor', async () => {
    stubFetch(ok);
    renderForm({ strings: DE, locale: 'de' });

    signIn('guest@example.test', 'pw', DE);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/de/practice');
  });

  it('evicts cached grading status — it belongs to the previous identity — and leaves unrelated cache alone', async () => {
    const client = new QueryClient();
    client.setQueryData([...GRADING_STATUS_QUERY_KEY, 'e1'], { status: 'succeeded' });
    client.setQueryData(['blog-posts'], ['keep me']);
    stubFetch(ok);
    renderForm({ client });

    signIn('guest@example.test', 'pw');

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(client.getQueryData([...GRADING_STATUS_QUERY_KEY, 'e1'])).toBeUndefined();
    expect(client.getQueryData(['blog-posts'])).toEqual(['keep me']);
  });

  it('does not navigate on a refusal', async () => {
    stubFetch(() => refusal(401, 'invalidCredentials'));
    renderForm();

    signIn('guest@example.test', 'pw');
    await screen.findByRole('alert');

    expect(replace).not.toHaveBeenCalled();
  });

  it('announces success in a status region', async () => {
    stubFetch(ok);
    renderForm();

    signIn('guest@example.test', 'pw');

    expect(await screen.findByRole('status')).toHaveTextContent(EN.successTitle);
  });
});

describe('SignInForm — catalogue (both locales)', () => {
  it.each([['en', EN], ['de', DE]] as const)('%s has every string the form takes', (_locale, strings) => {
    for (const key of [
      'emailLabel', 'emailRequiredError', 'emailInvalidError', 'passwordLabel', 'passwordRequiredError', 'passwordTooLongError',
      'submitCta', 'submittingCta', 'successTitle', 'successBody', 'errorGeneric', 'invalidCredentialsError', 'rateLimitedError',
    ] as const) {
      expect(strings[key], key).toBeTruthy();
    }
    expect(strings.passwordTooLongError).toContain('{max}');
  });
});
