import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Button } from './button';

/**
 * The stock Button is a fixed-height, no-wrap pill, which crops a long label at
 * the viewport edge instead of wrapping it (the German register CTA ran ~480px
 * on a 393px phone). `size="cta"` is the named way out, so the next long label
 * is a one-word choice. jsdom does no layout, so this pins the classes; that the
 * label actually fits is tests/registration.spec.ts, in a real browser.
 */
afterEach(cleanup);

const classesOf = (size?: 'cta' | 'default' | 'sm' | 'lg' | 'icon') => {
  render(<Button size={size}>label</Button>);
  return screen.getByRole('button').className.split(/\s+/);
};

describe('Button size="cta"', () => {
  it('wraps and grows with its label: no fixed height, no no-wrap', () => {
    const classes = classesOf('cta');

    expect(classes).toContain('whitespace-normal');
    expect(classes).toContain('h-auto');
    expect(classes).toContain('text-center');
    expect(classes).not.toContain('whitespace-nowrap');
    expect(classes.filter((name) => /^h-(10|9|11)$/.test(name))).toEqual([]);
  });

  it('is an opt-in: every other size keeps the base no-wrap and its fixed height, so nothing else on the site changes', () => {
    for (const [size, height] of [
      [undefined, 'h-10'],
      ['default', 'h-10'],
      ['sm', 'h-9'],
      ['lg', 'h-11'],
      ['icon', 'h-10'],
    ] as const) {
      const classes = classesOf(size);
      expect(classes, String(size)).toContain('whitespace-nowrap');
      expect(classes, String(size)).toContain(height);
      expect(classes, String(size)).not.toContain('whitespace-normal');
      cleanup();
    }
  });
});
