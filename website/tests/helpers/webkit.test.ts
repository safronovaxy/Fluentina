/**
 * KAN-33 round-1 review (Test Lead): `isWebKitOverPlainHttp` gates whether
 * three specs' worth of cookie assertions run at all (see this file's own
 * comment) — an over-skipping mutant (e.g. `return isPlainHttp || true`)
 * would make those tests report "skipped", not "failed", and a Playwright
 * skip is not a failure, so CI would stay green while silently exercising
 * nothing. No Playwright run exists to catch that shape of bug, so this is a
 * plain Vitest truth table over the exported predicate itself: every
 * WebKit/Chromium/Firefox × plain-HTTP/HTTPS combination that matters here.
 *
 * This file lives under tests/ (Playwright's own testDir), which
 * vitest.config.ts excludes wholesale so Playwright specs never get
 * collected by Vitest — see the narrow, name-pinned include added there for
 * this one file.
 */
import { describe, expect, it } from 'vitest';
import { isWebKitOverPlainHttp } from './webkit';

describe('isWebKitOverPlainHttp', () => {
  it('is true for WebKit over plain HTTP — the one case the skip exists for', () => {
    expect(isWebKitOverPlainHttp('webkit', true)).toBe(true);
  });

  it('is false for WebKit over HTTPS — the TLS-proxied CI path should run for real', () => {
    expect(isWebKitOverPlainHttp('webkit', false)).toBe(false);
  });

  it('is false for Chromium over plain HTTP — Chromium honours Secure cookies on localhost', () => {
    expect(isWebKitOverPlainHttp('chromium', true)).toBe(false);
  });

  it('is false for Chromium over HTTPS', () => {
    expect(isWebKitOverPlainHttp('chromium', false)).toBe(false);
  });

  it('is false for Firefox over plain HTTP — not a WebKit engine, so the skip must not apply', () => {
    expect(isWebKitOverPlainHttp('firefox', true)).toBe(false);
  });
});
