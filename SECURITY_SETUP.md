# Fluentina Security Configuration

This document describes the comprehensive security measures implemented to protect the Fluentina CMS and website.

## Overview

Your CMS is publicly accessible at `cms.fluentina.com`, which is standard practice but requires robust security. We've implemented **defense in depth** with multiple layers of protection:

1. **Application-Level Rate Limiting** (Strapi middleware)
2. **Infrastructure-Level Protection** (Google Cloud Armor WAF)
3. **HTTPS Encryption** (Managed SSL certificates)
4. **Strapi Authentication** (Built-in user management)

## Security Layers

### Layer 1: Strapi Rate Limiting Middleware

**Location:** `/cms/src/middlewares/rate-limit.ts`

**What it does:**
- Protects against brute force attacks by limiting requests per IP address
- Different limits for different route types

**Configuration:**
```typescript
Admin routes (/admin, /api/admin):
  - Max: 10 requests per minute per IP
  - Prevents: Brute force password attacks
  - Response: HTTP 429 "Too Many Requests"

API routes (/api):
  - Max: 100 requests per minute per IP
  - Prevents: API abuse and DoS
  - Response: HTTP 429 "Too Many Requests"
```

**How it works:**
- Uses in-memory store to track request counts per IP
- Automatically resets counters every minute
- Includes rate limit headers in responses:
  - `Rate-Limit-Remaining`: How many requests left
  - `Rate-Limit-Reset`: When the limit resets
  - `Rate-Limit-Total`: Total allowed per window

**For production at scale:**
If you deploy multiple CMS instances, consider switching from in-memory to Redis for shared rate limiting state.

### Layer 2: Google Cloud Armor (WAF)

**Policy Name:** `writewise-security-policy`

**Applied to:**
- CMS Backend (`writewise-cms-backend`)
- Website Backend (`writewise-website-backend`)

**Security Rules:**

#### Rule 1000: Rate-Based Ban
```
Type: Rate limiting with automatic ban
Threshold: 100 requests per 60 seconds per IP
Action: Ban IP for 10 minutes (600 seconds)
Response: HTTP 429 on exceed
```

**What it protects:**
- Prevents large-scale DDoS attacks
- Blocks aggressive scrapers
- Stops automated attack tools

#### Rule 2000: SQL Injection Protection
```
Type: Preconfigured WAF rule (sqli-v33-stable)
Action: Block request (HTTP 403)
```

**What it protects:**
- Blocks SQL injection attempts in:
  - URL parameters
  - Form data
  - Headers
  - Request body

**Examples of blocked attacks:**
```
' OR 1=1 --
'; DROP TABLE users; --
UNION SELECT * FROM passwords
```

#### Rule 3000: XSS Protection
```
Type: Preconfigured WAF rule (xss-v33-stable)
Action: Block request (HTTP 403)
```

**What it protects:**
- Blocks cross-site scripting attempts
- Prevents malicious JavaScript injection
- Protects against HTML injection

**Examples of blocked attacks:**
```html
<script>alert('xss')</script>
<img src=x onerror=alert('xss')>
javascript:void(document.cookie)
```

#### Rule 4000: Local File Inclusion Protection
```
Type: Preconfigured WAF rule (lfi-v33-stable)
Action: Block request (HTTP 403)
```

**What it protects:**
- Blocks attempts to read server files
- Prevents directory traversal attacks

**Examples of blocked attacks:**
```
../../etc/passwd
..%2F..%2Fetc%2Fpasswd
....//....//etc/passwd
```

### Layer 3: HTTPS Encryption

**SSL Certificate:** `writewise-ssl-cert-v2`

**Domains covered:**
- `fluentina.com`
- `www.fluentina.com`
- `cms.fluentina.com`

**Features:**
- Automatic renewal by Google
- TLS 1.2+ only (secure protocols)
- Perfect Forward Secrecy
- HSTS eligible

### Layer 4: Strapi Authentication

**Built-in features:**
- Password hashing (bcrypt)
- Session management
- Role-based access control (RBAC)
- JWT token authentication

## Security Best Practices

### ✅ Already Implemented

1. **Multi-layered defense** - Both application and infrastructure level
2. **Rate limiting** - Two independent systems (Strapi + Cloud Armor)
3. **WAF protection** - SQL injection, XSS, LFI blocked
4. **HTTPS only** - All traffic encrypted
5. **CORS properly configured** - Only whitelisted origins

### 🔐 Additional Recommendations

#### 1. Strong Admin Passwords

**Action required:** Ensure all admin accounts use:
- **16+ characters**
- Mix of uppercase, lowercase, numbers, symbols
- No dictionary words
- Unique per user

**Check your password:**
```bash
# Log into Strapi admin at: https://cms.fluentina.com/admin
# Settings → Users → Edit each user → Change password
```

#### 2. Regular Updates

**Action:** Keep Strapi updated

```bash
# Check for updates
npm run upgrade:dry

# Apply updates
npm run upgrade
```

**Schedule:** Check monthly for security patches

#### 3. Monitor Logs

**View blocked requests:**
```bash
# View Cloud Armor logs
gcloud logging read "resource.type=http_load_balancer AND jsonPayload.enforcedSecurityPolicy.name=writewise-security-policy" \
  --project=writewise-468912 \
  --limit=50 \
  --format=json
```

**What to look for:**
- Repeated blocks from same IP (potential attacker)
- Geographic patterns (attacks from specific countries)
- Attack types (SQL injection attempts, etc.)

#### 4. IP Whitelist (Optional)

If you only access CMS from specific locations, add IP whitelist:

**Edit:** `/cms/src/middlewares/rate-limit.ts`

```typescript
whitelist: (ctx) => {
  // Your office IP, home IP, etc.
  const allowedIPs = ['1.2.3.4', '5.6.7.8'];
  return allowedIPs.includes(ctx.ip);
},
```

**Note:** Only use if you have static IPs. Not recommended if you need mobile access.

## Security Monitoring

### Check Rate Limiting Status

The Strapi rate limiting provides headers in responses:

```bash
curl -I https://cms.fluentina.com/admin

# Response includes:
Rate-Limit-Total: 10
Rate-Limit-Remaining: 9
Rate-Limit-Reset: 1234567890
```

### Check Cloud Armor Status

```bash
# View security policy
gcloud compute security-policies describe writewise-security-policy \
  --project=writewise-468912

# View blocked requests (last hour)
gcloud logging read "resource.type=http_load_balancer AND jsonPayload.enforcedSecurityPolicy.name=writewise-security-policy AND jsonPayload.statusDetails=denied_by_security_policy" \
  --project=writewise-468912 \
  --freshness=1h
```

### Test Rate Limiting

**Test admin rate limit (should block after 10 requests):**
```bash
for i in {1..15}; do
  echo "Request $i"
  curl -I https://cms.fluentina.com/admin 2>&1 | grep -E "(HTTP|Rate-Limit)"
  sleep 1
done
```

Expected: First 10 succeed, requests 11-15 get HTTP 429

## Cost Implications

### Cloud Armor Pricing

**Current configuration cost (estimated):**
- Security policy: $6/month (flat fee)
- Rule evaluations: ~$0.75/month (100K requests)
- Rate limiting: Included

**Total estimated:** $7-10/month

**Note:** This is a small price for enterprise-grade security.

### Free Tier

- First 10M requests/month: No charge for rule evaluations
- You're well within free tier unless you get massive traffic

## Troubleshooting

### "Too many requests" error

**Cause:** Triggered rate limiting
**Solution:** Wait 1-10 minutes depending on which limit was hit

**Check which limit:**
- Immediate block (10 req/min) = Strapi middleware
- Block after 100 requests = Cloud Armor

### Legitimate traffic blocked

**Cause:** WAF rule too aggressive

**Solution:** Check logs to see which rule blocked:
```bash
gcloud logging read "resource.type=http_load_balancer AND jsonPayload.enforcedSecurityPolicy.name=writewise-security-policy" \
  --project=writewise-468912 \
  --limit=10
```

**Fix:** Contact me to adjust the specific rule

### Admin login issues

**Possible causes:**
1. Rate limit exceeded (wait 1 minute)
2. Wrong password
3. Network issue

**Debug:**
```bash
# Test connectivity
curl -I https://cms.fluentina.com/admin

# Check rate limit headers
curl -v https://cms.fluentina.com/admin 2>&1 | grep Rate-Limit
```

## Security Incident Response

### If you suspect an attack:

1. **Check Cloud Armor logs** (see above)
2. **Review Strapi logs:**
   ```bash
   gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=writewise-cms" \
     --project=writewise-468912 \
     --limit=100
   ```
3. **Temporarily tighten rate limits** if needed
4. **Review admin user list** for unauthorized accounts

### Emergency: Block specific IP

```bash
# Add IP to blocklist in Cloud Armor
gcloud compute security-policies rules create 100 \
  --security-policy=writewise-security-policy \
  --expression="origin.ip == '1.2.3.4'" \
  --action=deny-403 \
  --description="Block malicious IP" \
  --project=writewise-468912
```

## Summary

✅ **Your CMS is now protected by:**
- Application-level rate limiting (10 req/min admin, 100 req/min API)
- Infrastructure WAF (SQL injection, XSS, LFI protection)
- Rate-based bans (100 req/min = 10 min ban)
- HTTPS encryption
- Strapi authentication

✅ **You're safe to use `cms.fluentina.com` publicly**

⚠️ **Remember to:**
- Use strong admin passwords
- Keep Strapi updated
- Monitor logs occasionally

🔒 **Attack surface minimized while maintaining usability**

## Related Documentation

- [CUSTOM_DOMAIN_SETUP.md](./CUSTOM_DOMAIN_SETUP.md) - Domain and SSL configuration
- [Strapi Security Docs](https://docs.strapi.io/dev-docs/security)
- [Cloud Armor Docs](https://cloud.google.com/armor/docs)

## Questions?

If you have security concerns or want to adjust any settings, let me know!
