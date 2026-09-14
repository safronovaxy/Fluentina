import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
import { GuestFlowShell } from './GuestFlowShell';

/**
 * KAN-9 — stubbed out, not exercised for real here. LocaleSwitcher pulls in
 * next-intl's `useRouter`/`usePathname` (backed by `next/navigation`), which
 * has its own dedicated test file (LocaleSwitcher.test.tsx) with the
 * `next/navigation` mocking that needs. This suite is about the shell's own
 * structure (back link, step indicator, width classes) — unchanged by this
 * story except for what's asserted below — so it stubs the switcher rather
 * than dragging routing concerns into every test in the file.
 */
vi.mock('./LocaleSwitcher', () => ({
  LocaleSwitcher: () => <div data-testid="locale-switcher-stub" />,
}));

describe('GuestFlowShell', () => {
  it('renders its children inside the main content column', () => {
    renderWithIntl(
      <GuestFlowShell currentStepId="none">
        <p>Essay goes here</p>
      </GuestFlowShell>,
    );
    expect(screen.getByRole('main')).toHaveTextContent('Essay goes here');
  });

  it('excludes the marketing chrome and keeps a single main landmark', () => {
    renderWithIntl(
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
    renderWithIntl(
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
    renderWithIntl(
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
    renderWithIntl(
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
    renderWithIntl(
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
    renderWithIntl(
      <GuestFlowShell currentStepId="none" contentClassName="max-w-5xl">
        <p>content</p>
      </GuestFlowShell>,
    );
    const header = screen.getByRole('link', { name: 'Fluentina home' }).parentElement;
    expect(header?.className).toContain('max-w-5xl');
    expect(header?.className).not.toContain('max-w-3xl');
  });

  it('carries a variant-prefixed contentClassName width override to the header too', () => {
    // The width helper used to test tokens with a raw `startsWith('max-w-')`,
    // which fails on anything variant-prefixed or !important-marked —
    // sm:max-w-5xl, lg:max-w-7xl, !max-w-5xl all reach `main` via
    // contentClassName (asserted below) but never reached the header, so a
    // screen that only widens from a breakpoint got a header that stayed
    // capped at the unprefixed default: exactly the indented-header
    // misalignment this whole mechanism exists to prevent.
    renderWithIntl(
      <GuestFlowShell
        currentStepId="none"
        contentClassName="max-w-5xl sm:max-w-7xl md:!max-w-4xl"
      >
        <p>content</p>
      </GuestFlowShell>,
    );
    const main = screen.getByRole('main');
    const header = screen.getByRole('link', { name: 'Fluentina home' }).parentElement;
    expect(main.className).toContain('max-w-5xl');
    expect(main.className).toContain('sm:max-w-7xl');
    expect(header?.className).toContain('max-w-5xl');
    expect(header?.className).toContain('sm:max-w-7xl');
    // Tailwind v3 writes the important marker AFTER the variant, so this
    // shape slipped through when `!` was stripped before the variant split:
    // the content column widened and the header did not.
    expect(main.className).toContain('md:!max-w-4xl');
    expect(header?.className).toContain('md:!max-w-4xl');
  });

  it('leaves the header padding alone when contentClassName overrides padding', () => {
    // Only the width should carry over — a page passing px-0 for its content
    // gutter shouldn't silently strip the header's own padding too, since
    // the header isn't what contentClassName documents itself as touching.
    renderWithIntl(
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
    renderWithIntl(
      <GuestFlowShell currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.queryByRole('link', { name: 'Back' })).toBeNull();

    // Structural, not just "no link with that name": a permanently-rendered
    // empty spacer div in the back link's place would also satisfy the
    // assertion above while still reserving layout space. The header row's
    // only children should be the brand link and the step list — nothing
    // else, in either position.
    const headerRow = screen.getByRole('link', { name: 'Fluentina home' }).parentElement;
    expect(headerRow?.children).toHaveLength(2);
    expect(headerRow?.firstElementChild).toHaveAttribute('aria-label', 'Fluentina home');
    expect(headerRow?.lastElementChild).toHaveAttribute('aria-label', 'Guest essay flow progress');
  });

  it('renders a back link before the step indicator when backHref is given', () => {
    renderWithIntl(
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

    // Icon-only at every width (KAN-27 fix): the label is carried by
    // aria-label, never rendered as visible text — a visible "Back to
    // prompts" span would eat into the step list's width budget again, the
    // exact truncation bug this shape avoids. See GuestFlowShell.tsx.
    expect(back).not.toHaveTextContent('Back to prompts');
  });

  it('falls back to a default accessible label when backLabel is omitted', () => {
    renderWithIntl(
      <GuestFlowShell currentStepId="prompt" backHref="/practice/prompt">
        <p>content</p>
      </GuestFlowShell>,
    );
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute(
      'href',
      '/practice/prompt',
    );
  });

  it('KAN-14 — prefixes backHref with the active locale, same as every other in-flow link on this page', () => {
    // Nothing had passed backHref on a German screen before KAN-14's
    // essay-entry page — this pins the fix: plain next/link would render
    // the unprefixed path verbatim regardless of locale, silently dropping
    // a German guest back onto the English URL.
    renderWithIntl(
      <GuestFlowShell currentStepId="write" backHref="/practice" backLabel="Zurück">
        <p>content</p>
      </GuestFlowShell>,
      { locale: 'de' },
    );
    expect(screen.getByRole('link', { name: 'Zurück' })).toHaveAttribute('href', '/de/practice');
  });

  it('KAN-9 — renders the locale switcher on every guest-flow screen, above the header row', () => {
    // Above the header row (a separate bar), not inside it: the header's
    // step list is already at its pixel budget (see flow-steps.ts) — this
    // pins the switcher to a position that can't silently start competing
    // with it for width.
    renderWithIntl(
      <GuestFlowShell currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
    );
    const switcher = screen.getByTestId('locale-switcher-stub');
    const header = screen.getByRole('link', { name: 'Fluentina home' }).closest('header');
    expect(header).not.toBeNull();
    expect(
      switcher.compareDocumentPosition(header!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('KAN-9 — sets lang from the active locale on its own root, not just relying on <html>', () => {
    renderWithIntl(
      <GuestFlowShell currentStepId="none">
        <p>content</p>
      </GuestFlowShell>,
      { locale: 'de' },
    );
    // <html lang> stays "en" (root layout, outside the localised subtree —
    // see GuestFlowShell.tsx) — this is the shell asserting its own
    // language for assistive tech and translation tools regardless of that.
    expect(screen.getByRole('main').closest('[lang]')).toHaveAttribute('lang', 'de');
  });
});
