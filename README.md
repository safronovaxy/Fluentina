# Fluentina Website & CMS

This repository contains the marketing website, the guest/Phase 1 essay-grading
product, and the content management system (CMS) for Fluentina — an app helping
German learners pass the written-essay portion of the Goethe B2 exam via
AI-graded practice essays.

Team process (branching, PR review, merge criteria, CI/CD) lives in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). Architecture, product, and test-strategy
decisions live on Confluence (space **MFS**) — see the links at the bottom of
this file.

## Repository Structure

```
Fluentina/
├── cms/                    # Strapi CMS (Node.js)
│   ├── config/            # Strapi configuration
│   ├── src/               # API and content types
│   │   └── api/
│   │       ├── blog-post/
│   │       ├── feature/
│   │       ├── testimonial/
│   │       ├── resource/
│   │       ├── pricing-plan/
│   │       └── page/
│   ├── Dockerfile         # Docker configuration for Cloud Run
│   └── package.json       # Node.js dependencies
├── website/                # Marketing site + guest product (Next.js 15, App Router)
│   ├── src/
│   │   ├── app/            # Routes: (marketing)/*, (placement-test)/*, guest essay flow (in progress)
│   │   ├── page-components/# Page-level React components rendered by app/ routes
│   │   ├── components/     # Shared/UI components (shadcn/ui)
│   │   ├── hooks/          # Custom React hooks
│   │   └── lib/            # Utilities, Strapi client
│   ├── tests/               # Playwright e2e specs
│   ├── public/              # Static assets
│   ├── next.config.ts       # Next.js configuration
│   └── package.json         # Website dependencies
├── docker-compose.yml      # Local-only Postgres for product dev (see CONTRIBUTING.md)
└── .github/workflows/      # CI/CD pipelines (ci.yml, grading-regression.yml, deploy-*.yml)
```

## Local Development

See [`CONTRIBUTING.md`](./CONTRIBUTING.md#local-development-setup) for the full
setup (website, CMS, and the local Postgres used by the product backend —
never the shared production Cloud SQL instance).

## CMS (Strapi)

### Content Types

1. **BlogPost** - Blog posts for SEO and content marketing
2. **Feature** - Product features displayed on homepage
3. **Testimonial** - Customer testimonials and reviews
4. **Resource** - Learning resources and guides
5. **PricingPlan** - Subscription tiers and pricing
6. **Page** - Static pages (About, Privacy Policy, etc.)

### Technology Stack

- **Strapi v5.34.0** - Headless CMS
- **PostgreSQL** - Database (Cloud SQL)
- **Node.js 20** - Runtime
- **Docker** - Containerization
- **Google Cloud Run** - Serverless deployment

### Local Development

1. Install dependencies:
   ```bash
   cd cms
   npm install
   ```

2. Start development server (SQLite):
   ```bash
   npm run develop
   ```

3. Access admin panel:
   ```
   http://localhost:1337/admin
   ```

### Production Configuration

The CMS is deployed to Google Cloud Run with:
- **Service Name**: `writewise-cms`
- **Region**: `europe-west10`
- **Database**: Cloud SQL PostgreSQL (schema: `cms`)
- **Scaling**: 0-2 instances (scales to zero when idle)
- **Resources**: 1 CPU, 512Mi memory

### Environment Variables

Required environment variables for production:

```
NODE_ENV=production
DATABASE_CLIENT=postgres
DATABASE_NAME=writewise
DATABASE_USERNAME=writewise
DATABASE_SCHEMA=cms
DATABASE_HOST=/cloudsql/writewise-468912:europe-west10:writewise-db
DATABASE_PORT=5432
HOST=0.0.0.0
PORT=1337
APP_KEYS=<secret>
API_TOKEN_SALT=<secret>
ADMIN_JWT_SECRET=<secret>
TRANSFER_TOKEN_SALT=<secret>
JWT_SECRET=<secret>
DATABASE_PASSWORD=<secret>
```

All secrets are stored in Google Secret Manager.

## Deployment

### Automatic Deployment (CI/CD)

Push to `main` branch triggers automatic deployment via GitHub Actions:

```bash
git push origin main
```

The workflow:
1. Builds Docker image
2. Pushes to Artifact Registry
3. Deploys to Cloud Run
4. Runs health checks

### Manual Deployment

1. Build Docker image:
   ```bash
   cd cms
   docker build -t writewise-cms .
   ```

2. Deploy to Cloud Run:
   ```bash
   gcloud run deploy writewise-cms \
     --image europe-west10-docker.pkg.dev/writewise-468912/writewise/writewise-cms:latest \
     --region europe-west10 \
     --platform managed
   ```

## Access

- **CMS Admin Panel**: https://writewise-cms-<hash>.europe-west10.run.app/admin
- **API Endpoints**: https://writewise-cms-<hash>.europe-west10.run.app/api

## Database

The CMS uses a dedicated PostgreSQL schema (`cms`) within the shared Fluentina Cloud SQL instance:
- **Instance**: `writewise-db`
- **Database**: `writewise`
- **Schema**: `cms`

This allows resource sharing while maintaining data separation between the app and CMS.

## Cost Optimization

The CMS is configured to scale to zero when not in use:
- **Active time**: ~$5-10/month
- **Idle time**: ~$0/month
- **Expected monthly cost**: $8-15 (depends on usage)

## Security

- All sensitive configuration stored in Secret Manager
- Cloud SQL connection via Unix socket (no public IP)
- Non-root container user
- API authentication via tokens
- HTTPS only

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for branching, PR/review process,
merge criteria, and local dev setup — a condensed version of the
[Ways of Working & Delivery Model](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25526274)
Confluence page.

## Reference documentation (Confluence, space MFS)

- [Ways of Working & Delivery Model](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25526274)
- [Architecture Decisions](https://safronov.atlassian.net/wiki/spaces/MFS/pages/24838145)
- [Architecture Diagrams](https://safronov.atlassian.net/wiki/spaces/MFS/pages/24805378)
- [Test Strategy & Automation Approach](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25427970)
- [Phase 1 MVP — Revised Scope & Business Requirements](https://safronov.atlassian.net/wiki/spaces/MFS/pages/23494657)

## Support

For issues or questions, contact the development team.
