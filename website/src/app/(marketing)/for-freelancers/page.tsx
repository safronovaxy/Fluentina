import type { Metadata } from 'next';
import Freelancers from '@/page-components/Freelancers';
import { generateReviewSchema } from '@/lib/seo';

export const revalidate = false;

export const metadata: Metadata = {
  title: 'Fluentina for Freelance Language Tutors — Save Time, Grow Your Business',
  description:
    'Fluentina helps freelance language tutors cut prep and review time by up to 70%, track student performance with real data, and take on more students without burning out.',
  keywords:
    'freelance language tutor, AI language teaching tool, student progress tracking, CEFR exercises, language tutor software',
  alternates: {
    canonical: 'https://fluentina.com/for-freelancers',
  },
  openGraph: {
    title: 'Fluentina for Freelance Language Tutors',
    description:
      'Fluentina helps freelance language tutors cut prep and review time by up to 70%, track student performance with real data, and take on more students without burning out.',
    url: 'https://fluentina.com/for-freelancers',
    type: 'website',
  },
};

const freelancerReviews = [
  {
    authorName: 'Andreea R.',
    ratingValue: 5,
    reviewBody:
      "I used to spend Sunday evenings preparing exercises. Now I spend 20 minutes and have a full week ready. I've taken on three new students since starting the beta.",
  },
  {
    authorName: 'Jonas K.',
    ratingValue: 5,
    reviewBody:
      "The analytics completely changed how I plan lessons. I spotted that half my students had the same grammar gap — one targeted exercise fixed it for everyone.",
  },
  {
    authorName: 'Fatima L.',
    ratingValue: 5,
    reviewBody:
      "My students love the instant feedback. And I love that I can see exactly where they are without waiting for the next session.",
  },
];

export default function FreelancersPage() {
  return (
    <>
      {freelancerReviews.map((r, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(generateReviewSchema(r)) }}
        />
      ))}
      <Freelancers />
    </>
  );
}
