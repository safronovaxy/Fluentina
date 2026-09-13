// Vitest alias target for the `server-only` package (see vitest.config.ts).
//
// `server-only`'s real implementation throws unconditionally unless it is
// resolved via the `react-server` package-export condition — the condition
// Next's own bundler sets when compiling a Server Component, and which
// nothing in a Vitest run ever sets. Every module in `lib/db` and
// `lib/domain` starts with `import 'server-only'` per KAN-10's layering
// rule, so without this alias no data-layer test could import the code
// under test at all.
//
// This mirrors the package's own `react-server` export branch (`empty.js`
// — a deliberately empty module) rather than reproducing its throw: the
// guard's job is to stop this code from being bundled into a browser
// client, which is a build-time/bundler concern enforced instead by the
// `no-restricted-imports` ESLint rules in eslint.config.js. A test run is
// neither a client bundle nor evidence one way or the other, so it is the
// wrong place for this check to fire.
export {};
