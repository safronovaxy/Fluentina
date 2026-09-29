'use client';

/**
 * KAN-17 — the one monotonic "how long has this job been waiting" clock for
 * the pending screen. `GradingPreview` owns it and derives BOTH the shown
 * elapsed time and the "taking longer than we aim for" state from it, so the
 * two cannot disagree about what the job's age is.
 *
 * Why one source: `GradingStatus.jobAgeMs` is `server Date header - createdAt`
 * and is NOT monotonic across polls. The `Date` header has whole-second
 * resolution and consecutive polls can land on instances whose clocks differ,
 * so near a boundary one answer can say 60.4s and the next 59.8s. Shown
 * as-is that would step the clock back; used as-is for the slow state it
 * would empty the live region and refill it, and `aria-atomic` would read the
 * announcement out a second time. The floor below is what stops both: the
 * age this hook reports never decreases for an essay, whatever the answers
 * say.
 *
 * The elapsed time is the job's age on the SERVER's clock at the last answer,
 * carried forward by the client clock's DIFFERENCE between then and now — so
 * a guest's wrong system clock cannot skew it (see `advanceElapsed`).
 */
import { useEffect, useState } from 'react';

/**
 * The job's age now, never less than `floorMs` (what was already reported).
 * Pure: `jobAgeMs` is the age the last answer reported, `answeredAt` and
 * `now` are client-clock times and are only ever differenced (clamped at
 * zero, so a stale `now` from before the answer cannot subtract).
 */
export function advanceElapsed(floorMs: number, jobAgeMs: number, answeredAt: number, now: number): number {
  return Math.max(floorMs, jobAgeMs + Math.max(0, now - answeredAt));
}

const TICK_MS = 1000;

/**
 * `null` until an answer with an age has arrived (nothing true to say yet).
 * `jobAgeMs`/`answeredAt` are `GradingStatus.jobAgeMs` and the query's
 * `dataUpdatedAt`. The floor is per essay: it restarts when `essayId`
 * changes, so one essay's elapsed time is never shown for the next.
 *
 * Ticks (and so re-renders its caller) once a second, but only while there is
 * an age to advance — a finished job stops the timer.
 */
export function usePendingElapsed(essayId: string, jobAgeMs: number | null, answeredAt: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  // The floor lives in state, adjusted DURING render — React's sanctioned
  // "adjust state when props change" pattern: the render is discarded and
  // re-run at once, and nothing outside React is mutated while rendering.
  const [floor, setFloor] = useState({ essayId, ms: 0 });

  const active = jobAgeMs !== null;
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [active]);

  const base = floor.essayId === essayId ? floor.ms : 0;
  const elapsed = jobAgeMs === null ? null : advanceElapsed(base, jobAgeMs, answeredAt, now);
  const next = elapsed ?? base;
  if (floor.essayId !== essayId || floor.ms !== next) setFloor({ essayId, ms: next });

  return elapsed;
}
