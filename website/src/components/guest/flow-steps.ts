export interface GuestFlowStep {
  /** Stable identifier, e.g. "prompt" — used as the React key and for tests. */
  id: string;
  /** Short label shown from the `md` breakpoint up, e.g. "Choose prompt". */
  label: string;
}

/**
 * Canonical step list for the guest essay flow, matching the User Flow
 * diagram (Confluence MFS-24805378) and the story sequence (KAN-13
 * prompt selection through KAN-20 registration). Stories land this list
 * one screen at a time — each new route imports GUEST_FLOW_STEPS and
 * passes its own step id to <GuestFlowShell>, rather than re-declaring the
 * step list.
 *
 * `as const` matters twice over: it derives GuestFlowStepId below, so an
 * unknown id is a compile error rather than a silently mis-highlighted
 * screen; and it makes the array readonly. As a plain mutable array, any
 * consumer could push to it, and on a long-lived Cloud Run instance that
 * mutation would persist across requests for every subsequent guest.
 */
export const GUEST_FLOW_STEPS = [
  { id: 'prompt', label: 'Choose prompt' },
  { id: 'write', label: 'Write essay' },
  { id: 'submit', label: 'Submit' },
  { id: 'preview', label: 'Preview score' },
  { id: 'register', label: 'Register' },
] as const satisfies readonly GuestFlowStep[];

export type GuestFlowStepId = (typeof GUEST_FLOW_STEPS)[number]['id'];
