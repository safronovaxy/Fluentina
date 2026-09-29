import 'server-only';

/**
 * KAN-18 — the ownership-scoped essay read. Two callers need it:
 * - the preview page (`practice/preview/page.tsx`), for which
 *   `getOwnedEssay` is the ownership gate — `null` is its 404 — and
 * - `getGradingStatus`, which reads the essay lazily, only when it has a
 *   worked example to build, to cut that one sentence out server-side.
 * The grading status poll (`GET /api/essays/[id]/grading`) returns no
 * annotation offsets at any access level and never the essay text (KAN-19,
 * BR-4.2): the browser is sent the finished sentence, not the text and the
 * offsets to cut it with. Both reads go through the same `ownedBy()`-scoped
 * repository query everything else uses, rather than through a second
 * guest-facing endpoint that would return essay content.
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
