import type { Metadata } from 'next';
import { strapiClient } from '@/lib/strapi';
import PricingPage from '@/page-components/Pricing';
import { WRITEWISE_APP_SCHEMA_JSON, generateFAQSchema } from '@/lib/seo';

export const revalidate = 900;

export const metadata: Metadata = {
  title: 'Pricing — Start Free | Fluentina',
  description:
    'Simple, transparent pricing for AI-powered language learning. Start free and upgrade anytime. Choose from Free, Pro, or Premium plans.',
  keywords: 'Fluentina pricing, language learning subscription, AI tutor cost',
  alternates: {
    canonical: 'https://fluentina.com/pricing',
  },
  // Out of search for the proof-of-concept phase, matching its removal from
  // nav (ADR-8) and from sitemap.ts. `follow` stays on so link equity still
  // flows through the page. The route keeps working for anyone given the URL.
  robots: { index: false, follow: true },
  openGraph: {
    title: 'Pricing — Start Free | Fluentina',
    description:
      'Simple, transparent pricing for AI-powered language learning. Start free and upgrade anytime.',
    url: 'https://fluentina.com/pricing',
    type: 'website',
  },
};

export default async function PricingRoute() {
  const [pricingResult, faqResult] = await Promise.allSettled([
    strapiClient.getStripePricing(900),
    strapiClient.getFAQs('Pricing', 900),
  ]);

  const initialPricingData =
    pricingResult.status === 'fulfilled' ? pricingResult.value : undefined;
  const initialFaqData =
    faqResult.status === 'fulfilled' ? faqResult.value : undefined;

  const faqs = (initialFaqData?.data ?? []).map((f) => ({ question: f.question, answer: f.answer }));

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WRITEWISE_APP_SCHEMA_JSON }} />
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(generateFAQSchema(faqs)) }}
        />
      )}
      <PricingPage
        initialPricingData={initialPricingData}
        initialFaqData={initialFaqData}
      />
    </>
  );
}
