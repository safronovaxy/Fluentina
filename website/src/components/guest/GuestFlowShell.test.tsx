import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GuestFlowShell } from './GuestFlowShell';

describe('GuestFlowShell', () => {
  it('renders its children inside the main content column', () => {
    render(
      <GuestFlowShell currentStepId="none">
        <p>Essay goes here</p>
      </GuestFlowShell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Essay goes here');
  });

  it('excludes the marketing chrome and keeps a single main landmark', () => {
    render(
      <GuestFlowShell currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Fluentina home' })).toHaveAttribute('href', '/');
  });

  it('forwards the current step id to the indicator', () => {
    // The shell's whole job as a foundation is passing this down. Asserting
    // only that the list exists meant hardcoding currentStepId="none" in the
    // shell left every test in the repo green, and every later screen would
    // have rendered with no step highlighted.
    render(
      <GuestFlowShell currentStepId="prompt">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.getByRole('list', { name: 'Guest essay flow progress' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Step 1 of 5: Prompt' })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('lets a screen opt out of the step indicator', () => {
    render(
      <GuestFlowShell steps={[]} currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.queryByRole('list', { name: 'Guest essay flow progress' })).toBeNull();
  });

  it('lets contentClassName override the default width, not stack with it', () => {
    // contentClassName is the shell's one prop with a real failure mode, and
    // the seam the next guest-flow story will actually use. tailwind-merge
    // means a conflicting utility REPLACES the default: passing max-w-5xl
    // drops max-w-3xl rather than producing both. Pinned here so KAN-13/14
    // discover the semantics from a test rather than from a broken layout.
    render(
      <GuestFlowShell currentStepId="none" contentClassName="max-w-5xl">
        <p>content</p>
      </GuestFlowShell>,
    );
    const main = screen.getByRole('main');
    expect(main.className).toContain('max-w-5xl');
    expect(main.className).not.toContain('max-w-3xl');
  });
});
