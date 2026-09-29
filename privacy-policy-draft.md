# Privacy Policy — content approved, NOT publishable yet

**Status: approved on content by Irina, 2026-09-29. Not published, not wired into the site.** Written to replace the existing policy, which describes a different product. Publication is tracked as **KAN-54**.

**Two separate things still stand between this and going live.**

**1. The `[FILL]` markers.** Publishing a policy that reads "[FILL — registered legal entity name]" would be worse than leaving the stale one up. These are blanks only Irina can fill: the legal entity and address, the supervisory authority, and the version and publication date. Items marked **[CHECK]** are things I could not verify from the code.

**2. No lawyer has read it.** I wrote it to be accurate about what the code actually does, which is the part I can verify. Whether that is *sufficient* under GDPR — and whether the Art. 6 legal bases I assigned are the right ones — is a judgement I am not qualified to make. Irina has accepted this knowingly for the POC stage; it is recorded as entry 3 on the **Known Gaps** page so that "approved" is not later mistaken for "reviewed". The transfer of essay text to a US provider is the part most worth paying someone to look at, and it compounds with Known Gaps entry 1.

---

## What changed from the current policy, and why

| Change | Reason |
|---|---|
| Added the entire guest flow | The current policy does not mention guests at all, yet a guest submitting an essay is the product's main processing activity and it happens before any account exists. |
| Added AI grading and the US transfer | Essay text is sent to Anthropic. Nothing disclosed this. KAN-21 requires it. |
| Removed "name" from account data | Registration collects email and password only. |
| Removed "lesson progress, exercise results" | Write-wise language. This product grades essays and runs a placement test. |
| Split retention by data type | Guest essays 30 days, logs 90 days, account data until deletion. One sentence could not carry that. |
| Added the 16+ requirement | KAN-21 makes it a registration condition; Art. 8 makes 16 the threshold in Germany. |
| Added automated processing | The product assigns a score by machine. Even where Art. 22 does not bite, silence about it in an AI product reads badly. |

---

# Privacy Policy

*Last updated: [FILL — publication date]*
*Version: [FILL — e.g. 2026-10-v1. This string gets recorded against every user's consent, so it must be stable and meaningful.]*

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
- **Placement test takers** — [CHECK — does the placement test collect an email address to send results? If so it needs its own paragraph here.]

## 3. What we collect, and when

### 3.1 If you use the service as a guest

- **A session identifier.** When you first visit the practice area, we place a randomly generated identifier in a cookie on your device. It contains nothing about you — it is a random value that lets us associate your essay with your browser so we can show you your own result. It is not used for tracking or advertising.
- **Your essay text.** The full text you submit, stored so it can be graded and shown back to you.
- **Your grading result.** The score, the per-area assessments, and the annotations tied to specific sentences of your essay.
- **The exact text sent to and received from the AI provider.** We retain the prompt we sent and the provider's raw response. This is kept so that grading quality can be audited and improved, and so a disputed score can be investigated.
- **Technical data.** Your IP address and standard server log data, used for security and to enforce rate limits.

We do not ask for your name, email address, or any other identifying information to grade an essay.

### 3.2 If you register

- **Your email address**, used to identify your account and to contact you about it.
- **Your password**, stored only as a cryptographic hash. We never store or have access to the password itself.
- **Your consent choices** — which version of these terms you accepted, whether you confirmed you are 16 or over, whether you opted into marketing, and the time of each. See Section 8.
- **Any essays you submitted as a guest in that browser**, which are attached to your new account when you register.

### 3.3 If you contact us

Your name, email address, and the content of your message, processed to answer you.

### 3.4 Payments

[CHECK — is Stripe live? The pricing page is currently unlinked from the site. If payments are not yet taken, delete this section; describing processing that does not happen is its own problem.]

Payments are processed by Stripe. We do not store full payment card details. Stripe's own privacy policy applies: [stripe.com/privacy](https://stripe.com/privacy).

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
| Marketing email | Art. 6(1)(a) — consent, freely given and separately obtained |
| Answering your enquiry | Art. 6(1)(f) — legitimate interests |
| Payment processing | Art. 6(1)(b) — performance of a contract |

[FILL — the legitimate-interests entries each require a balancing assessment on file. Ask your lawyer whether retaining raw AI responses is comfortably a legitimate interest or whether it is better placed under consent.]

## 6. How long we keep things

| Data | Retention |
|---|---|
| Guest essay, score and report, where no account is created | **Deleted 30 days after submission**, automatically |
| Guest essay attached to an account | Kept while the account exists |
| Account data (email, password hash, consent records) | Kept while the account exists |
| Prompt and raw AI response | [FILL — this is currently kept as long as the essay. Decide whether that is what you want, since it is a second copy of the essay text kept for a different purpose.] |
| Server logs | Up to 90 days |
| Rate-limit counters (a hashed identifier) | Roughly two hours |
| Consent records, after account deletion | Three years, linked only to a hash of your email |
| Database backups | **Six months** — deleted records remain recoverable from backups until they expire |
| Contact enquiries | [FILL] |

When you delete your account, your essays, scores and reports are deleted with it.

**Two things outlast that deletion, and you should know about both.**

**Backups.** Our database is backed up automatically, and those backups are kept for **six months**. A record you delete today remains in backups until the backup containing it expires. We do not restore backups in order to delete individual records; the data is removed from them as they expire.

**Your consent record.** We keep a record of which version of this policy you accepted and when, linked to a one-way hash of your email address rather than to your account or your address itself. We keep it for **three years**, then delete it. This is the only thing we retain, we retain it under Art. 17(3)(e) GDPR as evidence for the establishment or defence of legal claims, and it contains nothing you wrote.

**What we cannot delete.** Essay text you submitted was sent to our AI provider for grading (Section 4). We cannot delete the copy they hold — their retention is governed by their own terms. [FILL — state their retention period here once their DPA has been read. "We cannot delete it" is an honest answer; "we don't know what happens to it" is not.]

## 7. Who we share data with

| Recipient | Purpose | Location |
|---|---|---|
| **Anthropic** | AI grading of essay text | United States |
| **Google Cloud** | Hosting, database, file storage | EU (europe-west10, Berlin) |
| **Mailjet** | Transactional email | EU |
| **Stripe** | Payment processing [CHECK — only if live] | United States |

We do not sell your personal data, and we do not share it for advertising.

[CHECK — Mistral is present in the codebase as an alternative grading provider but is not currently in use. Do not list it until it is.]

## 8. Consent, and the 16+ requirement

To create an account you must:

- accept these terms and this policy, and
- confirm that you are **16 years of age or older**.

These are two separate, unticked choices. Marketing email is a third, entirely optional choice, never bundled with the other two and never pre-ticked.

We record which version of this policy you accepted and when, for each choice separately. Absence of a record means consent was not given — we never infer it.

We do not offer a parental-consent route, so if you are under 16 you cannot create an account.

You can withdraw marketing consent at any time without affecting your account.

## 9. Cookies

We use only cookies that are necessary for the service to function:

| Cookie | Purpose | Lifetime |
|---|---|---|
| Guest session | Associates your essay with your browser so you can see your own result | 30 days |
| Login session | Keeps you signed in | [FILL — 14 days per the current design] |

We use no analytics, tracking or advertising cookies, so we do not show a cookie consent banner. [CHECK — confirm nothing else on the marketing site sets one, including any embedded content.]

## 10. Your rights

Under the GDPR you have the right to access your data, to have it corrected, to have it erased, to restrict or object to processing, to receive it in portable form, and to withdraw consent where processing is based on it.

To exercise any of these, write to **contact@fluentina.com**.

**A note for guests:** because we deliberately collect nothing that identifies you, we usually cannot tell which essay is yours unless you still have the browser session it was submitted from. If you want a guest essay deleted, contact us from that browser and we will explain what we need. Guest essays are in any case deleted automatically after 30 days.

## 11. Complaints

You may lodge a complaint with a supervisory authority. [FILL — the competent authority is the one for the state your company is registered in, not the federal BfDI. The current policy names the BfDI, which is the authority for federal public bodies and is very likely wrong for you. For example, Berlin is the Berliner Beauftragte für Datenschutz und Informationsfreiheit.]

## 12. Security

We protect your data with encryption in transit, hashed password storage, access controls scoped so that one user's data cannot be read by another, and a web application firewall. No system is perfectly secure, but we treat your essay text as personal data throughout.

## 13. Changes

We may update this policy. Registered users will be notified by email of material changes. The version and date at the top of this page always identify the current text, and the version you consented to is recorded against your account.

## 14. Contact

**contact@fluentina.com**

---

## Open questions for you

1. **Legal entity, address, and supervisory authority.** Three blanks I cannot fill. The current policy names the BfDI, which I believe is wrong — that is the federal authority for public bodies, not for a private company.
2. **Anthropic's DPA and training terms.** Someone needs to read the actual agreement and confirm both the training position and the transfer safeguard. This is the single highest-value item on the list.
3. **Is Stripe live?** If not, cut Section 3.4 and the Stripe row.
4. **Placement test.** Does it collect an email to send results? It is a separate surface and I have not traced it.
5. **Raw AI responses.** We keep the exact prompt and response alongside the essay, which is effectively a second copy of the essay text kept for quality auditing. Legitimate interest is defensible but it is worth a deliberate decision rather than inheriting it from an implementation choice.
6. **German version — decided: English only, not a blocker.** Irina's position, and it is the right one: the users are German *learners*, so a B1 reader will understand English better than German, and many Goethe B2 candidates are native in neither.

   The one residual inconsistency: the site has a `/de` locale, and KAN-21's consent checkboxes will render in German because the message catalogue enforces both locales. So a German-speaking user reads German checkboxes and clicks through to an English policy. Cheapest resolution is a single German string noting the policy is available in English — not a legal translation. Worth revisiting only if there are ever paying German customers.
7. **The Strapi question.** The page prefers CMS content over the file. If a policy exists in Strapi, it is the live one and this draft has to replace that, not just the fallback.
