import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepIndicator, type GuestFlowStep } from './StepIndicator';

const STEPS: GuestFlowStep[] = [
  { id: 'a', label: 'Step A' },
  { id: 'b', label: 'Step B' },
  { id: 'c', label: 'Step C' },
];

describe('StepIndicator', () => {
  it('renders one list item per step, labelled for assistive tech', () => {
    render(<StepIndicator steps={STEPS} currentStepIndex={1} />);
    const list = screen.getByRole('list', { name: /guest essay flow progress/i });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks exactly the current step with aria-current="step"', () => {
    render(<StepIndicator steps={STEPS} currentStepIndex={1} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).not.toHaveAttribute('aria-current');
    expect(items[1]).toHaveAttribute('aria-current', 'step');
    expect(items[2]).not.toHaveAttribute('aria-current');
  });

  it('renders a check icon (aria-hidden) for completed steps, a number for the rest', () => {
    render(<StepIndicator steps={STEPS} currentStepIndex={2} />);
    const items = screen.getAllByRole('listitem');
    // Step A and B are before the current step (index 2) -> complete -> checkmark svg, no visible digit
    expect(items[0].querySelector('svg')).toBeInTheDocument();
    expect(items[1].querySelector('svg')).toBeInTheDocument();
    // Step C is the current step -> shows its 1-based number, not a checkmark
    expect(items[2]).toHaveTextContent('3');
    expect(items[2].querySelector('svg')).not.toBeInTheDocument();
  });

  it('marks no step as current or complete when currentStepIndex is -1 (not started)', () => {
    render(<StepIndicator steps={STEPS} currentStepIndex={-1} />);
    for (const item of screen.getAllByRole('listitem')) {
      expect(item).not.toHaveAttribute('aria-current');
      expect(item.querySelector('svg')).not.toBeInTheDocument();
    }
  });

  it('always renders the text label in the DOM (shown from sm: up via CSS, not JS)', () => {
    // Responsive behaviour here is CSS-only (Tailwind `hidden sm:inline`), not a
    // JS-measured breakpoint switch — jsdom doesn't evaluate media queries, so
    // what we can and should assert is that the label markup exists and carries
    // the expected responsive utility classes, at every viewport.
    render(<StepIndicator steps={STEPS} currentStepIndex={0} />);
    const label = screen.getByText('Step A');
    expect(label.className).toContain('hidden');
    expect(label.className).toContain('sm:inline');
  });
});
