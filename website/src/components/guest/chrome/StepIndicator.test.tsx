import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
import { StepIndicator } from './StepIndicator';
import { GUEST_FLOW_STEPS } from '../flow-steps';

/**
 * Note on scope: jsdom has no layout and no media queries, so nothing here
 * can prove responsive behaviour. Asserting that a className string contains
 * "md:inline" only proves the literal is still in the source — it would pass
 * with Tailwind misconfigured, with the rule overridden, or with the layout
 * visibly broken. The viewport-differential assertions live in
 * tests/guest-flow.spec.ts, which runs in a real browser at two widths.
 *
 * What this file is for: the state machine, and the accessible names, which
 * are what every later guest-flow screen inherits.
 */
describe('StepIndicator', () => {
  it('renders one item per step', () => {
    renderWithIntl(<StepIndicator currentStepId="none" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(GUEST_FLOW_STEPS.length);
  });

  it('pins the canonical step order (Confluence MFS-24805378 user flow)', () => {
    // Compared against literals, not against GUEST_FLOW_STEPS: deriving the
    // expectation from the same constant that produced the render meant
    // dropping a step from the flow still passed.
    renderWithIntl(<StepIndicator currentStepId="none" />);
    expect(
      screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label')),
    ).toEqual([
      'Step 1 of 5: Prompt',
      'Step 2 of 5: Write',
      'Step 3 of 5: Submit',
      'Step 4 of 5: Preview',
      'Step 5 of 5: Register',
    ]);
  });

  it('marks exactly the current step with aria-current', () => {
    renderWithIntl(<StepIndicator currentStepId="write" />);
    const current = screen.getAllByRole('listitem').filter(
      (li) => li.getAttribute('aria-current') === 'step',
    );
    expect(current).toHaveLength(1);
    // No ", current step" suffix: aria-current carries that meaning already.
    expect(current[0]).toHaveAttribute('aria-label', 'Step 2 of 5: Write');
  });

  it('distinguishes complete, current and upcoming steps in text', () => {
    // The old version only ever rendered with the last step current, so no
    // fixture contained an upcoming step at all, and completion was conveyed
    // by icon and colour with nothing readable to assert.
    renderWithIntl(<StepIndicator currentStepId="submit" />);
    const items = screen.getAllByRole('listitem');
    const labels = items.map((li) => li.getAttribute('aria-label'));
    expect(labels[0]).toContain(', completed');
    expect(labels[1]).toContain(', completed');
    expect(labels[2]).not.toContain(', completed');
    expect(items[2]).toHaveAttribute('aria-current', 'step');
    expect(labels[3]).not.toContain(', completed');
    expect(labels[4]).not.toContain(', completed');

    // Assert what is RENDERED, not only the accessible name. The name is
    // computed independently, so deleting the isComplete branch — making a
    // finished step an identical grey numbered dot — left every assertion
    // above still passing.
    expect(items[0].querySelector('svg')).not.toBeNull();
    expect(items[0]).not.toHaveTextContent('1');
    expect(items[1].querySelector('svg')).not.toBeNull();
    expect(items[2].querySelector('svg')).toBeNull();
    expect(items[2]).toHaveTextContent('3');
    expect(items[3].querySelector('svg')).toBeNull();
    expect(items[3]).toHaveTextContent('4');
  });

  it('shows every step as upcoming before the flow starts', () => {
    renderWithIntl(<StepIndicator currentStepId="none" />);
    const items = screen.getAllByRole('listitem');
    expect(items.some((li) => li.getAttribute('aria-current') === 'step')).toBe(false);
    for (const li of items) {
      expect(li.getAttribute('aria-label')).not.toContain(', completed');
      expect(li.querySelector('svg')).toBeNull();
    }
  });

  it('numbers upcoming steps rather than leaving them blank', () => {
    // The landing page renders with no current step, so every dot is an
    // upcoming one. Without this, rendering nothing for upcoming steps — five
    // blank circles on the one screen this story ships — passed every test.
    renderWithIntl(<StepIndicator currentStepId="none" />);
    const items = screen.getAllByRole('listitem');
    items.forEach((li, i) => expect(li).toHaveTextContent(String(i + 1)));
  });

  it('renders nothing when given an empty step list', () => {
    const { container } = renderWithIntl(<StepIndicator steps={[]} currentStepId="none" />);
    // An empty <ol> with a progress label is worse than no indicator for a
    // screen that wants none, e.g. an error or session-expiry page.
    expect(container.querySelector('ol')).toBeNull();
  });

  /**
   * KAN-27 — steps is now generic (TStep extends GuestFlowStep), so
   * currentStepId's type derives from whatever `steps` list is actually
   * passed rather than always from the canonical GUEST_FLOW_STEPS. These are
   * runtime tests of that; see StepIndicator.typecheck.tsx for the
   * compile-time half — a mismatched currentStepId against a `steps` list
   * that keeps its literal id types (via `as const`) is a type error, which
   * a runtime test can't demonstrate on its own.
   */
  describe('KAN-27 — custom step lists', () => {
    const CUSTOM_STEPS = [
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' },
    ] as const;

    it('highlights the matching id in a caller-supplied step list', () => {
      renderWithIntl(<StepIndicator steps={CUSTOM_STEPS} currentStepId="beta" />);
      expect(screen.getByRole('listitem', { name: 'Step 2 of 2: Beta' })).toHaveAttribute(
        'aria-current',
        'step',
      );
    });

    it('warns in development when currentStepId matches nothing in the supplied list', () => {
      // The exact bug this story fixes: a `steps` list with no `as const`
      // widens `id` to plain `string`, so `currentStepId="prompt"` compiles
      // cleanly (it's a valid canonical id) even though it matches nothing
      // in `nonLiteralSteps` — no `as any` needed, that's what makes it a
      // silent bug rather than a caught one. This is the runtime safety net
      // for exactly that gap; the const-list case is caught at compile time
      // instead (see StepIndicator.typecheck.tsx).
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const nonLiteralSteps = [{ id: 'alpha', label: 'Alpha' }];
      const { container } = renderWithIntl(
        <StepIndicator steps={nonLiteralSteps} currentStepId="prompt" />,
      );

      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain('prompt');
      // Assert the absence of the STATE, not of an unrelated label: the
      // supplied list only has an "alpha" step, so `queryByRole('listitem',
      // { name: /Prompt/ })` being null is trivially true under any
      // implementation, including a "be forgiving, highlight step 1 on no
      // match" one — which is the wrong behaviour this warning exists to
      // flag, and which this assertion would have missed entirely.
      expect(container.querySelector('[aria-current="step"]')).toBeNull();
      warn.mockRestore();
    });

    it('does not warn when currentStepId is "none" or matches an actual step', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      renderWithIntl(<StepIndicator steps={CUSTOM_STEPS} currentStepId="none" />);
      renderWithIntl(<StepIndicator steps={CUSTOM_STEPS} currentStepId="alpha" />);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not warn in production even when currentStepId matches nothing', () => {
      // Deleting the `process.env.NODE_ENV !== 'production' &&` guard left
      // 21/21 green before this test existed — nothing exercised the
      // production branch in either direction. This is the "still silent in
      // prod" half; the case above is the "still warns in dev" half.
      vi.stubEnv('NODE_ENV', 'production');
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const nonLiteralSteps = [{ id: 'alpha', label: 'Alpha' }];
      renderWithIntl(<StepIndicator steps={nonLiteralSteps} currentStepId="prompt" />);

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      vi.unstubAllEnvs();
    });
  });
});

/**
 * KAN-9 — i18n architecture. These pin the acceptance criteria directly:
 * strings come from the message catalogue rather than being literals in the
 * component, switching locale changes what's rendered, and a broken/missing
 * catalogue entry fails loudly rather than rendering silently as an empty
 * string or the raw "namespace.key".
 */
describe('StepIndicator — KAN-9 i18n', () => {
  it('renders the catalogue value, not a hardcoded literal', () => {
    // The bug this catches: hardcoding 'Guest essay flow progress' back into
    // StepIndicator.tsx instead of calling t('progressLabel'). If that
    // literal were still there, overriding the catalogue value below would
    // have no effect and this assertion would fail.
    renderWithIntl(<StepIndicator currentStepId="none" />, {
      messages: {
        chrome: {
          guest: {
            progressLabel: '__CATALOGUE_OVERRIDE__',
            stepAriaLabel: '{label}',
            steps: { prompt: 'Prompt', write: 'Write', submit: 'Submit', preview: 'Preview', register: 'Register' },
          },
        },
      },
    });
    expect(screen.getByRole('list', { name: '__CATALOGUE_OVERRIDE__' })).toBeInTheDocument();
  });

  it('renders German labels when the locale is de, English when en — same component, same props', () => {
    const { unmount } = renderWithIntl(<StepIndicator currentStepId="write" />, { locale: 'en' });
    expect(screen.getByRole('list', { name: 'Guest essay flow progress' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Step 2 of 5: Write' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    unmount();

    renderWithIntl(<StepIndicator currentStepId="write" />, { locale: 'de' });
    expect(
      screen.getByRole('list', { name: 'Fortschritt im Gast-Aufsatzablauf' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Schritt 2 von 5: Schreiben' })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });

  it('marks the completed suffix through the German select case, not English concatenation', () => {
    // A word-for-word ", completed" suffix bolted onto a translated label
    // would render nonsense in German. This pins that the suffix itself
    // comes from the same catalogue entry (an ICU `select`), not a shared
    // English string.
    renderWithIntl(<StepIndicator currentStepId="submit" />, { locale: 'de' });
    expect(screen.getByRole('listitem', { name: 'Schritt 1 von 5: Thema, abgeschlossen' })).toBeInTheDocument();
  });

  it('fails loudly — throws — on a missing catalogue key, rather than rendering an empty string or the raw key', () => {
    // Constructs the exact bug this guards: a key present in `en.json` but
    // dropped from `de.json` (e.g. a translator missed one). Without the
    // onError/getMessageFallback wiring in IntlProvider, next-intl's default
    // behaviour is to log via console.error and silently render the literal
    // string "chrome.guest.progressLabel" in its place.
    //
    // Matches the specific message, not a bare `toThrow()`: a bare
    // `toThrow()` passes on ANY thrown error, including an unrelated render
    // error that has nothing to do with the missing key this test
    // constructs — it would still pass if the fail-loud wiring were deleted
    // outright, as long as something else in the tree happened to throw.
    //
    // Asserts on the *key path*, not the exact wording: `onIntlError` (see
    // src/i18n/errorPolicy.ts) rethrows next-intl's own `IntlError` as-is
    // rather than replacing it with a hand-written string, since it's
    // already both accurate and more informative (it names the locale
    // too). `intlMessageFallback`'s own "Missing translation for ..."
    // wording is independently tested (errorPolicy.test.ts) — it is not
    // reachable here because `onError` always runs first, for the same
    // error, and throws before `getMessageFallback` is ever called.
    const messagesMissingProgressLabel = {
      chrome: { guest: { steps: { prompt: 'Prompt' } } },
    };
    expect(() =>
      renderWithIntl(<StepIndicator currentStepId="none" />, {
        messages: messagesMissingProgressLabel,
      }),
    ).toThrow(/chrome\.guest\.progressLabel/);
  });
});
