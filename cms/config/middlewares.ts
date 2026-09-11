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
        'http://localhost:8081',
        'http://localhost:5173',
        'https://fluentina.com',
        'https://www.fluentina.com',
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
