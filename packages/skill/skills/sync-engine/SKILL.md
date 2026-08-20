---
name: sync-engine
description: Design and build an application with @mit-sdg/sync-engine and concept design, through compact independent review, bounded implementation roles, and objective evidence. Use for building an application on the framework, never for changing the framework itself.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and fresh native subagents in Paseo, Codex, Claude Code, or Antigravity; downstream roles use best-effort assigned-path discipline.
---

# Sync-engine application workflow

```text
brief → independent design → syntax → bounded independent criticism
→ approval or explicit preauthorization → concept implementation
→ application implementation → requested frontend → independent evidence
→ required validation → handback
```

## Non-negotiable boundaries

- Authored Markdown under `design/` is product and design authority. Generated output,
  implementation, analysis, and coordinator notes are not.
- Use fresh native agents for design, criticism, and evidence, and separate bounded roles
  for concept, application, and requested frontend implementation. Record every one with
  the compiler's `launch`; a role with no launch record did not run, and if a required
  role cannot launch, stop. The coordinator writes only the brief and assignments, never
  role-owned design, production source, or tests.
- Every role inherits the coordinator's exact provider, model, and reasoning setting
  unless the user names another. Managed Paseo launches attest it; native harness launches
  request inheritance with no override and record when machine attestation is unavailable.
- Preserve unrelated work. Only the coordinator may change Git's index, refs, or history
  on a direct, explicit human-user request; see the workflow for scope.
- Nobody reverse-engineers the framework, the coordinator included. Inside the installed
  package read only `examples/` and `docs/user/`, never `dist/` or a checkout's source.
  Downstream implementation and evidence roles additionally receive narrow assigned paths
  and explicit path discipline; supply them exact public references.
- Build every role prompt with the self-contained compiler `scripts/command.ts` and bind
  downstream prompts and follow-ups to the reviewed design digest. Write every generated
  prompt, assignment, and follow-up through filesystem APIs and deliver it by path; never
  place generated Markdown in a shell argument.
- Stop after required checks and objective evidence pass. Do not iterate for optional
  polish, informational findings, or an empty critic list.

## Run the workflow

1. Read repository instructions and [start the coordinator
   workflow](references/workflow.md). Read
   [design and criticism](references/design-and-criticism.md) and
   [implementation](references/implementation.md) on reaching those stages, not before.
2. Confirm the harness satisfies the
   [contract](references/harnesses/contract.md) for the current role. Read exactly the
   matching short guide: [Paseo](references/harnesses/paseo.md),
   [Codex](references/harnesses/codex.md),
   [Claude Code](references/harnesses/claude-code.md), or
   [Antigravity](references/harnesses/antigravity.md). Do not search for other
   orchestration instructions.
3. Initialize and maintain `product/brief.md` with the workflow's brief commands; do not
   read or recreate the packaged template directly.
4. Build only the current phase prompt with the compiler. Do not read role templates or
   common prompt files yourself. Launch an initial role through its guide; route the
   compiler-built contract phase to the original designer without launching another.
5. Keep objective, decisions, current stage, critic count, and unresolved material
   issues in active coordinator context. Do not create workflow metadata or a workflow
   database.

The compiler validates inputs, release executables, prompt bytes, follow-ups, design
identity, role order, launch records, and handback. It chooses no product decision,
stage, approval, repair, or acceptance; a reported `Next:` line is syntax, not permission.
