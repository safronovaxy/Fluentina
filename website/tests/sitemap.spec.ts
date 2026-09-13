/**
 * T12 — Sitemap & Robots
 *
 * Verifies sitemap.xml and robots.txt exist and contain
 * all expected static routes plus dynamic blog/resource slugs.
 */
import { test, expect } from '@playwright/test';
import { STATIC_MARKETING_ROUTES } from './helpers/routes';

test.use({ browserName: 'chromium' });

test('T12.1 — /sitemap.xml returns 200 and valid XML', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('<?xml');
  expect(body).toContain('<urlset');
  expect(body).toContain('</urlset>');
});

test('T12.2 — Sitemap contains all static marketing routes', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  const body = await response.text();

  for (const route of STATIC_MARKETING_ROUTES) {
    expect(body, `Sitemap should contain ${route}`).toContain(
      `fluentina.com${route === '/' ? '' : route}`,
    );
  }
});

// @cms — needs a reachable Strapi with published posts. CI runs with no CMS
// (see ci.yml), so this is excluded there and runs against a live site.
test('T12.3 — @cms Sitemap contains at least one blog post URL', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  const body = await response.text();
  expect(body).toMatch(/fluentina\.com\/blog\/[^<"]+/);
});

// @cms — the >= 14 floor assumes CMS-backed blog and video URLs on top of the
// 12 hardcoded static routes. Without a CMS the sitemap has exactly 12.
test('T12.4 — @cms Sitemap URL count is >= 14 (12 static + dynamic)', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  const body = await response.text();
  const urls = (body.match(/<loc>/g) ?? []).length;
  expect(urls).toBeGreaterThanOrEqual(14);
});

test('T12.5 — /robots.txt returns 200', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toMatch(/user-agent/i);
});

test('T12.6 — robots.txt references the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');
  const body = await response.text();
  expect(body.toLowerCase()).toContain('sitemap');
  expect(body).toContain('fluentina.com');
});

// The old assertion here checked the sitemap never mentions /app. With the
// mockup deleted there is no code path that could emit it, so it certified
// nothing. The live control is robots.txt, which nothing was checking.
test('T12.7 — robots.txt still disallows /app/ and /api/', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain('/app/');
  expect(body).toContain('/api/');
});
