'use client';

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Clock,
  Users,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Star,
  Zap,
  BookOpen,
  MessageSquare,
  Gift,
  TrendingUp,
  Lightbulb,
  Send,
  CheckCircle,
} from "lucide-react";

const STRAPI_URL =
  process.env.NEXT_PUBLIC_STRAPI_URL ||
  "https://writewise-cms-m2xkjyh6ta-oe.a.run.app";

const applySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: "Name is required" })
    .max(100, { message: "Name must be less than 100 characters" }),
  email: z
    .string()
    .trim()
    .email({ message: "Please enter a valid email address" })
    .max(255, { message: "Email must be less than 255 characters" }),
  language: z.string().min(1, { message: "Please select a language" }),
  seats: z.string().min(1, { message: "Please select a student seat range" }),
  message: z
    .string()
    .trim()
    .max(500, { message: "Message must be less than 500 characters" })
    .optional(),
  consent: z.literal(true, {
    errorMap: () => ({ message: "You must agree to be contacted" }),
  }),
});

type ApplyFormData = z.infer<typeof applySchema>;

const languages = [
  { value: "German", label: "German" },
  { value: "English", label: "English" },
  { value: "French", label: "French" },
  { value: "Spanish", label: "Spanish" },
  { value: "Italian", label: "Italian" },
  { value: "Portuguese", label: "Portuguese" },
  { value: "Other", label: "Other" },
];

const seatRanges = [
  { value: "1–5", label: "1–5 students" },
  { value: "6–10", label: "6–10 students" },
  { value: "11–20", label: "11–20 students" },
  { value: "21+", label: "21+ students" },
];

const TutorApplyForm = () => {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ApplyFormData>({
    resolver: zodResolver(applySchema),
    defaultValues: {
      name: "",
      email: "",
      language: "",
      seats: "",
      message: "",
    },
  });

  const onSubmit = async (data: ApplyFormData) => {
    setIsSubmitting(true);

    const bodyText = [
      `Language taught: ${data.language}`,
      `Student seats needed: ${data.seats}`,
      data.message ? `\nMessage:\n${data.message}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const response = await fetch(`${STRAPI_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: data.name,
          email: data.email,
          subject: "freelancer-apply",
          message: bodyText,
        }),
      });

      if (!response.ok) throw new Error("Failed to send application");

      setIsSubmitted(true);
      toast.success("Application sent successfully!");
    } catch (error) {
      console.error("Error sending application:", error);
      toast.error("Failed to send application. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>
        <h3 className="mb-2 text-xl font-semibold">Application Received!</h3>
        <p className="text-muted-foreground">
          Thanks for applying. We'll review your application and get back to you
          soon.
        </p>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Full Name</FormLabel>
                <FormControl>
                  <Input placeholder="Jane Smith" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email Address</FormLabel>
                <FormControl>
                  <Input
                    type="email"
                    placeholder="jane@example.com"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Language You Teach</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a language" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {languages.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="seats"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Student Seats Needed</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a range" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {seatRanges.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="message"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                Short Message{" "}
                <span className="text-muted-foreground font-normal">
                  (optional, max 500 characters)
                </span>
              </FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Tell us a bit about your tutoring practice, your students, or any questions you have..."
                  className="min-h-[120px] resize-none"
                  maxLength={500}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="consent"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3 space-y-0">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
              <div className="leading-snug">
                <FormLabel className="font-normal cursor-pointer">
                  I agree to be contacted by the Fluentina team regarding my
                  application to the freelance tutor programme.
                </FormLabel>
                <FormMessage />
              </div>
            </FormItem>
          )}
        />

        <Button
          type="submit"
          size="lg"
          className="w-full bg-gradient-brand hover:opacity-90"
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Sending...
            </>
          ) : (
            <>
              <Send className="mr-2 h-4 w-4" />
              Apply for the Beta
            </>
          )}
        </Button>
      </form>
    </Form>
  );
};

// ─── Page data ───────────────────────────────────────────────────────────────

const painPoints = [
  {
    icon: Clock,
    title: "Hours Lost Searching",
    description:
      "Stop spending valuable time hunting for the right exercise for each student's level and goals.",
  },
  {
    icon: BookOpen,
    title: "Tedious Submission Reviews",
    description:
      "Manual review of every student submission drains energy that should go toward teaching.",
  },
  {
    icon: Users,
    title: "Capped Student Capacity",
    description:
      "Administrative overhead limits how many students you can take on, capping your income potential.",
  },
];

const benefits = [
  {
    icon: Zap,
    title: "Instant Exercise Matching",
    description:
      "AI instantly surfaces the perfect exercise for any student's CEFR level and learning objective — no searching required.",
  },
  {
    icon: MessageSquare,
    title: "AI-Assisted Review",
    description:
      "Fluentina pre-reviews student submissions with detailed feedback. You validate and add personal touches — in a fraction of the time.",
  },
  {
    icon: Users,
    title: "Grow Your Student Roster",
    description:
      "Save 60–70% of admin time and reinvest it in taking on more students — or simply enjoy more time for yourself.",
  },
  {
    icon: BarChart3,
    title: "Student Performance Analytics",
    description:
      "See exactly where each student struggles and excels. Make data-driven decisions to tailor learning paths with confidence.",
  },
  {
    icon: TrendingUp,
    title: "Track Every Milestone",
    description:
      "Visualise progress over time for each student and share achievement reports that wow parents and sponsors.",
  },
  {
    icon: Lightbulb,
    title: "Smarter Lesson Planning",
    description:
      "Analytics reveal patterns across your whole student group — spot common weaknesses and address them proactively.",
  },
];

const howItWorks = [
  {
    number: "01",
    title: "You Join as a Tutor",
    description:
      "Create your tutor account and configure your preferred languages and CEFR levels.",
  },
  {
    number: "02",
    title: "Invite Your Students",
    description:
      "Students join for free under your tutor account. Seats are flexible — reassign them anytime.",
  },
  {
    number: "03",
    title: "Assign & Monitor",
    description:
      "Assign exercises in seconds. Students complete them and receive instant AI feedback.",
  },
  {
    number: "04",
    title: "Review with AI Assist",
    description:
      "Open submissions with AI pre-analysis already done. Approve, add notes, and move on in minutes.",
  },
];

const testimonials = [
  {
    name: "Andreea R.",
    role: "Freelance English Tutor · 14 students",
    content:
      "I used to spend Sunday evenings preparing exercises. Now I spend 20 minutes and have a full week ready. I've taken on three new students since starting the beta.",
    rating: 5,
  },
  {
    name: "Jonas K.",
    role: "German Language Coach · 9 students",
    content:
      "The analytics completely changed how I plan lessons. I spotted that half my students had the same grammar gap — one targeted exercise fixed it for everyone.",
    rating: 5,
  },
  {
    name: "Fatima L.",
    role: "French & Spanish Tutor · 11 students",
    content:
      "My students love the instant feedback. And I love that I can see exactly where they are without waiting for the next session.",
    rating: 5,
  },
];

const pricingHighlights = [
  "Monthly subscription — one flat rate per tutor",
  "Includes a set number of active student seats",
  "Seats are transferable between students at any time",
  "Students always use the platform free of charge",
  "Scale seats up as your roster grows",
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const Freelancers = () => {
  return (
    <>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-brand-subtle py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
              <Gift className="h-4 w-4" />
              Beta Programme — 100 Spots · 3 Months Free
            </div>
            <h1 className="mb-6 text-4xl font-bold tracking-tight text-foreground md:text-5xl lg:text-6xl">
              Your AI Co-Pilot for{" "}
              <span className="text-gradient-brand">Freelance Language Tutoring</span>
            </h1>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-muted-foreground md:text-xl">
              Fluentina handles exercise discovery and submission review so you spend less time on
              admin and more time on what you love — and on growing your student roster.
            </p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button size="lg" className="bg-gradient-brand px-8 hover:opacity-90" asChild>
                <a href="#apply">
                  Apply for the Beta
                  <ArrowRight className="ml-2 h-5 w-5" />
                </a>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <a href="#how-it-works">See How It Works</a>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Limited to 100 freelance tutors · No credit card required during beta
            </p>
          </div>
        </div>
        <div className="absolute -left-20 -top-20 h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-20 -right-20 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
      </section>

      {/* Pain Points */}
      <section className="border-y bg-background py-16">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-12 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Sound <span className="text-gradient-brand">Familiar?</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Every freelance tutor hits these walls. Fluentina is built to break through them.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {painPoints.map((point) => (
              <div key={point.title} className="flex gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                  <point.icon className="h-6 w-6 text-destructive" />
                </div>
                <div>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{point.title}</h3>
                  <p className="text-muted-foreground">{point.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Everything You Need to{" "}
              <span className="text-gradient-brand">Teach Smarter</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Fluentina becomes the silent assistant that never takes a day off.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            {benefits.map((benefit) => (
              <Card
                key={benefit.title}
                className="card-elevated border-0 transition-transform hover:-translate-y-1"
              >
                <CardContent className="p-6">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-brand">
                    <benefit.icon className="h-6 w-6 text-white" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-foreground">{benefit.title}</h3>
                  <p className="text-muted-foreground">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="bg-muted/30 py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              How <span className="text-gradient-brand">Fluentina</span> Works for Tutors
            </h2>
            <p className="text-lg text-muted-foreground">
              From setup to your first reviewed submission — in under an hour.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {howItWorks.map((step, index) => (
              <div key={step.number} className="relative">
                <div className="mb-4 text-5xl font-bold text-primary/20">{step.number}</div>
                <h3 className="mb-2 text-xl font-semibold text-foreground">{step.title}</h3>
                <p className="text-muted-foreground">{step.description}</p>
                {index < howItWorks.length - 1 && (
                  <div className="absolute right-0 top-8 hidden h-0.5 w-full bg-gradient-to-r from-primary/20 to-transparent lg:block lg:w-1/2" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Model */}
      <section className="py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-4xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
                  A Model Built{" "}
                  <span className="text-gradient-brand">for Freelancers</span>
                </h2>
                <p className="mb-8 text-lg text-muted-foreground">
                  One predictable monthly rate for you. Completely free for your students. Active
                  seats that move with your roster — because student life isn't linear.
                </p>
                <ul className="space-y-4">
                  {pricingHighlights.map((point) => (
                    <li key={point} className="flex items-start gap-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                      <span className="text-foreground">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Card className="card-elevated border-0">
                <CardContent className="p-8 text-center">
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                    <Gift className="h-4 w-4" />
                    Beta Offer
                  </div>
                  <div className="mb-2 text-6xl font-bold text-gradient-brand">Free</div>
                  <p className="mb-2 text-xl font-medium text-foreground">3 months, on us</p>
                  <p className="mb-8 text-muted-foreground">
                    Join as one of 100 beta tutors, use the platform intensively, and share honest
                    feedback on features and experience.
                  </p>
                  <Button size="lg" className="w-full bg-gradient-brand hover:opacity-90" asChild>
                    <a href="#apply">
                      Apply Now — Limited Spots
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </a>
                  </Button>
                  <p className="mt-4 text-sm text-muted-foreground">
                    100 spots total · Applications reviewed in order received
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="bg-muted/30 py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
              Early Tutors <span className="text-gradient-brand">Love It</span>
            </h2>
            <p className="text-lg text-muted-foreground">
              Hear from tutors already in our early access programme.
            </p>
          </div>
          <div className="grid gap-8 md:grid-cols-3">
            {testimonials.map((testimonial) => (
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
            ))}
          </div>
        </div>
      </section>

      {/* Apply Form */}
      <section id="apply" className="bg-gradient-brand-subtle py-20 lg:py-32">
        <div className="container mx-auto px-4">
          <div className="mx-auto max-w-2xl">
            <div className="mb-10 text-center">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary">
                <Gift className="h-4 w-4" />
                Only 100 spots available
              </div>
              <h2 className="mb-4 text-3xl font-bold text-foreground md:text-4xl">
                Ready to Reclaim Your Time and{" "}
                <span className="text-gradient-brand">Grow Your Business?</span>
              </h2>
              <p className="text-lg text-muted-foreground">
                Apply for the Fluentina beta for freelance tutors. Three months free — your feedback
                shapes the product.
              </p>
            </div>
            <div className="rounded-2xl border bg-card p-8 shadow-sm">
              <TutorApplyForm />
            </div>
          </div>
        </div>
      </section>
    </>
  );
};

export default Freelancers;
