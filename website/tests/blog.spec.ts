/**
 * T6 — Blog
 *
 * Verifies blog listing, category filtering, post navigation,
 * post content rendering, and 404 for unknown slugs.
 */
import { test, expect } from '@playwright/test';
import { isCritical } from './helpers/console-errors';

test.describe('T6 — Blog listing', () => {
  test('T6.1 — @cms Blog listing loads with posts', async ({ page }) => {
    await page.goto('/blog');
    // Should show at least one article/post card
    const cards = page.locator('article, [class*="card"], [class*="post"]');
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
  });

  test('T6.2 — No stuck loading skeleton on blog listing', async ({ page }) => {
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');
    // Skeletons should not be present after load
    const skeletons = page.locator('[class*="skeleton"], [class*="Skeleton"]');
    const count = await skeletons.count();
    expect(count).toBe(0);
  });

  test('T6.3 — Category filter buttons are visible', async ({ page }) => {
    await page.goto('/blog');
    // "All" button is rendered by the client component once hydrated. It does
    // not depend on CMS content — the category list always starts with "All" —
    // but when the CMS is unreachable the client query retries with backoff,
    // so hydration settles late and unpredictably. Raising the timeout alone
    // left it flaky under parallel load; waiting for the network to go quiet
    // makes it deterministic instead of racing a fixed deadline.
    await page.waitForLoadState('networkidle');
    const allButton = page.getByRole('button', { name: /^all$/i });
    await expect(allButton).toBeVisible({ timeout: 20_000 });
  });

  test('T6.4 — @cms Clicking "All" shows posts', async ({ page }) => {
    await page.goto('/blog');
    // Wait for React to hydrate and render blog posts first
    const cards = page.locator('article, a[href^="/blog/"]');
    await expect(cards.first()).toBeVisible({ timeout: 8000 });
    // Then optionally click "All" filter button
    const allButton = page.getByRole('button', { name: /^all$/i });
    if (await allButton.isVisible()) {
      await allButton.click();
    }
    await expect(cards.first()).toBeVisible();
  });

  test('T6.5 — @cms Clicking a post card navigates to post page', async ({ page }) => {
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');
    // Find first link to a blog post
    const postLink = page.locator('a[href^="/blog/"]').first();
    if (!(await postLink.count())) {
      test.skip(); // No posts published
      return;
    }
    const href = await postLink.getAttribute('href');
    await postLink.click();
    await expect(page).toHaveURL(href!);
    // Post page should have an h1
    await expect(page.locator('h1').first()).toBeVisible();
  });
});

test.describe('T6 — Blog post', () => {
  let firstSlug: string;

  test.beforeAll(async ({ request }) => {
    const response = await request.get('/blog');
    const html = await response.text();
    const match = html.match(/href="\/blog\/([^"?#]+)"/);
    firstSlug = match?.[1] ?? '';
  });

  test('T6.6 — Blog post content is visible', async ({ page }) => {
    if (!firstSlug) { test.skip(); return; }
    await page.goto(`/blog/${firstSlug}`);
    await expect(page.locator('h1').first()).toBeVisible();
    // Article body should contain meaningful text
    const body = page.locator('article, [class*="prose"], main');
    await expect(body.first()).toBeVisible();
    const text = await body.first().innerText();
    expect(text.length).toBeGreaterThan(100);
  });

  test('T6.7 — Blog post shows author and date', async ({ page }) => {
    if (!firstSlug) { test.skip(); return; }
    await page.goto(`/blog/${firstSlug}`);
    // At least one of these should be visible
    const authorOrDate = page.locator(
      '[class*="author"], [class*="date"], time, [datetime]'
    );
    await expect(authorOrDate.first()).toBeVisible();
  });

  test('T6.8 — Nonexistent blog slug returns 404 page', async ({ page }) => {
    const response = await page.goto('/blog/this-post-does-not-exist-xyz-abc-123');
    expect(response?.status()).toBe(404);
    // 404 page content should be visible
    await expect(page.locator('h1, h2').first()).toBeVisible();
  });

  test('T6.9 — Blog post has no console errors', async ({ page }) => {
    if (!firstSlug) { test.skip(); return; }
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto(`/blog/${firstSlug}`);
    await page.waitForLoadState('networkidle');
    // Shared filter, not a local copy: this runs on test:e2e:live, where a
    // narrower list lacks the analytics and network entries and goes
    // spuriously red.
    const critical = errors.filter(isCritical);
    expect(critical).toHaveLength(0);
  });
});
