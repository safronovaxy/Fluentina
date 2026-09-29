import { describe, expect, it } from 'vitest';
import { resolveRegisteredSession } from './registered-session';

describe('resolveRegisteredSession — the KAN-20 seam', () => {
  it('finds no registered session today: there is no sign-in yet, and a cookie cannot conjure one', async () => {
    expect(await resolveRegisteredSession(() => 'anything-at-all')).toBeNull();
  });
});
