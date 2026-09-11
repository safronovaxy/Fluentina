# Custom Domain Setup - fluentina.com

This guide will help you configure `fluentina.com` to point to your deployed Fluentina website.

## Overview

**Setup Steps:**
1. ✅ Verify domain ownership with Google (COMPLETE)
2. ✅ Configure Google Cloud Load Balancer (COMPLETE)
3. **→ Add DNS records to your domain registrar (DO THIS NOW)**
4. Wait for DNS propagation and SSL activation
5. Test your custom domains

**Architecture:**

Since your services are deployed in the `europe-west10` region (which doesn't support direct domain mapping), I've set up a **production-grade Google Cloud Load Balancer**:

```
Internet
    ↓
DNS Records (all point to same IP):
    ├─ fluentina.com → 34.160.140.247
    ├─ www.fluentina.com → 34.160.140.247
    └─ cms.fluentina.com → 34.160.140.247
    ↓
Google Cloud Load Balancer (34.160.140.247)
    ├─ SSL Certificate (auto-managed, covers all 3 domains)
    ├─ URL Routing:
    │   ├─ fluentina.com → Website Backend
    │   ├─ www.fluentina.com → Website Backend
    │   └─ cms.fluentina.com → CMS Backend
    ↓
Cloud Run Services (europe-west10)
    ├─ writewise-website (marketing site)
    └─ writewise-cms (Strapi CMS)
```

**Benefits:**
- Production-grade infrastructure with DDoS protection
- Automatic SSL certificate management
- Global CDN capabilities for faster loading
- Health checks and automatic failover

## Step 1: Verify Domain Ownership with Google

Before Cloud Run can use your custom domain, you need to verify you own it.

### Option A: Via Google Search Console (Recommended)

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Click "Add Property"
3. Enter `fluentina.com`
4. Choose verification method:
   - **DNS TXT Record** (recommended): Add a TXT record to your DNS
   - **HTML File**: Upload a file to your website root
   - **HTML Meta Tag**: Add a meta tag to your homepage
5. Complete verification

### Option B: Via Google Cloud Console

1. Go to [Google Cloud Domains Verification](https://console.cloud.google.com/apis/credentials/domainverification?project=writewise-468912)
2. Click "Add Domain"
3. Enter `fluentina.com`
4. Follow the verification instructions (usually adding a TXT record to DNS)
5. Click "Verify"

**Verification TXT Record Format:**
```
Name: @
Type: TXT
Value: google-site-verification=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
TTL: 3600 (or default)
```

You'll get the actual value from Google during verification.

## Step 2: Load Balancer Setup (Complete!)

**Status:** ✅ **COMPLETE** - Load balancer has been configured!

Since the `europe-west10` region doesn't support direct domain mapping, I've set up a **Google Cloud Load Balancer** with the following architecture:

### What Was Configured

1. **Static IP Address:** `34.160.140.247`
2. **Serverless Network Endpoint Groups (NEGs):**
   - `writewise-website-neg` → Points to Cloud Run website service
   - `writewise-cms-neg` → Points to Cloud Run CMS service
3. **Backend Services:**
   - `writewise-website-backend` → Serves website traffic
   - `writewise-cms-backend` → Serves CMS traffic
4. **SSL Certificate:** `writewise-ssl-cert-v2`
   - Domains: `fluentina.com`, `www.fluentina.com`, `cms.fluentina.com`
   - Status: Provisioning (will be ACTIVE after DNS is configured)
5. **URL Routing:**
   - `fluentina.com` → Website backend
   - `www.fluentina.com` → Website backend
   - `cms.fluentina.com` → CMS backend
6. **HTTPS Load Balancer:**
   - Entry point: `34.160.140.247:443`
   - Automatic SSL termination
   - Routes traffic based on hostname

**Load Balancer Benefits:**
- ✅ Production-grade infrastructure
- ✅ Automatic SSL certificate management
- ✅ Global load balancing and CDN capabilities
- ✅ DDoS protection
- ✅ Health checks and automatic failover

You can view the load balancer in the console:
- [Load Balancers](https://console.cloud.google.com/net-services/loadbalancing/list/loadBalancers?project=writewise-468912)

## Step 3: Configure DNS Records

You need to add A records that point your domains to the load balancer's static IP address.

### DNS Records to Add

Add these **THREE** A records to your domain registrar:

#### 1. Root Domain (fluentina.com)

```
Name: @
Type: A
Value: 34.160.140.247
TTL: 300
```

#### 2. WWW Subdomain (www.fluentina.com)

```
Name: www
Type: A
Value: 34.160.140.247
TTL: 300
```

#### 3. CMS Subdomain (cms.fluentina.com)

```
Name: cms
Type: A
Value: 34.160.140.247
TTL: 300
```

**That's it!** All three domains point to the same load balancer IP, and the load balancer routes traffic to the correct service based on the hostname.

**Note:** Use a shorter TTL (300 seconds) initially so you can quickly fix any issues. After everything works, you can increase it to 3600 or higher.

## Step 4: Add DNS Records to Your Domain Registrar - **DO THIS NOW**

### Where is fluentina.com registered?

Go to your domain registrar's DNS management page:

**Common Registrars:**
- **GoDaddy**: Go to [DNS Management](https://dcc.godaddy.com/control/portfolio/dns)
- **Namecheap**: Go to [Domain List](https://ap.www.namecheap.com/domains/list/) → Manage → Advanced DNS
- **Google Domains**: Go to [My Domains](https://domains.google.com/registrar/) → DNS
- **Cloudflare**: Go to [Dashboard](https://dash.cloudflare.com/) → DNS
- **Route 53** (AWS): Go to Hosted Zones

### Add the Records

1. **Delete any existing A or CNAME records** for `@` (root domain), `www`, and `cms` (subdomains)

2. **Add A record for root domain:**
   ```
   Name: @ (or leave blank)
   Type: A
   Value: 34.160.140.247
   TTL: 300
   ```

3. **Add A record for www subdomain:**
   ```
   Name: www
   Type: A
   Value: 34.160.140.247
   TTL: 300
   ```

4. **Add A record for CMS subdomain:**
   ```
   Name: cms
   Type: A
   Value: 34.160.140.247
   TTL: 300
   ```

5. **Save changes**

**Important Notes:**
- Use `@` or leave the name blank for the root domain (fluentina.com)
- Use `www` for the www subdomain (www.fluentina.com)
- Use `cms` for the CMS subdomain (cms.fluentina.com)
- **If using Cloudflare:** Set proxy to "DNS only" (gray cloud icon) - the load balancer handles HTTPS
- Start with TTL 300 (5 minutes) so you can quickly fix any issues

## Step 5: Verify SSL Certificate

The Google Cloud Load Balancer automatically provisions SSL certificates for your custom domains. This takes 15-60 minutes after DNS propagation.

### Check SSL Certificate Status

```bash
gcloud compute ssl-certificates describe writewise-ssl-cert-v2 \
  --global \
  --project=writewise-468912 \
  --format="get(managed.status,managed.domainStatus)"
```

You should see:
```
ACTIVE
cms.fluentina.com: ACTIVE
fluentina.com: ACTIVE
www.fluentina.com: ACTIVE
```

**Current Status:** `PROVISIONING` (will become `ACTIVE` after DNS is configured)

### Check Load Balancer Status

View in console:
- [Load Balancers](https://console.cloud.google.com/net-services/loadbalancing/list/loadBalancers?project=writewise-468912)
- [SSL Certificates](https://console.cloud.google.com/net-services/loadbalancing/advanced/sslCertificates/list?project=writewise-468912)

## Step 6: Update CORS Configuration

Once the custom domain is active, update the CMS CORS to allow the new domain:

**File:** `/cms/config/middlewares.ts`

Already configured with:
```typescript
origin: [
  'https://fluentina.com',  // ✅ Already added
  'https://writewise-website-m2xkjyh6ta-oe.a.run.app',
  // ...
]
```

## Step 7: Update Environment Variables (Optional)

If you want to update the website to use the custom CMS domain:

**Update GitHub Secrets:**
```bash
# Update VITE_STRAPI_URL to use custom domain
# (Optional - current URL works fine)
```

**Rebuild Website:**
```bash
git commit --allow-empty -m "Trigger rebuild for custom domain"
git push origin main
```

## Verification Checklist

After DNS propagation (can take 5 minutes to 48 hours):

- [x] Domain verified in Google Cloud
- [x] Load balancer configured
- [x] SSL certificate created (provisioning)
- [ ] DNS records added to registrar (@, www, cms)
- [ ] DNS propagation complete
- [ ] SSL certificate status: ACTIVE
- [ ] https://fluentina.com loads the website
- [ ] https://www.fluentina.com loads the website
- [ ] https://cms.fluentina.com/admin loads the CMS admin
- [ ] Pricing page loads correctly on custom domain
- [ ] Contact form works on custom domain

## Troubleshooting

### "Domain not verified" error
- Complete Step 1 (domain verification) first
- Wait a few minutes after verification
- Try again

### DNS not propagating
- Wait longer (DNS can take up to 48 hours)
- Check DNS with: `dig fluentina.com`
- Check DNS with: `nslookup fluentina.com`
- Try different DNS resolver (8.8.8.8)

### SSL certificate not issuing
- Ensure DNS is fully propagated
- Wait up to 60 minutes
- Check Cloud Run console for status
- Verify all A/AAAA records are correct

### Website still showing Cloud Run URL
- Clear browser cache
- Hard refresh: Ctrl+Shift+R (or Cmd+Shift+R)
- Try incognito/private browsing

### CORS errors after switching to custom domain
- CORS is already configured for fluentina.com
- Try hard refresh
- Check browser console for specific errors

## DNS Propagation Check

Check if DNS has propagated globally:
- [DNS Checker](https://dnschecker.org/) - Enter `fluentina.com`
- [What's My DNS](https://www.whatsmydns.net/) - Check globally

## Current Status

- [x] Website deployed to Cloud Run
- [x] CMS deployed to Cloud Run
- [x] Pricing working with Stripe
- [x] Contact form working with Mailjet
- [x] Domain verified with Google
- [x] Load balancer configured
- [x] SSL certificate created (provisioning)
- [ ] **DNS records need to be added** ← You are here
- [ ] Wait for DNS propagation
- [ ] Verify SSL certificate becomes ACTIVE
- [ ] Test custom domains

## Next Steps

**What you need to do now:**

### ✅ Completed:
1. Domain verified with Google
2. Load balancer configured with SSL certificate
3. Both services (website and CMS) connected to load balancer

### 🎯 Action Required - ADD DNS RECORDS:

**Go to Step 4 above** and add these **THREE** DNS records to your domain registrar:

1. **Root domain (fluentina.com):**
   - Type: A
   - Name: @ (or blank)
   - Value: `34.160.140.247`
   - TTL: 300

2. **WWW subdomain (www.fluentina.com):**
   - Type: A
   - Name: www
   - Value: `34.160.140.247`
   - TTL: 300

3. **CMS subdomain (cms.fluentina.com):**
   - Type: A
   - Name: cms
   - Value: `34.160.140.247`
   - TTL: 300

### After Adding DNS Records:

1. **Wait for DNS propagation** (5-30 minutes, up to 48 hours)
   - Check propagation at [DNS Checker](https://dnschecker.org/)

2. **SSL certificate activation** (15-60 minutes after DNS)
   - Google will automatically provision SSL certificates
   - Check status: Step 5 above

3. **Test your domains:**
   - https://fluentina.com → Website
   - https://www.fluentina.com → Website (same)
   - https://cms.fluentina.com → CMS Admin
   - Test pricing page, contact form, etc.

**Right now:** Go add the DNS records! This is the only remaining manual step.

## Support

If you need help:
- Check Cloud Run logs: `gcloud logging read ...`
- Check domain mapping status: `gcloud beta run domain-mappings list`
- Ask me for help with any step!
