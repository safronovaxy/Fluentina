/**
 * T2 — Server-Side HTML & SEO
 *
 * The most critical test area: verifies that real content exists in the
 * raw HTML *before* JavaScript runs. Uses fetch() to get the wire response
 * and checks the HTML string directly.
 *
 * If this test fails it means the page is still a client-rendered SPA
 * (empty <div id="root">) — the primary reason for the Next.js migration.
 */
import { test, expect } from '@playwright/test';
import { SSR_CONTENT_CHECKS } from './helpers/routes';

test.use({ browserName: 'chromium' });

// ── T2.1–T2.5  Real content in raw HTML ─────────────────────────────────────

for (const { route, mustContain } of SSR_CONTENT_CHECKS) {
  test(`T2 — ${route} has server-rendered content in HTML source`, async ({ request }) => {
    const response = await request.get(route);
    const html = await response.text();

    // Must NOT be a bare SPA shell
    expect(html, `${route}: looks like an empty SPA shell`).not.toMatch(
      /<div id="root"><\/div>/,
    );

    // Must contain meaningful content
    expect(html, `${route}: expected content matching ${mustContain}`).toMatch(mustContain);
  });
}

// ── T2.7–T2.10  Meta tags present in <head> ──────────────────────────────────

const META_PAGES = [
  '/',
  '/pricing',
  '/about',
  '/blog',
  '/contact',
  '/placement-test',
  '/placement-test/german',
  '/placement-test/english',
  '/privacy',
  '/terms',
  '/for-freelancers',
];

for (const route of META_PAGES) {
  test(`T2 — ${route} has <title> tag`, async ({ request }) => {
    const response = await request.get(route);
    const html = await response.text();
    expect(html).toMatch(/<title>[^<]+<\/title>/);
    // Title must not be empty or just whitespace
    const match = html.match(/<title>([^<]+)<\/title>/);
    expect(match?.[1]?.trim().length ?? 0).toBeGreaterThan(5);
  });

  test(`T2 — ${route} has meta description`, async ({ request }) => {
    const response = await request.get(route);
    const html = await response.text();
    expect(html).toMatch(/meta[^>]+name="description"[^>]+content="[^"]{10,}"/);
  });

  test(`T2 — ${route} has og:title`, async ({ request }) => {
    const response = await request.get(route);
    const html = await response.text();
    expect(html).toMatch(/meta[^>]+property="og:title"/);
  });

  test(`T2 — ${route} has canonical link`, async ({ request }) => {
    const response = await request.get(route);
    const html = await response.text();
    expect(html).toMatch(/link[^>]+rel="canonical"[^>]+href="https:\/\/write-wise\.com/);
  });
}

// ── T2.11–T2.14  Structured data (JSON-LD) ───────────────────────────────────

test('T2 — / homepage has Organization JSON-LD (server-rendered)', async ({ request }) => {
  const response = await request.get('/');
  const html = await response.text();
  expect(html).toMatch(/application\/ld\+json/);
  expect(html).toMatch(/"@type"\s*:\s*"Organization"/);
  // Logo must be an ImageObject, not a bare string path
  expect(html).toMatch(/"logo"\s*:\s*\{/);
  // description must be present
  expect(html).toMatch(/"description"\s*:/);
});

test('T2 — / homepage has SoftwareApplication JSON-LD (server-rendered)', async ({ request }) => {
  const response = await request.get('/');
  const html = await response.text();
  expect(html).toMatch(/"@type"\s*:\s*"SoftwareApplication"/);
  expect(html).toMatch(/"applicationCategory"\s*:\s*"EducationApplication"/);
  expect(html).toMatch(/"offers"/);
  expect(html).toMatch(/"aggregateRating"/);
});

test('T2 — /pricing has SoftwareApplication JSON-LD (server-rendered)', async ({ request }) => {
  const response = await request.get('/pricing');
  const html = await response.text();
  expect(html).toMatch(/"@type"\s*:\s*"SoftwareApplication"/);
  expect(html).toMatch(/"offers"/);
});

test('T2 — /pricing has FAQPage JSON-LD', async ({ request }) => {
  const response = await request.get('/pricing');
  const html = await response.text();
  expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
});

test('T2 — /blog/[slug] has Article JSON-LD', async ({ request }) => {
  // First get a real slug from the blog listing page
  const listing = await request.get('/blog');
  const listingHtml = await listing.text();

  // Extract first blog href — works for both /blog/slug and full URL patterns
  const slugMatch = listingHtml.match(/href="\/blog\/([^"?#]+)"/);
  if (!slugMatch) {
    test.skip(); // No blog posts published yet — skip gracefully
    return;
  }

  const response = await request.get(`/blog/${slugMatch[1]}`);
  const html = await response.text();
  expect(html).toMatch(/"@type"\s*:\s*"Article"/);
});

// T2.6 previously asserted the deleted /app mockup didn't leak Strapi data
// client-side. The mockup is gone (ADR-7) — route.spec.ts now covers /app
// returning 404 instead.
