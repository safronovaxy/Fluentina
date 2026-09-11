import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestFlowShell } from './GuestFlowShell';
import { GUEST_FLOW_STEPS } from './flow-steps';

describe('GuestFlowShell', () => {
  it('renders its children inside the main landmark', () => {
    render(
      <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepIndex={0}>
        <p>Step content</p>
      </GuestFlowShell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Step content');
  });

  it('renders a brand link back to the marketing homepage', () => {
    render(
      <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepIndex={0}>
        <p>content</p>
      </GuestFlowShell>,
    );
    const homeLink = screen.getByRole('link', { name: /fluentina home/i });
    expect(homeLink).toHaveAttribute('href', '/');
  });

  it('renders the full step list from the shared GUEST_FLOW_STEPS constant', () => {
    render(
      <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepIndex={0}>
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(GUEST_FLOW_STEPS.length);
  });

  it('caps content width and keeps safe side padding at every size (no native-app-only APIs)', () => {
    render(
      <GuestFlowShell steps={GUEST_FLOW_STEPS} currentStepIndex={0}>
        <p>content</p>
      </GuestFlowShell>,
    );
    const main = screen.getByRole('main');
    // max-w-3xl caps desktop reading width; px-4 keeps a >=16px gutter on
    // phones (widened via sm:px-6 above the sm breakpoint) — see the
    // artifact-design responsive-gutter rule this mirrors for the product UI.
    expect(main.className).toContain('max-w-3xl');
    expect(main.className).toContain('px-4');
    expect(main.className).toContain('sm:px-6');
  });
});
