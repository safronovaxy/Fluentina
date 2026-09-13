/**
 * Script to populate sample content in Strapi
 * Run with: node populate-sample-data.js
 */

const STRAPI_URL = 'http://localhost:1337';

// Helper function to create content
async function createContent(endpoint, data) {
  try {
    const response = await fetch(`${STRAPI_URL}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to create ${endpoint}:`, error);
      return null;
    }

    const result = await response.json();
    console.log(`✅ Created ${endpoint}:`, result.data.id);
    return result.data;
  } catch (error) {
    console.error(`Error creating ${endpoint}:`, error.message);
    return null;
  }
}

// Sample data
const sampleFeatures = [
  {
    title: 'Writing Practice',
    description: 'Improve your writing skills with AI-powered exercises tailored to your level from A2 to C1.',
    icon: 'PenTool',
    order: 1,
  },
  {
    title: 'Instant Feedback',
    description: 'Get detailed corrections and explanations for grammar, vocabulary, and style in seconds.',
    icon: 'MessageSquare',
    order: 2,
  },
  {
    title: 'Smart AI Tutor',
    description: 'Learn from mistakes with personalized explanations powered by advanced language AI.',
    icon: 'Brain',
    order: 3,
  },
  {
    title: 'Track Progress',
    description: 'Monitor your improvement with detailed statistics and CEFR level assessments.',
    icon: 'Target',
    order: 4,
  },
  {
    title: 'Personalized Topics',
    description: 'Practice writing about subjects that interest you for better engagement and learning.',
    icon: 'Sparkles',
    order: 5,
  },
  {
    title: 'Achieve Goals',
    description: 'Reach your language learning objectives with structured practice and clear milestones.',
    icon: 'Award',
    order: 6,
  },
];

const sampleTestimonials = [
  {
    name: 'Sarah Mitchell',
    role: 'Marketing Manager',
    company: 'Tech Solutions Inc.',
    content: 'Fluentina has been a game-changer for my German learning journey. The instant feedback helps me understand my mistakes immediately, and I can see real progress in my writing skills.',
    rating: 5,
    featured: true,
  },
  {
    name: 'David Chen',
    role: 'Student',
    content: 'As a B1 learner, the personalized exercises are perfect for my level. The AI explanations are clear and help me understand grammar rules I struggled with.',
    rating: 5,
    featured: true,
  },
  {
    name: 'Emma Rodriguez',
    role: 'Software Engineer',
    company: 'StartupHub',
    content: 'I love how I can practice writing about topics I am interested in. It makes learning feel less like work and more like fun!',
    rating: 4,
    featured: false,
  },
];

const sampleBlogPosts = [
  {
    title: 'How AI is Revolutionizing Language Learning in 2026',
    slug: 'ai-language-learning-2026',
    excerpt: 'Discover how artificial intelligence creates personalized learning experiences that adapt to your unique needs and learning pace.',
    content: `# How AI is Revolutionizing Language Learning in 2026

Artificial intelligence has transformed the way we learn languages, making personalized education accessible to everyone.

## Instant Feedback
One of the biggest advantages of AI-powered learning is instant feedback. Instead of waiting for a teacher to review your work, you get corrections and explanations in seconds.

## Personalized Learning Paths
AI adapts to your level and learning style, creating exercises that challenge you without overwhelming you.

## 24/7 Availability
Practice whenever you want, wherever you are. Your AI tutor never sleeps.`,
    author: 'Dr. Elena Kowalski',
    authorRole: 'AI Research Director',
    publishedDate: '2026-01-15',
    readTime: '8 min read',
    category: 'AI',
    seoDescription: 'Learn how AI is transforming language learning with personalized feedback and adaptive learning paths.',
    featured: true,
  },
  {
    title: '5 Tips for Improving Your Writing Skills',
    slug: 'improve-writing-skills',
    excerpt: 'Practical strategies to enhance your written communication in any language.',
    content: `# 5 Tips for Improving Your Writing Skills

Writing is a skill that improves with practice and the right strategies.

## 1. Write Every Day
Consistency is key. Even 10 minutes of daily practice makes a difference.

## 2. Read Extensively
Reading exposes you to different writing styles and vocabulary.

## 3. Get Feedback
Don't practice in isolation. Use tools like Fluentina for instant feedback.

## 4. Focus on Clarity
Clear communication is more important than complex vocabulary.

## 5. Review and Revise
Great writing is rewriting. Always review your work.`,
    author: 'Michael Thompson',
    authorRole: 'Language Coach',
    publishedDate: '2026-01-20',
    readTime: '6 min read',
    category: 'Tips',
    seoDescription: 'Five practical tips to improve your writing skills in any language.',
    featured: false,
  },
];

const sampleResources = [
  {
    title: 'CEFR Levels Explained',
    description: 'Comprehensive guide to understanding the Common European Framework of Reference for Languages.',
    category: 'Guides',
    link: 'https://www.coe.int/en/web/common-european-framework-reference-languages',
    featured: true,
  },
  {
    title: 'Grammar Practice Exercises',
    description: 'Free online exercises for all levels to improve your grammar skills.',
    category: 'Tools',
    link: 'https://example.com/grammar',
    featured: false,
  },
];

const samplePricingPlans = [
  {
    name: 'Free Plan',
    code: 'free',
    price: 0,
    currency: 'EUR',
    description: 'Perfect for getting started with language learning',
    features: [
      '5 writing tasks per month',
      'Basic AI feedback',
      'Progress tracking',
      'CEFR level assessment',
    ],
    highlighted: false,
    order: 1,
  },
  {
    name: 'Basic Plan',
    code: 'basic',
    price: 9.99,
    priceYearly: 99.99,
    currency: 'EUR',
    description: 'For serious learners who want consistent practice',
    features: [
      '50 writing tasks per month',
      'Detailed AI feedback',
      'Advanced progress tracking',
      'Personalized topics',
      'Priority support',
    ],
    highlighted: true,
    stripePriceId: 'price_1SvFVnDS2PG1K2EVUKQTUwF7',
    order: 2,
  },
  {
    name: 'Premium Plan',
    code: 'premium',
    price: 19.99,
    priceYearly: 199.99,
    currency: 'EUR',
    description: 'Unlimited practice for fast progress',
    features: [
      'Unlimited writing tasks',
      'Expert AI feedback with explanations',
      'Comprehensive analytics',
      'Custom topic requests',
      'Premium support',
      'Exclusive content',
    ],
    highlighted: false,
    stripePriceId: 'price_1SvFWADS2PG1K2EVenqVLt69',
    order: 3,
  },
];

const samplePages = [
  {
    title: 'About Fluentina',
    slug: 'about',
    content: `# About Fluentina

Fluentina is an AI-powered language learning platform that helps you improve your writing skills through personalized practice and instant feedback.

## Our Mission
We believe that everyone should have access to quality language education, regardless of their location or budget.

## How It Works
1. Choose your level (A2-C1)
2. Get personalized writing tasks
3. Receive instant AI feedback
4. Track your progress

Join thousands of learners improving their writing skills every day.`,
    seoTitle: 'About Fluentina - AI-Powered Language Learning',
    seoDescription: 'Learn about Fluentina, the AI platform helping thousands improve their writing skills.',
  },
];

// Main function to populate all data
async function populateData() {
  console.log('🚀 Starting to populate sample data...\n');

  // Features
  console.log('Creating features...');
  for (const feature of sampleFeatures) {
    await createContent('features', feature);
  }

  // Testimonials
  console.log('\nCreating testimonials...');
  for (const testimonial of sampleTestimonials) {
    await createContent('testimonials', testimonial);
  }

  // Blog Posts
  console.log('\nCreating blog posts...');
  for (const post of sampleBlogPosts) {
    await createContent('blog-posts', post);
  }

  // Resources
  console.log('\nCreating resources...');
  for (const resource of sampleResources) {
    await createContent('resources', resource);
  }

  // Pricing Plans
  console.log('\nCreating pricing plans...');
  for (const plan of samplePricingPlans) {
    await createContent('pricing-plans', plan);
  }

  // Pages
  console.log('\nCreating pages...');
  for (const page of samplePages) {
    await createContent('pages', page);
  }

  console.log('\n✅ Sample data population complete!');
  console.log('\n📝 Note: Content is created in draft state. Publish it in the Strapi admin panel.');
}

// Run the script
populateData().catch(console.error);
