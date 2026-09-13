import type { Metadata } from 'next';
import { strapiClient } from '@/lib/strapi';
import ResourcesPage from '@/page-components/Resources';
import { generateFAQSchema } from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Learning Resources — Videos, Guides & Tools | Fluentina',
  description:
    'Free German learning resources: video tutorials, guides, tools, and FAQs to accelerate your language learning journey with Fluentina.',
  keywords: 'German learning resources, Fluentina tutorials, language learning guides, writing practice tips, Fluentina FAQ',
  alternates: {
    canonical: 'https://fluentina.com/resources',
  },
  openGraph: {
    title: 'Learning Resources — Videos, Guides & Tools | Fluentina',
    description:
      'Free German learning resources: video tutorials, guides, tools, and FAQs.',
    url: 'https://fluentina.com/resources',
    type: 'website',
  },
};

export default async function ResourcesRoute() {
  const [resourcesResult, faqResult] = await Promise.allSettled([
    strapiClient.getResources(),
    strapiClient.getFAQs(),
  ]);

  const initialResourcesData =
    resourcesResult.status === 'fulfilled' ? resourcesResult.value : undefined;
  const initialFaqData =
    faqResult.status === 'fulfilled' ? faqResult.value : undefined;

  const faqs = (initialFaqData?.data ?? []).map((f) => ({ question: f.question, answer: f.answer }));

  return (
    <>
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(generateFAQSchema(faqs)) }}
        />
      )}
      <ResourcesPage
        initialResourcesData={initialResourcesData}
        initialFaqData={initialFaqData}
      />
    </>
  );
}
