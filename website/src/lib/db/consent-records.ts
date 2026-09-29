import 'server-only';

/**
 * KAN-20 / KAN-21 / KAN-22 — the consent trail's repository.
 *
 * APPEND-ONLY, and this file is where that is true in code: there is an
 * insert and a read, and no update or delete. A withdrawal is
 * `recordConsent(actor, { kind, documentVersion, granted: false })` — a new
 * row — never an edit of the row that recorded the grant. The current state of
 * a kind is its most recent row (`currentConsentState`); the earlier rows are
 * the history that answers "what had this person agreed to, and when".
 *
 * Registration writes its four rows through `insertConsentRecordsWithin`, in
 * the same transaction as the user insert (lib/db/users.ts). `recordConsent`
 * is the seam a later settings/withdrawal screen calls; nothing calls it yet.
 */
import { desc, eq } from 'drizzle-orm';
import { db, type Executor } from './client';
import { consentRecords } from './schema';
import type { UserActor } from '@/lib/contracts/actor';
import { isConsentKind, type ConsentKind } from '@/lib/contracts/consent';

export interface ConsentDecision {
  readonly kind: ConsentKind;
  readonly documentVersion: string;
  readonly granted: boolean;
}

export interface ConsentState extends ConsentDecision {
  readonly recordedAt: Date;
}

/** Registration's write: many rows, on the caller's transaction. */
export async function insertConsentRecordsWithin(
  executor: Executor,
  userId: string,
  decisions: readonly ConsentDecision[],
): Promise<void> {
  if (decisions.length === 0) return;
  await executor.insert(consentRecords).values(
    decisions.map((decision) => ({
      userId,
      kind: decision.kind,
      documentVersion: decision.documentVersion,
      granted: decision.granted,
    })),
  );
}

/** Appends one decision for `actor`. Never updates an earlier row. */
export async function recordConsent(actor: UserActor, decision: ConsentDecision): Promise<void> {
  await insertConsentRecordsWithin(db, actor.userId, [decision]);
}

/**
 * The current state per kind: the most recent row for each. Scoped on
 * `user_id` — one user cannot read another's consent trail.
 */
export async function currentConsentState(actor: UserActor): Promise<ConsentState[]> {
  const rows = await db
    .select()
    .from(consentRecords)
    .where(eq(consentRecords.userId, actor.userId))
    .orderBy(desc(consentRecords.recordedAt));
  const latest = new Map<ConsentKind, ConsentState>();
  for (const row of rows) {
    if (!isConsentKind(row.kind) || latest.has(row.kind)) continue;
    latest.set(row.kind, {
      kind: row.kind,
      documentVersion: row.documentVersion,
      granted: row.granted,
      recordedAt: row.recordedAt,
    });
  }
  return [...latest.values()];
}
