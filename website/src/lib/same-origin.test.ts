/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { isCrossOriginRequest } from './same-origin';

/**
 * Round-1 review (should-fix): this guard protects two routes
 * (`/api/guest-session`, `/api/essays`) on the strength of edge-case tests
 * that lived entirely inside one of them (`guest-session/route.test.ts`),
 * scoped to that route's own suite. Two mutants against this file —
 * reverting the null-collapse fix, and reversing the forwarded-host
 * precedence — were each killed by exactly one test there. Testing
 * `isCrossOriginRequest` directly here means both routes are protected by
 * the same guarantee regardless of which route's suite anyone happens to
 * run or trim; each route's own suite keeps exactly one integration-level
 * cross-origin test proving the guard is actually wired in.
 */
function req(headers: Record<string, string>, url = 'http://localhost:3000/api/essays'): NextRequest {
  return new NextRequest(new URL(url), { method: 'POST', headers });
}

describe('isCrossOriginRequest — Origin absent', () => {
  it('is not cross-origin when Origin is absent entirely — a same-origin fetch may omit it', () => {
    const request = req({ host: 'localhost:3000' });

    expect(isCrossOriginRequest(request)).toBe(false);
  });
});

describe('isCrossOriginRequest — ordinary same-origin and cross-origin requests', () => {
  it('is not cross-origin when Origin matches Host', () => {
    const request = req({ origin: 'http://localhost:3000', host: 'localhost:3000' });

    expect(isCrossOriginRequest(request)).toBe(false);
  });

  it('is cross-origin when Origin disagrees with Host', () => {
    const request = req({ origin: 'https://evil.example', host: 'localhost:3000' });

    expect(isCrossOriginRequest(request)).toBe(true);
  });
});

describe('isCrossOriginRequest — malformed Origin (post-approval hardening, KAN-10)', () => {
  it('is cross-origin for a malformed (unparseable) Origin, even alongside an otherwise-valid Host', () => {
    const request = req({ origin: 'not a url', host: 'localhost:3000' });

    expect(isCrossOriginRequest(request)).toBe(true);
  });

  it('is cross-origin for a malformed Origin with no Host or x-forwarded-host at all — absence on both sides must not collapse into a match (the null-collapse mutant)', () => {
    const request = req({ origin: 'not a url' });
    // NextRequest always carries some Host under the hood via the URL it's
    // constructed from in Node; strip it explicitly so neither header this
    // function reads is present, reproducing "no proxy header at all".
    request.headers.delete('host');

    expect(isCrossOriginRequest(request)).toBe(true);
  });
});

describe('isCrossOriginRequest — forwarded-host precedence (post-approval hardening, KAN-10)', () => {
  it('compares Origin against x-forwarded-host, not Host, when the two disagree', () => {
    const accepted = req({
      origin: 'https://fluentina.com',
      'x-forwarded-host': 'fluentina.com',
      host: 'evil.example',
    });
    const rejected = req({
      origin: 'https://evil.example',
      'x-forwarded-host': 'fluentina.com',
      host: 'evil.example',
    });

    expect(isCrossOriginRequest(accepted)).toBe(false);
    expect(isCrossOriginRequest(rejected)).toBe(true);
  });

  it('still rejects a genuinely foreign Origin even when x-forwarded-host is present and correct — proves the fix compares hosts, not merely stops checking once a forwarded-host header exists', () => {
    const request = req({
      origin: 'https://evil.example',
      'x-forwarded-host': 'fluentina.com',
    });

    expect(isCrossOriginRequest(request)).toBe(true);
  });
});

describe('isCrossOriginRequest — the real Cloud Run / output:standalone shape (round 2 review)', () => {
  // Next's `output: standalone` server builds `request.nextUrl` from the
  // container bind address (`HOSTNAME`/`PORT`), not from any header — so on
  // Cloud Run `request.nextUrl.origin` is always `https://0.0.0.0:8080`, a
  // value no real browser can ever send as `Origin`. These reproduce that
  // shape directly (a NextRequest whose URL is bound to `0.0.0.0:8080`,
  // nothing like the browser's real `Origin`) and prove the actual
  // comparison — Origin's host against `x-forwarded-host` — gets it right
  // in both directions regardless.
  it('accepts a same-origin request even when the request URL itself is bound to a different host than the browser Origin', () => {
    const request = req(
      { origin: 'https://fluentina.com', 'x-forwarded-host': 'fluentina.com' },
      'https://0.0.0.0:8080/api/essays',
    );

    expect(isCrossOriginRequest(request)).toBe(false);
  });

  it('still rejects a genuinely foreign Origin under the same bound-URL shape', () => {
    const request = req(
      { origin: 'https://evil.example', 'x-forwarded-host': 'fluentina.com' },
      'https://0.0.0.0:8080/api/essays',
    );

    expect(isCrossOriginRequest(request)).toBe(true);
  });
});
