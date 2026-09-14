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

  it('POSTs to /api/guest-session exactly once on mount — the Node-context trigger for the row middleware.ts cannot write', () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchSpy);

    render(<GuestSessionBootstrap />);

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
});
