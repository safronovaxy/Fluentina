import 'server-only';

/**
 * Generates a guest session's bearer identifier.
 *
 * KAN-10 requirement: 128 bits from a cryptographically secure source,
 * never sequential, never derived from anything about the visitor (no IP,
 * user agent, timestamp, or counter folded in — any of those would make the
 * id guessable or correlatable). 16 bytes is exactly 128 bits, hex-encoded
 * to the 32-character lowercase string `guestSessionIdSchema`
 * (lib/contracts/actor.ts) validates.
 *
 * Deliberately not `crypto.randomUUID()`: a v4 UUID spends 6 of its 128 bits
 * on fixed version/variant markers, leaving 122 bits of actual entropy —
 * close, but not the 128 this story specifies.
 *
 * Web Crypto's `getRandomValues`, not `node:crypto`'s `randomBytes` (this
 * function's implementation until session issuance actually needed to run
 * somewhere): issuance (KAN-10, second half) mints this id from
 * `src/middleware.ts`, which runs on the Edge runtime, and Edge has no
 * `node:crypto` — importing it there throws at build time. `globalThis
 * .crypto` is the Web Crypto API, a CSPRNG in both runtimes (confirmed
 * against this repo's own Node 20, the version CI and docker-compose.yml
 * both pin — see the build/verification notes in the KAN-10 commit), so one
 * implementation now serves both the Edge-side mint and every Node-context
 * caller (route handlers, this file's own tests) without a second,
 * parallel generator to keep in sync.
 *
 * Lives in `lib/domain`, not `lib/db`, because it is a business rule (what
 * makes a valid session id) with no SQL in it. Issuing it as a cookie is
 * `src/middleware.ts`'s job (KAN-10); this function only ever returns a
 * value, never touches a cookie, a header, or the database.
 */
import { guestSessionIdSchema, type GuestSessionId } from '@/lib/contracts/actor';

export function generateGuestSessionId(): GuestSessionId {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  // Self-check against the same schema a boundary would use to validate an
  // incoming value — if this ever drifted out of sync with the schema, the
  // failure is loud and immediate rather than a corrupt row landing in the
  // database.
  return guestSessionIdSchema.parse(id);
}
