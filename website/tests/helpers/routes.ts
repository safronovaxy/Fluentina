/**
 * Canonical list of all Fluentina routes.
 * Used across multiple test files to avoid repetition.
 */

export const STATIC_MARKETING_ROUTES = [
  '/',
  // Still here on purpose: /pricing must keep serving (ADR-8 unlinks it, it
  // does not remove it). It is deliberately NOT in the sitemap and is
  // noindex for the POC phase — see SEARCH_EXCLUDED_ROUTES below.
  '/pricing',
  '/about',
  '/blog',
  '/contact',
  '/for-freelancers',
  '/placement-test',
  '/placement-test/german',
  '/placement-test/english',
  '/privacy',
  '/terms',
] as const;

/**
 * Routes that must serve, but must stay out of search for the
 * proof-of-concept phase: unlinked from nav, absent from sitemap.xml, and
 * carrying a noindex tag. Showing a paid-tier page during the free-conversion
 * validation window would work against what that window is measuring.
 */
export const SEARCH_EXCLUDED_ROUTES = ['/pricing'] as const;

// The /app mockup (APP_ROUTES) was deleted per Architecture Decisions ADR-7
// — see routing.spec.ts for the 404 regression test. The real guest essay
// flow lives under website/src/app/(guest)/, starting with KAN-8.

/** Redirects: [source, expectedDestination (partial match)] */
export const REDIRECT_RULES: Array<{ from: string; to: string; status: 301 | 308 }> = [
  { from: '/privacy-policy',  to: '/privacy', status: 301 },
  { from: '/user-agreement',  to: '/terms',   status: 301 },
  { from: '/wp-admin/',       to: '/',        status: 301 },
  { from: '/author/someone',  to: '/',        status: 301 },
  { from: '/tag/grammar',     to: '/',        status: 301 },
  { from: '/category/tips',   to: '/',        status: 301 },
  { from: '/pricing/',        to: '/pricing', status: 301 },
  { from: '/blog/',           to: '/blog',    status: 301 },
];

/** Pages that must have real server-rendered content (not an empty #root div) */
export const SSR_CONTENT_CHECKS: Array<{ route: string; mustContain: RegExp }> = [
  // Must be specific to the new brand: the old alternation also matched the
  // pre-rebrand homepage, so it could not detect a half-finished rebrand.
  { route: '/',                      mustContain: /fluentina/i },
  { route: '/pricing',               mustContain: /plan|price|€|\$/i },
  { route: '/about',                 mustContain: /about|mission|team/i },
  { route: '/blog',                  mustContain: /blog|article|post/i },
  { route: '/contact',               mustContain: /contact|name|email|message/i },
  { route: '/for-freelancers',       mustContain: /freelanc|tutor|teacher/i },
  { route: '/placement-test',        mustContain: /placement|language|test|level/i },
  { route: '/placement-test/german', mustContain: /german|deutsch/i },
  { route: '/placement-test/english',mustContain: /english/i },
  { route: '/privacy',               mustContain: /privacy|personal data|gdpr/i },
  { route: '/terms',                 mustContain: /terms|conditions|agreement/i },
];
