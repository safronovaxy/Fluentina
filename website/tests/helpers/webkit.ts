/**
 * Shared WebKit-engine predicates.
 *
 * KAN-33 added a second WebKit project (`webkit-mobile`, alongside KAN-30's
 * `webkit-desktop`) and found the same bug shape in two places that each
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
 */
export function isWebKitOverPlainHttp(browserName: string, isPlainHttp: boolean): boolean {
  return browserName === 'webkit' && isPlainHttp;
}
