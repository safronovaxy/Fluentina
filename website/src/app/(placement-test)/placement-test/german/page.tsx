import type { Metadata } from 'next';
import PlacementTestGerman from '@/page-components/PlacementTestGerman';
import { strapiClient } from '@/lib/strapi';
import { generateFAQSchema, generateQAPageSchema } from '@/lib/seo';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'German Language Placement Test — Free CEFR Assessment',
  description:
    'Take our free AI-powered German placement test and discover your exact CEFR level (A1–C2) across grammar, vocabulary, reading and writing. Results in 20 minutes.',
  keywords:
    'German placement test, Deutsch Einstufungstest, CEFR level German, German language assessment, free German test',
  alternates: {
    canonical: 'https://fluentina.com/placement-test/german',
  },
  openGraph: {
    title: 'German Language Placement Test — Free CEFR Assessment | Fluentina',
    description:
      'Take our free AI-powered German placement test and discover your exact CEFR level (A1–C2) across grammar, vocabulary, reading and writing. Results in 20 minutes.',
    url: 'https://fluentina.com/placement-test/german',
    type: 'website',
  },
};

const qaSchema = generateQAPageSchema({
  question: 'What is my German language level?',
  answer:
    'Take our free AI-powered German placement test to discover your exact CEFR level (A1–C2). The adaptive test covers grammar, vocabulary, reading and writing, and delivers results in 20 minutes — no registration required.',
});

export default async function PlacementTestGermanPage() {
  let faqs: { question: string; answer: string }[] = [];
  try {
    const data = await strapiClient.getFAQsByPage('placement-test-german');
    faqs = (data.data ?? []).map((f) => ({ question: f.question, answer: f.answer }));
  } catch {
    // CMS unavailable — omit FAQ schema
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(qaSchema) }} />
      {faqs.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(generateFAQSchema(faqs)) }}
        />
      )}
      <PlacementTestGerman />
    </>
  );
}
