import 'server-only';

/**
 * KAN-20 — generates a registered user's session token, and derives what the
 * database stores in its place.
 *
 * Same shape as `session-id.ts` (Web Crypto `getRandomValues`, hex, a branded
 * Zod self-check), with one difference that matters: 32 bytes, not 16. The
 * guest id's 128 bits were sized for one anonymous essay; this value unlocks an
 * account, so it gets 256. Never derived from anything about the visitor.
 *
 * `hashRegisteredSessionToken` is what `sessions.id` holds. PLAIN, UNSALTED
 * SHA-256, on purpose — see lib/db/sessions.ts for why a salt or a KDF here
 * would be a mistake, not an improvement. Comment kept in both places so
 * neither gets "fixed" to bcrypt in isolation.
 */
import { createHash } from 'node:crypto';
import {
  registeredSessionTokenHashSchema,
  registeredSessionTokenSchema,
  type RegisteredSessionToken,
  type RegisteredSessionTokenHash,
} from '@/lib/contracts/actor';

export function generateRegisteredSessionToken(): RegisteredSessionToken {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return registeredSessionTokenSchema.parse(token);
}

export function hashRegisteredSessionToken(token: RegisteredSessionToken): RegisteredSessionTokenHash {
  return registeredSessionTokenHashSchema.parse(createHash('sha256').update(token).digest('hex'));
}
