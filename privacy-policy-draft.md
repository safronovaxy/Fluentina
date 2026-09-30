# Privacy Policy — content approved, NOT publishable yet

**Status: approved on content by Irina, 2026-09-29. Not published, not wired into the site.** Written to replace the existing policy, which describes a different product. Publication is tracked as **KAN-54**.

**Revised 2026-09-29 against `origin/main` at `fb217e2` (KAN-20 merged), after two independent code audits.** The blocker list below used to say three things. On the evidence it is seven. Each entry says what would clear it.

**1. The `[FILL]` markers.** Publishing a policy that reads "[FILL — registered legal entity name]" would be worse than leaving the stale one up. These are blanks only Irina can fill: the legal entity and address, the supervisory authority, and the version and publication date. **Cleared by:** Irina filling them. Items marked **[CHECK]** are things I could not verify from the code; each says what would settle it.

**2. One retention claim is not yet true.** The table below states that guest essays are *"deleted 30 days after submission, automatically"*. Nothing performs that deletion — KAN-11 was deferred to a later phase on 2026-09-29, and there is no scheduled-cleanup path anywhere in the codebase (`lib/db/schema.ts` says so in its own comments on both `rate_limit_counters` and `sessions`: the only sweeps that exist run on a write path, and no Cloud Scheduler job or cleanup endpoint has been built). Irina's decision is to **keep the wording**, because it describes the intended design, and to track the gap rather than soften the text. That is coherent while this document is unpublished. It is not coherent once it is live: at that point the policy would be making a factual claim about automated deletion that no code performs, which is worse than the current policy's omissions, because those are stale rather than false. So this is a **hard publication blocker** on KAN-54. **Cleared by:** the sweep shipping, or the wording being revisited before publishing. Recorded as Known Gaps entry 4.

**3. No lawyer has read it.** I wrote it to be accurate about what the code actually does, which is the part I can verify. Whether that is *sufficient* under GDPR — and whether the Art. 6 legal bases I assigned are the right ones — is a judgement I am not qualified to make. Irina has accepted this knowingly for the POC stage; it is recorded as entry 3 on the **Known Gaps** page so that "approved" is not later mistaken for "reviewed". The transfer of essay text to a US provider is the part most worth paying someone to look at, and it compounds with Known Gaps entry 1. **Cleared by:** a review by someone qualified, at minimum of Sections 4, 5 and 9.

**4. Account deletion has no implementation.** Section 10 tells you that you have the right to erasure and that the way to exercise it is to write to contact@fluentina.com. Writing to contact@ *is the entire mechanism*: there is no `deleteUser`, no erasure endpoint, and no admin path anywhere in the repository — the only routes under `website/src/app/api` are the three auth routes, the two essay routes, the guest-session route and the internal grading-job route. The `ON DELETE CASCADE` foreign keys in `lib/db/schema.ts` are real and would do the right thing, but nothing in the codebase triggers them. So "we will delete your account" is today a promise about a manual process that no code supports and no runbook describes. That is not automatically wrong — a manual process is a lawful process — but it is not what a reader would infer, and a one-month Art. 12(3) deadline has to be met by somebody. **Cleared by:** either shipping an erasure path, or writing down the manual procedure (who runs it, against what, within what time) and saying plainly in Section 10 that erasure is handled by hand.

**5. Every consent record currently says `UNPUBLISHED-DRAFT`.** `lib/contracts/consent.ts` sets `CURRENT_CONSENT_VERSIONS` for all four consent kinds to `PROVISIONAL_CONSENT_VERSION = 'UNPUBLISHED-DRAFT'`, deliberately, because this policy has no publication date yet. Section 13 below tells the reader "the version you consented to is recorded against your account". That is true of the mechanism and false of the value until the placeholder is replaced. Publishing this text without replacing it in the same change would leave every consent row claiming agreement to a draft. **Cleared by:** setting `CURRENT_CONSENT_VERSIONS.privacyPolicy` to the real publication date, with an honest `requiresReconsent`, in the commit that publishes.

**6. The placement test contradicts Section 8.** Section 8 says marketing is "a third, entirely optional choice, never bundled". The placement test — a live, publicly linked surface, in the header nav, the footer and the sitemap — collects first name, last name, email and phone behind a single checkbox reading "I consent to Fluentina contacting me about language learning services", and on submit subscribes that address to the Fluentina newsletter list and, where configured, to a placement-test list (`cms/src/api/placement-test/services/placement-test.ts`). You cannot take the test without ticking it. That is marketing consent bundled with the service, recorded nowhere in the versioned `consent_records` trail, against no document version. Section 3.4 and Section 8 below now describe this rather than smoothing it over, but describing it does not make Section 8's claim true of the whole product. **Cleared by:** either unbundling the placement test's marketing opt-in from taking the test, or narrowing Section 8's claim to the account flow — and a decision on which is Irina's, not mine.

**7. The consent banner does not gate everything the policy will say it gates.** `app/layout.tsx` sets Google Consent Mode v2 to deny by default and loads CookieYes to collect a choice, which is the right shape. But `lib/growthbook.ts`'s `getAnonymousId()` writes a random UUID to `localStorage` as `ww_anon_id` from `Providers.tsx`'s `useEffect`, on every page, before and regardless of any banner interaction, and GrowthBook then fetches flags from `cdn.growthbook.io`. There is no consent check anywhere in `analytics.ts`, `growthbook.ts`, `Providers.tsx` or `PageViewTracker.tsx` — grep for it and nothing comes back. Section 9 below says this explicitly rather than implying blanket gating. **Cleared by:** gating the `ww_anon_id` write and the GrowthBook load on the CookieYes choice, or a documented decision that this identifier is strictly necessary — which is a claim someone should have to defend.

---

## What changed from the current policy, and why

| Change | Reason |
|---|---|
| Added the entire guest flow | The current policy does not mention guests at all, yet a guest submitting an essay is the product's main processing activity and it happens before any account exists. |
| Added AI grading and the US transfer | Essay text is sent to Anthropic. Nothing disclosed this. KAN-21 requires it. |
| Removed "name" from account data | Registration collects email and password only (`lib/contracts/auth.ts`, `lib/db/users.ts`). |
| Removed "lesson progress, exercise results" | Write-wise language. This product grades essays and runs a placement test. |
| Split retention by data type | Guest essays 30 days, logs and backups per Section 6, account data until deletion. One sentence could not carry that. |
| Added the 16+ requirement | KAN-21 makes it a registration condition; Art. 8 makes 16 the threshold in Germany. |
| Added automated processing | The product assigns a score by machine. Even where Art. 22 does not bite, silence about it in an AI product reads badly. |
| **Added the placement test** | It is live, linked from the main nav, and collects name, phone and email — and enrols people in marketing lists. Neither policy mentioned it. |
| **Replaced "we run no analytics"** | False. The root layout loads GA4, a CookieYes banner and Consent Mode v2 on every page; GrowthBook runs experiments off a `localStorage` identifier. See Section 9. |
| **Removed payments** | Nothing under `website/src` takes a payment. The pricing page is unlinked (ADR-8) and the only Stripe code is the CMS pulling the price catalogue. |

---

# Privacy Policy

*Last updated: [FILL — publication date]*
*Version: [FILL — e.g. 2026-10-v1. This string gets recorded against every user's consent, so it must be stable and meaningful. It must be written into `lib/contracts/consent.ts` in the same change — see blocker 5.]*

## 1. Controller

The controller responsible for processing your personal data is:

**[FILL — registered legal entity name, e.g. "Fluentina GmbH"]**
[FILL — street address]
[FILL — postal code, city, country]

Email: contact@fluentina.com

[FILL — if you have appointed a Data Protection Officer, their contact details go here. Most companies this size are not required to appoint one; if you have not, delete this line rather than leaving it ambiguous.]

## 2. Who this policy covers

This policy applies whether or not you have an account:

- **Guests** — you can write and submit an essay for grading without registering. We process your data from the moment you submit.
- **Registered users** — you have created an account with an email address and password.
- **Placement test takers** — the placement test is a separate surface with its own data collection. It asks for your name, email address and optionally your phone number before you begin, and it emails you your result. See Section 3.4.
- **Anyone who visits the site at all** — analytics and experimentation run on every page, including the marketing pages and the practice area. See Sections 3.5 and 9.

## 3. What we collect, and when

### 3.1 If you use the service as a guest

- **A session identifier.** When you first visit the practice area, we place a randomly generated identifier in a cookie on your device. It contains nothing about you — it is a random value that lets us associate your essay with your browser so we can show you your own result. It is not used for tracking or advertising.
- **Your essay text.** The full text you submit, stored so it can be graded and shown back to you.
- **Your grading result.** The score, the per-area assessments, and the annotations tied to specific sentences of your essay.
- **The exact text sent to and received from the AI provider.** We retain the prompt we sent and the provider's raw response. This is kept so that grading quality can be audited and improved, and so a disputed score can be investigated.
- **Technical data.** Your IP address and standard server log data, used for security and to enforce rate limits. Our rate-limit counters record your IP address and your session identifier as they are, not in hashed form (Section 6), and a refusal is written to our server logs with a short fingerprint of the identifier that tripped it. That fingerprint is a truncated hash, and for an IP address it is **not anonymous**: the address space is small enough that the original address can be recovered from it in well under a second. We treat those log entries as personal data, and so should you.

We do not ask for your name, email address, or any other identifying information to grade an essay.

### 3.2 If you register

- **Your email address**, used to identify your account and to contact you about it.
- **Your password**, stored only as a cryptographic hash. We never store or have access to the password itself.
- **Your consent choices** — which version of these terms you accepted, which version of this policy, whether you confirmed you are 16 or over, whether you opted into marketing, and the time of each. These are recorded as four separate records, one per choice. See Section 8.
- **A login session record.** When you sign in we store a row identifying the session, so that signing out can genuinely end it. We store a hash of the session token, never the token itself.
- **Any essays you submitted as a guest in that browser**, which are attached to your new account when you register.

### 3.3 If you contact us

Your name, email address, and the content of your message, processed to answer you. The contact form does not write to our database: it sends your message as an email to our support inbox through Mailjet.

### 3.4 If you take the placement test

The placement test is a separate flow from the essay-grading service, and it collects more than the rest of the product does.

- **Before the test:** your **first name, last name, email address, optionally your phone number**, and the language you are testing in.
- **During the test:** your answers, including free-text written answers.
- **After the test:** your result — a CEFR level, dimension scores and a question-by-question analysis — which we email to the address you gave.

Two things about this you should know plainly:

- **Taking the test enrols you in our marketing lists.** The single checkbox on the first step reads "I consent to Fluentina contacting me about language learning services", and you cannot start the test without ticking it. On submission your address is added to the Fluentina newsletter list, and to a placement-test list where one is configured. This is a different arrangement from the account flow described in Section 8, where marketing is genuinely separable. It is recorded as a publication blocker on this document (blocker 6) rather than presented here as if it were intended.
- **Your answers leave this website.** They are passed through our CMS to the Fluentina app service for evaluation, and your result — which includes the per-question feedback — is sent to you as an email through Mailjet. See Section 7.

[CHECK — the placement test's evaluation runs in the Fluentina app service, which is a separate codebase not in this repository. Whether it uses an AI provider, which one, and in what country, cannot be established from here. If it does, Section 4 needs to cover it too. This is the single largest unverified surface in this document.]

### 3.5 If you simply browse the site

On every page of this site, including the marketing pages and the practice area, we run analytics and A/B experimentation. This means:

- **Google Analytics 4** receives an event when you load a page and when you move between pages.
- **A randomly generated identifier** is stored in your browser's `localStorage` under the name `ww_anon_id`. It is not derived from anything about you, but it is stable across visits and is what keeps you in the same experiment group. It is written on your first page load, before and regardless of any cookie-banner choice — see Section 9, which does not pretend otherwise.
- **GrowthBook** receives a request for the current experiment configuration and is told which experiment variant you were shown.

Section 9 sets out what is gated on your consent and what is not.

## 4. Automated grading, and the AI provider

**Your essay text is sent to a third-party AI provider to be graded.** This is the core of the service and cannot be opted out of while still using it.

- The provider we currently use is **Anthropic** (Claude), operating in the **United States**.
- Your essay is sent as content to be assessed. We do not send your email address, your name, or your account identifier with it.
- [CHECK — Anthropic's commercial terms state that API inputs are not used to train their models. Confirm this holds for the plan you are on, then state it here plainly, because it is the question a cautious user will actually have.]
- We may change provider. If we move to a provider in a different country, we will update this policy and, where the change is material, notify registered users.

**International transfer.** Sending your essay to the United States is a transfer outside the EEA. [FILL — name the safeguard you are relying on: Standard Contractual Clauses, or Anthropic's participation in the EU-US Data Privacy Framework if applicable. This needs checking against Anthropic's current DPA rather than assumed.]

**Automated processing.** Your score, your assessments and your annotations are produced by a machine, without a human reviewing them. This does not produce legal effects for you and does not restrict your access to anything outside this service, so it is not a decision within the meaning of Art. 22 GDPR. If you believe a score is wrong, write to us and a person will look at it.

**Detection of manipulation attempts.** We automatically check submitted text for attempts to instruct the AI to inflate a score. Where detected, the result is capped and flagged. This check runs on your essay text only.

## 5. Legal basis for each purpose (Art. 6 GDPR)

| Purpose | Legal basis |
|---|---|
| Grading an essay you submitted as a guest | Art. 6(1)(b) — steps taken at your request before entering a contract |
| Providing the service to a registered user | Art. 6(1)(b) — performance of a contract |
| Sending your essay to the AI provider | Art. 6(1)(b) — performance of a contract; it is the service |
| Retaining the prompt and raw AI response for quality auditing | Art. 6(1)(f) — legitimate interests in verifying and improving grading accuracy |
| Security, rate limiting, abuse prevention | Art. 6(1)(f) — legitimate interests |
| Running the placement test and emailing you your result | Art. 6(1)(b) — steps taken at your request before entering a contract |
| Adding you to a marketing list when you take the placement test | Art. 6(1)(a) — consent. [CHECK — as implemented this consent is bundled with taking the test and is not separable, which is the objection in blocker 6. Whether it is validly "freely given" under Art. 7(4) on those facts is exactly the question for a lawyer.] |
| Marketing email to registered users | Art. 6(1)(a) — consent, freely given and separately obtained |
| Answering your enquiry | Art. 6(1)(f) — legitimate interests |
| Analytics and A/B experimentation (Section 9) | Art. 6(1)(a) — consent, collected through the cookie banner. [CHECK — the `ww_anon_id` identifier is written before that consent is collected (blocker 7). Until that is fixed, this row describes the intent, not the behaviour.] |

[FILL — the legitimate-interests entries each require a balancing assessment on file. Ask your lawyer whether retaining raw AI responses is comfortably a legitimate interest or whether it is better placed under consent.]

## 6. How long we keep things

| Data | Retention |
|---|---|
| Guest essay, score and report, where no account is created | **Deleted 30 days after submission**, automatically — *intended design, not yet built; see blocker 2* |
| Guest essay attached to an account | Kept while the account exists |
| Account data (email, password hash, consent records) | Kept while the account exists |
| Prompt and raw AI response | [FILL — this is currently kept as long as the essay. Decide whether that is what you want, since it is a second copy of the essay text kept for a different purpose.] |
| Login session record | Expires 30 days after sign-in at the latest, or after 14 days without use, whichever comes first. Expired rows are deleted the next time someone signs in or registers. |
| Server logs | [CHECK — confirm against the actual GCP configuration. Nothing in this repository configures Cloud Logging retention: there is no infrastructure-as-code, and the only `retention` setting anywhere in `.github/` is `retention-days: 7` on a CI build artifact. The "90 days" this row used to state was inherited verbatim from the policy this replaces and is supported by nothing. Google Cloud's default for the `_Default` log bucket is 30 days, so the real figure is more likely 30. Do not publish a number until someone has looked at the project.] |
| Rate-limit counters (your IP address and session identifier, **stored as-is, not hashed**) | Deleted about two hours after the window closes, on the next request the service receives |
| Consent records | **Deleted with your account.** They cascade on account deletion and there is no archive. |
| Database backups | **Six months** — [CHECK — this is Irina's stated intent, not a verified setting. Nothing in this repository configures a Cloud SQL backup policy, and the GCP default retention for automated backups is around 7 days. Confirm against the actual instance configuration before publishing, and change the instance or the number so that they agree.] |
| Contact enquiries | Not stored in our database. Your message becomes an email in our support inbox, sent via Mailjet, and it lives there and in Mailjet's sending records. [CHECK — we have no mailbox retention policy; setting one would make this answerable.] |
| Placement test data | [CHECK — the lead details go to Mailjet lists and the answers go to the Fluentina app service. Neither is stored by this repository, so neither retention period can be established from here. The Mailjet list membership persists until you unsubscribe or are removed.] |

When you delete your account, your essays, scores, reports, grading jobs, login sessions and consent records are deleted with it — those cascades are real and correct. **But see blocker 4: nothing in the codebase currently triggers them.** Deletion today is a manual operation performed in response to an email.

**Several things outlast that deletion, and you should know about all of them.**

**Backups.** Our database is backed up automatically. A record you delete today remains in backups until the backup containing it expires. We do not restore backups in order to delete individual records; the data is removed from them as they expire. (The retention period is the `[CHECK]` in the table above.)

**Our AI provider's copy.** Essay text you submitted was sent to Anthropic for grading (Section 4). We cannot delete the copy they hold — their retention is governed by their own terms. [FILL — state their retention period here once their DPA has been read. "We cannot delete it" is an honest answer; "we don't know what happens to it" is not.]

**Analytics data.** The events sent to Google Analytics are held by Google under its own retention settings and are not linked to your account, so deleting your account does not remove them. [CHECK — the GA4 property's data-retention setting is configured in the Google Analytics console, not in this repository. Look it up and state it.]

**Mailjet.** Your contact enquiry, any placement-test report we emailed you, and any marketing-list membership live in Mailjet and in our support mailbox. Deleting a Fluentina account does not touch any of them; unsubscribing removes you from a list but does not delete the sending history.

**Rate-limit counters.** These have no link to your account — the table has no foreign key to `users` — so no account deletion reaches them. They expire on their own schedule (above), which is short, but it is not the account cascade doing it.

**Server logs.** Refusal log entries carry a fingerprint of the IP address or session identifier involved, which for an IP address is recoverable (Section 3.1). They are not linked to an account and are not deleted by account deletion; they age out on whatever retention the log store is actually set to.

## 7. Who we share data with

| Recipient | Purpose | Location |
|---|---|---|
| **Anthropic** | AI grading of essay text | United States |
| **Google Cloud** | Hosting, database, file storage | EU (europe-west10, Berlin) |
| **Google (Analytics 4)** | Website analytics — page views and experiment-exposure events | [CHECK — for EEA visitors the Google entity is normally Google Ireland Ltd, with onward transfer to the United States. Confirm from the GA4 account's own terms rather than assuming.] |
| **CookieYes** | The cookie-consent banner and the record of your consent choice | [CHECK — CookieYes is loaded from `cdn-cookieyes.com`; the contracting entity and its location must come from the CookieYes account, not from our code.] |
| **GrowthBook** | A/B experiment configuration and assignment | [CHECK — loaded from `cdn.growthbook.io`; confirm the entity and region from the GrowthBook account.] |
| **Mailjet** | Transactional email (contact enquiries, placement-test result emails) **and marketing lists** (the newsletter list and the placement-test list) | EU |
| **Fluentina app service** | Placement-test generation and evaluation — receives your free-text answers | [CHECK — this is a separate service reached at `WRITEWISE_APP_URL`; its hosting region is not set in this repository.] |

We do not sell your personal data. We do not share it for advertising, and we have not configured any advertising integration — though note that Google Consent Mode's `ad_storage` and `ad_personalization` signals are set on every page (Section 9) because the GA4 tag expects them, not because ads are running.

We do not take payments, so no payment processor receives your data. Our content system reads our price list from Stripe, but that is a catalogue lookup: no personal data of yours reaches Stripe.

[CHECK — Mistral is present in the codebase as an alternative grading provider but is not currently in use. Do not list it until it is.]

## 8. Consent, and the 16+ requirement

To create an account you must:

- accept these terms and this policy, and
- confirm that you are **16 years of age or older**.

These are two unticked choices as you see them on the form, and three records in our systems: your acceptance of the terms and your acceptance of this policy are stored separately, because the two documents change independently and "which privacy policy did this person agree to" has to be answerable on its own. Marketing email is a fourth, entirely optional choice, never bundled with the other three and never pre-ticked. If you leave it unticked we record that too — a record saying you declined, rather than no record at all.

We record which version of each document you accepted and when, for each choice separately. Absence of a record means consent was not given — we never infer it. Consent records are append-only: withdrawing adds a new record rather than erasing the old one, so the history stays answerable.

We do not offer a parental-consent route, so if you are under 16 you cannot create an account.

You can withdraw marketing consent at any time without affecting your account.

**The placement test is the exception, and we would rather say so than let you find out.** As described in Section 3.4, the placement test puts marketing consent and taking the test behind one checkbox, does not version it, and does not record it in the trail described above. That is inconsistent with everything in this section and it is recorded as a publication blocker on this document rather than presented as a design.

## 9. Cookies, analytics and experimentation

**We run analytics on every page of this site, and we show a cookie consent banner.**

### Cookies we set ourselves

| Cookie | Purpose | Lifetime |
|---|---|---|
| Guest session | Associates your essay with your browser so you can see your own result | 30 days |
| Login session | Keeps you signed in | 14 days, and never more than 30 days from sign-in |

### Analytics, consent and experimentation

Three third-party components load on every page, from the site's root layout:

- **Google Consent Mode v2** runs first and sets `ad_storage`, `analytics_storage`, `ad_user_data` and `ad_personalization` to **denied** by default, before anything else loads.
- **CookieYes** then shows the consent banner. Your choice updates those four signals.
- **Google Analytics 4** loads after the page, and respects whatever the signals say at that point. Until you consent, it is told not to store analytics cookies or advertising identifiers.
- **GrowthBook** runs our A/B experiments. It reads the `ww_anon_id` identifier described in Section 3.5, fetches the experiment configuration from `cdn.growthbook.io`, and reports which variant you were shown to Google Analytics as an `experiment_viewed` event.

**What is not gated, stated plainly.** The consent-mode signals control what *Google* stores. They do not control two other things, and today neither is gated on your banner choice:

- the `ww_anon_id` identifier is written to your browser's `localStorage` on your first page load, before you have answered the banner;
- the request to `cdn.growthbook.io` for experiment configuration is made regardless of your answer.

We consider this a defect rather than a design, and it is recorded as blocker 7 on this document. If you are reading this after publication and it is still here, it has not been fixed.

[CHECK — CookieYes itself sets cookies to remember your choice, and Google Analytics sets its own once you consent. Their exact names and lifetimes come from those two services' configuration, not from our code, and should be listed here before publication. A cookie table that omits the cookies the banner itself sets is not a cookie table.]

## 10. Your rights

Under the GDPR you have the right to access your data, to have it corrected, to have it erased, to restrict or object to processing, to receive it in portable form, and to withdraw consent where processing is based on it.

To exercise any of these, write to **contact@fluentina.com**.

**How that actually works today.** There is no button. Every one of these requests is handled by a person, by hand, in response to your email — there is no self-service deletion, no export endpoint and no admin tooling for any of it (blocker 4). We will respond within one month, as Art. 12(3) requires.

**A note for guests:** because we deliberately collect nothing that identifies you, we usually cannot tell which essay is yours unless you still have the browser session it was submitted from. If you want a guest essay deleted, contact us from that browser and we will explain what we need. Guest essays are also intended to be deleted automatically after 30 days — see the note on that row in Section 6.

## 11. Complaints

You may lodge a complaint with a supervisory authority. [FILL — the competent authority is the one for the state your company is registered in, not the federal BfDI. The current policy names the BfDI, which is the authority for federal public bodies and is very likely wrong for you. For example, Berlin is the Berliner Beauftragte für Datenschutz und Informationsfreiheit.]

## 12. Security

We protect your data with encryption in transit, hashed password storage, access controls scoped so that one user's data cannot be read by another, and a web application firewall. No system is perfectly secure, but we treat your essay text as personal data throughout.

## 13. Changes

We may update this policy. Registered users will be notified by email of material changes. The version and date at the top of this page always identify the current text, and the version you consented to is recorded against your account. (See blocker 5: the version string in the code is a placeholder until this text is published.)

## 14. Contact

**contact@fluentina.com**

---

## Open questions for you

1. **Legal entity, address, and supervisory authority.** Three blanks I cannot fill. The current policy names the BfDI, which I believe is wrong — that is the federal authority for public bodies, not for a private company.
2. **Anthropic's DPA and training terms.** Someone needs to read the actual agreement and confirm both the training position and the transfer safeguard. This is the single highest-value item on the list.
3. **Payments — resolved: not live, section cut.** Nothing under `website/src` takes a payment; the pricing page is unlinked from the nav (ADR-8) and the only Stripe code in the repository is the CMS reading the product catalogue from the Stripe API. Section 3.4's payment text and the Stripe row in Section 7 are gone. Put them back when checkout is built, not before.
4. **Placement test — resolved as a fact, open as a decision.** It collects name, phone and email, and it enrols people in marketing lists off a single bundled checkbox (Section 3.4, blocker 6). Whether to unbundle the opt-in or to narrow Section 8's promise is a product decision and it is yours.
5. **Raw AI responses.** We keep the exact prompt and response alongside the essay, which is effectively a second copy of the essay text kept for quality auditing. Legitimate interest is defensible but it is worth a deliberate decision rather than inheriting it from an implementation choice.
6. **German version — decided: English only, not a blocker.** Irina's position, and it is the right one: the users are German *learners*, so a B1 reader will understand English better than German, and many Goethe B2 candidates are native in neither.

   The one residual inconsistency: the site has a `/de` locale, and KAN-21's consent checkboxes will render in German because the message catalogue enforces both locales. So a German-speaking user reads German checkboxes and clicks through to an English policy. Cheapest resolution is a single German string noting the policy is available in English — not a legal translation. Worth revisiting only if there are ever paying German customers.
7. **The Strapi question — and a slug mismatch whoever publishes needs to know about.** The page prefers CMS content over the file. If a policy exists in Strapi, it is the live one and this draft has to replace that, not just the fallback. Note also that `app/(marketing)/privacy/page.tsx` fetches the Strapi page with slug **`privacy-policy`**, while the hard-coded fallback in that same file declares `slug: 'privacy'`. They disagree. Before publishing, establish which slug the live CMS entry actually uses — replacing the wrong one leaves the old text on the site while looking like a successful update.
8. **Logs and backups.** Both retention figures in Section 6 are now `[CHECK]`. The 90-day log figure came from the policy this replaces and is supported by nothing in the repository; the six-month backup figure is your stated intent, and the instance is very likely not configured to honour it. Someone with console access needs to either confirm both or change the configuration to match the text.
9. **The Fluentina app service.** Placement-test answers, including free text, are POSTed to it, and it is a codebase I cannot see. If it calls an AI provider — which the naming strongly suggests — Section 4 is incomplete and a second international transfer may be undisclosed.
