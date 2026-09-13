// JSON-LD schema generator functions for structured data

export const generateOrganizationSchema = (name: string, url: string, logoUrl?: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name,
  url,
  description:
    'Fluentina helps intermediate English and German learners (A2–B2) break through the plateau with AI-powered writing practice and real-time feedback at exactly the right level of challenge.',
  ...(logoUrl && {
    logo: {
      '@type': 'ImageObject',
      url: logoUrl,
    },
  }),
  sameAs: [
    'https://twitter.com/Fluentina',
    'https://www.linkedin.com/company/write-wise-language-improvement/',
    'https://www.youtube.com/@write-wise',
  ],
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'customer support',
    email: 'support@fluentina.com',
    url: 'https://fluentina.com/contact',
  },
});

export const generateWebsiteSchema = (name: string, url: string) => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name,
  url,
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${url}/blog?q={search_term_string}`,
    },
    'query-input': 'required name=search_term_string',
  },
});

export const generateSoftwareApplicationSchema = () => ({
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://fluentina.com/#app',
  name: 'Fluentina',
  applicationCategory: 'EducationApplication',
  operatingSystem: 'Web',
  url: 'https://fluentina.com',
  description:
    'AI writing coach for intermediate English and German learners (A2–B2). Adaptive exercises, real-time grammar and vocabulary feedback, designed to push past the intermediate plateau.',
  offers: {
    '@type': 'Offer',
    name: 'Free',
    price: '0',
    priceCurrency: 'USD',
  },
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: '4.9',
    ratingCount: '1043',
    bestRating: '5',
    worstRating: '1',
  },
});

// Pre-computed Fluentina schemas — avoids redundant object creation and JSON.stringify on every request.
export const WRITEWISE_ORG_SCHEMA_JSON = JSON.stringify(
  generateOrganizationSchema('Fluentina', 'https://fluentina.com', 'https://fluentina.com/logo.png'),
);
export const WRITEWISE_WEBSITE_SCHEMA_JSON = JSON.stringify(
  generateWebsiteSchema('Fluentina', 'https://fluentina.com'),
);
export const WRITEWISE_APP_SCHEMA_JSON = JSON.stringify(generateSoftwareApplicationSchema());

export const generateArticleSchema = (params: {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
  author: string;
  image?: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: params.title,
  description: params.description,
  url: params.url,
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': params.url,
  },
  datePublished: params.datePublished,
  dateModified: params.dateModified,
  author: {
    '@type': 'Person',
    name: params.author,
  },
  publisher: {
    '@type': 'Organization',
    name: 'Fluentina',
    url: 'https://fluentina.com',
    logo: {
      '@type': 'ImageObject',
      url: 'https://fluentina.com/logo.png',
    },
  },
  ...(params.image && { image: [params.image] }),
});

export const generateReviewSchema = (params: {
  authorName: string;
  ratingValue: number;
  reviewBody: string;
  datePublished?: string;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'Review',
  author: {
    '@type': 'Person',
    name: params.authorName,
  },
  itemReviewed: {
    '@id': 'https://fluentina.com/#app',
  },
  reviewRating: {
    '@type': 'Rating',
    ratingValue: params.ratingValue,
    bestRating: 5,
    worstRating: 1,
  },
  reviewBody: params.reviewBody,
  ...(params.datePublished && { datePublished: params.datePublished }),
});

export const generateQAPageSchema = (params: {
  question: string;
  answer: string;
  answerCount?: number;
}) => ({
  '@context': 'https://schema.org',
  '@type': 'QAPage',
  mainEntity: {
    '@type': 'Question',
    name: params.question,
    answerCount: params.answerCount ?? 1,
    acceptedAnswer: {
      '@type': 'Answer',
      text: params.answer,
    },
  },
});

export const generateFAQSchema = (faqs: { question: string; answer: string }[]) => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
});
