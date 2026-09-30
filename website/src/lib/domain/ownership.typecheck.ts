/**
 * Compile-only assertions, in the KAN-27 `*.typecheck` style (see
 * `lib/db/ownership.typecheck.ts` for how these files run: `tsc --noEmit` is
 * the only runner, and a `@ts-expect-error` that stops firing is the failure).
 *
 * KAN-52 widened `submitEssay` and `startGrading` from `GuestActor` to
 * `OwnerActor` so a registered user can submit. That widening must not also
 * admit the system actor, which owns nothing. These live on the domain side of
 * the layering boundary because they import domain modules; the `lib/db`
 * assertions for the same story stay in `lib/db/ownership.typecheck.ts`.
 */
import { submitEssay } from './essay-submission';
import { startGrading } from './grading/start-grading';
import type { GuestActor, SystemActor, UserActor } from '@/lib/contracts/actor';

declare const systemActor: SystemActor;
declare const guestActor: GuestActor;
declare const userActor: UserActor;

// @ts-expect-error — submitEssay persists under its actor; a SystemActor must be rejected.
submitEssay(systemActor, 'content');

// @ts-expect-error — startGrading is ownership-scoped (createGradingJob); a SystemActor must be rejected.
startGrading(systemActor, 'some-essay-id');

// Sanity check the assertions above are testing the right thing: both owner
// kinds must type-check in the same positions.
submitEssay(guestActor, 'content');
submitEssay(userActor, 'content');
startGrading(guestActor, 'some-essay-id');
startGrading(userActor, 'some-essay-id');
