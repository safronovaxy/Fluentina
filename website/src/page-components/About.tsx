'use client';

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Globe, Lightbulb, Users, Target, Award, ArrowRight, Mail, MapPin } from "lucide-react";

const values = [
  {
    icon: Heart,
    title: "Learner-First",
    description: "Every feature we build starts with understanding what learners truly need to succeed.",
  },
  {
    icon: Lightbulb,
    title: "Innovation",
    description: "We leverage cutting-edge AI to create learning experiences that were impossible before.",
  },
  {
    icon: Globe,
    title: "Accessibility",
    description: "Quality language education should be available to everyone, everywhere, at any price point.",
  },
  {
    icon: Target,
    title: "Results-Driven",
    description: "We measure success by your progress, not by vanity metrics or time spent in-app.",
  },
];

const team = [
  {
    name: "Dr. Elena Kowalski",
    role: "CEO & Co-Founder",
    bio: "Former linguistics professor with 15+ years in language education research.",
  },
  {
    name: "Marcus Chen",
    role: "CTO & Co-Founder",
    bio: "AI researcher with experience at leading tech companies, passionate about educational technology.",
  },
  {
    name: "Sofia Andersson",
    role: "Head of Product",
    bio: "Product leader with background in EdTech, multilingual speaker of 5 languages.",
  },
  {
    name: "James Okonkwo",
    role: "Head of Content",
    bio: "Curriculum designer and polyglot, formerly at major language learning platforms.",
  },
];

const milestones = [
  { year: "2024", event: "Fluentina founded with a mission to democratize language learning" },
  { year: "2025", event: "Launched beta with 1,000 early adopters" },
  { year: "2026", event: "Scaling up" }
];

const About = () => {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-brand-subtle py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-3xl text-center">
            <h1 className="mb-6 text-4xl font-bold text-foreground md:text-5xl">
              Our Mission: Make Language Learning{" "}
              <span className="text-gradient-brand">Personal</span>
            </h1>
            <p className="text-lg text-muted-foreground md:text-xl">
              We believe everyone deserves a personal language mentor. Fluentina combines
              the best of AI technology with proven pedagogical methods to create truly
              personalized learning experiences.
            </p>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="py-20">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <div className="grid gap-12 md:grid-cols-2">
              <div>
                <h2 className="mb-6 text-3xl font-bold text-foreground">
                  Our <span className="text-gradient-brand">Story</span>
                </h2>
                <div className="space-y-4 text-muted-foreground">
                  <p>
                    Fluentina was born from a simple observation: despite countless language
                    learning apps, most learners plateau after reaching intermediate level.
                    Traditional apps focus on vocabulary and basic grammar, but struggle to
                    help learners develop real communication skills.
                  </p>
                  <p>
                    Our founders came together with a shared vision: create an AI mentor that could provide the kind of
                    personalized feedback that was previously only available through expensive
                    private tutoring.
                  </p>
                  <p>
                    Today, Fluentina helps learners worldwide improve their
                    writing, speaking, and overall communication skills in their target
                    language. We're just getting started.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {milestones.map((milestone) => (
                  <div key={milestone.year} className="flex gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-gradient-brand text-sm font-bold text-white">
                      {milestone.year.slice(2)}
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{milestone.year}</div>
                      <div className="text-sm text-muted-foreground">{milestone.event}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="bg-muted/30 py-20">
        <div className="container mx-auto px-4">
          <h2 className="mb-12 text-center text-3xl font-bold text-foreground md:text-4xl">
            Our <span className="text-gradient-brand">Values</span>
          </h2>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {values.map((value) => (
              <Card key={value.title} className="card-elevated border-0 text-center">
                <CardContent className="p-6">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-brand">
                    <value.icon className="h-7 w-7 text-white" />
                  </div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{value.title}</h3>
                  <p className="text-sm text-muted-foreground">{value.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="bg-gradient-brand py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
            Get in Touch
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-white/80">
            Have questions about Fluentina? Want to explore partnerships? We'd love to hear from you.
          </p>
          <div className="mb-8 flex flex-col items-center justify-center gap-6 sm:flex-row">
            <div className="flex items-center gap-2 text-white">
              <Mail className="h-5 w-5" />
              support@fluentina.com
            </div>
            <div className="flex items-center gap-2 text-white">
              <MapPin className="h-5 w-5" />
              Berlin, Deutschland
            </div>
          </div>
          <Button size="lg" variant="secondary" asChild>
            <a href="mailto:support@fluentina.com">
              Contact Us
              <ArrowRight className="ml-2 h-5 w-5" />
            </a>
          </Button>
        </div>
      </section>
    </>
  );
};

export default About;
