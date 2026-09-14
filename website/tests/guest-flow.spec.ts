/**
 * KAN-8 — Guest flow responsive foundation
 *
 * Runs across chromium-desktop (1280px) and chromium-mobile (Pixel 5, 393px),
 * parameterised (KAN-9) over both locale routes — `/practice` (English) and
 * `/de/practice` (German).
 *
 * Running on two viewport projects is not by itself proof of responsiveness:
 * an earlier version of this spec made only viewport-independent assertions,
 * so the mobile run proved the page loaded at a narrow width and nothing
 * more. Deleting a breakpoint class — leaving five unlabelled dots on
 * desktop, or five truncated labels on a phone — passed the whole suite.
 * The viewport-differential test below is the one that actually fails for
 * that.
 *
 * Same trap, one axis over: running these against English alone twice (once
 * per viewport project) doubles the assertion count without doubling the
 * evidence for the locale axis. German is the harder case for the
 * differential/truncation tests specifically: "Registrieren" against
 * "Register", "Einreichen" against "Submit", against a step row already
 * tuned to the pixel (see flow-steps.ts). Running them in German is what
 * caught "Registrieren" truncating at a full desktop width, which is why
 * that label is now "Konto". A label that truncates only in
 * German, only on desktop, would ship green if this file only ever loaded
 * `/practice`. Looping the whole describe block over both locale fixtures,
 * rather than hand-copying it into a second file, is what keeps this from
 * happening again without doubling the file to maintain.
 *
 * Only the landing page has real content today (the rest of the guest flow,
 * KAN-13 onward, nests under this same GuestFlowShell); this spec is the seam
 * future funnel specs (Test Strategy §5) extend rather than duplicate.
 */
import { test, expect, type Page } from '@playwright/test';
import { isCritical } from './helpers/console-errors';

const isMobileProject = () => test.info().project.name === 'chromium-mobile';

async function gotoOk(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.ok(), `${path} should respond 200, got ${response?.status()}`).toBe(true);
  return response;
}

interface LocaleFixture {
  locale: 'en' | 'de';
  path: string;
  progressLabel: string;
  heading: string;
  ctaName: string;
  brandName: string;
  firstStepLabel: string;
  lastStepLabel: string;
}

const LOCALE_FIXTURES: readonly LocaleFixture[] = [
  {
    locale: 'en',
    path: '/practice',
    progressLabel: 'Guest essay flow progress',
    heading: 'Practice a B2-style essay',
    ctaName: 'Start practicing',
    brandName: 'Fluentina home',
    firstStepLabel: 'Step 1 of 5: Prompt',
    lastStepLabel: 'Step 5 of 5: Register',
  },
  {
    locale: 'de',
    path: '/de/practice',
    progressLabel: 'Fortschritt im Gast-Aufsatzablauf',
    heading: 'Übe einen B2-Aufsatz',
    ctaName: 'Jetzt üben',
    brandName: 'Fluentina Startseite',
    firstStepLabel: 'Schritt 1 von 5: Thema',
    lastStepLabel: 'Schritt 5 von 5: Konto',
  },
];

for (const fx of LOCALE_FIXTURES) {
  test.describe(`KAN-8/KAN-9 — ${fx.path} guest flow landing (${fx.locale})`, () => {
    test('loads with no horizontal overflow at the current viewport', async ({ page }) => {
      await gotoOk(page, fx.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth, 'page should not scroll horizontally').toBeLessThanOrEqual(clientWidth);
    });

    test('step labels are shown on desktop and collapsed to dots on mobile', async ({ page }) => {
      await gotoOk(page, fx.path);

      const progress = page.getByRole('list', { name: fx.progressLabel });
      // Located structurally, not by its text. Keying off the label wording
      // made a label change fail this as "not visible", masking what is
      // actually being tested.
      const labels = progress.locator('li > span:last-child');
      const firstLabel = labels.first();

      // The numbered dots are present at every width — that is the whole
      // point of the collapse, and is what makes the mobile header usable.
      // Scoped to the progress list: KAN-13 is itself a list of prompts.
      await expect(progress.getByRole('listitem')).toHaveCount(5);

      if (isMobileProject()) {
        await expect(firstLabel).toBeHidden();
      } else {
        await expect(firstLabel).toBeVisible();

        // Visible is not the same as readable: a label truncated to
        // "Choose p…" (or, in German, "Registrie…") is fully visible. Every
        // label must fit its box, at every desktop width, in both locales,
        // or the step names are decoration.
        for (const label of await labels.all()) {
          const clipped = await label.evaluate(
            (el) => el.scrollWidth > el.clientWidth,
          );
          expect(clipped, `step label "${await label.textContent()}" is truncated`).toBe(false);
        }
      }
    });

    test('the guest segment is noindex, inherited from its layout', async ({ page }) => {
      // Asserted here rather than trusted: the (guest) layout sets this so
      // later screens inherit it without their authors remembering, and the
      // failure — a half-built screen indexed by Google — is invisible
      // until it happens. robots.txt is deliberately NOT the mechanism; a
      // crawler has to be allowed to fetch the page in order to read this
      // tag.
      await gotoOk(page, fx.path);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        /noindex/,
      );
    });

    test('every step is announced with a name, at both sizes', async ({ page }) => {
      // The visible label is display:none on mobile, which removes it from
      // the accessibility tree entirely. Without an explicit name a
      // screen-reader user hears "list, 5 items — 1, 2, 3, 4, 5", and a
      // completed step, whose only content is an aria-hidden check icon,
      // announces as empty.
      await gotoOk(page, fx.path);
      await expect(page.getByRole('listitem', { name: fx.firstStepLabel })).toBeAttached();
      await expect(page.getByRole('listitem', { name: fx.lastStepLabel })).toBeAttached();
    });

    test('renders the step progress and the primary CTA', async ({ page }) => {
      await gotoOk(page, fx.path);

      const progress = page.getByRole('list', { name: fx.progressLabel });
      await expect(progress).toBeVisible();
      // Scoped to the progress list rather than page-wide, so this keeps
      // meaning the same thing once a screen adds any other list.
      await expect(progress.getByRole('listitem')).toHaveCount(5);

      const cta = page.getByRole('button', { name: fx.ctaName, exact: true });
      await expect(cta).toBeVisible();
      // Intentionally disabled — see (guest)/practice/page.tsx: prompt
      // selection/essay entry (KAN-13/KAN-14) don't exist yet to link to.
      await expect(cta).toBeDisabled();
    });

    test('brand link in the flow header returns to the marketing homepage', async ({ page }) => {
      await gotoOk(page, fx.path);
      await page.getByRole('link', { name: fx.brandName }).click();
      await expect(page).toHaveURL('/');
    });

    test('zero console errors', async ({ page }) => {
      const errors: string[] = [];
      // Filter pageerror too, not just console: a third-party script
      // throwing on an unregistered origin arrives here, not as a console
      // message.
      page.on('pageerror', (err) => {
        if (isCritical(err.message)) errors.push(err.message);
      });
      page.on('console', (msg) => {
        if (msg.type() === 'error' && isCritical(msg.text())) errors.push(msg.text());
      });

      await gotoOk(page, fx.path);
      // networkidle, not domcontentloaded: goto already waits for load, and
      // domcontentloaded fired before that, so the old assertion ran at
      // roughly the load event — before React hydrates. A hydration
      // mismatch logs its console.error after that point, so this test
      // passed on precisely the failure it exists to catch.
      await page.waitForLoadState('networkidle');

      expect(errors, `Console errors on ${fx.path}:\n${errors.join('\n')}`).toHaveLength(0);
    });
  });
}
