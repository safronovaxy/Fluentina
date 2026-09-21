/**
 * KAN-25 — the client IP the per-IP rate-limit backstop counts against.
 * Plain adapter-level code, next to `same-origin.ts` (ADR-14 precedent: HTTP-
 * proxy-chain reasoning that isn't a domain rule, shared by more than one
 * route). Nothing reads this header anywhere else in the codebase today —
 * this is its first consumer, so the trust reasoning below has no precedent
 * to lean on and has to stand on its own.
 *
 * --- The hop-count assumption, stated explicitly (as this story's own
 * ticket requires of the rate-limit design as a whole) ---
 *
 * Production fronts Cloud Run with a Google external Application Load
 * Balancer over serverless NEGs — see `guest-session/route.ts`'s own comment
 * on this deployment's proxy chain, which already establishes that this
 * load balancer "manages `x-forwarded-for`". Concretely: it APPENDS exactly
 * two entries to whatever `X-Forwarded-For` a caller supplied itself —
 * the connecting client's IP, then the load balancer's own — so a request
 * that genuinely passed through it carries the shape `<client-controlled
 * prefix, however long or absent>, <real client IP>, <GFE IP>`: AT LEAST two
 * comma-separated entries, always. The real client is therefore the
 * SECOND-TO-LAST entry: the last is the load balancer itself (trustworthy
 * but useless here — identical for every request), and everything before
 * the second-to-last is exactly as unverified as `x-forwarded-host`
 * (`same-origin.ts`'s own caveat) — a caller can set it to anything.
 *
 * This function assumes exactly ONE trusted hop sits between the caller and
 * this application in whatever environment it runs in — true for production
 * today. If a later change ever puts a second trusted proxy in front of this
 * app (each one appending its own entry the same way), the fixed
 * second-to-last offset below has to move with it, in this one function —
 * the same "one place this assumption lives" discipline `same-origin.ts`
 * already follows for `forwardedHost`. As of this story, no such second hop
 * exists for production traffic; nothing here accounts for one.
 *
 * --- Fewer than two hops: treated as unidentified, not as a real single IP
 * ---
 *
 * Round-2 (self-caught, verified against the real pipeline, twice): the
 * first cut of this function fell back to a shared placeholder string when
 * the header was absent, and the second cut assumed "absent" was the only
 * untrustworthy shape and trusted a single present hop as-is. Both were
 * wrong, for the same underlying reason neither cut had actually confirmed:
 * Next.js's own server (`next start`, the standalone build this deployment
 * runs) SYNTHESISES `X-Forwarded-For` itself, from the raw socket, whenever
 * the incoming request doesn't already carry one — it does not leave the
 * header genuinely absent the way a bare Node `http` server would. Measured
 * directly against the built app with no proxy of any kind in front of it
 * (this codebase's own local dev and CI/e2e posture — see this deployment's
 * proxy chain): every such request arrives at THIS function already
 * carrying `x-forwarded-for: ::1` — the loopback peer address, a REAL,
 * present, single-hop value, not an absent header. The "fall back when
 * absent" branch that both earlier cuts relied on is unreachable here in
 * practice; the actual failure mode was that a single-hop value (synthesised
 * locally, or — just as easily — sent directly by any caller with no
 * load balancer involved at all) was being TRUSTED as a real, distinguishing
 * per-caller identity. Locally that collapsed the entire e2e suite (every
 * request, across every unrelated spec file, sharing one `::1` bucket) —
 * verified directly: `guest-flow.spec.ts` and `guest-session.spec.ts` failed
 * with real 429s from unrelated, earlier tests exhausting it first, twice,
 * once for each wrong assumption. In production the same shape is worse: a
 * caller hitting Cloud Run's default URL directly (bypassing the load
 * balancer entirely, if that's reachable — the same open gap
 * `same-origin.ts`'s `forwardedHost` caveat already carries, deferred to
 * KAN-28, not newly introduced here) could send ANY single-hop
 * `X-Forwarded-For` value and have it trusted outright — spoofable, not
 * merely locally confusing.
 *
 * The actual, load-bearing signal this deployment can trust is not "is the
 * header present" but "does it carry AT LEAST the two hops the load
 * balancer always appends for traffic that genuinely passed through it" —
 * fewer than two hops means this request cannot be proven to have gone
 * through the one trusted proxy this function's whole offset assumption
 * rests on, whether that's because nothing set the header at all, Next.js
 * synthesised a single local one, or a caller fabricated one directly.
 * `null` is what `lib/domain/rate-limit.ts` reads as "skip the IP-scoped
 * check for this request" — the per-session cap (always checked, never
 * skipped) still applies regardless.
 */
import type { NextRequest } from 'next/server';

export function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get('x-forwarded-for');
  if (!xff) return null;

  const hops = xff
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);

  // Fewer than two hops means this request cannot be shown to have actually
  // passed through the load balancer's own append step — see this module's
  // own comment above for why that, not mere presence/absence of the
  // header, is the real trust boundary. Nothing here treats a single-hop
  // value as a usable identity, unlike an earlier cut of this function.
  if (hops.length < 2) return null;

  return hops[hops.length - 2];
}
