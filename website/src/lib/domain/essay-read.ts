import 'server-only';

/**
 * KAN-18 — the ownership-scoped essay read the guest preview screen needs.
 * The grading status poll (`GET /api/essays/[id]/grading`) returns
 * annotation offsets but deliberately not the essay text they index into,
 * so the screen that renders "your own sentence, with the error marked"
 * has to read that text from somewhere. It is read here, server-side, by
 * the page — through the same `ownedBy()`-scoped repository query
 * everything else uses — rather than by adding a second guest-facing
 * endpoint that would return essay content.
 *
 * Same ADR-14 seam shape as `grading-status.ts`: adapters import
 * `lib/domain`, never `lib/db`. `null` covers both "no such essay" and "not
 * yours", indistinguishably, as `getEssayById`'s own comment describes.
 */
import type { OwnerActor } from '@/lib/contracts/actor';
import type { Essay } from '@/lib/contracts/essay';
import { getEssayById } from '@/lib/db/essays';

export async function getOwnedEssay(actor: OwnerActor, essayId: string): Promise<Essay | null> {
  return getEssayById(actor, essayId);
}
