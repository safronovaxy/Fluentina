import type { Metadata } from 'next';
import { strapiClient } from '@/lib/strapi';
import PageContent from '@/page-components/Page';
import type { Page } from '@/types/strapi';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'Read the Fluentina Privacy Policy to understand how we collect, use and protect your personal data.',
  alternates: {
    canonical: 'https://fluentina.com/privacy',
  },
  openGraph: {
    title: 'Privacy Policy | Fluentina',
    description: 'Read the Fluentina Privacy Policy to understand how we collect, use and protect your personal data.',
    url: 'https://fluentina.com/privacy',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const STATIC_PRIVACY_PAGE: Page = {
  id: 0,
  documentId: 'static-privacy',
  createdAt: '',
  updatedAt: '',
  publishedAt: '',
  title: 'Privacy Policy',
  slug: 'privacy',
  content: `*Last updated: March 2025*

## 1. Controller

The controller responsible for the processing of your personal data on this website and in the Fluentina application is:

**Fluentina**
fluentina.com
contact@fluentina.com

## 2. Data We Collect

### 2.1 Account Data
When you register, we collect your name and email address. This data is required to create and manage your account.

### 2.2 Usage Data
We collect data about how you interact with the Fluentina platform, including lesson progress, exercise results, and session activity. This data is used exclusively to provide and improve our service.

### 2.3 Payment Data
Payments are processed by Stripe, Inc. We do not store your full payment card details. Stripe's privacy policy applies to payment data: [stripe.com/privacy](https://stripe.com/privacy).

### 2.4 Contact Enquiries
If you contact us via the contact form, we process your name, email address, and message content to respond to your enquiry.

### 2.5 Technical Data
We collect standard server logs (IP address, browser type, pages visited) for security and performance purposes.

## 3. Legal Basis for Processing (GDPR Art. 6)

| Purpose | Legal Basis |
|---------|-------------|
| Account management | Art. 6(1)(b) — performance of a contract |
| Providing the learning service | Art. 6(1)(b) — performance of a contract |
| Payment processing | Art. 6(1)(b) — performance of a contract |
| Security and fraud prevention | Art. 6(1)(f) — legitimate interests |
| Marketing emails (opt-in) | Art. 6(1)(a) — consent |
| Responding to enquiries | Art. 6(1)(f) — legitimate interests |

## 4. Data Retention

We retain your personal data for as long as your account is active or as needed to provide our services. Account data is deleted within 30 days of account deletion. Server logs are retained for up to 90 days. You may request earlier deletion at any time (see Section 7).

## 5. Third-Party Services

We share data with the following third parties only to the extent necessary to operate the service:

- **Stripe** — payment processing (USA; Standard Contractual Clauses apply)
- **Mailjet** — transactional email delivery (EU)
- **Google Cloud** — hosting and infrastructure (EU, region: europe-west10)

We do not sell your personal data to any third party.

## 6. Cookies

Fluentina uses strictly necessary cookies required for authentication and security. We do not use tracking or advertising cookies.

## 7. Your Rights

Under the GDPR, you have the right to:

- **Access** — request a copy of the data we hold about you
- **Rectification** — request correction of inaccurate data
- **Erasure** — request deletion of your data ("right to be forgotten")
- **Restriction** — request that we restrict processing of your data
- **Portability** — receive your data in a structured, machine-readable format
- **Objection** — object to processing based on legitimate interests
- **Withdraw consent** — at any time, where processing is based on consent

To exercise any of these rights, please contact us at **contact@fluentina.com**.

## 8. Right to Lodge a Complaint

If you believe we are processing your data unlawfully, you have the right to lodge a complaint with a supervisory authority. In Germany, the competent authority is the **Bundesbeauftragte für den Datenschutz und die Informationsfreiheit (BfDI)**: [bfdi.bund.de](https://www.bfdi.bund.de).

## 9. Data Security

We use industry-standard security measures including HTTPS encryption, access controls, and regular security reviews to protect your personal data.

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. We will notify registered users of material changes by email. The date of the latest revision is shown at the top of this page.

## 11. Contact

For any privacy-related questions or requests, please contact us at **contact@fluentina.com**.
`,
};

export default async function PrivacyPage() {
  let pageData;
  try {
    const result = await strapiClient.getPage('privacy-policy');
    pageData = result.data?.[0] ?? null;
  } catch {
    pageData = null;
  }

  return <PageContent slug="privacy-policy" initialData={pageData ?? STATIC_PRIVACY_PAGE} />;
}
