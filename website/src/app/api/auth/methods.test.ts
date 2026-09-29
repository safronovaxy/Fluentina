/** @vitest-environment node */
import { describe, expect, it } from 'vitest';
import * as register from './register/route';
import * as login from './login/route';
import * as logout from './logout/route';

/**
 * The registered-session cookie is `SameSite=Lax`, which the browser DOES send
 * on top-level cross-site GET navigations (lib/registered-session-cookie.ts).
 * Every state-changing endpoint must therefore stay a POST: one that answered
 * GET could be triggered by a plain link. Nothing else enforces it — this does.
 */
describe('the auth routes answer POST and nothing else', () => {
  it.each([
    ['register', register],
    ['login', login],
    ['logout', logout],
  ])('/api/auth/%s exports POST and no other HTTP method handler', (_name, route) => {
    const handlers = Object.keys(route).filter((name) => ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(name));
    expect(handlers).toEqual([]);
    expect(typeof route.POST).toBe('function');
  });
});
