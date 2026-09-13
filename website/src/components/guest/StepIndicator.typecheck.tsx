/**
 * KAN-27 — compile-time half of the generic StepIndicator/GuestFlowShell
 * type checks. Deliberately named so it matches neither vitest's
 * `src/**\/*.{test,spec}.{ts,tsx}` include glob (vitest.config.ts) nor
 * playwright's `tests/**` — this file runs no assertions and renders
 * nothing; its only job is to fail `tsc --noEmit` if the generic typing
 * regresses. Runtime coverage for the parts this can't reach (a `steps`
 * list without `as const`, so `id` widens to `string`) lives in
 * StepIndicator.test.tsx and GuestFlowShell.test.tsx instead.
 *
 * Not wired into any test runner on purpose — a `@ts-expect-error` line is
 * only meaningful under `tsc --noEmit`, which is run in CI and in this
 * story's own verification, not under vitest's esbuild transform (which
 * strips types and would never see the error either way).
 *
 * Also covers two follow-up findings on the generic itself (see the doc
 * comment on StepIndicatorProps for the reasoning): `steps={[]}` narrowing
 * `TStep` to `never` so only `currentStepId="none"` is accepted, and the
 * slice-vs-filter asymmetry, where a subset of the canonical list produced
 * by `.slice` is NOT caught (the type still carries every canonical id) but
 * the same subset produced by `.filter` with a matching type predicate IS.
 */
import { StepIndicator } from './StepIndicator';
import { GuestFlowShell } from './GuestFlowShell';
import { GUEST_FLOW_STEPS } from './flow-steps';

const CUSTOM_STEPS = [
  { id: 'alpha', label: 'Alpha' },
  { id: 'beta', label: 'Beta' },
] as const;

// --- Valid usages: must compile ---

// Default step list, no `steps` prop — currentStepId still narrowed to the
// canonical ids, exactly as before this story.
<StepIndicator currentStepId="prompt" />;
<StepIndicator currentStepId="none" />;
<GuestFlowShell currentStepId="prompt">{null}</GuestFlowShell>;

// Canonical list passed explicitly.
<StepIndicator steps={GUEST_FLOW_STEPS} currentStepId="write" />;
<GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepId="write">{null}</GuestFlowShell>;

// A caller-supplied, `as const` step list — currentStepId is checked
// against ITS ids, not the canonical list's.
<StepIndicator steps={CUSTOM_STEPS} currentStepId="alpha" />;
<GuestFlowShell steps={CUSTOM_STEPS} currentStepId="beta">{null}</GuestFlowShell>;

// `steps={[]}` — TStep infers as `never`, so 'none' is the only accepted
// currentStepId. This is an unannounced narrowing versus pre-KAN-27, where
// currentStepId was checked against the canonical list regardless of what
// (if anything) `steps` held.
<StepIndicator steps={[]} currentStepId="none" />;

// --- Invalid usages: must NOT compile ---
// Each of these is the KAN-27 bug: a canonical id (or an id from the wrong
// list) accepted against an unrelated `steps` list. If the generic typing
// regresses to the old independently-typed props, these `@ts-expect-error`
// lines stop being errors and `tsc --noEmit` fails on the unused directive.

// @ts-expect-error — 'prompt' is a canonical id, not one of CUSTOM_STEPS'.
<StepIndicator steps={CUSTOM_STEPS} currentStepId="prompt" />;

// @ts-expect-error — same mismatch, forwarded through GuestFlowShell.
<GuestFlowShell steps={CUSTOM_STEPS} currentStepId="prompt">{null}</GuestFlowShell>;

// @ts-expect-error — 'alpha' only exists on CUSTOM_STEPS, not the default.
<StepIndicator currentStepId="alpha" />;

// @ts-expect-error — a typo against the canonical list must still fail
// (regression guard: the pre-KAN-27 behaviour this generic must preserve).
<StepIndicator currentStepId="promt" />;

// @ts-expect-error — steps={[]} narrows TStep to `never`; any real step id,
// canonical or not, is now rejected, not just an unmatched one.
<StepIndicator steps={[]} currentStepId="prompt" />;

// NOT an @ts-expect-error, and that is the point: slicing a subset of the
// canonical list does not narrow currentStepId to the remaining ids.
// `.slice` on GUEST_FLOW_STEPS' type still returns the full element union
// (id included), so TypeScript has no way to see that 'register' was
// dropped. Documented as a known gap on StepIndicatorProps above, not
// silently "should be an error" — a filter with a matching type predicate
// (see the doc comment) is caught; a slice is not.
<StepIndicator steps={GUEST_FLOW_STEPS.slice(0, 3)} currentStepId="register" />;

// By contrast, a `.filter` whose callback TypeScript infers as a type
// predicate DOES narrow correctly and IS caught:
// @ts-expect-error — 'register' was filtered out of the list passed as `steps`.
<StepIndicator steps={GUEST_FLOW_STEPS.filter((s) => s.id !== 'register')} currentStepId="register" />;
