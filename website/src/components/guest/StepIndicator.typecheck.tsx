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
