import type { GuestFlowStep } from './StepIndicator';

/**
 * Canonical step list for the guest essay flow, matching the User Flow
 * diagram (Confluence MFS-24805378) and the story sequence (KAN-13
 * prompt selection through KAN-20 registration). Stories land this list
 * one screen at a time — each new route imports GUEST_FLOW_STEPS and
 * passes its own index to <GuestFlowShell>, rather than re-declaring the
 * step list.
 */
export const GUEST_FLOW_STEPS: GuestFlowStep[] = [
  { id: 'prompt', label: 'Choose prompt' },
  { id: 'write', label: 'Write essay' },
  { id: 'submit', label: 'Submit' },
  { id: 'preview', label: 'Preview score' },
  { id: 'register', label: 'Register' },
];
