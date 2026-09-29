/**
 * KAN-20 — how long a registered session lives. Numbers only, in
 * `lib/contracts` because both `lib/db/sessions.ts` (which enforces them in
 * SQL) and `lib/registered-session-cookie.ts` (which must never let the
 * cookie outlive the row) need the same values, and neither may import the
 * other.
 *
 * - Absolute lifetime, 30 days: matches ADR-17, so a guest who converts is
 *   not on a shorter leash than they had as a guest.
 * - Idle timeout, 14 days: a session unused for this long stops
 *   authenticating even if its absolute expiry is still in the future.
 * - `last_used_at` is refreshed only when it is more than an hour stale.
 *   Refreshing on every authenticated request would be one write per request
 *   on the Postgres instance the CMS shares.
 *
 * Deliberately NOT derived from `guest-session-cookie.ts`'s constant: the
 * guest and registered lifetimes are different decisions that happen to
 * share a number today, and coupling them would make changing one silently
 * change the other.
 */
export const SESSION_ABSOLUTE_LIFETIME_DAYS = 30;
export const SESSION_IDLE_TIMEOUT_DAYS = 14;
export const SESSION_LAST_USED_REFRESH_HOURS = 1;
