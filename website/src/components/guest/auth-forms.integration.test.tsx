import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { IntlProvider } from '@/components/IntlProvider';
import enMessages from '@/messages/en.json';
import { RegistrationForm, type RegistrationFormStrings } from './RegistrationForm';
import { SignInForm, type SignInFormStrings } from './SignInForm';
import { buildRegisterRequest, emptyRegistrationValues, validateRegistration, type RegistrationFormValues } from './auth-form-model';
import { POST as registerRoute } from '@/app/api/auth/register/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { db } from '@/lib/db/client';
import { consentRecords, users } from '@/lib/db/schema';
import { CONSENT_KINDS, CURRENT_CONSENT_VERSIONS, REQUIRED_CONSENT_KINDS, type ConsentKind } from '@/lib/contracts/consent';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/contracts/auth';
import { LOGIN_EMAIL_LIMIT, REGISTRATION_IP_LIMIT } from '@/lib/domain/rate-limit';
import { REGISTERED_SESSION_COOKIE_NAME } from '@/lib/registered-session-cookie';
import { GUEST_SESSION_COOKIE_NAME } from '@/lib/guest-session-cookie';
import { createEssay } from '@/lib/db/essays';
import { createGuestSession } from '@/lib/db/guest-sessions';
import { getOwnedEssay } from '@/lib/domain/essay-read';
import { generateGuestSessionId } from '@/lib/domain/session-id';
import { resetDatabase, closePool } from '@/test/db-fixtures';
import { TEST_PASSWORD, registerTestAccount, registrationBody, uniqueEmail } from '@/test/auth-fixtures';
import { jsonPost, setCookieLine, xff } from '@/test/auth-requests';

/**
 * KAN-55 — the forms driven against the REAL `POST /api/auth/register` and
 * `/login` handlers and a real Postgres, with only the network hop replaced
 * (the form's `fetch` calls the handler directly). This is where the claims the
 * unit tests can only assume are shown to hold: that what the browser refuses
 * the server refuses too, that a stale consent version is refused as
 * `staleConsentVersion` (and a stale bundle that disagrees about anything else
 * as `invalidSubmission`), each with its own copy, that the consent records the server writes are the ones
 * the form displayed, and that sign-in cannot tell an unknown email from a wrong
 * password.
 */
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/',
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

const REGISTER = enMessages.chrome.guest.register as unknown as RegistrationFormStrings;
const SIGN_IN = enMessages.chrome.guest.signIn as unknown as SignInFormStrings;

let ipCounter = 0;
/** A fresh client IP per test, so one test's rate-limit counters cannot bleed into another's (the table is truncated too). */
let clientIp = '203.0.113.1';

/** Routes the form's `fetch` to the real handlers. `mutateBody` lets a test stand in for a form that rendered earlier than the server's current state. */
function wireFetchToRoutes(mutateBody?: (body: any) => any, options: { cookies?: Record<string, string> } = {}) {
  const calls: Array<{ path: string; status: number }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      const parsed = JSON.parse(String(init?.body));
      const request: NextRequest = jsonPost(path, mutateBody ? mutateBody(parsed) : parsed, { headers: xff(clientIp), cookies: options.cookies });
      const handler = path === '/api/auth/register' ? registerRoute : loginRoute;
      const response = await handler(request);
      calls.push({ path, status: response.status });
      return response;
    }),
  );
  return calls;
}

function renderRegistration(essayId?: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={enMessages}>
        <RegistrationForm strings={REGISTER} essayId={essayId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

function renderSignIn(essayId?: string) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlProvider locale="en" messages={enMessages}>
        <SignInForm strings={SIGN_IN} essayId={essayId} />
      </IntlProvider>
    </QueryClientProvider>,
  );
}

const box = (kind: ConsentKind) => screen.getByRole('checkbox', { name: new RegExp(`^${REGISTER.consent[kind].label.split('{link}')[0]}`) });

function fillRegistration(email: string, password: string, tickKinds: readonly ConsentKind[] = REQUIRED_CONSENT_KINDS) {
  fireEvent.change(screen.getByLabelText(REGISTER.emailLabel), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(REGISTER.passwordLabel), { target: { value: password } });
  for (const kind of tickKinds) fireEvent.click(box(kind));
}

const submitRegistration = () => fireEvent.click(screen.getByRole('button', { name: REGISTER.submitCta }));

function fillSignIn(email: string, password: string) {
  fireEvent.change(screen.getByLabelText(SIGN_IN.emailLabel), { target: { value: email } });
  fireEvent.change(screen.getByLabelText(SIGN_IN.passwordLabel), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: SIGN_IN.submitCta }));
}

function valuesWith(overrides: Partial<RegistrationFormValues> & { ticked?: readonly ConsentKind[] } = {}): RegistrationFormValues {
  const empty = emptyRegistrationValues();
  const consent = { ...empty.consent };
  for (const kind of overrides.ticked ?? REQUIRED_CONSENT_KINDS) consent[kind] = true;
  return { email: overrides.email ?? uniqueEmail(), password: overrides.password ?? TEST_PASSWORD, consent };
}

async function postRegisterDirect(body: unknown) {
  const response = await registerRoute(jsonPost('/api/auth/register', body, { headers: xff(clientIp) }));
  return { status: response.status, body: (await response.json()) as { ok?: true; reason?: string } };
}

beforeAll(async () => {
  await resetDatabase();
});
beforeEach(() => {
  replace.mockClear();
  clientIp = `203.0.113.${(ipCounter++ % 200) + 1}`;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  await resetDatabase();
});
afterAll(async () => {
  await closePool();
});

describe('registration form -> POST /api/auth/register', () => {
  it('creates the account, signs the guest in, and sends them back to their report', async () => {
    const calls = wireFetchToRoutes();
    const essayId = 'a6afa382-8223-4b5d-b4ea-d5a7f0694211';
    renderRegistration(essayId);
    const email = uniqueEmail();

    fillRegistration(email, TEST_PASSWORD);
    submitRegistration();

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/practice/preview?essay=${essayId}`));
    expect(calls).toEqual([{ path: '/api/auth/register', status: 201 }]);
    expect(await db.select().from(users).where(eq(users.email, email))).toHaveLength(1);
  });

  it('records one consent row per kind under the versions the form displayed — marketing declined, not omitted', async () => {
    wireFetchToRoutes();
    renderRegistration();
    const email = uniqueEmail();
    const displayed = Object.fromEntries(CONSENT_KINDS.map((kind) => [kind, box(kind).getAttribute('data-consent-version')]));

    fillRegistration(email, TEST_PASSWORD);
    submitRegistration();
    await waitFor(() => expect(replace).toHaveBeenCalled());

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, user.id)).orderBy(asc(consentRecords.kind));
    expect(rows.map((row) => row.kind).sort()).toEqual([...CONSENT_KINDS].sort());
    for (const row of rows) {
      expect(row.documentVersion, row.kind).toBe(displayed[row.kind]);
      expect(row.documentVersion, row.kind).toBe(CURRENT_CONSENT_VERSIONS[row.kind as ConsentKind]);
      expect(row.granted, row.kind).toBe(row.kind !== 'marketingEmail');
    }
  });

  it('records marketing as granted only when that box was ticked', async () => {
    wireFetchToRoutes();
    renderRegistration();
    const email = uniqueEmail();

    fillRegistration(email, TEST_PASSWORD, [...REQUIRED_CONSENT_KINDS, 'marketingEmail']);
    submitRegistration();
    await waitFor(() => expect(replace).toHaveBeenCalled());

    const [user] = await db.select().from(users).where(eq(users.email, email));
    const rows = await db.select().from(consentRecords).where(eq(consentRecords.userId, user.id));
    expect(rows.find((row) => row.kind === 'marketingEmail')?.granted).toBe(true);
  });

  it('the response signs the guest in: a registered-session cookie is set', async () => {
    // Asserted on the route directly with the exact body the form builds.
    const response = await registerRoute(jsonPost('/api/auth/register', buildRegisterRequest(valuesWith()), { headers: xff(clientIp) }));

    expect(response.status).toBe(201);
    expect(setCookieLine(response, REGISTERED_SESSION_COOKIE_NAME)).toBeDefined();
  });

  it('409: a second registration with the same address (however cased) shows the plain already-registered message, and nothing is created', async () => {
    const existing = await registerTestAccount({ email: 'Taken.Address@Example.test' });
    wireFetchToRoutes();
    renderRegistration('a6afa382-8223-4b5d-b4ea-d5a7f0694211');

    fillRegistration(existing.email.toUpperCase(), TEST_PASSWORD);
    submitRegistration();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(REGISTER.emailAlreadyRegisteredError);
    expect(alert.querySelector('a, button')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('a stale consent form is refused by the server as staleConsentVersion, and the form says the terms may have changed', async () => {
    // A form rendered before a policy change carries the old version; the
    // server accepts only the version in force.
    const calls = wireFetchToRoutes((body) => ({
      ...body,
      consent: { ...body.consent, privacyPolicy: { ...body.consent.privacyPolicy, version: '2020-01-01' } },
    }));
    renderRegistration();

    fillRegistration(uniqueEmail(), TEST_PASSWORD);
    submitRegistration();

    const alert = await screen.findByRole('alert');
    // Whole-text comparisons: the two reload messages share a prefix, so a
    // substring match on the shorter would also pass for the longer.
    expect(alert.textContent).toBe(REGISTER.staleConsentVersionError);
    expect(alert.textContent).not.toBe(REGISTER.invalidSubmissionError);
    expect(alert.textContent).not.toBe(REGISTER.errorGeneric);
    expect(calls).toEqual([{ path: '/api/auth/register', status: 400 }]);
    expect(await db.select().from(users)).toEqual([]);
    expect(replace).not.toHaveBeenCalled();
  });

  it('a stale bundle that disagrees with the server about more than a consent version gets invalidSubmission, and the form says reload without blaming the terms', async () => {
    // The one way this form can be refused invalidSubmission: it validated
    // against ITS bundle's schema, and the server has since changed. Stood in
    // for by a password the server's policy refuses (a bundle from before the
    // minimum was raised), sent alongside a stale consent version — reloading
    // fixes both, but "the terms changed" would only be half the story.
    const calls = wireFetchToRoutes((body) => ({
      ...body,
      password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
      consent: { ...body.consent, privacyPolicy: { ...body.consent.privacyPolicy, version: '2020-01-01' } },
    }));
    renderRegistration();

    fillRegistration(uniqueEmail(), TEST_PASSWORD);
    submitRegistration();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(REGISTER.invalidSubmissionError);
    expect(alert.textContent).not.toBe(REGISTER.staleConsentVersionError);
    expect(calls).toEqual([{ path: '/api/auth/register', status: 400 }]);
    expect(await db.select().from(users)).toEqual([]);
  });

  it('a rate-limit refusal from the real cap shows the rate-limit message', async () => {
    // Exhaust this IP's registration cap with real (refused-for-bad-body but counted) requests.
    for (let i = 0; i < REGISTRATION_IP_LIMIT; i++) await postRegisterDirect({ nonsense: true });
    wireFetchToRoutes();
    renderRegistration();

    fillRegistration(uniqueEmail(), TEST_PASSWORD);
    submitRegistration();

    expect(await screen.findByRole('alert')).toHaveTextContent(REGISTER.rateLimitedError);
    expect(await db.select().from(users)).toEqual([]);
  });
});

describe('what the form refuses, the server refuses too — mandatory consent', () => {
  it.each(REQUIRED_CONSENT_KINDS)('%s unticked: the form sends nothing, and the same body posted straight to the route is refused invalidSubmission', async (missing) => {
    const calls = wireFetchToRoutes();
    renderRegistration();
    const ticked = REQUIRED_CONSENT_KINDS.filter((kind) => kind !== missing);
    const email = uniqueEmail();

    fillRegistration(email, TEST_PASSWORD, ticked);
    submitRegistration();
    await screen.findByText(REGISTER.consent[missing].requiredError!);
    expect(calls).toEqual([]);

    const direct = await postRegisterDirect(buildRegisterRequest(valuesWith({ email, ticked })));
    expect(direct.status).toBe(400);
    expect(direct.body.reason).toBe('invalidSubmission');
    expect(await db.select().from(users)).toEqual([]);
  });
});

describe('what the form refuses, the server refuses too — the password policy', () => {
  const cases: ReadonlyArray<[string, string]> = [
    ['empty', ''],
    ['one under the minimum', 'a'.repeat(PASSWORD_MIN_LENGTH - 1)],
    ['exactly the minimum', 'a'.repeat(PASSWORD_MIN_LENGTH)],
    ['exactly the maximum', 'a'.repeat(PASSWORD_MAX_LENGTH)],
    ['one over the maximum', 'a'.repeat(PASSWORD_MAX_LENGTH + 1)],
    ['nine astral characters', '\u{1F600}'.repeat(PASSWORD_MIN_LENGTH - 1)],
    ['ten astral characters', '\u{1F600}'.repeat(PASSWORD_MIN_LENGTH)],
    ['nine characters that NFKC-expand to eleven', 'a'.repeat(PASSWORD_MIN_LENGTH - 2) + 'ﬃ'],
  ];

  it.each(cases)('%s: the browser and the route give the same verdict', async (_label, password) => {
    const values = valuesWith({ password });
    const browserAccepts = validateRegistration(values).ok;

    const server = await postRegisterDirect(buildRegisterRequest(values));

    expect(server.status).toBe(browserAccepts ? 201 : 400);
    if (!browserAccepts) expect(server.body.reason).toBe('invalidSubmission');
  });

  it.each(cases.filter(([, password]) => !validateRegistration(valuesWith({ password })).ok))(
    '%s: driven through the form, nothing is sent',
    async (_label, password) => {
      const calls = wireFetchToRoutes();
      renderRegistration();

      fillRegistration(uniqueEmail(), password);
      submitRegistration();

      await waitFor(() => expect(screen.getByLabelText(REGISTER.passwordLabel)).toHaveAttribute('aria-invalid', 'true'));
      expect(calls).toEqual([]);
    },
  );
});

describe('sign-in form -> POST /api/auth/login', () => {
  it('signs a registered user in and goes to the practice landing page', async () => {
    const account = await registerTestAccount();
    const calls = wireFetchToRoutes();
    renderSignIn();

    fillSignIn(account.email, account.password);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/practice'));
    expect(calls).toEqual([{ path: '/api/auth/login', status: 200 }]);
  });

  it('an unknown email and a wrong password produce the same status, the same reason and byte-identical markup', async () => {
    const account = await registerTestAccount();
    const calls = wireFetchToRoutes();

    const unknown = renderSignIn();
    fillSignIn(`nobody-${randomUUID()}@example.test`, 'a password nobody has');
    const unknownAlert = await screen.findByRole('alert');
    const unknownMarkup = normalise(unknown.container);
    unknown.unmount();
    cleanup();

    const wrong = renderSignIn();
    fillSignIn(account.email, 'definitely not the password');
    const wrongAlert = await screen.findByRole('alert');
    const wrongMarkup = normalise(wrong.container);

    expect(calls).toEqual([
      { path: '/api/auth/login', status: 401 },
      { path: '/api/auth/login', status: 401 },
    ]);
    expect(wrongAlert).toHaveTextContent(SIGN_IN.invalidCredentialsError);
    expect(wrongAlert.outerHTML).toBe(unknownAlert.outerHTML);
    expect(wrongMarkup).toBe(unknownMarkup);
    expect(replace).not.toHaveBeenCalled();
  });

  it('a rate-limit refusal from the real per-email cap shows the rate-limit message — and not the credentials one', async () => {
    const account = await registerTestAccount();
    for (let i = 0; i < LOGIN_EMAIL_LIMIT; i++) {
      await loginRoute(jsonPost('/api/auth/login', { email: account.email, password: 'wrong' }, { headers: xff(clientIp) }));
    }
    wireFetchToRoutes();
    renderSignIn();

    fillSignIn(account.email, account.password);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(SIGN_IN.rateLimitedError);
    expect(alert).not.toHaveTextContent(SIGN_IN.invalidCredentialsError);
    expect(replace).not.toHaveBeenCalled();
  });
});

// KAN-52 made sign-in ADOPT the guest essay the browser holds, and KAN-55's pages
// and form were first written as if it did not. These are the tests that would
// have said so: the real form, the real login route, the real guest cookie, a
// real essay row, and the real ownership read the report page makes.
describe('sign-in form -> the guest essay the browser holds (KAN-52)', () => {
  async function guestWithEssay() {
    const guest = { kind: 'guest', sessionId: generateGuestSessionId() } as const;
    await createGuestSession(guest);
    const essay = await createEssay(guest, 'Gestern habe ich einen Satz geschrieben.');
    return { guest, essay };
  }

  it('signing in with the guest cookie present adopts the essay: the account can read it, the old session id cannot, and the form lands on its report', async () => {
    const { guest, essay } = await guestWithEssay();
    const account = await registerTestAccount();
    const calls = wireFetchToRoutes(undefined, { cookies: { [GUEST_SESSION_COOKIE_NAME]: guest.sessionId } });
    renderSignIn(essay.id);

    fillSignIn(account.email, account.password);

    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/practice/preview?essay=${essay.id}`));
    expect(calls).toEqual([{ path: '/api/auth/login', status: 200 }]);
    expect((await getOwnedEssay({ kind: 'user', userId: account.userId }, essay.id))?.id).toBe(essay.id);
    expect(await getOwnedEssay(guest, essay.id)).toBeNull();
  });

  it('control: the same sign-in with NO guest cookie adopts nothing — so the test above is about the cookie reaching login, not about sign-in in general', async () => {
    const { guest, essay } = await guestWithEssay();
    const account = await registerTestAccount();
    wireFetchToRoutes();
    renderSignIn(essay.id);

    fillSignIn(account.email, account.password);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(await getOwnedEssay({ kind: 'user', userId: account.userId }, essay.id)).toBeNull();
    expect((await getOwnedEssay(guest, essay.id))?.id).toBe(essay.id);
  });
});

/** Markup with React ids and typed values removed — the parts that legitimately differ between the two runs. */
function normalise(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('input').forEach((input) => input.removeAttribute('value'));
  return clone.innerHTML.replace(/:r[0-9a-z]+:/g, ':id:');
}
