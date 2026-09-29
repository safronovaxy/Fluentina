/**
 * KAN-20 / KAN-21 / KAN-22 — what a person can consent to at registration,
 * and which version of each document or wording is currently in force.
 *
 * Registration is the moment consent is captured, so this story cannot be
 * built without deciding what it writes: one `consent_records` row per kind
 * below, per registration (lib/db/schema.ts). Four kinds, four separate
 * rows, each with its own version and timestamp — never a boolean column on
 * `users`, and never one row standing for several choices.
 *
 * - `termsOfService`, `privacyPolicy`: the two documents (KAN-21 asks for one
 *   checkbox covering both; they are still two records, because the two
 *   documents change independently and "which privacy policy did this person
 *   agree to" must be answerable on its own).
 * - `ageDeclaration16Plus`: the self-declared "I am 16 or over". There is no
 *   parental-consent flow in Phase 1 — a person who cannot declare this
 *   simply cannot register; that is a known, accepted limitation, not an
 *   omission. The wording can change, so it is versioned like the rest.
 * - `marketingEmail`: independent of the three above. Optional, unticked by
 *   default, never bundled with or implied by any of them. The row is written
 *   even when the box is unticked (`granted = false`): that is affirmative
 *   evidence the choice was presented and declined, which a missing row is
 *   not.
 *
 * VERSIONS. The scheme is settled (coordinator, on Irina's behalf): a
 * `document_version` is the document's PUBLICATION date as `YYYY-MM-DD`, with
 * `-vN` appended only for a same-day correction (`2026-10-01`, then
 * `2026-10-01-v2`). No "privacy" or "terms" in the string — `kind` is already a
 * column, so each document versions independently. Not today's date and not the
 * date a change was merged: the date the text was published.
 *
 * A bare date cannot answer the question that actually gets asked — "who still
 * needs to re-accept?" — since a typo fix and a new sub-processor look
 * identical. So each kind has a REGISTRY of its versions carrying
 * `requiresReconsent` and a one-line `summary`, and `CURRENT_CONSENT_VERSIONS`
 * names the one in force.
 *
 * A registration request carries the version the client actually rendered; the
 * request schema (`auth.ts`) accepts only the current one, so a stale page left
 * open across a policy change is refused rather than recording an agreement to
 * text that is no longer in force. A client is expected to render from
 * `CURRENT_CONSENT_VERSIONS` and send back what it rendered. (No such form
 * exists yet — this is the contract one must satisfy.)
 *
 * ALL FOUR ARE PROVISIONAL, AND MUST BE REPLACED BEFORE LAUNCH. Irina's privacy
 * policy is a draft in review and unpublished, so its publication date does not
 * exist yet; the terms, the age wording and the marketing wording have no
 * settled publication dates either. `PROVISIONAL_CONSENT_VERSION` is
 * deliberately, obviously not a date — a plausible-looking date in a consent
 * record is worse than an obviously fake one, because it would be believed. A
 * consent row carrying it means "agreed to a draft". Replace each with the real
 * publication date, in the same change that publishes the text, and set its
 * `requiresReconsent` honestly.
 *
 * The legal text itself must never be read from the CMS for the purpose of
 * recording consent: a CMS edit would change the words while the version string
 * stayed put, making every consent row claim someone agreed to words they never
 * saw. How the exact published text is archived is not decided here.
 */
export const PROVISIONAL_CONSENT_VERSION = 'UNPUBLISHED-DRAFT';

export const CONSENT_KINDS = ['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus', 'marketingEmail'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** The kinds a person must grant to create an account. `marketingEmail` is deliberately not one. */
export const REQUIRED_CONSENT_KINDS = ['termsOfService', 'privacyPolicy', 'ageDeclaration16Plus'] as const;
export type RequiredConsentKind = (typeof REQUIRED_CONSENT_KINDS)[number];

export interface ConsentVersionEntry {
  /** `YYYY-MM-DD` publication date (`-vN` for a same-day correction), or the provisional placeholder. */
  readonly version: string;
  /** True when moving to this version means existing users must accept again (a new sub-processor); false for a typo fix. */
  readonly requiresReconsent: boolean;
  readonly summary: string;
}

/** Every version of each kind's text, oldest first. The last entry is the current one. */
export const CONSENT_VERSION_REGISTRY = {
  termsOfService: [
    { version: PROVISIONAL_CONSENT_VERSION, requiresReconsent: true, summary: 'Provisional — terms publication date not yet set' },
  ],
  privacyPolicy: [
    { version: PROVISIONAL_CONSENT_VERSION, requiresReconsent: true, summary: 'Provisional — draft policy covering AI grading, in review, unpublished' },
  ],
  ageDeclaration16Plus: [
    { version: PROVISIONAL_CONSENT_VERSION, requiresReconsent: true, summary: 'Provisional — "I am 16 or over" wording not yet published' },
  ],
  marketingEmail: [
    { version: PROVISIONAL_CONSENT_VERSION, requiresReconsent: true, summary: 'Provisional — marketing opt-in wording not yet published' },
  ],
} as const satisfies Record<ConsentKind, readonly ConsentVersionEntry[]>;

export const CURRENT_CONSENT_VERSIONS = {
  termsOfService: PROVISIONAL_CONSENT_VERSION,
  privacyPolicy: PROVISIONAL_CONSENT_VERSION,
  ageDeclaration16Plus: PROVISIONAL_CONSENT_VERSION,
  marketingEmail: PROVISIONAL_CONSENT_VERSION,
} as const satisfies Record<ConsentKind, string>;

/** True while any current version is still the placeholder — i.e. until the launch blocker above is cleared. */
export function hasProvisionalConsentVersions(): boolean {
  return CONSENT_KINDS.some((kind) => CURRENT_CONSENT_VERSIONS[kind] === PROVISIONAL_CONSENT_VERSION);
}

export function isConsentKind(value: unknown): value is ConsentKind {
  return (CONSENT_KINDS as readonly unknown[]).includes(value);
}
