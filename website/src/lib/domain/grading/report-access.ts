import 'server-only';

/**
 * KAN-19 (BR-4.2) — how much of a finished grade an actor is entitled to.
 *
 * The registration seam. A guest gets the teaser (`locked`); a registered
 * owner gets the whole result (`full`). Written as an exhaustive switch with
 * a `never` assertion on the default so a third kind of `OwnerActor` is a
 * compile error here, not a silent fall-through into either answer — and
 * `'locked'` is never reached by omission: the guest arm names it.
 *
 * This decides only ENTITLEMENT. Whether the actor may see this essay at all
 * is `lib/db`'s `ownedBy`, and a flagged result is withheld from everyone
 * whatever this returns (`getGradingStatus`) — neither rule lives here.
 */
import type { OwnerActor } from '@/lib/contracts/actor';

export function reportAccessFor(actor: OwnerActor): 'locked' | 'full' {
  switch (actor.kind) {
    case 'guest':
      return 'locked';
    case 'user':
      return 'full';
    default: {
      const unhandled: never = actor;
      throw new Error(`no report access rule for this actor kind: ${String(unhandled)}`);
    }
  }
}
