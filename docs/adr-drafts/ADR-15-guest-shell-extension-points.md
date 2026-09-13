# ADR-15: Extension points in the guest-flow shell

**Status:** Proposed — awaiting Irina's approval
**Date:** 2026-09-13
**Driver:** KAN-27, deferred out of KAN-8. Implemented on `feature/KAN-27-guest-shell-extension-points` (PR #7)
**Relates to:** ADR-14 (this concerns the presentation layer only)

## Context

KAN-8 shipped `GuestFlowShell` and `StepIndicator` as the chrome every guest-flow screen renders inside — six screens across eight stories, of which only the landing page exists today.

Three questions surfaced in that review which were not about the story's acceptance criteria, so they were deferred to KAN-27 rather than widening a shipped story. Each is a shape later stories are stuck with: this shell is cheap to change with one caller and expensive with six.

This record exists because "why isn't there just a slot?" is what a new contributor asks in month three, and the answer is a judgement about future callers rather than anything visible in the file.

## 1. A typed back-link pair, not a general header slot

### Options considered

- **`headerSlot?: React.ReactNode`** — maximum flexibility, zero decisions. Any screen can render anything in the header.
- **`backHref?: string` + `backLabel?: string`** *(chosen)* — the shell renders the link itself; the caller supplies only the destination and its name.
- **Nothing; each screen builds its own header.** Rejected on sight — that is the inconsistency the shell exists to prevent.

### Decision

`backHref` and `backLabel`, with the shell owning the markup: the arrow icon, the placement before the step indicator, and the accessible name. Omitting `backHref` renders the header exactly as it does today, with no wrapper element and no reserved space, so the landing page is unchanged and no layout shift is introduced for screens that have nowhere to go back to. No general escape hatch is added alongside it.

**The link is icon-only at every width**, with its name carried entirely by `aria-label`. This is not a styling preference. The header row is capped at `max-w-3xl`, so the step-label budget never grows with viewport width, and a visible text label is spent directly out of it. Measured on the built page: a label reading "Back to prompts" shrinks the step list from 600px to 449px and truncates three of the five step names at every width from 768px up — reintroducing the exact defect fixed in KAN-8. An icon-only link removes that coupling structurally rather than capping a string length and hoping.

### Reasoning

There is exactly one concrete driver: moving between prompt selection and essay entry, in both directions. A generic slot answers a question nobody has asked, and it answers it in the way that guarantees drift — six stories, six hand-rolled back links, six chances to forget the accessible name or to hide the label at a different breakpoint, and a subsequent story to reconcile them.

The real trade is discoverability against consistency, and at this stage consistency wins because the flow is a funnel: a guest who loses the back affordance between two steps drops out. A slot also silently moves responsibility for the header's accessibility and for its width budget from the shell to each caller, which is a poor default when most callers will be written quickly.

The cost is honest and small: the first screen that needs an unrelated header affordance will have to change the shell rather than pass a node. That is the point to revisit a general slot — when there is a second real use, not before. Recorded here so that revisit is a decision rather than an argument.

**Consequence worth carrying forward:** the header's fixed cap means any new header child is spent out of the step-label budget. Header additions need a browser-level truncation check, not a unit test — the existing one cannot see truncation because the test environment has no layout engine.

## 2. Content width propagates to the header; other overrides do not

### Options considered

- **Leave it** — the width was hardcoded twice, once for the header container and once for `main`, and `contentClassName` reached only `main`.
- **Apply `contentClassName` to both** — one line, and wrong: `px-0` passed for a content gutter would also strip the header's own padding.
- **Resolve and share only the `max-w-*` tokens** *(chosen)*.

### Decision

`resolveContentWidthClassName` extracts just the `max-w-*` tokens from `contentClassName` and merges them with the shell's `max-w-3xl` default through tailwind-merge; the result goes on both the header container and `main`. All other utilities continue to apply to the content column alone. Conflicting utilities replace rather than stack, which was already true for `main` and is pinned by tests on both.

Matching is done **after stripping variant prefixes and `!`**, so `sm:max-w-5xl` and `!max-w-5xl` propagate like plain `max-w-5xl`. A raw prefix test silently dropped them, which meant a screen widening only on desktop got the misalignment this helper exists to prevent.

### Reasoning

The bug this fixes is visual and specific: a screen that widens itself to `max-w-5xl` — the essay-entry screen is the obvious candidate — got a header bar still capped at `max-w-3xl`, so the wordmark and step indicator sat visibly indented against the screen's own content. Two hardcoded copies of one value will always drift.

Width is shared because the header and the content column are one visual column; padding is not, because the header's padding is the shell's business. Narrowing the propagation to `max-w-*` is what lets both be true at once. It does mean a caller cannot restyle the header by passing classes — the same boundary decision as §1, and deliberate.

## 3. Generic over the supplied step list

### Options considered

- **Status quo** — `steps?: readonly GuestFlowStep[]` (with `id: string`) and `currentStepId` typed independently against the canonical list.
- **Runtime validation only** — warn when the current id matches nothing.
- **Generic `TStep`, defaulting to the canonical step type** *(chosen)*, plus the runtime warning for the case types cannot reach.

### Decision

`StepIndicator` and `GuestFlowShell` are generic over `TStep extends GuestFlowStep`, defaulting to `CanonicalGuestFlowStep` (the literal element type of `GUEST_FLOW_STEPS`), with `currentStepId: TStep['id'] | 'none'`. A caller that passes no `steps` keeps exactly the narrowing it had before. A development-only warning covers the residual gap. Compile-time expectations live in `StepIndicator.typecheck.tsx`, matched by neither test runner's include glob, since `@ts-expect-error` is only meaningful under `tsc --noEmit` — which CI runs.

### Reasoning

The old typing let the two props disagree with no error: a custom list with `currentStepId="prompt"` compiled, because `"prompt"` was a valid canonical id, and then the lookup found nothing and no step highlighted. A progress indicator that silently highlights nothing is the kind of defect that survives to production, because it looks like a CSS problem and nobody writes a test for "the right dot is filled" on every screen.

Two properties had to hold together, and the default type argument is what delivers both: custom lists are checked against their own ids, *and* the common case — no `steps` prop at all — does not get loosened back to plain `string` as the price of genericity.

**The limits are stated rather than hidden**, because a reader who over-trusts this will skip the runtime case:

- A plain mutable array widens `id` to `string`, and no generic can recover a type TypeScript already discarded. Hence the runtime warning, which extends coverage rather than replacing the type check.
- A **subset** of the canonical list has the same hole: `GUEST_FLOW_STEPS.slice(0, 3)` preserves the full union, so an id that is no longer present still compiles. Interestingly `.filter(s => s.id !== 'register')` **is** caught, because TypeScript infers a type predicate from that callback and narrows accordingly.
- `steps={[]}` now infers `TStep` as `never`, so `currentStepId` collapses to `'none'` alone. That is a narrowing versus previous behaviour, harmless in practice since the only sensible value there is `'none'`.

The typecheck file is self-verifying, which is worth knowing for whoever maintains it: if the generic typing regresses, the `@ts-expect-error` directives stop erroring and the compiler fails on the unused directive. The guard cannot rot quietly. One thing it cannot defend against is being excluded from the type check config — a change that did both at once would pass everything, so that file category is documented in `CONTRIBUTING.md`.

## Consequences

- Later guest-flow stories get a back link by passing two props and must not build their own.
- A screen needing a wider column passes `contentClassName="max-w-5xl"` and the header follows; passing padding or other utilities affects content only.
- A screen with a non-canonical step list must declare it `as const` to get the compile-time check, and must not rely on a subset of the canonical list being checked.
- Any future header addition needs a browser-level truncation check, per §1.
- Revisit §1 when a second, unrelated header affordance has a real story behind it.
