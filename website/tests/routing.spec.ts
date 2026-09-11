/**
 * T1 — Routing & HTTP Status Codes
 *
 * Verifies every route returns the correct HTTP status.
 * Uses fetch() directly so we check the wire-level response
 * before any JavaScript runs.
 */
import { test, expect } from '@playwright/test';
import { STATIC_MARKETING_ROUTES } from './helpers/routes';

// Only run in one project — this is pure HTTP, no browser rendering needed
test.use({ browserName: 'chromium' });

for (const route of STATIC_MARKETING_ROUTES) {
  test(`T1 — GET ${route} returns 200`, async ({ request }) => {
    const response = await request.get(route);
    expect(response.status(), `${route} should return 200`).toBe(200);
  });
}

test('T1 — GET /nonexistent-page returns 404', async ({ request }) => {
  const response = await request.get('/this-page-does-not-exist-xyz');
  expect(response.status()).toBe(404);
});

// The /app mockup (Dashboard/Tasks/Progress, mock data) was deleted per
// Architecture Decisions ADR-7 — a different, broader product concept with
// no functional wiring, superseded by the real guest essay flow (KAN-8
// onward, under website/src/app/(guest)/). It should now 404 like any
// other removed route.
test('T1 — GET /app returns 404 (deleted mockup, ADR-7)', async ({ request }) => {
  const response = await request.get('/app');
  expect(response.status()).toBe(404);
});

test('T1 — GET /health returns 200 with body "healthy"', async ({ request }) => {
  const response = await request.get('/health');
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body.trim()).toBe('healthy');
});

test('T1 — GET /blog/nonexistent-slug returns 404', async ({ request }) => {
  const response = await request.get('/blog/this-post-does-not-exist-xyz-abc');
  expect(response.status()).toBe(404);
});
