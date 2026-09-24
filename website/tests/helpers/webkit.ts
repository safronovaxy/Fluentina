/**
 * Shared WebKit-engine predicates.
 *
 * KAN-33 added a second WebKit project (`webkit-mobile`, alongside KAN-30's
 * `webkit-desktop`) and found the same bug shape in three places that each
 * independently keyed a WebKit-specific behaviour off `testInfo.project.name
 * === 'webkit-desktop'`: tests/guest-session.spec.ts, tests/essay-entry.spec.ts
 * and tests/word-count.spec.ts each guard, this way, a case where WebKit
 * cannot store the guest session's `__Host-`-prefixed cookie over plain HTTP
 * (see guest-session.spec.ts's own comment for the probe that established
 * it). Name-pinned to the one Safari project that existed when each was
 * written, all three would have silently stopped applying their skip on the
 * new project's plain-HTTP runs instead of extending to it — the exact class
 * of bug this story's own review flagged in tests/guest-flow.spec.ts's mobile
 * check, just for viewport instead of engine. `browserName` (a first-class
 * Playwright fixture) fixes it the same way: derive from the actual thing
 * that matters, not a name that happens to correlate with it today.
 */

/**
 * True when the current project's browser engine is WebKit and the
 * connection under test is plain HTTP.
 *
 * Round-2 review (SA): playwright.config.ts already throws at config-load
 * time if CI has an unencrypted BASE_URL (see the comment above that throw,
 * ~line 28), which means plain HTTP is supposed to be impossible in CI in
 * the first place. A mutant here (e.g. a spec hard-coding
 * `const isPlainHttp = true`) would otherwise silently skip that spec's
 * WebKit assertions in CI instead of failing loudly, with nothing to catch
 * it — a skip isn't a failure, and playwright.config.ts's throw only guards
 * its own BASE_URL check, not every caller of this predicate. So: if this
 * would ever return true while `process.env.CI` is set, that's not a
 * legitimate skip, it's evidence the "plain HTTP is impossible in CI"
 * invariant already broke somewhere upstream — throw instead of skipping.
 */
export function isWebKitOverPlainHttp(browserName: string, isPlainHttp: boolean): boolean {
  const result = browserName === 'webkit' && isPlainHttp;
  if (result && process.env.CI) {
    throw new Error(
      'isWebKitOverPlainHttp: WebKit over plain HTTP in CI. playwright.config.ts is supposed ' +
        'to make this impossible by throwing on an unencrypted BASE_URL in CI (see the comment ' +
        'above that throw) — reaching this means that invariant broke, or a spec is passing a ' +
        'hard-coded/miscomputed isPlainHttp instead of the real BASE_URL check. Either way this ' +
        "is a broken pipeline, not a WebKit test to silently skip.",
    );
  }
  return result;
}
