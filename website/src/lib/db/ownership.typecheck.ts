/**
 * Compile-only assertions, in the KAN-27 `*.typecheck` style: this file
 * renders and asserts nothing at runtime — `tsc --noEmit` (the `typecheck`
 * npm script) is its only runner. Neither Vitest's `include` glob nor
 * Playwright's `testDir` picks up `*.typecheck.*` files on purpose; a
 * `@ts-expect-error` line failing to fire is the only thing that would catch
 * a regression here.
 *
 * KAN-10's binding requirement: "exclude the system actor from the
 * ownership function at the type level." This proves `ownedBy` — and every
 * scoped repository function built on it — rejects a `SystemActor` at
 * compile time, not just by convention.
 */
import { ownedBy, type OwnedColumns } from './ownership';
import { getEssayById } from './essays';
import { getGuestSessionById } from './guest-sessions';
import type { SystemActor, GuestActor } from '@/lib/contracts/actor';

declare const systemActor: SystemActor;
declare const guestActor: GuestActor;
declare const columns: OwnedColumns;

// A SystemActor must not type-check against ownedBy()'s OwnerActor parameter.
// @ts-expect-error — SystemActor is not an OwnerActor; ownership does not apply to it.
ownedBy(systemActor, columns);

// The same exclusion must hold for every scoped repository function built on it.
// @ts-expect-error — getEssayById is scoped and must reject a SystemActor.
getEssayById(systemActor, 'some-essay-id');

// @ts-expect-error — getGuestSessionById is scoped and must reject a SystemActor.
getGuestSessionById(systemActor, 'some-session-id');

// Sanity check the assertions above are testing the right thing: a real
// OwnerActor must type-check fine in the same positions.
ownedBy(guestActor, columns);
