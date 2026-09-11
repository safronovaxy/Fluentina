import type { Metadata } from 'next';
import PlacementTestHub from '@/page-components/PlacementTestHub';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Free Language Placement Test — Find Your CEFR Level',
  description:
    'Take our free AI-powered CEFR placement test in German, English, Spanish, French, Italian or Portuguese. Discover your exact level (A1–C2) in 20 minutes.',
  keywords:
    'language placement test, CEFR level test, free language assessment, German placement test, English placement test',
  alternates: {
    canonical: 'https://fluentina.com/placement-test',
  },
  openGraph: {
    title: 'Free Language Placement Test — Find Your CEFR Level | Fluentina',
    description:
      'Take our free AI-powered CEFR placement test in German, English, Spanish, French, Italian or Portuguese. Discover your exact level (A1–C2) in 20 minutes.',
    url: 'https://fluentina.com/placement-test',
    type: 'website',
  },
};

export default function PlacementTestPage() {
  return <PlacementTestHub />;
}
