---
name: sync-engine
description: Design and build applications using concept design and @mit-sdg/sync-engine through an independent Markdown design review, isolated implementation workers, validation, and user acceptance.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and native subagents that can be given isolated working directories and mutation boundaries.
---

# Sync-engine application workflow

Use this workflow for application design and implementation, not for changing the
sync-engine framework itself. The normal path is:

```text
intent choice → setup or existing baseline → interactive product discussion or general
assumptions → independent design → independent criticism and repair → user reviews
Markdown → implementation workers
→ integration and objective evidence → validation → final acceptance
```

## Non-negotiable boundaries

- Native subagents are required for design, criticism, concept implementation,
  composition implementation, integration, and evidence. If the harness cannot
  provide them, pause and tell the user; do not imitate independence with sequential
  self-review.
- Use routine/normal reasoning for every routine role. Do not request maximum
  reasoning merely because a role is delegated.
- Keep the objective, settled decisions, current stage, and unresolved issues in
  coordinator context. Do not create workflow metadata or treat mechanical output
  as conversational authority.
- Design authority is the Markdown under `design/`. Workers must not change approved
  Markdown silently.
- Use the installed `sync-engine-analysis` command as internal context selection for
  coordination, integration, and evidence. Never provide it to or invoke it for the
  independent designer or critic.
- Preserve unrelated work. Never commit, merge, rebase, reset, switch branches, or
  otherwise alter Git history. User acceptance performs no Git operation.

## Run the workflow

1. Start with the intent choice in
   [settle the product request](references/workflow.md#settle-the-product-request):
   ask whether the user wants to discuss the design first (recommended) or wants the
   agent to proceed with general assumptions.
2. Follow [setup and baseline](references/workflow.md#establish-a-working-baseline).
3. In discussion mode, run as many interactive rounds as the user wants. Ask one or
   two material product questions per turn, give options and a recommended answer for
   each, and periodically ask whether to continue discussing or move to a draft. In
   assumption mode, proceed without product-discovery questions and record reasonable
   assumptions. Keep the objective and settled decisions in coordinator context.
4. Run the closed-context designer and independent critic protocol in
   [design roles](references/design-roles.md).
5. Link the actual candidate Markdown in one concise user review. Implementation
   requires clear conversational approval of that reviewed design.
6. Run the isolated build sequence in
   [implementation roles](references/implementation-roles.md).
7. Follow [validation and handback](references/workflow.md#validate-and-hand-back).

Read repository instructions before acting. For application semantics and authoring,
use the exact installed core documents identified by the role protocol; do not
replace them with orchestration prose from this package.
