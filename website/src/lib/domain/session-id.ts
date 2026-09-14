import 'server-only';

/**
 * Generates a guest session's bearer identifier.
 *
 * KAN-10 requirement: 128 bits from a cryptographically secure source,
 * never sequential, never derived from anything about the visitor (no IP,
 * user agent, timestamp, or counter folded in — any of those would make the
 * id guessable or correlatable). `crypto.randomBytes` is Node's CSPRNG; 16
 * bytes is exactly 128 bits, hex-encoded to the 32-character lowercase
 * string `guestSessionIdSchema` (lib/contracts/actor.ts) validates.
 *
 * Deliberately not `crypto.randomUUID()`: a v4 UUID spends 6 of its 128 bits
 * on fixed version/variant markers, leaving 122 bits of actual entropy —
 * close, but not the 128 this story specifies.
 *
 * Lives in `lib/domain`, not `lib/db`, because it is a business rule (what
 * makes a valid session id) with no SQL in it — issuing the id as a cookie
 * is a separate, later story (KAN-9 lands `src/middleware.ts` first).
 */
import { randomBytes } from 'node:crypto';
import { guestSessionIdSchema, type GuestSessionId } from '@/lib/contracts/actor';

export function generateGuestSessionId(): GuestSessionId {
  const id = randomBytes(16).toString('hex');
  // Self-check against the same schema a boundary would use to validate an
  // incoming value — if this ever drifted out of sync with the schema, the
  // failure is loud and immediate rather than a corrupt row landing in the
  // database.
  return guestSessionIdSchema.parse(id);
}
