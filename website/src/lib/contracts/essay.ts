/**
 * The persisted shape of an essay row. This story builds storage and
 * ownership only — word-count enforcement, grading, and the submission API
 * itself are KAN-14's job, not this one.
 */
import type { GuestSessionId } from './actor';

export interface Essay {
  readonly id: string;
  /**
   * The guest session that owns the essay while it is a guest's; NULL once it
   * belongs to an account — nulled at conversion, and never set on an essay a
   * registered user submits (KAN-52). Exactly one of `sessionId` and `userId`
   * is non-null (the `essays_exactly_one_owner` CHECK).
   */
  readonly sessionId: GuestSessionId | null;
  /** Set once the essay belongs to an account: at conversion, or at creation by a registered user. */
  readonly userId: string | null;
  readonly content: string;
  readonly createdAt: Date;
}
