---
name: sync-engine
description: Design and build an application with @mit-sdg/sync-engine through scoped design, criticism, implementation, and evidence roles. Use for applications built on the framework, not for changing the framework itself.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and optionally a supported agent harness.
---

# Sync-engine application skill

Coordinate one bounded application change. Read the [workflow](references/workflow.md) before starting and the selected part of the [harness reference](references/harnesses.md) before delegation.

## Follow direction over defaults

Skill behavior is a recommendation. Follow an explicit user request unless it conflicts with safety or repository instructions. Record only consequential deviations under `Active decisions` in the work item so resumed work receives the current context. Keep earlier decisions visible when superseded.

Default to the shortest sufficient path:

```text
brief
  -> design and independent criticism when behavior changes
  -> relevant implementation roles
  -> evidence when it serves the requested outcome
  -> validation and handback
```

Existing accepted design may proceed directly to implementation. The user may omit, combine, replace, or simulate roles.

## Keep work visible

One work item lives at `.sync-engine/work/<slug>/`. Its `brief.md` records goal, active decisions, status, and concise activity. Timestamped artifacts preserve each task, access grant, compiled prompt, result, execution mode, identity, and status. Use `sync-engine-skill work show <slug>` for a readable overview. Finalize each run before preparing another and never return, idle, or wait with a simulation record prepared. When execution budget is low, hand back before starting optional evidence. `work finish <slug>` refuses handback while a run remains prepared.

## Delegate or simulate

A delegated role uses a fresh agent unless continuing that exact recorded identity. Prefer a detected supervising harness that can retain role ownership and completion over its embedded provider adapter. For example, when `PASEO_AGENT_ID` is present, use the Paseo harness and keep its delegated launch in the foreground. Outside such supervision, use the supported native adapter. A coordinator simulation uses the same compiled prompt and artifacts, records its reason, has no agent ID, and is never described as independent.

Simulate when the user requests it or delegation is unavailable. If the user explicitly required independence, ask before simulating. A later delegated review replaces or supplements a simulation; it does not continue one.

## Bound role context

Inline the task and authoritative context. Grant only the files or directories needed for normal work, with separate read and write areas. Prefer `sync-engine-skill grant init` over hand-authoring capability JSON. The CLI warns when access exceeds a role recommendation or a same-phase continuation expands its prior grant; record only consequential choices under `Active decisions`. Exclude `node_modules`, framework internals, skills, harness configuration, traces, and unrelated work artifacts; supply exact public documentation or declarations inline.

If context is missing, expand it through a new prompt rather than asking the role to discover unlisted files. Project checks may read the wider project transitively, but the role does not inspect unlisted files itself.

## Keep prompts lean

Use the built-in role kit once. Contract design receives exact authored, SSF, and boundary syntax; contract criticism receives the semantic reading rules; application work receives registration, assembly, and composition syntax. Add worked examples, HTTP, read-construction, persistence, or other specialized references only when needed. Prefer a small exact excerpt over a reference book. Prompt size is reported for inspection; there is no package-imposed arbitrary ceiling.

The coordinator chooses phases, context, access, simulation, review acceptance, validation, and handback. The CLI records those choices but does not turn defaults into workflow gates.
