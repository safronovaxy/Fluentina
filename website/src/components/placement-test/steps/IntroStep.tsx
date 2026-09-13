import { useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Clock,
  Brain,
  Target,
  BookOpen,
  Shield,
  CheckCircle2,
  ArrowRight,
  Loader2,
  PenTool,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePlacementTest } from '../PlacementTestContext';
import { generatePlacementTest, registerPlacementLead } from '@/lib/placement-test-api';

// ============================================================================
// Shared constants
// ============================================================================

const SUPPORTED_LANGUAGES = [
  { value: 'English',    label: 'English' },
  { value: 'German',     label: 'German' },
  { value: 'Spanish',    label: 'Spanish' },
  { value: 'French',     label: 'French' },
  { value: 'Italian',    label: 'Italian' },
  { value: 'Portuguese', label: 'Portuguese' },
];

const registrationSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(50),
  lastName:  z.string().trim().min(1, 'Last name is required').max(50),
  email:     z.string().trim().email('Please enter a valid email').max(255),
  consent:   z.boolean().refine((v) => v === true, { message: 'You must consent to continue' }),
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

// ============================================================================
// Page header (shared)
// ============================================================================

function TestHeader({ language }: { language: string | null }) {
  return (
    <header className="border-b bg-card">
      <div className="container mx-auto flex items-center justify-between px-4 py-4">
        <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand">
            <PenTool className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-bold text-foreground">Fluentina</span>
        </a>
        <Badge variant="outline" className="text-xs">Free Assessment</Badge>
      </div>
    </header>
  );
}

// ============================================================================
// CombinedIntroView — explanation + registration form on one page (new users)
// ============================================================================

function CombinedIntroView() {
  const { state, dispatch } = usePlacementTest();
  const [isStarting, setIsStarting] = useState(false);
  const [showNativeOverride, setShowNativeOverride] = useState(false);

  const form = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: { firstName: '', lastName: '', email: '', consent: false },
  });

  async function onSubmit(data: RegistrationFormData) {
    setIsStarting(true);
    dispatch({ type: 'SET_GENERATING', payload: true });

    try {
      const { success } = await registerPlacementLead({
        firstName: data.firstName,
        lastName:  data.lastName,
        email:     data.email,
        language:  state.language ?? 'English',
        consent:   true,
      });

      if (success) {
        dispatch({
          type: 'REGISTER_SUCCESS',
          payload: {
            userInfo: {
              firstName: data.firstName,
              lastName:  data.lastName,
              email:     data.email,
            },
            language:       state.language ?? 'English',
            nativeLanguage: state.nativeLanguage,
          },
        });
      }

      const test = await generatePlacementTest({
        language:       state.language ?? 'English',
        nativeLanguage: state.nativeLanguage,
      });
      dispatch({ type: 'SET_TEST', payload: test });
    } catch (err: any) {
      toast.error('Something went wrong. Please try again.');
      console.error('Test start error:', err);
      dispatch({ type: 'SET_GENERATING', payload: false });
      setIsStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <TestHeader language={state.language} />

      <main className="container mx-auto max-w-6xl px-4 py-12">
        {/* Title */}
        <div className="text-center mb-10">
          <Badge className="mb-4 bg-primary/10 text-primary border-0 px-4 py-1.5 text-sm">
            <Target className="mr-1.5 h-3.5 w-3.5 inline" />
            {state.language} Placement Test
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Discover Your{' '}
            <span className="text-gradient-brand">{state.language} Level</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Find your exact CEFR level across all language skills and get a personalised
            learning report — completely free.
          </p>
        </div>

        {/* At-a-glance cards */}
        <div className="grid gap-4 sm:grid-cols-3 mb-10">
          {[
            { icon: Clock,  title: '~20 Minutes', desc: 'Complete at your own pace — no time limit per question' },
            { icon: Brain,  title: '20 Questions', desc: 'Covering grammar, vocabulary, writing, and comprehension' },
            { icon: Target, title: 'CEFR Assessment', desc: 'Get your exact level from A1 to C2 with detailed analysis' },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border-0 shadow-sm text-center">
              <CardContent className="pt-6 pb-4">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Two-column layout: explanation left, form right */}
        <div className="grid lg:grid-cols-2 gap-8 items-start">

          {/* ── Left column: How It Works + Before You Start ── */}
          <div className="space-y-6">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="h-5 w-5 text-primary" />
                  How It Works
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  {
                    step: '1',
                    title: 'Answer diverse question types',
                    desc: 'Multiple choice, fill-in-the-gap, sentence reordering, error correction, matching, and short writing tasks.',
                  },
                  {
                    step: '2',
                    title: 'Questions progress across CEFR levels',
                    desc: 'The test covers A1 through C2 — foundations, intermediate, and advanced — gradually increasing in difficulty.',
                  },
                  {
                    step: '3',
                    title: 'Get instant results',
                    desc: 'Receive your CEFR level with a skill breakdown across vocabulary, grammar, reading, and writing.',
                  },
                  {
                    step: '4',
                    title: 'Receive a detailed report',
                    desc: 'A comprehensive analysis is emailed to you with personalised learning recommendations.',
                  },
                ].map((item) => (
                  <div key={item.step} className="flex gap-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                      {item.step}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{item.title}</h4>
                      <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm bg-muted/50">
              <CardContent className="pt-6">
                <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Shield className="h-4 w-4 text-primary" />
                  Before You Start
                </h3>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {[
                    'Find a quiet place without distractions',
                    'Answer from your current knowledge — no dictionaries or translators',
                    "If a question is too hard, skip it — that's useful information too",
                    'For writing tasks, aim for clear and natural language',
                  ].map((tip) => (
                    <li key={tip} className="flex items-start gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* ── Right column: Registration form (sticky) ── */}
          <div className="lg:sticky lg:top-24">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-xl">
                  Start your free {state.language} test
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Enter your details — we'll send your personalised level report here.
                </p>
              </CardHeader>
              <CardContent>
                {/* Native language indicator */}
                <div className="mb-5 p-3 bg-primary/5 rounded-lg border border-primary/10 flex items-center justify-between gap-4">
                  <span className="text-sm text-muted-foreground">
                    Test instructions will be in{' '}
                    <span className="font-medium text-foreground">{state.nativeLanguage}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowNativeOverride(!showNativeOverride)}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    Change
                    {showNativeOverride ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>

                {showNativeOverride && (
                  <div className="mb-5">
                    <label className="text-sm font-medium mb-1.5 block">My native language</label>
                    <Select
                      value={state.nativeLanguage}
                      onValueChange={(v) => dispatch({ type: 'SET_NATIVE_LANGUAGE', payload: v })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SUPPORTED_LANGUAGES.map((l) => (
                          <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid sm:grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>First name</FormLabel>
                            <FormControl>
                              <Input placeholder="Anna" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Last name</FormLabel>
                            <FormControl>
                              <Input placeholder="Müller" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email address</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="anna@example.com" {...field} />
                          </FormControl>
                          <FormMessage />
                          <p className="text-xs text-muted-foreground">
                            Your detailed report will be sent here.
                          </p>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="consent"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-start gap-3 space-y-0 rounded-lg border border-input p-3 bg-muted/30">
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                          </FormControl>
                          <div className="space-y-1 leading-none">
                            <FormLabel className="cursor-pointer text-sm">
                              I consent to Fluentina contacting me about language learning services.
                            </FormLabel>
                            <p className="text-xs text-muted-foreground">
                              We respect your privacy. Unsubscribe at any time.
                            </p>
                            <FormMessage />
                          </div>
                        </FormItem>
                      )}
                    />

                    <Button
                      type="submit"
                      disabled={isStarting}
                      className="w-full bg-gradient-brand hover:opacity-90 text-white py-3 text-base font-semibold h-auto"
                    >
                      {isStarting ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Preparing your test…
                        </>
                      ) : (
                        <>
                          Begin Placement Test
                          <ArrowRight className="ml-2 w-5 h-5" />
                        </>
                      )}
                    </Button>

                    {isStarting && (
                      <p className="text-xs text-muted-foreground text-center animate-pulse">
                        Our AI is generating a personalised {state.language} test — this may take
                        1–2 minutes. Please don't close this tab.
                      </p>
                    )}
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// TestDetails — shown only when user was already registered at mount (session restore)
// ============================================================================

function TestDetails() {
  const { state, dispatch } = usePlacementTest();
  const [isStarting, setIsStarting] = useState(false);

  async function handleStart() {
    if (!state.language || !state.nativeLanguage) {
      toast.error('Language information missing. Please start again.');
      dispatch({ type: 'RESET' });
      return;
    }

    setIsStarting(true);
    dispatch({ type: 'SET_GENERATING', payload: true });

    try {
      const test = await generatePlacementTest({
        language:       state.language,
        nativeLanguage: state.nativeLanguage,
      });
      dispatch({ type: 'SET_TEST', payload: test });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err?.message || 'Failed to generate test' });
      toast.error('Failed to generate your test. Please try again.');
      setIsStarting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <TestHeader language={state.language} />

      <main className="container mx-auto max-w-3xl px-4 py-12">
        <div className="text-center mb-10">
          <Badge className="mb-4 bg-primary/10 text-primary border-0 px-4 py-1.5 text-sm">
            <Target className="mr-1.5 h-3.5 w-3.5 inline" />
            {state.language} Placement Test
          </Badge>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-4">
            Welcome back,{' '}
            <span className="text-gradient-brand">{state.userInfo?.firstName}!</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-xl mx-auto">
            Ready to continue? Your previous session was saved. Click below to begin your{' '}
            {state.language} placement test.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3 mb-10">
          {[
            { icon: Clock,  title: '~20 Minutes', desc: 'Complete at your own pace — no time limit per question' },
            { icon: Brain,  title: '20 Questions', desc: 'Covering grammar, vocabulary, writing, and comprehension' },
            { icon: Target, title: 'CEFR Assessment', desc: 'Get your exact level from A1 to C2 with detailed analysis' },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="border-0 shadow-sm text-center">
              <CardContent className="pt-6 pb-4">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="text-center">
          <Button
            size="lg"
            className="bg-gradient-brand text-white px-10 text-base"
            onClick={handleStart}
            disabled={isStarting || state.isGenerating}
          >
            {isStarting || state.isGenerating ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Preparing your test…
              </>
            ) : (
              <>
                Begin Placement Test
                <ArrowRight className="ml-2 h-5 w-5" />
              </>
            )}
          </Button>
          {(isStarting || state.isGenerating) && (
            <p className="text-sm text-muted-foreground mt-3 animate-pulse">
              Our AI is generating a personalised {state.language} test — this may take 1–2 minutes.
              Please don't close this tab.
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            Instructions will be in <strong>{state.nativeLanguage}</strong>
          </p>
        </div>
      </main>
    </div>
  );
}

// ============================================================================
// IntroStep — entry point
// ============================================================================

export function IntroStep() {
  const { state } = usePlacementTest();
  // Capture registration state at mount time only.
  // If userInfo was already set when we mounted (session restore), show the
  // simplified "Begin" screen. Otherwise always render the combined view.
  const wasAlreadyRegistered = useRef(!!state.userInfo);

  if (wasAlreadyRegistered.current) {
    return <TestDetails />;
  }

  return <CombinedIntroView />;
}
