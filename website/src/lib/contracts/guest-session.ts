/**
 * The persisted shape of a guest session, independent of how `lib/db` stores
 * it. Declared here rather than inferred from the Drizzle table (`lib/db`)
 * so this layer stays importable without pulling in the schema or the SQL
 * driver — see the ADR-14 layering note in CONTRIBUTING.md.
 */
import type { GuestSessionId } from './actor';

export interface GuestSession {
  /** The bearer session id itself; also the row's primary key. */
  readonly id: GuestSessionId;
  /** Set once the session is attached to a registered account (conversion). */
  readonly userId: string | null;
  readonly createdAt: Date;
  /** Null until conversion; the moment the old session id stops authorising reads. */
  readonly convertedAt: Date | null;
}
