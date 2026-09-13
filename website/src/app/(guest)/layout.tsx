import type { Metadata } from 'next';

/**
 * Layout for the guest essay-submission flow (KAN-8 onward: landing,
 * prompt selection, essay entry, submission, preview, registration).
 * Intentionally no marketing Header/Footer — mirrors the existing
 * (placement-test) flow layout — because each step renders its own
 * focused chrome via <GuestFlowShell> (website/src/components/guest/).
 */

/**
 * noindex for the whole segment, not per page. The root layout asserts
 * index: true, and robots.ts does not disallow /practice, so any new screen
 * added under (guest) would otherwise ship indexable unless its author
 * remembered the override — a half-built essay-entry page in search results.
 *
 * Note this must stay a `noindex` tag rather than a robots.txt disallow: a
 * crawler has to be allowed to fetch the page in order to read the tag.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
export default function GuestFlowLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
