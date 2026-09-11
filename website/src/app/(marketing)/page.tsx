import type { Metadata } from 'next';
import { strapiClient } from '@/lib/strapi';
import IndexPage from '@/page-components/Index';
import {
  WRITEWISE_ORG_SCHEMA_JSON,
  WRITEWISE_WEBSITE_SCHEMA_JSON,
  WRITEWISE_APP_SCHEMA_JSON,
  generateReviewSchema,
} from '@/lib/seo';

export const revalidate = 3600;

export const metadata: Metadata = {
  title: 'Fluentina - AI-Powered Language Learning Platform',
  description:
    'Fluentina helps you master German, English and other languages with AI-powered writing exercises, personalized feedback, and adaptive learning paths (A2–C1).',
  keywords:
    'German language learning, Deutsch lernen, English language learning, AI language tutor, CEFR placement test, writing practice, language learning app, multilingual AI tutor',
  alternates: {
    canonical: 'https://fluentina.com',
  },
  openGraph: {
    title: 'Fluentina - AI-Powered Language Learning Platform',
    description:
      'Fluentina helps you master German, English and other languages with AI-powered writing exercises, personalized feedback, and adaptive learning paths (A2–C1).',
    url: 'https://fluentina.com',
    type: 'website',
  },
};

export default async function HomePage() {
  const [featuresResult, testimonialsResult] = await Promise.allSettled([
    strapiClient.getFeatures(),
    strapiClient.getTestimonials(true),
  ]);

  const initialFeatures =
    featuresResult.status === 'fulfilled' ? featuresResult.value : undefined;
  const initialTestimonials =
    testimonialsResult.status === 'fulfilled' ? testimonialsResult.value : undefined;

  const reviews = (initialTestimonials?.data ?? []).map((t) =>
    generateReviewSchema({
      authorName: t.name,
      ratingValue: t.rating,
      reviewBody: t.content,
      datePublished: t.publishedAt ? new Date(t.publishedAt).toISOString().split('T')[0] : undefined,
    }),
  );

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WRITEWISE_ORG_SCHEMA_JSON }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WRITEWISE_WEBSITE_SCHEMA_JSON }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: WRITEWISE_APP_SCHEMA_JSON }} />
      {reviews.map((schema, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }} />
      ))}
      <IndexPage
        initialFeaturesData={initialFeatures}
        initialTestimonialsData={initialTestimonials}
      />
    </>
  );
}
