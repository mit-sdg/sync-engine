---
name: sync-engine
description: Design and build an application with @mit-sdg/sync-engine and concept design, through compact independent review, bounded implementation roles, and objective evidence. Use for building an application on the framework, never for changing the framework itself.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and fresh native subagents in Paseo, Codex, Claude Code, or Antigravity; downstream roles use best-effort assigned-path discipline.
---

# Sync-engine application workflow

## Non-negotiable boundaries

- Authored Markdown under `design/` is product and design authority. Generated output,
  implementation, analysis, and coordinator notes are not.
- Use fresh agents for design, criticism, and evidence, with bounded concept, application,
  and frontend roles. Record every compiled phase with `launch`; an unrecorded required
  phase did not run. The coordinator writes only the brief and assignments, never
  role-owned design, source, or tests.
- Roles inherit provider, model, and reasoning unless the user names another. Paseo
  attests these; native records disclose unavailable attestation.
- Preserve unrelated work. Only the coordinator may change Git's index, refs, or history
  on a direct, explicit human-user request; see the workflow for scope.
- Nobody reverse-engineers the framework, the coordinator included. Inside the installed
  package read only `examples/` and `docs/user/`, never `dist/` or a checkout's source.
  Downstream implementation and evidence roles additionally receive narrow assigned paths
  and explicit path discipline; supply them exact public references.
- Build prompts with the self-contained `scripts/command.ts`; bind downstream work to the reviewed design
  digest. Deliver generated files by path, never through shell arguments.
- Stop after required checks and objective evidence pass. Do not iterate for optional
  polish, informational findings, or an empty critic list.

## Run the workflow

1. Read repository instructions and [start the coordinator
   workflow](references/workflow.md). Read
   [design and criticism](references/design-and-criticism.md) and
   [implementation](references/implementation.md) on reaching those stages, not before.
2. Read the harness [contract](references/harnesses/contract.md) and exactly one adapter:
   [Paseo](references/harnesses/paseo.md), [Codex](references/harnesses/codex.md),
   [Claude Code](references/harnesses/claude-code.md), or
   [Antigravity](references/harnesses/antigravity.md).
3. Initialize and maintain `product/brief.md` with the workflow's brief commands; do not
   read or recreate the packaged template directly.
4. Build only the current phase prompt with the compiler. Do not read role templates or
   common prompt files yourself. Launch a role through its guide; continue the
   original designer with the compiler's contract delta and `--continue-agent`. Retained
   context is hash-bound, not resent. Only direct human instruction permits
   `--user-override`.
5. Keep objective, decisions, current stage, critic count, and unresolved material
   issues in active coordinator context. Do not create workflow metadata or a workflow
   database.

The compiler validates inputs, release executables, prompt bytes, follow-ups, design
identity, role order, launch records, and handback. It chooses no product decision,
stage, approval, repair, or acceptance; a reported `Next:` line is syntax, not permission.
