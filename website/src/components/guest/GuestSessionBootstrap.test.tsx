import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { GuestSessionBootstrap } from './GuestSessionBootstrap';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('GuestSessionBootstrap', () => {
  it('renders nothing', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null)));

    const { container } = render(<GuestSessionBootstrap />);

    expect(container).toBeEmptyDOMElement();
  });

  it('POSTs to /api/guest-session exactly once on mount, even under StrictMode\'s double-invoked effect — the guard this component exists to be', () => {
    // A plain, non-StrictMode render only ever calls the effect once
    // regardless of whether `firedRef` is there at all, so a render like
    // that never actually exercises the guard: deleting `firedRef` entirely
    // left a single-render version of this test green. StrictMode
    // double-invokes an effect (mount, cleanup, mount again) in development
    // specifically to surface exactly this class of bug, and it's the same
    // double-fire two tabs sharing a brand-new cookie or a double click can
    // produce for real — the case `lib/domain/guest-session.ts`'s own
    // unique-violation recovery exists to tolerate on the server side, and
    // the client-side half is this guard not sending the request twice at
    // all.
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchSpy);

    render(<GuestSessionBootstrap />, { wrapper: StrictMode });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('/api/guest-session', { method: 'POST' });
  });

  it('does not throw or retry within the same mount if the request fails — best-effort, per the component comment', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchSpy);

    expect(() => render(<GuestSessionBootstrap />)).not.toThrow();
    // Let the rejected promise's .catch() settle before asserting no retry.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('logs a non-ok response instead of swallowing it — review, round 2: a 400 resolves the fetch promise, .catch() alone never sees it', async () => {
    // This is the shape of the bug that actually shipped: the route
    // rejected every real browser request with a 400 (see route.ts's own
    // round-2 review note), and because a 400 is a RESOLVED response, not a
    // rejection, the old `.catch(() => {})` never ran and nothing was ever
    // logged — the failure was invisible end to end.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 400 })));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<GuestSessionBootstrap />);
    // Let the resolved promise's .then() settle before asserting.
    await Promise.resolve();
    await Promise.resolve();

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const [, detail] = consoleSpy.mock.calls[0] as [string, { status: number }];
    expect(detail).toEqual({ status: 400 });
    // Never the cookie value or the session id — see the component comment.
    expect(JSON.stringify(consoleSpy.mock.calls[0])).not.toMatch(/[0-9a-f]{32}/);

    consoleSpy.mockRestore();
  });

  it('does not log when the response is ok', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<GuestSessionBootstrap />);
    await Promise.resolve();
    await Promise.resolve();

    // Anchor: the effect actually fired and resolved a real (ok) response,
    // so the absence of a console.error below is evidence the ok branch is
    // silent — not just that the effect never ran at all.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
