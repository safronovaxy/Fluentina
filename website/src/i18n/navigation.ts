import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Locale-aware navigation primitives (KAN-9), scoped to `routing` above.
 *
 * `Link` and `usePathname` are what `LocaleSwitcher` uses to jump to the
 * other locale's version of the *current* guest-flow screen rather than
 * always bouncing back to the landing page — `useRouter`/`redirect` are
 * exported for the same reason later guest-flow stories (KAN-13 onward)
 * need them, so they don't reach for plain `next/navigation` inside the
 * `[locale]` tree and silently drop the locale segment on a client-side
 * navigation.
 */
export const { Link, redirect, usePathname, useRouter } = createNavigation(routing);
