# Agent role definitions

Three of the roles from [CONTRIBUTING.md](../../CONTRIBUTING.md), defined as
Claude Code subagents so the delivery model in the
[Ways of Working](https://safronov.atlassian.net/wiki/spaces/MFS/pages/25526274)
page is version-controlled next to the code instead of re-explained each
session.

| File | Role | Writes code? |
| --- | --- | --- |
| `senior-developer.md` | Senior Developer | Yes |
| `solution-architect.md` | Solution Architect | No — review only |
| `test-lead.md` | Test Lead | No — review only |

Product Owner is deliberately not defined here. That role is backlog and
acceptance-criteria ownership, which is Jira and Confluence work rather than
repo work.

## How they are meant to be used

The session driving the work acts as orchestrator. It dispatches the roles and
relays their findings; it does not do the reviewing itself.

For a pull request, dispatch `solution-architect` and `test-lead` **in the same
message** so they review in parallel, as the process requires. They must not
see each other's findings — two independent reads are the entire point, and a
reviewer that has read another review anchors to it. Collect both, hand the
Developer **one consolidated set** of feedback, and count that as one round.
Three rounds without agreement goes to Irina.

## Confluence is the source of truth

These files are a convenience copy. The Confluence space `MFS` outranks them,
and if the two disagree, Confluence wins and this file needs updating.

The reviewer roles have no Confluence tools, on purpose — a review agent should
not be able to edit the requirements it is reviewing against. The orchestrator
passes the relevant excerpts in the prompt. A role that needs a page it was not
given is instructed to ask rather than guess.

## Why each file pins a model

`.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL` to `haiku`, which
would otherwise apply to all three. That is a reasonable default for mechanical
subagent work and a poor one for review judgment, so the two reviewer roles pin
`opus` and the Developer pins `sonnet`. Frontmatter wins over the environment
default. Change the frontmatter, not the setting, if you want to trade cost
against depth.

## What this does and does not buy you

It buys context isolation and parallelism. A reviewer that never saw the
author's reasoning judges the diff on its merits, which is the single biggest
real effect, and two reviewers can run at once.

It does not buy a second opinion in the sense a second person would be. These
are the same model under different instructions, so they share failure modes. A
review that finds a real defect is real evidence. A review that says "looks
good" is weak evidence. Irina's own judgement remains the backstop, which is
why the escalation rules exist.
