import type { Metadata } from 'next';
import Contact from '@/page-components/Contact';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Contact Us',
  description: 'Get in touch with Fluentina. We\'d love to hear from you about your language learning journey.',
  alternates: {
    canonical: 'https://fluentina.com/contact',
  },
  openGraph: {
    title: 'Contact Us | Fluentina',
    description: 'Get in touch with Fluentina. We\'d love to hear from you about your language learning journey.',
    url: 'https://fluentina.com/contact',
    type: 'website',
  },
};

export default function ContactPage() {
  return <Contact />;
}
