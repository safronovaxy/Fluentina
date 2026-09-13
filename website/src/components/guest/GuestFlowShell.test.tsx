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

  it('gives the header the same max-width as the content column by default', () => {
    // KAN-27: max-w-3xl used to be hardcoded independently on the header
    // container and on main, so the two could only agree by coincidence.
    render(
      <GuestFlowShell currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
    );
    const main = screen.getByRole('main');
    const header = screen.getByRole('link', { name: 'Fluentina home' }).parentElement;
    const mainWidthClass = main.className.split(' ').find((c) => c.startsWith('max-w-'));
    expect(mainWidthClass).toBe('max-w-3xl');
    expect(header?.className).toContain(mainWidthClass);
  });

  it('carries a contentClassName width override over to the header too', () => {
    // Without this, a screen that widens itself (contentClassName="max-w-5xl")
    // gets a header bar visually indented against its own, wider content.
    render(
      <GuestFlowShell currentStepId="none" contentClassName="max-w-5xl">
        <p>content</p>
      </GuestFlowShell>,
    );
    const header = screen.getByRole('link', { name: 'Fluentina home' }).parentElement;
    expect(header?.className).toContain('max-w-5xl');
    expect(header?.className).not.toContain('max-w-3xl');
  });

  it('leaves the header padding alone when contentClassName overrides padding', () => {
    // Only the width should carry over — a page passing px-0 for its content
    // gutter shouldn't silently strip the header's own padding too, since
    // the header isn't what contentClassName documents itself as touching.
    render(
      <GuestFlowShell currentStepId="none" contentClassName="px-0">
        <p>content</p>
      </GuestFlowShell>,
    );
    const header = screen.getByRole('link', { name: 'Fluentina home' }).parentElement;
    expect(header?.className).toContain('px-4');
    expect(header?.className).toContain('max-w-3xl');
  });

  it('renders no back link when backHref is omitted', () => {
    // Must degrade cleanly: no empty wrapper, no reserved space, nothing to
    // cause a layout shift once a later story starts passing backHref.
    render(
      <GuestFlowShell currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();
  });

  it('renders a back link before the step indicator when backHref is given', () => {
    render(
      <GuestFlowShell currentStepId="prompt" backHref="/practice/prompt" backLabel="Back to prompts">
        <p>content</p>
      </GuestFlowShell>,
    );
    const back = screen.getByRole('link', { name: 'Back to prompts' });
    expect(back).toHaveAttribute('href', '/practice/prompt');

    // "in the header before the step indicator" (KAN-27 AC) — assert the
    // actual DOM order, not just that both elements exist.
    const progress = screen.getByRole('list', { name: 'Guest essay flow progress' });
    expect(
      back.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('falls back to a default accessible label when backLabel is omitted', () => {
    render(
      <GuestFlowShell currentStepId="prompt" backHref="/practice/prompt">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/practice/prompt',
    );
  });
});
