/**
 * The persisted shape of an essay row. This story builds storage and
 * ownership only — word-count enforcement, grading, and the submission API
 * itself are KAN-14's job, not this one.
 */
import type { GuestSessionId } from './actor';

export interface Essay {
  readonly id: string;
  /** The guest session an essay originated under — set for the row's whole lifetime, even after conversion. */
  readonly sessionId: GuestSessionId;
  /** Set once the owning session is converted to a registered account. */
  readonly userId: string | null;
  readonly content: string;
  readonly createdAt: Date;
}
