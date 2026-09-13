'use client';

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  MessageSquare,
  Target,
  Sparkles,
  Users,
  Award,
  ArrowRight,
  CheckCircle2,
  Star,
  Zap,
  Brain,
  PenTool,
} from "lucide-react";
import { useFeature } from "@growthbook/growthbook-react";
import { useFeatures, useTestimonials } from "@/hooks/use-strapi";
import { getIcon } from "@/lib/icons";
import { trackEvent } from "@/lib/analytics";
import type { StrapiResponse, Feature, Testimonial } from "@/types/strapi";

interface HeroContent {
  headline: string;
  headlineHighlight: string;
  badge: string;
  subheading: string;
  primaryCta: string;
}

const DEFAULT_HERO: HeroContent = {
  headline: "Master Any Language with Your",
  headlineHighlight: "AI Mentor",
  badge: "AI-Powered Real Learning Experience",
  subheading:
    "Fluentina helps intermediate learners (A2-C1) improve their active language skills through personalized writing exercises, real-time feedback, and adaptive learning paths.",
  primaryCta: "Start Learning Free",
};

const stats = [
  { value: "1K+", label: "Active Learners" },
  { value: "30K+", label: "Exercises Completed" },
  { value: "4.9", label: "User Rating" },
  { value: "6", label: "Languages available" },
];

const steps = [
  {
    number: "01",
    title: "Set the Target",
    description: "Define which CEFR level you would like to reach",
  },
  {
    number: "02",
    title: "Get Your Learning Path",
    description: "Receive a personalized curriculum based on your goals and progress.",
  },
  {
    number: "03",
    title: "Practice Regularly",
    description: "Complete engaging practical exercises with instant AI feedback and explanations.",
  },
  {
    number: "04",
    title: "Track & Improve",
    description: "Monitor your progress and celebrate milestones as you advance.",
  },
];

interface IndexProps {
  initialFeaturesData?: StrapiResponse<Feature[]>;
  initialTestimonialsData?: StrapiResponse<Testimonial[]>;
}

const Index = ({ initialFeaturesData, initialTestimonialsData }: IndexProps = {}) => {
  const heroFeature = useFeature('hero_messaging');
  const hero = (heroFeature.value as HeroContent) ?? DEFAULT_HERO;

  const { data: resolvedFeaturesData, isLoading: featuresLoading } = useFeatures({ initialData: initialFeaturesData });
  const { data: resolvedTestimonialsData, isLoading: testimonialsLoading } = useTestimonials(true, { initialData: initialTestimonialsData });

  const features = resolvedFeaturesData?.data.map(item => ({
    ...item,
    icon: getIcon(item.icon),
  })) || [];

  const testimonials = resolvedTestimonialsData?.data || [];

  return (
    <>
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-gradient-brand-subtle py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
              <Zap className="h-4 w-4" />
              {hero.badge}
            </div>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
              {hero.headline}{" "}
              <span className="text-gradient-brand">{hero.headlineHighlight}</span>
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
              {hero.subheading}
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="bg-gradient-brand px-8 hover:opacity-90" asChild>
                <a
                  href="https://app.fluentina.com?mode=signup"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackEvent('cta', 'click', `hero_primary|${hero.primaryCta}`)}
                >
                  {hero.primaryCta}
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#features">
                  See How It Works
                </a>
              </Button>
            </div>
            <div className="mt-8 flex items-center justify-center gap-8 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                1 Month Free Trial
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Cancel any time
              </div>
            </div>
          </div>
        </div>

        {/* Decorative elements — simple gradients, no blur filter (blur-3xl is GPU-heavy on mobile) */}
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-primary/10" />
        <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-accent/10" />
      </section>

      {/* Stats Section */}
      <section className="border-y bg-background py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-3xl font-bold text-gradient-brand md:text-4xl">{stat.value}</div>
                <div className="mt-1 text-sm text-muted-foreground">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Everything You Need to{" "}
              <span className="text-gradient-brand">Excel</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Comprehensive tools and features designed by language learning experts
              to accelerate your journey to fluency.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {featuresLoading && !resolvedFeaturesData ? (
              // Loading skeletons
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="border-0">
                  <CardContent className="p-6">
                    <Skeleton className="mb-4 h-12 w-12 rounded-lg" />
                    <Skeleton className="mb-2 h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="mt-2 h-4 w-5/6" />
                  </CardContent>
                </Card>
              ))
            ) : (
              features.map((feature) => (
                <Card key={feature.title} className="card-elevated border-0 transition-transform hover:-translate-y-1">
                  <CardContent className="p-6">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-brand">
                      <feature.icon className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="mb-2 text-xl font-semibold text-foreground">{feature.title}</h3>
                    <p className="text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="bg-muted/30 py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              How <span className="text-gradient-brand">Fluentina</span> Works
            </h2>
            <p className="text-lg text-muted-foreground">
              Start your language learning journey in four simple steps.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <div key={step.number} className="relative">
                <div className="mb-4 text-5xl font-bold text-primary/20">{step.number}</div>
                <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>
                {index < steps.length - 1 && (
                  <div className="absolute right-0 top-8 hidden h-0.5 w-full bg-gradient-to-r from-primary/20 to-transparent lg:block lg:w-1/2" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Loved by <span className="text-gradient-brand">Learners</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Join thousands of satisfied learners who have transformed their language skills.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {testimonialsLoading && !resolvedTestimonialsData ? (
              // Loading skeletons
              Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="border-0">
                  <CardContent className="p-6">
                    <div className="mb-4 flex gap-1">
                      {Array.from({ length: 5 }).map((_, j) => (
                        <Skeleton key={j} className="h-5 w-5 rounded" />
                      ))}
                    </div>
                    <Skeleton className="mb-2 h-4 w-full" />
                    <Skeleton className="mb-2 h-4 w-full" />
                    <Skeleton className="mb-4 h-4 w-3/4" />
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <div className="flex-1">
                        <Skeleton className="mb-1 h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            ) : (
              testimonials.map((testimonial) => (
                <Card key={testimonial.name} className="card-elevated border-0">
                  <CardContent className="p-6">
                    <div className="mb-4 flex gap-1">
                      {[...Array(testimonial.rating)].map((_, i) => (
                        <Star key={i} className="h-5 w-5 fill-primary text-primary" />
                      ))}
                    </div>
                    <p className="mb-4 text-foreground">&ldquo;{testimonial.content}&rdquo;</p>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-brand text-sm font-medium text-white">
                        {testimonial.name.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-foreground">{testimonial.name}</div>
                        <div className="text-sm text-muted-foreground">{testimonial.role}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-brand py-20 lg:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="mx-auto max-w-2xl">
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
              Ready to Transform Your Language Skills?
            </h2>
            <p className="mb-8 text-lg text-white/80">
              Join other learners worldwide and start your journey to fluency today. No credit card required.
            </p>
            <Button size="lg" variant="secondary" className="px-8" asChild>
              <a href="https://app.fluentina.com?mode=signup" target="_blank" rel="noopener noreferrer">
                Get Started Free
                <ArrowRight className="ml-2 h-5 w-5" />
              </a>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
};

export default Index;
