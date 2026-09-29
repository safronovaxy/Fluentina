/**
 * KAN-55 — the conversion funnel, end to end: a guest looks at their locked
 * report, follows its call to action, registers, and lands back on the same
 * report, unlocked. Plus the two pages on their own (registration, sign-in),
 * in both locales.
 *
 * NOT RUN when this was written: no Playwright browser could be installed in
 * the authoring environment (cdn.playwright.dev is blocked), so CI's e2e job is
 * this file's first real execution. Everything the forms decide is covered by
 * the unit suite — src/components/guest/{RegistrationForm,SignInForm,
 * auth-form-model}.test.ts(x), which HAS been run — and its counterpart against
 * the real route handlers and a real Postgres,
 * src/components/guest/auth-forms.integration.test.tsx, also run. This spec
 * proves only the wiring: real browser, real hydration, the real middleware
 * matcher resolving `/register` and `/sign-in`, real POSTs, real cookies, and
 * the real report changing from locked to full once the session changes.
 *
 * Same constraints the other guest specs carry: WebKit refuses a `__Host-`
 * cookie over plain HTTP, so anything that needs a session cookie skips there
 * (CI runs over the TLS proxy, where it does not skip; playwright.config.ts
 * throws if that ever stops being true).
 *
 * Every registration uses a unique address, so no test depends on another's
 * account. A fresh browser context per test is a fresh guest session, which is
 * what keeps each within registration's per-session cap.
 *
 * What is deliberately NOT here: a "sign in instead" path from the 409 (there
 * is none to test — see RegistrationForm), and the German-only wording checks
 * beyond the English-only-policy note, which the unit suite pins against the
 * real catalogue.
 */
import { test, expect, type Page } from '@playwright/test';
import { fillTextboxAndWaitForWordCount, wordCountText } from './helpers/essay-fill';
import { waitForHydration } from './helpers/hydration';
import { isWebKitOverPlainHttp } from './helpers/webkit';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const isPlainHttp = BASE_URL.startsWith('http://');
const GUEST_COOKIE = '__Host-fluentina_guest_session';
const PASSWORD = 'an e2e password long enough';

function skipIfWebkitCannotStoreTheSessionCookie(browserName: string) {
  test.skip(
    isWebKitOverPlainHttp(browserName, isPlainHttp),
    'WebKit refuses to store a __Host--prefixed cookie over plain HTTP, so no essay submission or session can succeed here.',
  );
}

const ESSAY_WORD_COUNT = 60;

function essayOf(firstSentence: string): string {
  const filler = Array.from({ length: ESSAY_WORD_COUNT - firstSentence.split(/\s+/).length }, (_, i) => `Wort${i}`).join(' ');
  return `${firstSentence} ${filler}.`;
}

const uniqueEmail = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;

interface LocaleFixture {
  readonly locale: 'en' | 'de';
  /** '' for English (unprefixed), '/de' for German. */
  readonly prefix: string;
  readonly essayText: string;
  readonly submitEssayName: string;
  readonly registerCta: string;
  readonly emailLabel: string;
  readonly passwordLabel: string;
  readonly submitName: string;
  readonly boxes: { readonly terms: RegExp; readonly privacy: RegExp; readonly age: RegExp; readonly marketing: RegExp };
  readonly termsError: string;
  readonly alreadyRegistered: string;
  readonly signInSubmit: string;
  readonly invalidCredentials: string;
  readonly privacyEnglishNote: RegExp | null;
}

const FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    prefix: '',
    essayText: essayOf('Yesterday I wrote a sentence for the end-to-end registration test.'),
    submitEssayName: 'Submit essay',
    registerCta: 'Create an account to unlock your full report',
    emailLabel: 'Email address',
    passwordLabel: 'Password',
    submitName: 'Create account',
    boxes: { terms: /Terms of Service/, privacy: /Privacy Policy/, age: /16 years old or older/, marketing: /news and offers/ },
    termsError: 'Please accept the Terms of Service to create an account.',
    alreadyRegistered: 'An account with this email address already exists.',
    signInSubmit: 'Sign in',
    invalidCredentials: 'The email address or password is incorrect.',
    privacyEnglishNote: null,
  },
  {
    locale: 'de',
    prefix: '/de',
    essayText: essayOf('Gestern habe ich einen Satz für den End-to-End-Test der Registrierung geschrieben.'),
    submitEssayName: 'Aufsatz einreichen',
    registerCta: 'Konto erstellen und den vollständigen Bericht freischalten',
    emailLabel: 'E-Mail-Adresse',
    passwordLabel: 'Passwort',
    submitName: 'Konto erstellen',
    boxes: { terms: /Nutzungsbedingungen/, privacy: /Datenschutzerklärung/, age: /16 Jahre alt/, marketing: /Neuigkeiten und Angebote/ },
    termsError: 'Bitte akzeptiere die Nutzungsbedingungen, um ein Konto zu erstellen.',
    alreadyRegistered: 'Mit dieser E-Mail-Adresse besteht bereits ein Konto.',
    signInSubmit: 'Anmelden',
    invalidCredentials: 'Die E-Mail-Adresse oder das Passwort ist falsch.',
    privacyEnglishNote: /nur auf Englisch verfügbar/,
  },
];

async function submitEssayAndWaitForLockedReport(page: Page, fx: LocaleFixture): Promise<string> {
  await page.goto(`${fx.prefix}/practice/write`);
  await fillTextboxAndWaitForWordCount(page, fx.essayText, wordCountText(fx.locale, ESSAY_WORD_COUNT));
  await page.getByRole('button', { name: fx.submitEssayName }).click();
  await expect(page).toHaveURL(new RegExp(`${fx.prefix}/practice/preview\\?essay=[0-9a-f-]{36}$`));
  await expect(page.getByTestId('locked-report')).toBeVisible({ timeout: 30_000 });
  return new URL(page.url()).searchParams.get('essay')!;
}

/**
 * The form's own refusal message, scoped to the form: Next.js's App Router
 * always renders a hidden `role="alert"` route announcer, so a bare
 * `getByRole('alert')` matches two elements and Playwright's strict mode
 * throws (tests/word-count.spec.ts documents the same trap).
 */
function formAlert(page: Page) {
  return page.locator('form [role="alert"]');
}

async function openRegistration(page: Page, fx: LocaleFixture, query = '') {
  const response = await page.goto(`${fx.prefix}/register${query}`);
  expect(response?.ok(), `${fx.prefix}/register should respond 200`).toBe(true);
  await waitForHydration(page, 'form');
}

async function tickRequired(page: Page, fx: LocaleFixture) {
  for (const name of [fx.boxes.terms, fx.boxes.privacy, fx.boxes.age]) await page.getByRole('checkbox', { name }).click();
}

async function fillRegistration(page: Page, fx: LocaleFixture, email: string) {
  await page.getByLabel(fx.emailLabel, { exact: true }).fill(email);
  await page.getByLabel(fx.passwordLabel, { exact: true }).fill(PASSWORD);
}

for (const fx of FIXTURES) {
  test.describe(`KAN-55 — registration funnel (${fx.locale})`, () => {
    test.describe.configure({ timeout: 90_000 });

    test('a guest follows the locked report\'s call to action, registers, and lands back on the same report, unlocked', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const answers: Array<{ status?: string; report?: { access?: string } } | null> = [];
      page.on('response', async (response) => {
        if (/^\/api\/essays\/[^/]+\/grading$/.test(new URL(response.url()).pathname)) answers.push(await response.json().catch(() => null));
      });
      const essayId = await submitEssayAndWaitForLockedReport(page, fx);

      // The CTA lives in the locked panel and carries this essay's id.
      const cta = page.getByTestId('locked-report').getByRole('link', { name: fx.registerCta });
      await expect(cta).toBeVisible();
      await cta.click();
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/register\\?essay=${essayId}$`));
      await waitForHydration(page, 'form');

      await fillRegistration(page, fx, uniqueEmail());
      await tickRequired(page, fx);
      answers.length = 0;
      await page.getByRole('button', { name: fx.submitName }).click();

      // Back on the SAME report, and it is the full one now: the panel is gone
      // and the server's own answer to the poll says `full`, not `locked`.
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/practice/preview\\?essay=${essayId}$`), { timeout: 30_000 });
      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('locked-report')).toHaveCount(0);
      await expect(page.getByTestId('locked-register-cta')).toHaveCount(0);
      await expect.poll(() => answers.some((answer) => answer?.status === 'succeeded')).toBe(true);
      expect(answers.filter((answer) => answer?.status === 'succeeded').every((answer) => answer?.report?.access === 'full')).toBe(true);
    });

    test('reloading the unlocked report keeps it unlocked — the session, not the page, carries the account', async ({ page, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const essayId = await submitEssayAndWaitForLockedReport(page, fx);
      await page.goto(`${fx.prefix}/register?essay=${essayId}`);
      await waitForHydration(page, 'form');
      await fillRegistration(page, fx, uniqueEmail());
      await tickRequired(page, fx);
      await page.getByRole('button', { name: fx.submitName }).click();
      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });

      await page.reload();

      await expect(page.getByTestId('overall-score')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('locked-report')).toHaveCount(0);
    });
  });

  test.describe(`KAN-55 — registration page (${fx.locale})`, () => {
    test('every consent box is unticked on first render, and marketing is a separate, optional group', async ({ page }) => {
      await openRegistration(page, fx);

      for (const name of Object.values(fx.boxes)) {
        await expect(page.getByRole('checkbox', { name })).not.toBeChecked();
      }
      await expect(page.getByRole('checkbox')).toHaveCount(4);
      await expect(page.getByTestId('consent-required').getByRole('checkbox')).toHaveCount(3);
      const optional = page.getByTestId('consent-optional');
      await expect(optional.getByRole('checkbox')).toHaveCount(1);
      await expect(optional.getByRole('checkbox', { name: fx.boxes.marketing })).toBeVisible();
    });

    test('ticking marketing ticks nothing else, and ticking the three required ones does not tick marketing', async ({ page }) => {
      await openRegistration(page, fx);

      await page.getByRole('checkbox', { name: fx.boxes.marketing }).click();
      for (const name of [fx.boxes.terms, fx.boxes.privacy, fx.boxes.age]) await expect(page.getByRole('checkbox', { name })).not.toBeChecked();

      await page.getByRole('checkbox', { name: fx.boxes.marketing }).click();
      await tickRequired(page, fx);
      await expect(page.getByRole('checkbox', { name: fx.boxes.marketing })).not.toBeChecked();
    });

    test('submitting with the boxes unticked names the required ones and sends nothing', async ({ page }) => {
      const registerRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/auth/register') registerRequests.push(request.url());
      });
      await openRegistration(page, fx);
      await fillRegistration(page, fx, uniqueEmail());

      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(page.getByText(fx.termsError)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/register$`));
      expect(registerRequests).toEqual([]);
    });

    test('a password below the policy is refused in the browser, and nothing is sent', async ({ page }) => {
      const registerRequests: string[] = [];
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/auth/register') registerRequests.push(request.url());
      });
      await openRegistration(page, fx);
      await page.getByLabel(fx.emailLabel, { exact: true }).fill(uniqueEmail());
      await page.getByLabel(fx.passwordLabel, { exact: true }).fill('short');
      await tickRequired(page, fx);

      await page.getByRole('button', { name: fx.submitName }).click();

      await expect(page.getByLabel(fx.passwordLabel, { exact: true })).toHaveAttribute('aria-invalid', 'true');
      expect(registerRequests).toEqual([]);
    });

    test('asks for email and password only', async ({ page }) => {
      await openRegistration(page, fx);

      await expect(page.locator('form input:not([aria-hidden="true"]):not([type="checkbox"])')).toHaveCount(2);
    });

    test('the two consent documents open in a new tab, and (German) the privacy consent says the policy is English-only', async ({ page }) => {
      await openRegistration(page, fx);

      await expect(page.getByRole('link', { name: fx.boxes.terms })).toHaveAttribute('href', '/terms');
      await expect(page.getByRole('link', { name: fx.boxes.privacy })).toHaveAttribute('href', '/privacy');
      await expect(page.getByRole('link', { name: fx.boxes.terms })).toHaveAttribute('target', '_blank');
      if (fx.privacyEnglishNote) await expect(page.getByText(fx.privacyEnglishNote)).toBeVisible();
    });

    test('an address that already has an account gets a plain message with no way to sign in from it', async ({ page, context, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const email = uniqueEmail();
      await openRegistration(page, fx);
      await fillRegistration(page, fx, email);
      await tickRequired(page, fx);
      await page.getByRole('button', { name: fx.submitName }).click();
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/practice$`), { timeout: 30_000 });

      await context.clearCookies();
      await openRegistration(page, fx);
      await fillRegistration(page, fx, email);
      await tickRequired(page, fx);
      await page.getByRole('button', { name: fx.submitName }).click();

      const alert = formAlert(page);
      await expect(alert).toContainText(fx.alreadyRegistered);
      await expect(alert.locator('a, button')).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/register$`));
    });
  });

  test.describe(`KAN-55 — sign-in page (${fx.locale})`, () => {
    test('resolves, and an unknown email and a wrong password show exactly the same thing', async ({ page, context, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const email = uniqueEmail();
      await openRegistration(page, fx);
      await fillRegistration(page, fx, email);
      await tickRequired(page, fx);
      await page.getByRole('button', { name: fx.submitName }).click();
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/practice$`), { timeout: 30_000 });
      await context.clearCookies();

      async function attempt(address: string, password: string) {
        const response = await page.goto(`${fx.prefix}/sign-in`);
        expect(response?.ok(), `${fx.prefix}/sign-in should respond 200`).toBe(true);
        await waitForHydration(page, 'form');
        await page.getByLabel(fx.emailLabel, { exact: true }).fill(address);
        await page.getByLabel(fx.passwordLabel, { exact: true }).fill(password);
        await page.getByRole('button', { name: fx.signInSubmit }).click();
        const alert = formAlert(page);
        await expect(alert).toBeVisible();
        return { text: await alert.innerText(), html: await alert.evaluate((el) => el.outerHTML) };
      }

      const unknown = await attempt(uniqueEmail(), PASSWORD);
      const wrong = await attempt(email, 'not the password at all');

      expect(unknown.text).toBe(fx.invalidCredentials);
      expect(wrong.text).toBe(unknown.text);
      expect(wrong.html).toBe(unknown.html);
    });

    test('signing in with the right credentials lands on the practice page', async ({ page, context, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const email = uniqueEmail();
      await openRegistration(page, fx);
      await fillRegistration(page, fx, email);
      await tickRequired(page, fx);
      await page.getByRole('button', { name: fx.submitName }).click();
      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/practice$`), { timeout: 30_000 });
      await context.clearCookies();

      await page.goto(`${fx.prefix}/sign-in`);
      await waitForHydration(page, 'form');
      await page.getByLabel(fx.emailLabel, { exact: true }).fill(email);
      await page.getByLabel(fx.passwordLabel, { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: fx.signInSubmit }).click();

      await expect(page).toHaveURL(new RegExp(`${fx.prefix}/practice$`), { timeout: 30_000 });
    });
  });
}

// The middleware matcher (src/middleware.ts): these two routes used to 404 for
// the unprefixed URL; that they resolve at all is the point. And extending the
// matcher must not have changed what the middleware does with a cookie.
test.describe('KAN-55 — /register and /sign-in resolve through the middleware without disturbing the guest cookie', () => {
  for (const path of ['/register', '/sign-in', '/de/register', '/de/sign-in']) {
    test(`${path}: 200, mints a guest cookie on a first visit, and leaves a valid one alone on the next`, async ({ page, context, browserName }) => {
      skipIfWebkitCannotStoreTheSessionCookie(browserName);
      const first = await page.goto(path);
      expect(first?.status(), `${path} should respond 200`).toBe(200);
      const minted = (await context.cookies()).find((cookie) => cookie.name === GUEST_COOKIE);
      expect(minted, 'a first visit should mint the guest cookie').toBeDefined();

      const again = await page.goto(path);
      expect(again?.status()).toBe(200);
      const after = (await context.cookies()).find((cookie) => cookie.name === GUEST_COOKIE);
      expect(after?.value, 'a returning visitor keeps the same session id').toBe(minted?.value);
      expect(after?.expires, 'and the cookie is not re-issued').toBe(minted?.expires);
    });
  }

  test('the prefixed default-locale path redirects to the canonical one, as for every other guest route', async ({ page }) => {
    await page.goto('/en/register');
    await expect(page).toHaveURL(/\/register$/);
    await expect(page).not.toHaveURL(/\/en\//);
  });
});
