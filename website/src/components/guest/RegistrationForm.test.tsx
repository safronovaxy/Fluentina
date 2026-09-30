import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import deMessages from '@/messages/de.json';
import { RegistrationForm, CONSENT_DOCUMENT_HREFS, type RegistrationFormStrings } from './RegistrationForm';
import { CONSENT_FIELDS } from './auth-form-model';
import { GRADING_STATUS_QUERY_KEY } from '@/hooks/use-grading-status';
import { CONSENT_KINDS, CURRENT_CONSENT_VERSIONS, REQUIRED_CONSENT_KINDS, type ConsentKind } from '@/lib/contracts/consent';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/contracts/auth';

/**
 * KAN-55 — the registration form, against the REAL catalogues (a hand-written
 * stand-in would not notice the German copy drifting, which the AC names).
 * The server's own enforcement of every rule here is proved separately, against
 * the real route handler, in `auth-forms.integration.test.tsx`.
 */
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/register',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

// Radix's checkbox measures its hidden form input with ResizeObserver, which jsdom lacks.
beforeEach(() => {
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

const EN = enMessages.chrome.guest.register as unknown as RegistrationFormStrings;
const DE = deMessages.chrome.guest.register as unknown as RegistrationFormStrings;
const ESSAY_ID = 'a6afa382-8223-4b5d-b4ea-d5a7f0694211';
const GOOD_EMAIL = 'guest@example.test';
const GOOD_PASSWORD = 'correct horse battery staple';

/**
 * The name a consent box is found by: the catalogue's own label text with the
 * link's text in place of `{link}`. Whitespace around the link is optional
 * because how an anchor's neighbours are spaced in a computed name differs
 * between accessibility-tree implementations.
 */
function boxName(strings: RegistrationFormStrings, kind: ConsentKind): RegExp {
  const { label, linkText } = strings.consent[kind];
  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(label.split('{link}').map(escape).join(linkText ? `\\s*${escape(linkText)}\\s*` : ''));
}

/** The strings the form on screen was rendered with — so the helpers below follow it into German. */
let active: RegistrationFormStrings = EN;

function box(kind: ConsentKind, strings = active): HTMLElement {
  return screen.getByRole('checkbox', { name: boxName(strings, kind) });
}

function renderForm(options: { strings?: RegistrationFormStrings; locale?: 'en' | 'de'; essayId?: string; client?: QueryClient } = {}) {
  const { strings = EN, locale = 'en', essayId, client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }) } = options;
  active = strings;
  return render(
    <QueryClientProvider client={client}>
      <IntlProvider locale={locale} messages={locale === 'de' ? deMessages : enMessages}>
        <RegistrationForm strings={strings} essayId={essayId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

function fillCredentials(strings = active, email = GOOD_EMAIL, password = GOOD_PASSWORD) {
  fireEvent.change(screen.getByLabelText(strings.emailLabel), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(strings.passwordLabel), { target: { value: password } });
}

function tick(...kinds: ConsentKind[]) {
  for (const kind of kinds) fireEvent.click(box(kind));
}

function submit(strings = active) {
  fireEvent.click(screen.getByRole('button', { name: strings.submitCta }));
}

function stubFetch(reply: () => Response | Promise<Response>) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => reply());
  vi.stubGlobal('fetch', spy);
  return spy;
}

const created = () => new Response(JSON.stringify({ ok: true }), { status: 201 });
const refusal = (status: number, reason: string) => new Response(JSON.stringify({ error: 'x', reason }), { status });

function sentBody(spy: ReturnType<typeof stubFetch>) {
  return JSON.parse(String(spy.mock.calls[0][1]?.body));
}

describe('RegistrationForm — email and password only', () => {
  it('asks for an email address and a password and no other field — no name, no profile', () => {
    const { container } = renderForm();

    expect(screen.getByLabelText(EN.emailLabel)).toHaveAttribute('type', 'email');
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveAttribute('type', 'password');
    // Nothing else a person could type into.
    expect(container.querySelectorAll('input:not([aria-hidden="true"]):not([type="checkbox"])')).toHaveLength(2);
    expect(container.querySelector('textarea, select, input[type="text"], input[type="tel"]')).toBeNull();
  });

  it('gives the password field the right autofill hints, and states the policy before anyone fails it', () => {
    renderForm();

    expect(screen.getByLabelText(EN.emailLabel)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByText(`At least ${PASSWORD_MIN_LENGTH} characters, up to ${PASSWORD_MAX_LENGTH}.`)).toBeInTheDocument();
  });
});

describe('RegistrationForm — consent: three mandatory, one optional, all unticked on first render (GDPR)', () => {
  it('renders exactly one checkbox per consent kind, from the contract', () => {
    renderForm();

    expect(screen.getAllByRole('checkbox')).toHaveLength(CONSENT_KINDS.length);
    for (const { kind } of CONSENT_FIELDS) expect(box(kind)).toBeInTheDocument();
  });

  it.each(CONSENT_KINDS)('%s is unticked on first render', (kind) => {
    renderForm();

    expect(box(kind)).toHaveAttribute('aria-checked', 'false');
    expect(box(kind)).toHaveAttribute('data-state', 'unchecked');
  });

  it('every box carries the version it is rendered under — the one that will be recorded', () => {
    renderForm();

    for (const kind of CONSENT_KINDS) expect(box(kind)).toHaveAttribute('data-consent-version', CURRENT_CONSENT_VERSIONS[kind]);
  });

  it('marketing sits in its own group, visibly labelled optional, apart from the three required boxes', () => {
    renderForm();

    const required = screen.getByTestId('consent-required');
    const optional = screen.getByTestId('consent-optional');
    expect(within(required).getAllByRole('checkbox')).toHaveLength(3);
    expect(within(optional).getAllByRole('checkbox')).toHaveLength(1);
    expect(within(optional).getByRole('checkbox')).toBe(box('marketingEmail'));
    expect(within(optional).getByText(EN.optionalConsentLegend)).toBeInTheDocument();
    expect(within(required).getByText(EN.requiredConsentLegend)).toBeInTheDocument();
    expect(required.contains(optional)).toBe(false);
  });

  it('ticking marketing ticks nothing else', () => {
    renderForm();

    tick('marketingEmail');

    expect(box('marketingEmail')).toHaveAttribute('aria-checked', 'true');
    for (const kind of REQUIRED_CONSENT_KINDS) expect(box(kind), kind).toHaveAttribute('aria-checked', 'false');
  });

  it('ticking every required box leaves marketing unticked — it is never implied', () => {
    renderForm();

    tick(...REQUIRED_CONSENT_KINDS);

    for (const kind of REQUIRED_CONSENT_KINDS) expect(box(kind), kind).toHaveAttribute('aria-checked', 'true');
    expect(box('marketingEmail')).toHaveAttribute('aria-checked', 'false');
  });

  it.each(REQUIRED_CONSENT_KINDS)('ticking and unticking %s alone never moves marketing or the other two', (kind) => {
    renderForm();
    const others = CONSENT_KINDS.filter((other) => other !== kind);

    tick(kind);
    for (const other of others) expect(box(other), `${other} after ticking ${kind}`).toHaveAttribute('aria-checked', 'false');
    tick(kind);
    for (const other of others) expect(box(other), `${other} after unticking ${kind}`).toHaveAttribute('aria-checked', 'false');
    expect(box(kind)).toHaveAttribute('aria-checked', 'false');
  });

  it('unticking marketing leaves the three required boxes as they were', () => {
    renderForm();
    tick(...REQUIRED_CONSENT_KINDS, 'marketingEmail');

    tick('marketingEmail');

    expect(box('marketingEmail')).toHaveAttribute('aria-checked', 'false');
    for (const kind of REQUIRED_CONSENT_KINDS) expect(box(kind), kind).toHaveAttribute('aria-checked', 'true');
  });

  it('a failed submit does not tick anything to "help" — the boxes are as the person left them', () => {
    renderForm();
    fillCredentials();

    submit();

    for (const kind of CONSENT_KINDS) expect(box(kind), kind).toHaveAttribute('aria-checked', 'false');
  });

  it('links the two documents, in a new tab so reading them does not discard the form', () => {
    renderForm();

    const terms = screen.getByRole('link', { name: EN.consent.termsOfService.linkText! });
    const privacy = screen.getByRole('link', { name: EN.consent.privacyPolicy.linkText! });
    expect(terms).toHaveAttribute('href', CONSENT_DOCUMENT_HREFS.termsOfService);
    expect(privacy).toHaveAttribute('href', CONSENT_DOCUMENT_HREFS.privacyPolicy);
    for (const link of [terms, privacy]) {
      expect(link).toHaveAttribute('target', '_blank');
      expect(link.getAttribute('rel')).toContain('noopener');
    }
  });

  it('clicking a document link does not tick its box', () => {
    renderForm();

    fireEvent.click(screen.getByRole('link', { name: EN.consent.termsOfService.linkText! }));

    expect(box('termsOfService')).toHaveAttribute('aria-checked', 'false');
  });
});

describe('RegistrationForm — submission is blocked without each mandatory box', () => {
  it.each(REQUIRED_CONSENT_KINDS)('with %s unticked and everything else valid (marketing ticked), nothing is sent and that box is named', async (missing) => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS.filter((kind) => kind !== missing), 'marketingEmail');

    submit();

    expect(await screen.findByText(EN.consent[missing].requiredError!)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    // Only the missing one is complained about.
    for (const kind of REQUIRED_CONSENT_KINDS.filter((other) => other !== missing)) {
      expect(screen.queryByText(EN.consent[kind].requiredError!), kind).toBeNull();
    }
    expect(box(missing)).toHaveAttribute('aria-invalid', 'true');
  });

  it('with all three unticked, names all three and sends nothing', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();

    submit();

    for (const kind of REQUIRED_CONSENT_KINDS) expect(await screen.findByText(EN.consent[kind].requiredError!)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never complains about the marketing box', async () => {
    stubFetch(created);
    renderForm();
    fillCredentials();

    submit();

    await screen.findByText(EN.consent.termsOfService.requiredError!);
    expect(box('marketingEmail')).not.toHaveAttribute('aria-invalid', 'true');
  });

  it('the error clears the moment the box is ticked, and the form can then be sent', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();
    tick('privacyPolicy', 'ageDeclaration16Plus');
    submit();
    await screen.findByText(EN.consent.termsOfService.requiredError!);

    tick('termsOfService');
    await waitFor(() => expect(screen.queryByText(EN.consent.termsOfService.requiredError!)).toBeNull());
    submit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('nothing is judged before the first submit — a form nobody has touched does not shout', () => {
    renderForm();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(box('termsOfService')).not.toHaveAttribute('aria-invalid', 'true');
  });
});

describe('RegistrationForm — what is sent', () => {
  it('posts the three required boxes as granted, marketing as an explicit false, each under the version in force', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);

    submit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/auth/register');
    expect(fetchSpy.mock.calls[0][1]?.method).toBe('POST');
    expect(sentBody(fetchSpy)).toEqual({
      email: GOOD_EMAIL,
      password: GOOD_PASSWORD,
      consent: {
        termsOfService: { version: CURRENT_CONSENT_VERSIONS.termsOfService, granted: true },
        privacyPolicy: { version: CURRENT_CONSENT_VERSIONS.privacyPolicy, granted: true },
        ageDeclaration16Plus: { version: CURRENT_CONSENT_VERSIONS.ageDeclaration16Plus, granted: true },
        marketingEmail: { version: CURRENT_CONSENT_VERSIONS.marketingEmail, granted: false },
      },
    });
  });

  it('posts marketing as granted only when that box was ticked', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS, 'marketingEmail');

    submit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchSpy).consent.marketingEmail.granted).toBe(true);
  });

  it('a person who leaves marketing unticked can still register — it is optional', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);

    submit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it('sends the password exactly as typed, spaces included', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials(EN, GOOD_EMAIL, '  padded password  ');
    tick(...REQUIRED_CONSENT_KINDS);

    submit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchSpy).password).toBe('  padded password  ');
  });
});

describe('RegistrationForm — the password policy runs in the browser and is the server\'s', () => {
  async function submitWithPassword(password: string) {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials(EN, GOOD_EMAIL, password);
    tick(...REQUIRED_CONSENT_KINDS);
    submit();
    return fetchSpy;
  }

  it('a password one character under the minimum is refused in the browser, with the bound taken from the contract', async () => {
    const fetchSpy = await submitWithPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1));

    expect(await screen.findByText(`Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByLabelText(EN.passwordLabel)).toHaveAttribute('aria-invalid', 'true');
  });

  it('a password one character over the maximum is refused in the browser', async () => {
    const fetchSpy = await submitWithPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1));

    expect(await screen.findByText(`Your password can be at most ${PASSWORD_MAX_LENGTH} characters.`)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an empty password is refused', async () => {
    const fetchSpy = await submitWithPassword('');

    expect(await screen.findByText(EN.passwordRequiredError)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['exactly the minimum', 'a'.repeat(PASSWORD_MIN_LENGTH)],
    ['exactly the maximum', 'a'.repeat(PASSWORD_MAX_LENGTH)],
    ['ten emoji (twenty UTF-16 units — counted as code points, like the server)', '\u{1F600}'.repeat(PASSWORD_MIN_LENGTH)],
  ])('%s is accepted', async (_label, password) => {
    const fetchSpy = await submitWithPassword(password);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchSpy).password).toBe(password);
  });

  it('a too-short password is fixed by typing more, and the message goes away without another submit', async () => {
    await submitWithPassword('short');
    await screen.findByText(`Your password needs at least ${PASSWORD_MIN_LENGTH} characters.`);

    fireEvent.change(screen.getByLabelText(EN.passwordLabel), { target: { value: GOOD_PASSWORD } });

    await waitFor(() => expect(screen.queryByText(/Your password needs at least/)).toBeNull());
  });

  it('a malformed email is refused in the browser', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials(EN, 'not-an-email');
    tick(...REQUIRED_CONSENT_KINDS);

    submit();

    expect(await screen.findByText(EN.emailInvalidError)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('RegistrationForm — it makes no request before submit (registration is already an enumeration oracle)', () => {
  it('typing an address, leaving the field and waiting sends nothing', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    const email = screen.getByLabelText(EN.emailLabel);

    fireEvent.focus(email);
    fireEvent.change(email, { target: { value: GOOD_EMAIL } });
    fireEvent.blur(email);
    fireEvent.change(screen.getByLabelText(EN.passwordLabel), { target: { value: GOOD_PASSWORD } });
    fireEvent.blur(screen.getByLabelText(EN.passwordLabel));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a form that fails its own checks sends nothing at all, however many times it is submitted', async () => {
    const fetchSpy = stubFetch(created);
    renderForm();
    fillCredentials();

    submit();
    submit();
    await screen.findByText(EN.consent.termsOfService.requiredError!);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offers no availability check, "is this email taken" control or extra button', () => {
    renderForm();

    expect(screen.getAllByRole('button').filter((button) => button.getAttribute('role') !== 'checkbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: EN.submitCta })).toHaveAttribute('type', 'submit');
  });
});

describe('RegistrationForm — errors the server produces', () => {
  async function submitAndGetRefusal(status: number, reason: string) {
    const fetchSpy = stubFetch(() => refusal(status, reason));
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();
    const alert = await screen.findByRole('alert');
    return { alert, fetchSpy };
  }

  it('409 emailAlreadyRegistered is a plain message', async () => {
    const { alert } = await submitAndGetRefusal(409, 'emailAlreadyRegistered');

    expect(alert).toHaveTextContent(EN.emailAlreadyRegisteredError);
  });

  it('the 409 message offers no way to sign in — no link in it, none anywhere new, and no "sign in" wording (KAN-52: it would orphan the guest\'s essay)', async () => {
    const { alert } = await submitAndGetRefusal(409, 'emailAlreadyRegistered');

    expect(within(alert).queryAllByRole('link')).toHaveLength(0);
    expect(within(alert).queryAllByRole('button')).toHaveLength(0);
    // The only links on the whole form are the two consent documents.
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs.sort()).toEqual([CONSENT_DOCUMENT_HREFS.privacyPolicy, CONSENT_DOCUMENT_HREFS.termsOfService].sort());
    expect(hrefs.join(' ')).not.toMatch(/sign-?in|log-?in/i);
    for (const strings of [EN, DE]) expect(strings.emailAlreadyRegisteredError).not.toMatch(/sign in|log in|anmeld|einlogg/i);
  });

  it('the 409 is not attached to the email field — that field is styled and announced exactly as after any other refusal', async () => {
    await submitAndGetRefusal(409, 'emailAlreadyRegistered');

    const email = screen.getByLabelText(EN.emailLabel);
    expect(email).toHaveAttribute('aria-invalid', 'false');
    expect(email.getAttribute('aria-describedby') ?? '').not.toContain('message');
  });

  it('keeps what the person typed after a 409, so a typo can be fixed without retyping everything', async () => {
    await submitAndGetRefusal(409, 'emailAlreadyRegistered');

    expect(screen.getByLabelText(EN.emailLabel)).toHaveValue(GOOD_EMAIL);
    expect(box('termsOfService')).toHaveAttribute('aria-checked', 'true');
  });

  it('a rate-limit refusal says to wait, not to retry', async () => {
    const { alert } = await submitAndGetRefusal(429, 'rateLimited');

    expect(alert).toHaveTextContent(EN.rateLimitedError);
    expect(EN.rateLimitedError).not.toBe(EN.errorGeneric);
  });

  // The two copies share a prefix, so each assertion is on the WHOLE text
  // (`toBe`, not the substring match `toHaveTextContent` does): otherwise the
  // longer stale-consent string would satisfy an assertion for the shorter one.
  it('staleConsentVersion says to reload and that the terms may have changed — its own text, not the generic or the invalidSubmission one', async () => {
    const { alert } = await submitAndGetRefusal(400, 'staleConsentVersion');

    expect(alert.textContent).toBe(EN.staleConsentVersionError);
    expect(alert.textContent).toMatch(/reload/i);
    expect(alert.textContent).toMatch(/terms/i);
    expect(alert.textContent).not.toBe(EN.errorGeneric);
    expect(alert.textContent).not.toBe(EN.invalidSubmissionError);
  });

  it('invalidSubmission says to reload but does not claim the terms changed — it is what a stale bundle that disagrees about more than a consent version gets', async () => {
    const { alert } = await submitAndGetRefusal(400, 'invalidSubmission');

    expect(alert.textContent).toBe(EN.invalidSubmissionError);
    expect(alert.textContent).toMatch(/reload/i);
    expect(alert.textContent).not.toMatch(/terms/i);
    expect(alert.textContent).not.toBe(EN.errorGeneric);
  });

  it.each([['en', EN], ['de', DE]] as const)('%s: staleConsentVersion shows the stale-consent string of that locale, not the invalidSubmission one', async (locale, strings) => {
    stubFetch(() => refusal(400, 'staleConsentVersion'));
    renderForm({ strings, locale });
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();

    expect((await screen.findByRole('alert')).textContent).toBe(strings.staleConsentVersionError);
  });

  it.each([
    [500, 'internalError'],
    [400, 'crossOrigin'],
    [400, 'invalidJson'],
    [413, 'bodyTooLarge'],
  ])('%i %s gets the generic message', async (status, reason) => {
    const { alert } = await submitAndGetRefusal(status, reason);

    expect(alert).toHaveTextContent(EN.errorGeneric);
  });

  it('a response that is not JSON at all gets the generic message', async () => {
    stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(EN.errorGeneric);
  });

  it('a dropped connection gets the generic message', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);

    submit();

    expect(await screen.findByRole('alert')).toHaveTextContent(EN.errorGeneric);
  });

  it('never shows the server\'s own English message text — only the structured reason is read', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: 'SERVER-INTERNAL-TEXT', reason: 'internalError' }), { status: 500 }));
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(EN.errorGeneric);
    expect(alert).not.toHaveTextContent('SERVER-INTERNAL-TEXT');
  });

  it('after a refusal the form can be submitted again, and the message clears while it is in flight', async () => {
    let attempt = 0;
    let release: (() => void) | undefined;
    const fetchSpy = stubFetch(() => {
      attempt += 1;
      if (attempt === 1) return refusal(429, 'rateLimited');
      return new Promise<Response>((resolve) => {
        release = () => resolve(created());
      });
    });
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();
    await screen.findByRole('alert');

    submit();

    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    release?.();
  });

  it('cannot be submitted twice while the first request is in flight', async () => {
    const fetchSpy = stubFetch(() => new Promise<Response>(() => {}));
    renderForm();
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);

    submit();
    const busy = await screen.findByRole('button', { name: EN.submittingCta });
    fireEvent.click(busy);

    expect(busy).toBeDisabled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('RegistrationForm — on success the guest lands back on their report', () => {
  async function register(options: Parameters<typeof renderForm>[0] = {}) {
    stubFetch(created);
    renderForm(options);
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
  }

  it('goes to the guest\'s own report, carried in from the call to action', async () => {
    await register({ essayId: ESSAY_ID });

    expect(replace).toHaveBeenCalledWith(`/practice/preview?essay=${ESSAY_ID}`);
  });

  it('stays under /de for a German guest', async () => {
    // The locale prefix comes from the locale-aware router; a plain router would drop it.
    stubFetch(created);
    renderForm({ strings: DE, locale: 'de', essayId: ESSAY_ID });
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(`/de/practice/preview?essay=${ESSAY_ID}`);
  });

  it('with no essay to return to, lands on the practice landing page', async () => {
    await register();

    expect(replace).toHaveBeenCalledWith('/practice');
  });

  it('evicts the cached guest-view report before going back, so the locked report is not shown again while the unlocked one loads — and leaves unrelated cache alone', async () => {
    const client = new QueryClient();
    client.setQueryData([...GRADING_STATUS_QUERY_KEY, ESSAY_ID], { status: 'succeeded', report: { access: 'locked' } });
    client.setQueryData(['blog-posts'], ['keep me']);

    await register({ essayId: ESSAY_ID, client });

    expect(client.getQueryData([...GRADING_STATUS_QUERY_KEY, ESSAY_ID])).toBeUndefined();
    expect(client.getQueryData(['blog-posts'])).toEqual(['keep me']);
  });

  it('does not navigate on a refusal', async () => {
    stubFetch(() => refusal(409, 'emailAlreadyRegistered'));
    renderForm({ essayId: ESSAY_ID });
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();
    await screen.findByRole('alert');

    expect(replace).not.toHaveBeenCalled();
  });

  it('says so while the navigation takes, in a status region, and takes the form away', async () => {
    stubFetch(created);
    renderForm({ essayId: ESSAY_ID });
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();

    expect(await screen.findByRole('status')).toHaveTextContent(EN.successTitle);
    expect(screen.queryByRole('button', { name: EN.submitCta })).toBeNull();
  });
});

describe('RegistrationForm — catalogue (both locales)', () => {
  const REQUIRED_STRING_KEYS = [
    'emailLabel', 'emailRequiredError', 'emailInvalidError', 'passwordLabel', 'passwordHint', 'passwordRequiredError',
    'passwordTooShortError', 'passwordTooLongError', 'requiredConsentLegend', 'optionalConsentLegend', 'submitCta',
    'submittingCta', 'successTitle', 'successBody', 'errorGeneric', 'invalidSubmissionError', 'staleConsentVersionError',
    'rateLimitedError', 'emailAlreadyRegisteredError',
  ] as const;

  it.each([['en', EN], ['de', DE]] as const)('%s has every string the form takes, and the placeholders the form fills', (_locale, strings) => {
    for (const key of REQUIRED_STRING_KEYS) expect(strings[key], key).toBeTruthy();
    expect(strings.passwordHint).toContain('{min}');
    expect(strings.passwordHint).toContain('{max}');
    expect(strings.passwordTooShortError).toContain('{min}');
    expect(strings.passwordTooLongError).toContain('{max}');
  });

  it.each([['en', EN], ['de', DE]] as const)('%s: each linked consent label has its {link} slot; each required one has its own error; marketing has none', (_locale, strings) => {
    for (const kind of Object.keys(CONSENT_DOCUMENT_HREFS) as ConsentKind[]) {
      expect(strings.consent[kind].label, kind).toContain('{link}');
      expect(strings.consent[kind].linkText, kind).toBeTruthy();
    }
    for (const kind of REQUIRED_CONSENT_KINDS) expect(strings.consent[kind].requiredError, kind).toBeTruthy();
    expect(strings.consent.marketingEmail.requiredError).toBeUndefined();
    expect(strings.consent.marketingEmail.label).toBeTruthy();
  });

  it('the messages that must differ from each other do: generic, rate-limit, invalid-submission, stale-consent and already-registered are distinct texts in each language', () => {
    for (const strings of [EN, DE]) {
      const texts = [
        strings.errorGeneric,
        strings.rateLimitedError,
        strings.invalidSubmissionError,
        strings.staleConsentVersionError,
        strings.emailAlreadyRegisteredError,
      ];
      expect(new Set(texts).size).toBe(texts.length);
    }
  });

  it('German stale-consent and invalid-submission strings are German, not the English ones', () => {
    expect(DE.staleConsentVersionError).not.toBe(EN.staleConsentVersionError);
    expect(DE.invalidSubmissionError).not.toBe(EN.invalidSubmissionError);
    expect(DE.staleConsentVersionError).toMatch(/Bedingungen/);
    expect(EN.staleConsentVersionError).not.toMatch(/Bedingungen/);
  });

  it('German: the privacy consent tells the guest the policy is available in English only — and English does not carry that note', () => {
    expect(DE.consent.privacyPolicy.label).toMatch(/Englisch/);
    expect(EN.consent.privacyPolicy.label).not.toMatch(/English/);
  });

  it('German: renders the form in German, the English-only note included, and a submit sends the same request as English', async () => {
    const fetchSpy = stubFetch(created);
    renderForm({ strings: DE, locale: 'de' });

    expect(screen.getByLabelText(DE.emailLabel)).toBeInTheDocument();
    expect(screen.getByText(/Die Datenschutzerklärung ist nur auf Englisch verfügbar/)).toBeInTheDocument();
    expect(box('marketingEmail')).toHaveAttribute('aria-checked', 'false');
    fillCredentials();
    tick(...REQUIRED_CONSENT_KINDS);
    submit();

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // The language of the page changes nothing about what is recorded.
    expect(sentBody(fetchSpy).consent.privacyPolicy).toEqual({ version: CURRENT_CONSENT_VERSIONS.privacyPolicy, granted: true });
  });

  it('German: a refusal to tick a box is explained in German', async () => {
    stubFetch(created);
    renderForm({ strings: DE, locale: 'de' });
    fillCredentials();

    submit();

    expect(await screen.findByText(DE.consent.ageDeclaration16Plus.requiredError!)).toBeInTheDocument();
  });
});
