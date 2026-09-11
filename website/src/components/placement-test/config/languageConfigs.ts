// ============================================================================
// Per-language configuration for SEO landing pages
// ============================================================================

export interface FAQItem {
  question: string;
  answer: string;
}

export interface LanguageConfig {
  /** Language name as used in the app state (e.g. "German") */
  language: string;
  /** URL slug (e.g. "german") */
  slug: string;
  /** ISO 3166-1 alpha-2 country code for flagcdn.com (e.g. "de") */
  flagCode: string;
  /** Country name for flag alt text */
  flagAlt: string;
  // SEO
  seoTitle: string;
  seoDescription: string;
  seoKeywords: string;
  // Page copy
  badgeLabel: string;
  heroTitle: string;
  heroTitleHighlight: string;
  heroSubtitle: string;
  ctaLabel: string;
  // Static fallback FAQs shown while CMS loads (also used for JSON-LD)
  staticFaqs: FAQItem[];
}

export const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  German: {
    language: 'German',
    slug: 'german',
    flagCode: 'de',
    flagAlt: 'Germany flag',
    seoTitle: 'Free German Placement Test — Find Your CEFR Level | Fluentina',
    seoDescription:
      'Take our free AI-powered German placement test. Discover your exact CEFR level (A1–C2) across grammar, vocabulary, reading and writing in just 20 minutes. Get a detailed report by email.',
    seoKeywords:
      'German placement test, Deutschtest online, German CEFR level test, test my German level, Deutsch Einstufungstest kostenlos, German language assessment, B1 German test, B2 German test',
    badgeLabel: 'Free German Assessment',
    heroTitle: 'Find Your',
    heroTitleHighlight: 'German Level',
    heroSubtitle:
      'Our free AI-powered CEFR placement test gives you an accurate, personalised assessment of your German skills — grammar, vocabulary, reading and writing — in just 20 minutes.',
    ctaLabel: 'Start Free German Test',
    staticFaqs: [
      {
        question: 'What is the CEFR scale for German?',
        answer:
          'CEFR (Common European Framework of Reference) has six levels: A1 (Beginner), A2 (Elementary), B1 (Intermediate), B2 (Upper-Intermediate), C1 (Advanced), and C2 (Proficient). Most everyday conversations require B1–B2. German university admission typically requires C1.',
      },
      {
        question: 'How accurate is this German level test?',
        answer:
          'Our AI-powered test covers all four core skill areas — vocabulary, grammar, reading comprehension, and writing — across all six CEFR levels. It is designed to give you a reliable A1–C2 assessment that correlates closely with official Goethe-Institut and telc results.',
      },
      {
        question: 'What German level do I need for the Goethe-Institut certificate?',
        answer:
          'Goethe-Institut offers certificates at every CEFR level: Goethe-Zertifikat A1, A2, B1, B2, C1 (Goethe-Zertifikat C1), and C2 (Goethe-Zertifikat C2 Großes Deutsches Sprachdiplom). Our placement test will tell you which exam level you are ready to prepare for.',
      },
      {
        question: 'How is this different from the TestDaF?',
        answer:
          'TestDaF tests B2–C1 German specifically for university admission. Our placement test covers the full A1–C2 spectrum and is designed to find your current level, not to certify it. Use it to understand where you stand before deciding which official exam to pursue.',
      },
      {
        question: 'Is my German B1 or B2?',
        answer:
          'B1 means you can understand the main points of clear standard input on familiar topics and handle most travel situations. B2 means you can understand complex texts and interact fluently with native speakers without strain. Our test will pinpoint your exact level within 20 minutes.',
      },
      {
        question: 'Do I need to prepare for this test?',
        answer:
          'No preparation needed — the test is designed to assess your current knowledge accurately. Preparing would skew the results. Just find a quiet spot, answer honestly, and you will receive a reliable CEFR level together with a personalised learning recommendation.',
      },
    ],
  },

  English: {
    language: 'English',
    slug: 'english',
    flagCode: 'gb',
    flagAlt: 'United Kingdom flag',
    seoTitle: 'Free English Placement Test — Find Your CEFR Level | Fluentina',
    seoDescription:
      'Take our free AI-powered English placement test. Discover your exact CEFR level (A1–C2) across grammar, vocabulary, reading and writing in just 20 minutes. Get a detailed report by email.',
    seoKeywords:
      'English placement test, English CEFR level test, test my English level, English language assessment, B2 English test, C1 English test, IELTS preparation level test, free English test online',
    badgeLabel: 'Free English Assessment',
    heroTitle: 'Find Your',
    heroTitleHighlight: 'English Level',
    heroSubtitle:
      'Our free AI-powered CEFR placement test gives you an accurate, personalised assessment of your English skills — grammar, vocabulary, reading and writing — in just 20 minutes.',
    ctaLabel: 'Start Free English Test',
    staticFaqs: [
      {
        question: 'What is the CEFR scale for English?',
        answer:
          'CEFR has six levels: A1 (Beginner), A2 (Elementary), B1 (Intermediate), B2 (Upper-Intermediate), C1 (Advanced), and C2 (Proficient). B2 is the level where most people can comfortably work and study in English. C1 corresponds to the Cambridge C1 Advanced (CAE) certificate.',
      },
      {
        question: 'How accurate is this English level test?',
        answer:
          'Our AI-powered test assesses all four core skill areas — vocabulary, grammar, reading comprehension, and writing — across all six CEFR levels. It provides a reliable A1–C2 result that correlates closely with official Cambridge and IELTS level benchmarks.',
      },
      {
        question: 'What English level do I need for IELTS or TOEFL?',
        answer:
          'IELTS Band 6.0–6.5 corresponds roughly to B2, Band 7.0–7.5 to C1. TOEFL iBT 72–94 is B2, 95–120 is C1. Our placement test will show you your current level and help you understand what preparation you need before sitting either exam.',
      },
      {
        question: 'Is my English B2 or C1?',
        answer:
          'B2 means you can understand complex texts and have fluid conversations but still make noticeable errors. C1 means you can express yourself fluently and spontaneously, understanding implicit meaning in most contexts. Our test pinpoints your exact level within 20 minutes.',
      },
      {
        question: 'How is this test different from Cambridge or IELTS?',
        answer:
          'Cambridge and IELTS are official certified exams with proctored conditions. Our test is a free, self-assessment tool designed to quickly locate your current level so you can plan your learning path — not to issue a certificate.',
      },
      {
        question: 'Do I need to prepare for this test?',
        answer:
          'No preparation needed. Answer honestly based on your current knowledge — preparation would skew the results. You will receive an accurate CEFR level and a personalised learning recommendation emailed to you immediately after completing the test.',
      },
    ],
  },
};

/** All six supported languages shown on the hub page */
export const HUB_LANGUAGES = [
  { language: 'German',     slug: 'german',     flagCode: 'de', flagAlt: 'Germany flag',     active: true  },
  { language: 'English',    slug: 'english',    flagCode: 'gb', flagAlt: 'UK flag',           active: true  },
  { language: 'Spanish',    slug: 'spanish',    flagCode: 'es', flagAlt: 'Spain flag',        active: false },
  { language: 'French',     slug: 'french',     flagCode: 'fr', flagAlt: 'France flag',       active: false },
  { language: 'Italian',    slug: 'italian',    flagCode: 'it', flagAlt: 'Italy flag',        active: false },
  { language: 'Portuguese', slug: 'portuguese', flagCode: 'pt', flagAlt: 'Portugal flag',     active: false },
];
