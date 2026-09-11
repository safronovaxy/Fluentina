import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Target,
  Mail,
  RotateCcw,
  PenTool,
  Trophy,
  Star,
  Lightbulb,
} from 'lucide-react';
import { usePlacementTest } from '../PlacementTestContext';

// ─── Constants ────────────────────────────────────────────────────

const CEFR_LABEL: Record<string, string> = {
  A1: 'Beginner',
  A2: 'Elementary',
  B1: 'Intermediate',
  B2: 'Upper-Intermediate',
  C1: 'Advanced',
  C2: 'Proficient',
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.fluentina.com';

// ─── Component ───────────────────────────────────────────────────

export function ResultsStep() {
  const { state, dispatch } = usePlacementTest();
  const results = state.results;

  if (!results) return null;

  const cefrLabel = CEFR_LABEL[results.cefrLevel] ?? '';
  const signupUrl = `${APP_URL}?mode=signup&level=${results.cefrLevel}&lang=${encodeURIComponent(state.language ?? '')}`;

  const dimensions: Array<{ key: keyof typeof results.dimensionScores; label: string }> = [
    { key: 'range', label: 'Range' },
    { key: 'accuracy', label: 'Accuracy' },
    { key: 'coherenceAndCohesion', label: 'Coherence & Cohesion' },
    { key: 'taskFulfilment', label: 'Task Fulfilment' },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-brand">
              <PenTool className="h-4 w-4 text-white" />
            </div>
            <span className="text-lg font-bold text-foreground">Fluentina</span>
          </a>
          <Badge className="bg-primary/10 text-primary border-0">Test Complete</Badge>
        </div>
      </header>

      <main className="container mx-auto max-w-3xl px-4 py-10 space-y-8">

        {/* Hero Result */}
        <div className="text-center">
          <div className="mx-auto mb-6 flex h-28 w-28 items-center justify-center rounded-full bg-gradient-brand shadow-lg shadow-primary/25">
            <span className="text-4xl font-black text-white">{results.cefrLevel}</span>
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2">
            Your {state.language} Level:{' '}
            <span className="text-gradient-brand">{results.cefrLevel} — {cefrLabel}</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Overall Score: <strong>{results.overallScore}%</strong>
          </p>
        </div>

        {/* Summary */}
        <Card className="border-0 shadow-sm">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground leading-relaxed">
              {results.highLevelSummary}
            </p>
          </CardContent>
        </Card>

        {/* Skill Breakdown */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              Skill Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {dimensions.map(({ key, label }) => {
              const score = results.dimensionScores[key];
              return (
                <div key={key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{label}</span>
                    <span className="text-muted-foreground">{score}%</span>
                  </div>
                  <Progress value={score} className="h-2" />
                </div>
              );
            })}
          </CardContent>
        </Card>

        {/* Strengths & Improvement */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-green-600">
                <Star className="h-5 w-5" />
                Your Strengths
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.strongAreas.map((area, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{area}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                <Lightbulb className="h-5 w-5" />
                Areas to Improve
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {results.improvementAreas.map((area, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-muted-foreground">{area}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Recommendation */}
        <Card className="border-0 shadow-sm bg-gradient-brand-subtle">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-brand">
                <TrendingUp className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground mb-1">Our Recommendation</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {results.recommendations}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Email notice */}
        {state.userInfo?.email && (
          <div className="flex items-start gap-3 rounded-xl bg-primary/10 border border-primary/20 p-4">
            <Mail className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <p className="text-sm text-foreground">
              <strong>Detailed report sent!</strong> A full analysis with question-by-question
              feedback has been emailed to{' '}
              <span className="font-medium">{state.userInfo.email}</span>.
            </p>
          </div>
        )}

        {/* CTAs */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-brand">
                <Trophy className="h-6 w-6 text-white" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Start Improving Today</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Get AI-personalised writing exercises tailored to your {results.cefrLevel} level.
              </p>
              <a href={signupUrl} target="_blank" rel="noopener noreferrer" className="block">
                <Button className="w-full bg-gradient-brand text-white">
                  <Trophy className="mr-2 h-4 w-4" />
                  Start Free Trial
                </Button>
              </a>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="pt-6 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-2">Detailed Report</h3>
              <p className="text-xs text-muted-foreground mb-4">
                {state.userInfo?.email
                  ? `Sent to ${state.userInfo.email}`
                  : 'A full breakdown has been sent to your email.'}
              </p>
              <div className="flex items-center justify-center gap-1.5 text-sm text-green-600 font-medium">
                <CheckCircle2 className="h-4 w-4" />
                Report Delivered
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Take again */}
        <div className="text-center pb-8">
          <button
            type="button"
            onClick={() => dispatch({ type: 'RESET' })}
            className="text-sm text-muted-foreground hover:text-foreground underline-offset-4 hover:underline flex items-center gap-1.5 mx-auto"
          >
            <RotateCcw className="w-4 h-4" />
            Take the test again
          </button>
        </div>
      </main>
    </div>
  );
}
