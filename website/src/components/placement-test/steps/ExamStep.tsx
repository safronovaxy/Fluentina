import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  ArrowRight,
  Send,
  Loader2,
  Clock,
  PenTool,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePlacementTest } from '../PlacementTestContext';
import { evaluatePlacementTest } from '@/lib/placement-test-api';
import type { PlacementTask } from '@/lib/placement-test-api';

// ─── Constants ───────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: 'Multiple Choice',
  fill_in_blank: 'Fill in the Gap',
  text_response: 'Writing',
  sentence_ordering: 'Reorder Words',
  error_correction: 'Error Correction',
  reading_comprehension: 'Reading',
  matching: 'Matching',
};

const CEFR_COLORS: Record<string, string> = {
  A1: 'bg-slate-100 text-slate-700',
  A2: 'bg-blue-100 text-blue-700',
  B1: 'bg-green-100 text-green-700',
  B2: 'bg-teal-100 text-teal-700',
  C1: 'bg-purple-100 text-purple-700',
  C2: 'bg-amber-100 text-amber-700',
};

// ─── Sentence Ordering (needs own component for useState) ────────

function SentenceOrderingInput({
  task,
  answers,
  onChange,
}: {
  task: PlacementTask;
  answers: Record<string, string>;
  onChange: (taskId: string, value: string) => void;
}) {
  const val = answers[task.id] ?? '';
  const [selected, setSelected] = useState<string[]>(() =>
    val ? val.split(' ').filter(Boolean) : []
  );

  // Words still available to place (remove one instance per selected word)
  const remaining = [...(task.shuffledParts ?? [])];
  selected.forEach((w) => {
    const idx = remaining.indexOf(w);
    if (idx !== -1) remaining.splice(idx, 1);
  });

  function addWord(word: string) {
    const next = [...selected, word];
    setSelected(next);
    onChange(task.id, next.join(' '));
  }

  function removeWord(i: number) {
    const next = selected.filter((_, idx) => idx !== i);
    setSelected(next);
    onChange(task.id, next.join(' '));
  }

  function clearAll() {
    setSelected([]);
    onChange(task.id, '');
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground font-medium">
        Tap words to build the sentence:
      </p>

      {/* Available word chips */}
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {remaining.map((w, i) => (
          <Badge
            key={`avail-${w}-${i}`}
            variant="secondary"
            className="text-sm py-1 px-2.5 cursor-pointer select-none hover:bg-primary hover:text-primary-foreground transition-colors"
            onClick={() => addWord(w)}
          >
            {w}
          </Badge>
        ))}
        {remaining.length === 0 && selected.length > 0 && (
          <span className="text-xs text-muted-foreground italic self-center">All words placed</span>
        )}
      </div>

      {/* Answer drop zone */}
      <div
        className={cn(
          'min-h-[42px] rounded-md border px-3 py-2 flex flex-wrap gap-1.5 items-center transition-colors',
          selected.length > 0 ? 'border-primary/50 bg-primary/5' : 'border-input bg-background'
        )}
      >
        {selected.length === 0 ? (
          <span className="text-sm text-muted-foreground">Tap words above to build your sentence…</span>
        ) : (
          selected.map((w, i) => (
            <Badge
              key={`sel-${i}`}
              className="text-sm py-1 px-2.5 cursor-pointer select-none gap-1"
              onClick={() => removeWord(i)}
            >
              {w}
              <span className="opacity-60 ml-0.5">×</span>
            </Badge>
          ))
        )}
      </div>

      {selected.length > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ─── Inline task renderer ────────────────────────────────────────

function TaskInput({
  task,
  answers,
  onChange,
}: {
  task: PlacementTask;
  answers: Record<string, string>;
  onChange: (taskId: string, value: string) => void;
}) {
  const val = answers[task.id] ?? '';

  if (task.type === 'multiple_choice') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{task.question}</p>
        <RadioGroup value={val} onValueChange={(v) => onChange(task.id, v)}>
          {task.options?.map((opt) => (
            <div key={opt} className="flex items-center space-x-2">
              <RadioGroupItem value={opt} id={`${task.id}-${opt}`} />
              <Label
                htmlFor={`${task.id}-${opt}`}
                className="text-sm cursor-pointer text-foreground"
              >
                {opt}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    );
  }

  if (task.type === 'fill_in_blank') {
    const parts = (task.template ?? '').split('___');
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-sm leading-relaxed">
        {parts.map((part, i) => (
          <span key={i} className="contents">
            <span className="text-foreground">{part}</span>
            {i < parts.length - 1 && (
              <Input
                className="inline-flex w-44 h-8 text-sm"
                placeholder="…"
                value={val}
                onChange={(e) => onChange(task.id, e.target.value)}
              />
            )}
          </span>
        ))}
        {parts.length === 1 && task.blanks && task.blanks > 0 && (
          // fallback: template had no ___ markers
          <Input
            className="w-full h-9 text-sm mt-2"
            placeholder="Type your answer…"
            value={val}
            onChange={(e) => onChange(task.id, e.target.value)}
          />
        )}
      </div>
    );
  }

  if (task.type === 'text_response') {
    const wordCount = val.split(/\s+/).filter(Boolean).length;
    const minWords = task.minWords ?? 40;
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{task.prompt ?? task.question}</p>
        <p className="text-xs text-muted-foreground">Minimum {minWords} words</p>
        <Textarea
          placeholder="Write your response…"
          value={val}
          onChange={(e) => onChange(task.id, e.target.value)}
          className="min-h-[100px]"
        />
        <p
          className={cn(
            'text-xs text-right',
            wordCount >= minWords ? 'text-green-600 font-medium' : 'text-muted-foreground'
          )}
        >
          {wordCount} / {minWords} words
        </p>
      </div>
    );
  }

  if (task.type === 'sentence_ordering') {
    return <SentenceOrderingInput task={task} answers={answers} onChange={onChange} />;
  }

  if (task.type === 'error_correction') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground font-medium">
          Find and correct the error in this sentence:
        </p>
        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm text-foreground italic">
          {task.sentence}
        </div>
        <Input
          placeholder="Write the corrected sentence…"
          value={val}
          onChange={(e) => onChange(task.id, e.target.value)}
        />
      </div>
    );
  }

  if (task.type === 'reading_comprehension') {
    return (
      <div className="space-y-4">
        <div className="rounded-md bg-accent/5 border border-accent/20 px-4 py-3 text-sm text-foreground leading-relaxed">
          {task.passage}
        </div>
        {task.subQuestions?.map((sq, i) => (
          <div key={sq.id} className="pl-4 border-l-2 border-border space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Question {i + 1}
            </p>
            <TaskInput task={sq} answers={answers} onChange={onChange} />
          </div>
        ))}
      </div>
    );
  }

  if (task.type === 'matching') {
    // Use JSON encoding to safely handle commas/arrows inside values
    const pairs: Record<string, string> = (() => {
      if (!val) return {};
      try {
        return JSON.parse(val);
      } catch {
        return {};
      }
    })();

    function updatePair(left: string, right: string) {
      const newPairs = { ...pairs, [left]: right };
      onChange(task.id, JSON.stringify(newPairs));
    }

    return (
      <div className="space-y-3">
        <p className="text-sm text-foreground font-medium">
          Match each item on the left with the correct answer on the right:
        </p>
        {task.leftItems?.map((left) => (
          <div key={left} className="flex items-center gap-3 text-sm">
            <span className="w-40 font-medium text-foreground shrink-0 truncate">{left}</span>
            <span className="text-muted-foreground">→</span>
            <select
              className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              value={pairs[left] ?? ''}
              onChange={(e) => updatePair(left, e.target.value)}
            >
              <option value="">Choose…</option>
              {task.rightItems?.map((right) => (
                <option key={right} value={right}>
                  {right}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
    );
  }

  return null;
}

// ─── Question Card ───────────────────────────────────────────────

function QuestionCard({
  task,
  index,
  answers,
  onChange,
}: {
  task: PlacementTask;
  index: number;
  answers: Record<string, string>;
  onChange: (taskId: string, value: string) => void;
}) {
  const hasAnswer =
    task.type === 'reading_comprehension'
      ? task.subQuestions?.some((sq) => answers[sq.id]?.trim())
      : !!answers[task.id]?.trim();

  return (
    <Card
      className={cn(
        'border shadow-sm transition-colors',
        hasAnswer ? 'border-primary/30' : 'border-border'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {index}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {TYPE_LABELS[task.type] ?? task.type}
            </Badge>
          </div>
          <Badge
            variant="secondary"
            className={cn('text-[10px]', CEFR_COLORS[task.targetCEFR])}
          >
            {task.targetCEFR}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{task.instruction}</p>
      </CardHeader>
      <CardContent>
        <TaskInput task={task} answers={answers} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

// ─── Main ExamStep ───────────────────────────────────────────────

export function ExamStep() {
  const { state, dispatch } = usePlacementTest();
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Always keep a fresh ref to the latest answers so handleSubmit
  // never captures a stale closure from an earlier render.
  const answersRef = useRef(state.answers);
  answersRef.current = state.answers;

  const test = state.test;
  if (!test) return null;

  const sections = test.sections;
  const activeSection = sections[currentSectionIndex];

  // Count answered tasks (reading_comprehension counts if any sub-question answered)
  const answeredCount = sections.flatMap((s) => s.tasks).filter((task) => {
    if (task.type === 'reading_comprehension') {
      return task.subQuestions?.some((sq) => state.answers[sq.id]?.trim());
    }
    return !!state.answers[task.id]?.trim();
  }).length;
  const totalTasks = sections.reduce((sum, s) => sum + s.tasks.length, 0);

  // Running task index offset for display numbering
  const sectionOffset = sections
    .slice(0, currentSectionIndex)
    .reduce((sum, s) => sum + s.tasks.length, 0);

  function handleChange(taskId: string, value: string) {
    dispatch({ type: 'SET_ANSWER', payload: { taskId, answer: value } });
  }

  async function handleSubmit() {
    if (!state.language || !state.nativeLanguage || !state.test) {
      toast.error('Test data missing. Please start again.');
      return;
    }
    if (!state.userInfo?.email) {
      toast.error('User information missing. Please start again.');
      return;
    }

    setIsSubmitting(true);
    dispatch({ type: 'SET_EVALUATING', payload: true });

    try {
      const answers = answersRef.current;
      const results = await evaluatePlacementTest({
        testId: state.test.id,
        language: state.language,
        nativeLanguage: state.nativeLanguage,
        answers,
        email: state.userInfo.email,
        firstName: state.userInfo.firstName,
      });
      dispatch({ type: 'SET_RESULTS', payload: results });
    } catch (err: any) {
      dispatch({ type: 'SET_ERROR', payload: err?.message || 'Evaluation failed' });
      toast.error('Failed to evaluate your test. Please try again.');
      setIsSubmitting(false);
    }
  }

  // Evaluation loading overlay
  if (isSubmitting || state.isEvaluating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-6 px-4">
        <div className="w-16 h-16 bg-gradient-brand rounded-2xl flex items-center justify-center">
          <Loader2 className="w-8 h-8 text-white animate-spin" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-semibold mb-2">Evaluating your answers…</h2>
          <p className="text-muted-foreground text-sm max-w-sm">
            Our AI is analysing your responses and determining your CEFR level.
            This usually takes 15–30 seconds.
          </p>
        </div>
        <div className="w-64">
          <Progress value={undefined} className="h-2 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <a href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-brand">
                <PenTool className="h-3.5 w-3.5 text-white" />
              </div>
              <span className="text-sm font-bold text-foreground hidden sm:inline">Fluentina</span>
            </a>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                if (currentSectionIndex > 0) setCurrentSectionIndex((i) => i - 1);
                else dispatch({ type: 'SET_STEP', payload: 'intro' });
              }}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {test.language} Placement Test
              </h2>
              <p className="text-xs text-muted-foreground">{activeSection.title}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {answeredCount}/{totalTasks} answered
              </p>
              <Progress
                value={(answeredCount / totalTasks) * 100}
                className="h-1.5 w-32"
              />
            </div>
            <Badge variant="outline" className="gap-1 hidden sm:flex">
              <Clock className="h-3 w-3" />
              ~20 min
            </Badge>
          </div>
        </div>

        {/* Section tabs */}
        <div className="container mx-auto flex gap-1 px-4 pb-2">
          {sections.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrentSectionIndex(i)}
              className={cn(
                'flex-1 rounded-md py-1.5 text-xs font-medium transition-colors',
                i === currentSectionIndex
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              <span className="hidden sm:inline">{s.title}</span>
              <span className="sm:hidden">{i + 1}</span>
            </button>
          ))}
        </div>
      </header>

      {/* Questions */}
      <main className="container mx-auto max-w-3xl px-4 py-6 space-y-5">
        {activeSection.tasks.map((task, qIdx) => (
          <QuestionCard
            key={task.id}
            task={task}
            index={sectionOffset + qIdx + 1}
            answers={state.answers}
            onChange={handleChange}
          />
        ))}

        {/* Navigation */}
        <div className="flex justify-between pt-4 pb-8">
          <Button
            variant="outline"
            onClick={() => setCurrentSectionIndex((i) => Math.max(0, i - 1))}
            disabled={currentSectionIndex === 0}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Previous Section
          </Button>

          {currentSectionIndex < sections.length - 1 ? (
            <Button onClick={() => setCurrentSectionIndex((i) => i + 1)}>
              Next Section
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          ) : (
            <Button
              className="bg-gradient-brand text-white"
              onClick={handleSubmit}
            >
              <Send className="mr-2 h-4 w-4" />
              Submit for Evaluation
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
