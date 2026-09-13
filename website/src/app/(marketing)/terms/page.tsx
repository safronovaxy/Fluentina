import type { Metadata } from 'next';
import { strapiClient } from '@/lib/strapi';
import PageContent from '@/page-components/Page';
import type { Page } from '@/types/strapi';

export const revalidate = 86400;

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'Read the Fluentina Terms of Service to understand the terms and conditions for using our platform.',
  alternates: {
    canonical: 'https://fluentina.com/terms',
  },
  openGraph: {
    title: 'Terms of Service | Fluentina',
    description: 'Read the Fluentina Terms of Service to understand the terms and conditions for using our platform.',
    url: 'https://fluentina.com/terms',
    type: 'website',
  },
  robots: { index: true, follow: true },
};

const STATIC_TERMS_PAGE: Page = {
  id: 0,
  documentId: 'static-terms',
  createdAt: '',
  updatedAt: '',
  publishedAt: '',
  title: 'Terms of Service',
  slug: 'terms',
  content: `*Last updated: March 2025*

## 1. Acceptance of Terms

By accessing or using Fluentina ("the Service"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree, please do not use the Service.

## 2. Description of Service

Fluentina is an AI-powered German language learning platform that provides writing exercises, feedback, and progress tracking. We offer both free and paid subscription plans.

## 3. Account Registration

To access the full Service, you must create an account by providing a valid email address and a secure password. You are responsible for maintaining the confidentiality of your credentials and for all activity that occurs under your account. Notify us immediately at **contact@fluentina.com** if you suspect unauthorised use of your account.

## 4. Subscriptions and Payments

### 4.1 Free and Paid Plans
Fluentina offers a free tier with limited features and paid subscription plans with full access. Plan details and pricing are described on our [Pricing page](/pricing).

### 4.2 Billing
Paid subscriptions are billed in advance on a monthly or annual basis. Payments are processed securely by Stripe. By subscribing, you authorise Stripe to charge your payment method on the applicable billing cycle.

### 4.3 Cancellation
You may cancel your subscription at any time from your account settings. Cancellation takes effect at the end of the current billing period. No refunds are issued for partial periods, except where required by applicable law.

### 4.4 Price Changes
We may change subscription prices with at least 30 days' notice. Continued use of the Service after the price change constitutes acceptance of the new pricing.

## 5. Acceptable Use

You agree not to:

- Use the Service for any unlawful purpose
- Attempt to gain unauthorised access to any part of the Service or its infrastructure
- Reverse-engineer, decompile, or disassemble any part of the Service
- Upload or transmit harmful, offensive, or infringing content
- Use automated tools (bots, scrapers) to access the Service without our written permission
- Share your account credentials with others

## 6. Intellectual Property

All content, software, and materials on Fluentina — including exercises, AI feedback, and UI — are owned by Fluentina or its licensors and are protected by copyright and intellectual property laws. You may not reproduce, distribute, or create derivative works without our express written permission.

Your submitted content (e.g. writing exercises) remains yours. By submitting it, you grant Fluentina a limited licence to use it solely for providing and improving the Service.

## 7. Privacy

Your use of the Service is subject to our [Privacy Policy](/privacy), which is incorporated into these Terms by reference.

## 8. Disclaimers

The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including warranties of fitness for a particular purpose, accuracy, or uninterrupted availability. Language learning results vary by individual effort and prior knowledge.

## 9. Limitation of Liability

To the maximum extent permitted by applicable law, Fluentina shall not be liable for any indirect, incidental, special, or consequential damages arising out of or in connection with your use of the Service, even if advised of the possibility of such damages. Our total liability to you for any claim shall not exceed the amount you paid us in the 12 months preceding the claim.

## 10. Termination

We may suspend or terminate your account if you breach these Terms or if we reasonably believe your use of the Service is harmful. Upon termination, your right to use the Service ceases immediately. You may delete your account at any time from your account settings.

## 11. Governing Law

These Terms are governed by the laws of Germany. Any disputes shall be subject to the exclusive jurisdiction of the courts of Germany, unless mandatory consumer protection laws in your country of residence provide otherwise.

## 12. Changes to Terms

We may update these Terms from time to time. We will notify you of material changes by email or a prominent notice on the Service. Continued use after the effective date of updated Terms constitutes acceptance.

## 13. Contact

For questions about these Terms, please contact us at **contact@fluentina.com**.
`,
};

export default async function TermsPage() {
  let pageData;
  try {
    const result = await strapiClient.getPage('user-agreement');
    pageData = result.data?.[0] ?? null;
  } catch {
    pageData = null;
  }

  return <PageContent slug="user-agreement" initialData={pageData ?? STATIC_TERMS_PAGE} />;
}
