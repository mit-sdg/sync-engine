---
name: sync-engine
description: Design and build an application with @mit-sdg/sync-engine through scoped design, criticism, implementation, and evidence roles. Use for applications built on the framework, not for changing the framework itself.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and optionally a supported agent harness.
---

# Sync-engine application skill

If the current assignment points to a compiled prompt whose first section is `# Role and objective`, follow that prompt directly. It already contains the complete role contract: do not read this skill's workflow, invoke its CLI, or coordinate another role.

Otherwise, coordinate one bounded application change. Read the [workflow](references/workflow.md) before starting and the selected part of the [harness reference](references/harnesses.md) before delegation.

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

One work item lives at `.sync-engine/work/<slug>/`. Its immutable `policy.json` fixes review and execution mode; `brief.md` records goal, active decisions, status, and concise activity. Timestamped artifacts preserve each task, access grant, compiled prompt, result, execution mode, identity, and status. Use `sync-engine-skill work show <slug>` for a readable overview.

Finalize each run before preparing another. Never return, idle, or wait with a simulation record prepared. Finalize a role-reported blocker with `--status blocked`, not `completed`. Completion checks design immutability and changed paths against the write grant.

When execution budget is low, hand back before starting optional evidence. `work finish <slug>` refuses handback while a run remains prepared.

## Delegate or simulate

A delegated role uses a fresh agent unless continuing that exact recorded identity. Prefer a detected supervising harness that can retain role ownership and completion over its embedded provider adapter. For example, when `PASEO_AGENT_ID` is present, use the Paseo harness and keep its delegated launch in the foreground. Outside such supervision, use the supported native adapter. A coordinator simulation uses the same compiled prompt and artifacts, records its reason, has no agent ID, and is never described as independent. It is direct execution, not role-play: do not claim to send an assignment, invoke an agent, or wait for a role. Once the prompt is built, perform the work silently and finalize it before resuming coordination. Use `continue` for a compact same-role simulation repair; it preserves retained context without inventing an agent identity.

Simulate when the user requests it or delegation is unavailable. If the user explicitly required independence, ask before simulating. A later delegated review replaces or supplements a simulation; it does not continue one.

## Bound role context

Inline the task and authoritative context. Grant only the files or directories needed for normal work, with separate read and write areas. Prefer `sync-engine-skill grant init` over hand-authoring capability JSON. The CLI warns when access exceeds a role recommendation or a same-phase continuation expands its prior grant; record only consequential choices under `Active decisions`. Exclude framework internals, package `dist`, skills, harness configuration, traces, sibling workspaces, caches, and unrelated work artifacts. Supply exact public material inline or name the package-owned public guide or example the task may use; do not browse package trees. The coordinator must not probe internal declarations, runtime exports, or another application's implementation. Do not install dependencies after bootstrap unless the user explicitly changes the setup.

If context is missing, expand it through a new prompt rather than asking the role to discover unlisted files. During simulation, the coordinator itself is bound by that prompt's grant until completion; broader coordinator access and prior discoveries are not role context. Project checks may read the wider project transitively, but the role does not inspect unlisted files itself.

## Keep prompts lean

Use the built-in role kit once. Contract design receives exact authored, SSF, and boundary syntax; contract criticism receives the semantic reading rules; application work receives registration, assembly, and composition syntax. Add worked examples, HTTP, read-construction, persistence, or other specialized references only when needed. Prefer a small exact excerpt over a reference book. The builder rejects byte-identical context, reports bytes by source slot, and uses compact continuations; inspect that report rather than imposing an arbitrary ceiling.

## Respect the work policy

The coordinator chooses phases, context, access, validation, and handback within the immutable work policy selected at `work start`. Required review binds approval to the current decomposition before contracts and to design before first implementation and final handback; implementation repair may batch intermediate design changes. Omitted review records the user's choice once. Execution policy limits the item to delegated, simulated, or mixed runs.
