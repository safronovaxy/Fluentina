/**
 * Layout for the guest essay-submission flow (KAN-8 onward: landing,
 * prompt selection, essay entry, submission, preview, registration).
 * Intentionally no marketing Header/Footer — mirrors the existing
 * (placement-test) flow layout — because each step renders its own
 * focused chrome via <GuestFlowShell> (website/src/components/guest/).
 */
export default function GuestFlowLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
