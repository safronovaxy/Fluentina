import { IntlErrorCode, type IntlError } from 'next-intl';

/**
 * KAN-9 — the fail-loud policy for broken translations, shared by the
 * Server Component path (src/i18n/request.ts, `getTranslations`) and the
 * Client Component path (src/components/IntlProvider.tsx, `useTranslations`).
 *
 * Extracted into its own module, rather than hand-copied into both files,
 * because a review found the two copies had already drifted in spirit even
 * though the code was identical: nothing stopped a future edit to one from
 * not being mirrored in the other, which would mean a missing key failing
 * loudly on the server and silently in the browser (or vice versa) with
 * nothing but a human noticing to catch it. Both request.ts and
 * IntlProvider.tsx import these two functions directly instead of defining
 * their own.
 *
 * BLOCKING REGRESSION this also fixes: the original version of both files
 * rethrew *every* `IntlError`, not just ones that mean a broken catalogue.
 * `use-intl` emits `IntlErrorCode.ENVIRONMENT_FALLBACK` as an advisory —
 * not a bug — the first time a translation runs server-side in a process
 * with no configured global `timeZone` (or `format.relativeTime()` runs
 * with no global `now`), so it fired on literally the first guest request
 * to any freshly started server process. Rethrowing it turned that
 * one-line advisory into a crashed render — a 500 on the guest flow's own
 * entry page, on every cold start of a scale-to-zero Cloud Run service.
 * `src/i18n/request.ts` also sets a global `timeZone`, which stops the
 * advisory firing at its source for that specific case; this policy is the
 * second, defence-in-depth layer for whichever advisory code a future
 * `format` call still produces (e.g. `now` for `format.relativeTime()`,
 * which KAN-16's "graded 2 minutes ago" will need).
 *
 * Only these three codes mean the catalogue itself is actually broken —
 * the thing this story's "fail loudly on a missing/unknown key" acceptance
 * criterion is about:
 *  - MISSING_MESSAGE: the key doesn't exist in this locale's catalogue.
 *  - INSUFFICIENT_PATH: the key resolves to a nested object, not a leaf
 *    string (e.g. a namespace passed where a message key was expected).
 *  - INVALID_MESSAGE: the ICU message itself can't be parsed (e.g.
 *    unbalanced `{`).
 *
 * Every other code (`ENVIRONMENT_FALLBACK`, `MISSING_FORMAT`, `INVALID_KEY`,
 * `FORMATTING_ERROR`) is next-intl's own advisory or formatting-fallback
 * machinery, not a broken translation, and must never crash a guest's
 * render — it's logged for visibility instead.
 */
const FATAL_CODES: ReadonlySet<IntlErrorCode> = new Set([
  IntlErrorCode.MISSING_MESSAGE,
  IntlErrorCode.INSUFFICIENT_PATH,
  IntlErrorCode.INVALID_MESSAGE,
]);

export function isFatalIntlErrorCode(code: IntlErrorCode): boolean {
  return FATAL_CODES.has(code);
}

/**
 * next-intl's `onError` hook — called for every `IntlError`, fatal or not.
 * Metadata only in the log line (error code + message), never essay text or
 * account email, same as every other log line in this codebase.
 */
export function onIntlError(error: IntlError): void {
  if (isFatalIntlErrorCode(error.code)) {
    throw error;
  }
  console.error(`[i18n] ${error.code}: ${error.message}`);
}

/**
 * next-intl's `getMessageFallback` hook — called once a translation lookup
 * has already failed, immediately after `onError` above has already run for
 * the very same error (see `use-intl`'s `createTranslator`: every call site
 * that invokes this also calls `onError` first, in the same branch). Since
 * `onIntlError` already throws for every fatal code, this function is not
 * reachable via that path in practice — the actual thrown error a guest
 * would see for a missing key is the one `onIntlError` raises, not this
 * one's "Missing translation for ..." text.
 *
 * It's still defined, and still applies the same fatal/non-fatal split,
 * as defence-in-depth: `getMessageFallback` and `onError` are configured
 * independently in both `src/i18n/request.ts` and
 * `src/components/IntlProvider.tsx`, so nothing but this shared module
 * guarantees they agree, and a future change to either config (e.g.
 * someone reaching for next-intl's `fallback` param, which skips `onError`
 * for that one call — see `use-intl`'s `getFallbackFromErrorAndNotify`)
 * could make this the only thing standing between a broken key and a
 * silently rendered "namespace.key" string. Tested directly, independent
 * of `onIntlError`, in errorPolicy.test.ts and request.test.ts.
 */
export function intlMessageFallback({
  error,
  key,
  namespace,
}: {
  error: IntlError;
  key: string;
  namespace?: string;
}): string {
  const path = [namespace, key].filter(Boolean).join('.');
  if (isFatalIntlErrorCode(error.code)) {
    throw new Error(`Missing translation for "${path}"`);
  }
  return path;
}
