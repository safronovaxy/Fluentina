/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { clientIp } from './client-ip';

function requestWithXff(xff?: string): NextRequest {
  return new NextRequest(new URL('http://localhost:3000/api/essays'), {
    method: 'POST',
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
}

describe('clientIp — the production-correct reading of X-Forwarded-For (KAN-25)', () => {
  // Google's external Application Load Balancer over serverless NEGs (this
  // deployment's front door — see guest-session/route.ts's own comment)
  // APPENDS exactly two entries to whatever a caller supplied itself: the
  // connecting client's own IP, then the load balancer's. The real client is
  // therefore the SECOND-TO-LAST entry, never the last (that's always the
  // load balancer itself) and never blindly the first (that's whatever the
  // caller claimed, unverified) — see client-ip.ts's own comment for the
  // full reasoning and the explicit one-trusted-hop assumption this rests
  // on.
  it('reads the second-to-last entry as the real client — the shape a request actually arrives in behind the load balancer, with no caller-supplied prefix', () => {
    const ip = clientIp(requestWithXff('203.0.113.7, 34.120.0.1'));

    expect(ip).toBe('203.0.113.7');
  });

  it('still reads the second-to-last entry when a caller-supplied prefix is present — the load balancer APPENDS, it does not replace', () => {
    // A caller that set its own X-Forwarded-For before the request ever
    // reached the load balancer — the load balancer preserves it and adds
    // its own two entries after. Everything before the second-to-last is
    // exactly as unverified as a caller-controlled header can be; trusting
    // it would let any caller claim to be any IP at all.
    const ip = clientIp(requestWithXff('198.51.100.9, 203.0.113.7, 34.120.0.1'));

    expect(ip).toBe('203.0.113.7');
  });

  it('never trusts the LAST entry as the client — that is always the load balancer itself, identical for every request, which would collapse the entire per-IP backstop onto one shared bucket', () => {
    const ip = clientIp(requestWithXff('203.0.113.7, 34.120.0.1'));

    expect(ip).not.toBe('34.120.0.1');
  });

  // Round-2 (self-caught, verified against the real pipeline — see this
  // module's own comment): a single present hop used to be trusted as-is,
  // reasoned as "a caller explicitly presented SOMETHING". Measured
  // directly: Next.js's own server (`next start`) synthesises exactly this
  // shape — a single hop, `::1` — for every request with no proxy in front
  // of it, which is this codebase's actual local/CI posture. Trusting it
  // recreated the same shared-bucket collision a `null` fallback was
  // supposed to have already fixed (see the still-earlier, also-wrong
  // 'unknown' cut below). Fewer than two hops now means "cannot show this
  // came through the load balancer", full stop — not "trust whatever's
  // there".
  it('returns null for a single-hop value — cannot be shown to have passed through the load balancer\'s own append step', () => {
    const ip = clientIp(requestWithXff('203.0.113.7'));

    expect(ip).toBeNull();
  });

  // Round-1 (self-caught, verified against the real e2e pipeline — see this
  // module's own comment): this used to fall back to the shared literal
  // 'unknown', reasoned as "a fail-safe, not a bypass" — false in practice.
  // With no proxy in front of a local/CI Playwright run, EVERY request in
  // the entire suite shares this one bucket, and unrelated, earlier tests
  // exhausting it made later, correct tests fail with real 429s
  // (guest-flow.spec.ts, guest-session.spec.ts). `null` is what
  // `lib/domain/rate-limit.ts` now reads as "skip the IP-scoped check for
  // this request" rather than "count it against a shared placeholder".
  it('returns null when the header is absent entirely, rather than a shared placeholder identity', () => {
    const ip = clientIp(requestWithXff(undefined));

    expect(ip).toBeNull();
  });

  it('ignores surrounding whitespace around each comma-separated hop', () => {
    const ip = clientIp(requestWithXff('  203.0.113.7 ,  34.120.0.1  '));

    expect(ip).toBe('203.0.113.7');
  });
});
