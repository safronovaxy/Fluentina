import type { Metadata } from 'next';
import About from '@/page-components/About';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'About Fluentina',
  description:
    'Learn about Fluentina\'s mission to make language learning personal. Discover how our AI-powered platform helps intermediate learners (A2–C1) develop real communication skills.',
  alternates: {
    canonical: 'https://fluentina.com/about',
  },
  openGraph: {
    title: 'About Fluentina - Our Mission & Story',
    description:
      'Learn about Fluentina\'s mission to make language learning personal. Discover how our AI-powered platform helps intermediate learners (A2–C1) develop real communication skills.',
    url: 'https://fluentina.com/about',
    type: 'website',
  },
};

export default function AboutPage() {
  return <About />;
}
