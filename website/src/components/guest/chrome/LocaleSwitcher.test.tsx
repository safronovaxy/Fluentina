import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithIntl } from '@/test/renderWithIntl';
import { LocaleSwitcher } from './LocaleSwitcher';

/**
 * next-intl's navigation hooks (used by `@/i18n/navigation`, which
 * LocaleSwitcher builds on) are backed by `next/navigation`, which only
 * exists inside a real Next.js request — outside of it (as in this jsdom
 * unit test) `useRouter`/`usePathname` have no App Router to attach to.
 * Mocking the two hooks next-intl actually calls (see
 * node_modules/next-intl/.../createNavigation.js) is enough; nothing else
 * in this component touches `next/navigation` directly.
 */
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/practice',
  // Unused by LocaleSwitcher itself, but createNavigation() (src/i18n/
  // navigation.ts) also builds a `redirect` export off of these at module
  // load time, so they need to exist even though this test never calls them.
  redirect: vi.fn(),
  permanentRedirect: vi.fn(),
}));

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    replace.mockClear();
  });

  it('renders both locales from the catalogue, not literals', () => {
    // The bug this catches: hardcoding "EN"/"DE" (or "English"/"Deutsch")
    // directly in the component instead of calling t(code). If it were
    // hardcoded, this catalogue override would have no visible effect.
    renderWithIntl(<LocaleSwitcher />, {
      messages: { chrome: { localeSwitcher: { label: 'Language', en: '__EN_OVERRIDE__', de: '__DE_OVERRIDE__' } } },
    });
    expect(screen.getByRole('button', { name: '__EN_OVERRIDE__' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '__DE_OVERRIDE__' })).toBeInTheDocument();
  });

  it('marks the active locale and disables it, so it is not offered as a no-op switch', () => {
    renderWithIntl(<LocaleSwitcher />, { locale: 'en' });
    expect(screen.getByRole('button', { name: 'EN' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'DE' })).not.toBeDisabled();
    expect(screen.getByRole('button', { name: 'DE' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switching locale navigates to the same path under the other locale', () => {
    // This is the "switching locale actually changes rendered output"
    // acceptance criterion at the unit level: next-intl's router already
    // resolves the *current* path (`/practice`, from the mocked
    // usePathname above) into the target locale's URL — `/de/practice`,
    // not e.g. a hardcoded link back to the landing page — before calling
    // through to next/navigation's router.replace.
    renderWithIntl(<LocaleSwitcher />, { locale: 'en' });
    fireEvent.click(screen.getByRole('button', { name: 'DE' }));
    expect(replace).toHaveBeenCalledWith('/de/practice');
  });
});
