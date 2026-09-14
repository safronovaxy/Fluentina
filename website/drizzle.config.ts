import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit is a CLI, run outside the Next.js process, so it does not get
// .env.local loaded for free the way `next dev`/`next build` do — hence the
// explicit dotenv load below, reading the same DATABASE_URL the app itself
// uses (website/.env.example). `.env.local` is Next's own convention, not
// dotenv's default `.env`, hence the explicit path. `quiet: true` because
// dotenv@17 prints a random self-promotional "tip" line to stdout on every
// load (one of which invites agents to an "auth" site at vestauth.com) —
// noise at best, and not something worth having in CLI/CI output either way.
config({ path: '.env.local', quiet: true });
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set — see website/.env.example');
}

export default defineConfig({
  // `driver` is only for the special-cased dialects (d1-http, expo,
  // durable-sqlite, aws-data-api, pglite) — plain node-postgres over a
  // connection string is dialect: 'postgresql' with no `driver` set.
  dialect: 'postgresql',
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
  // Migrations are generated as SQL and checked in — never hand-edited —
  // per the architecture decision to use Drizzle with drizzle-kit.
  strict: true,
  verbose: true,
});
