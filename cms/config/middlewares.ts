export default [
  'strapi::logger',
  'strapi::errors',
  // Rate limiting to protect against brute force attacks
  {
    name: 'global::rate-limit',
    config: {},
  },
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://market-assets.strapi.io', 'https://storage.googleapis.com'],
          'media-src': ["'self'", 'data:', 'blob:', 'https://storage.googleapis.com'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      enabled: true,
      origin: [
        'http://localhost:3000',
        'http://localhost:8081',
        'http://localhost:5173',
        'https://fluentina.com',
        'https://www.fluentina.com',
        // Kept until the old domain is retired. Merge and deploy are
        // decoupled, so the CMS can ship this before DNS cutover — dropping
        // these would break the contact form and placement test for anyone
        // still on write-wise.com, with a console CORS error and no server
        // record of the attempt.
        'https://write-wise.com',
        'https://www.write-wise.com',
        'https://writewise-website-m2xkjyh6ta-oe.a.run.app',
        'https://writewise-website-918249600328.europe-west10.run.app',
        'https://*.vercel.app'
      ],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      headers: ['Content-Type', 'Authorization', 'Origin', 'Accept'],
      keepHeaderOnError: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
