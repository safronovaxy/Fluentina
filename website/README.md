# Fluentina Website

Marketing website for [Fluentina](https://fluentina.com) — an AI-powered German language learning platform.

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Tailwind CSS 3
- shadcn/ui (Radix)
- React Hook Form + Zod
- TanStack React Query

## Local Development

```sh
# Install dependencies
cd website && npm install

# Start dev server (http://localhost:3000)
npm run dev

# Run tests
npm run test

# Production build
npm run build
```

## Deployment

Deployed automatically to Cloud Run via GitHub Actions on every push to `main`.

See `.github/workflows/deploy-website.yml` for details.
