import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Points at the request-config module (KAN-9) so the plugin can wire the
// locale-aware Server Component runtime for the tree nested under
// src/app/[locale]/ (currently just the guest flow — see that config file's
// own comment for the scope boundary).
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Produce a self-contained Node.js server for Cloud Run (no nginx needed)
  output: 'standalone',

  experimental: {
    // Enables per-import tree-shaking for large packages so only used icons/
    // components end up in the bundle, instead of the entire library.
    optimizePackageImports: ['lucide-react', '@radix-ui/react-navigation-menu'],
  },


  // Disable the built-in X-Powered-By header
  poweredByHeader: false,

  // Trailing slashes are canonically absent on this site
  trailingSlash: false,

  images: {
    // Allow images served from Strapi GCS bucket
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'writewise-cms-m2xkjyh6ta-oe.a.run.app' },
    ],
  },

  // ── Redirects (previously in nginx.conf) ─────────────────────────────────
  async redirects() {
    return [
      // Legacy URL slugs
      { source: '/privacy-policy', destination: '/privacy', permanent: true },
      { source: '/user-agreement', destination: '/terms',   permanent: true },

      // WordPress legacy routes → homepage
      { source: '/author/:path*',   destination: '/', permanent: true },
      { source: '/tag/:path*',      destination: '/', permanent: true },
      { source: '/category/:path*', destination: '/', permanent: true },
      { source: '/wp-admin/:path*', destination: '/', permanent: true },
      { source: '/wp-content/:path*', destination: '/', permanent: true },
      { source: '/wp-includes/:path*', destination: '/', permanent: true },
      { source: '/wp-login.php',    destination: '/', permanent: true },
      { source: '/xmlrpc.php',      destination: '/', permanent: true },
    ];
  },

  // ── Security & caching headers ────────────────────────────────────────────
  async headers() {
    return [
      // Long-term cache for Next.js content-hashed static assets
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      // Security headers on all routes
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options',        value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options',  value: 'nosniff' },
          { key: 'X-XSS-Protection',        value: '1; mode=block' },
          { key: 'Referrer-Policy',          value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
