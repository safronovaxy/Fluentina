# A/B Testing Implementation Plan
## Stack: GA4 + BigQuery + GrowthBook

---

## Architecture Overview

```
fluentina.com (React SPA)
    │
    ├── GrowthBook React SDK  ──► assigns variant per user (stored in cookie)
    │       │                     fires tracking callback on assignment
    │       ▼
    ├── GA4 (gtag.js)         ──► collects all events (page views, CTA clicks,
    │                              experiment assignments, conversions)
    │                                    │
    │                                    ▼ (streaming export, 1-click)
    │                             BigQuery (GCP, free tier)
    │                                    │
    │                                    ▼ (SQL queries)
    │                             GrowthBook Cloud (statistics, significance)
    │
    └── SEO.tsx (canonical)   ──► crawlers always see control variant,
                                   canonical URL always = primary URL
```

---

## Phase 1 — Manual Account Setup (you do this before any code)

These are one-time dashboard steps, no code involved.

### 1.1 Create GA4 Property
- Go to analytics.google.com → Create property for fluentina.com
- Property type: Web
- Note your **Measurement ID** (format: `G-XXXXXXXXXX`)
- In GA4 Admin → Data Streams → your stream → enable **Enhanced Measurement**
  (auto-tracks page views, scrolls, outbound clicks)

### 1.2 Enable BigQuery Export
- In GA4 Admin → BigQuery Linking → Link project `writewise-468912`
- Select dataset location: `europe-west10` (matches your Cloud Run region)
- Enable **daily export** (streaming export is paid; daily is free and sufficient)
- BigQuery dataset `analytics_XXXXXXXXX` will appear in your GCP project within 24h

### 1.3 Create GrowthBook Cloud Account
- Go to growthbook.io → Sign up (free, 3 seats)
- Create organization: "Fluentina"
- In SDK Connections → Create new connection → Platform: React
- Note your **Client Key** (format: `sdk-XXXXXXXXXX`) — this is public/safe

### 1.4 Connect BigQuery to GrowthBook
- In GrowthBook → Data Sources → Add Data Source → BigQuery
- Project: `writewise-468912`, Dataset: `analytics_XXXXXXXXX`
- Authentication: Service account (use your existing `gcs-service-account` or create
  a dedicated one with `bigquery.dataViewer` role)
- After connecting, GrowthBook will auto-suggest GA4 metric definitions

---

## Phase 2 — Analytics Foundation (GA4 in React)

**Files changed:** `website/package.json`, `website/src/lib/analytics.ts` (new),
`website/src/main.tsx`, `website/src/App.tsx`

### 2.1 Install dependency
```bash
cd website && npm install react-ga4
```

### 2.2 Create analytics helper (`website/src/lib/analytics.ts`)
Typed wrappers around GA4 for:
- `initGA(measurementId)` — initialise once
- `trackPageView(path)` — called on every route change
- `trackEvent(category, action, label?)` — conversion events (CTA clicks, form submits)
- `trackExperiment(experimentId, variationId)` — called by GrowthBook tracking callback

### 2.3 Initialise GA4 in `main.tsx`
Read `VITE_GA4_MEASUREMENT_ID` env var and call `initGA()` before React mounts.
Skip initialisation if the var is missing (safe for local dev without GA4).

### 2.4 Track route changes in `App.tsx`
Add a `useEffect` on `useLocation()` that calls `trackPageView(location.pathname)`
on every navigation. React Router v6 already uses `useLocation` in the header —
same pattern extended to analytics.

---

## Phase 3 — GrowthBook SDK Integration

**Files changed:** `website/package.json`, `website/src/lib/growthbook.ts` (new),
`website/src/main.tsx`

### 3.1 Install dependency
```bash
cd website && npm install @growthbook/growthbook-react
```

### 3.2 Create GrowthBook client (`website/src/lib/growthbook.ts`)
- Initialise `GrowthBook` with `clientKey` from `VITE_GROWTHBOOK_CLIENT_KEY`
- Set `trackingCallback` → calls `trackExperiment()` from analytics.ts
  (this is how experiment assignments flow into GA4 → BigQuery)
- Set `enableDevMode: true` in development (shows GrowthBook toolbar for QA)

### 3.3 Wrap app with `GrowthBookProvider` in `main.tsx`
```tsx
// main.tsx — final provider tree
<QueryClientProvider client={queryClient}>
  <GrowthBookProvider growthbook={growthbook}>
    <App />
  </GrowthBookProvider>
</QueryClientProvider>
```
GrowthBook loads feature flag config from their CDN asynchronously.
Falls back to control variant immediately if CDN is unavailable (no loading state needed).

---

## Phase 4 — Conversion Event Tracking

**Files changed:** `Index.tsx`, `Pricing.tsx`, `Contact.tsx`

These are the conversion events GrowthBook needs to compute experiment results.
Without tracking these, you can assign variants but can't measure impact.

### Events to add
| Page | Event | Action |
|------|-------|--------|
| Homepage | `cta_click` | Hero "Get Started" button |
| Homepage | `cta_click` | Bottom CTA section button |
| Pricing | `plan_cta_click` | Any plan "Get Started" button (label = plan name) |
| Contact | `contact_form_submit` | On successful form submission |
| All pages | `signup_redirect` | Any link to `/app?mode=signup` |

Implementation: wrap existing `<a>` / `<Link>` onClick handlers with `trackEvent()`.
No structural changes to pages — purely additive `onClick` additions.

---

## Phase 5 — Build & Deploy Configuration

**Files changed:** `.github/workflows/deploy-website.yml`

Add two new `--build-arg` entries to the Docker build step:
```yaml
--build-arg VITE_GA4_MEASUREMENT_ID=${{ secrets.GA4_MEASUREMENT_ID }} \
--build-arg VITE_GROWTHBOOK_CLIENT_KEY=${{ secrets.GROWTHBOOK_CLIENT_KEY }} \
```

**GitHub Secrets to add (you do this in repo Settings → Secrets):**
- `GA4_MEASUREMENT_ID` — your `G-XXXXXXXXXX` from Phase 1.1
- `GROWTHBOOK_CLIENT_KEY` — your `sdk-XXXXXXXXXX` from Phase 1.3

Both are public-safe values (they appear in client-side JS bundles by design).

---

## Phase 6 — First Experiment (Homepage Hero CTA)

**Files changed:** `website/src/pages/Index.tsx`

A simple first experiment to validate the full pipeline end-to-end:
test two variants of the hero CTA button copy:
- Control: "Get Started Free"
- Variant B: "Start Learning Today"

### 6.1 Define in GrowthBook dashboard
- Feature flag name: `hero-cta-copy`
- Type: String
- Control value: `"get-started-free"`
- Variant B value: `"start-learning-today"`
- Targeting: 100% of traffic, 50/50 split

### 6.2 Add flag to Index.tsx
```tsx
const { value: heroCta } = useFeature('hero-cta-copy');
// ...
<Button>{heroCta === 'start-learning-today' ? 'Start Learning Today' : 'Get Started Free'}</Button>
```

### 6.3 SEO safeguard
No new routes created. Crawlers see control variant (GrowthBook default before async
flag load resolves). Canonical URL unchanged — `SEO.tsx` already handles this correctly.

---

## Phase 7 — Validate Data Pipeline

After deploying, verify end-to-end:
1. Open fluentina.com in browser with GrowthBook DevMode toolbar
2. Confirm variant assignment visible in toolbar
3. Check GA4 Realtime view → Events → see `experiment_viewed` event
4. After 24h, check BigQuery dataset for `events_YYYYMMDD` table
5. In GrowthBook → Experiments → run analysis on the first experiment

---

## SEO Safety Summary

| Risk | Mitigation | Status |
|------|-----------|--------|
| Cloaking | Client-side assignment: crawlers get control variant | ✅ Safe by design |
| Duplicate content | No new URLs created for variants | ✅ N/A |
| Canonical confusion | `SEO.tsx` already sets canonical = current pathname | ✅ Already correct |
| CWV / layout shift | GrowthBook resolves before first paint (async, non-blocking) | ✅ No flicker |
| Sitemap pollution | No variant URLs → sitemap unchanged | ✅ N/A |

---

## Files Summary

| File | Change type | Phase |
|------|-------------|-------|
| `website/package.json` | Add 2 dependencies | 2, 3 |
| `website/src/lib/analytics.ts` | New file | 2 |
| `website/src/lib/growthbook.ts` | New file | 3 |
| `website/src/main.tsx` | Add GA4 init + GrowthBook provider | 2, 3 |
| `website/src/App.tsx` | Add route change tracking | 2 |
| `website/src/pages/Index.tsx` | Add CTA events + first experiment flag | 4, 6 |
| `website/src/pages/Pricing.tsx` | Add plan CTA click events | 4 |
| `website/src/pages/Contact.tsx` | Add form submit event | 4 |
| `.github/workflows/deploy-website.yml` | Add 2 build args | 5 |

**No CMS changes. No new routes. No structural page changes.**

---

## Prerequisites Before Starting Code

You must complete Phase 1 (manual setup) first and have:
- [ ] GA4 Measurement ID (`G-XXXXXXXXXX`)
- [ ] GrowthBook Client Key (`sdk-XXXXXXXXXX`)
- [ ] Both added as GitHub Secrets (`GA4_MEASUREMENT_ID`, `GROWTHBOOK_CLIENT_KEY`)
- [ ] BigQuery export enabled in GA4 (can be done in parallel with code work,
      but analysis won't work until BigQuery has 24h of data)
