---
name: sync-engine
description: Design and build applications using concept design and @mit-sdg/sync-engine through compact independent review, bounded implementation roles, and objective evidence.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and native agents with file-based prompts; downstream roles use best-effort assigned-path discipline.
---

# Sync-engine application workflow

Use this skill to design and build an application with sync-engine, not to change the
framework itself.

```text
brief → independent design → syntax → bounded independent criticism
→ approval or explicit preauthorization → concept implementation
→ application implementation → requested frontend → independent evidence
→ required validation → handback
```

## Non-negotiable boundaries

- Authored Markdown under `design/` is product and design authority. Generated output,
  implementation, analysis, and coordinator notes are not.
- Use fresh native agents for design, criticism, and evidence, and separate bounded
  roles for concept, application, and requested frontend implementation. The
  coordinator writes only the
  brief and temporary assignments/context, never role-owned design, production source,
  or tests. If a required role cannot launch, stop.
- Use the coordinator's exact provider and model for every role, at that provider's
  normal reasoning setting; do not repeat reasoning instructions in prompts.
- Preserve unrelated work. Only the coordinator may change Git's index, refs, or history
  on a direct, explicit human-user request; see the workflow for scope.
- Downstream implementation and evidence roles receive narrow assigned paths and explicit
  path-discipline instructions; they never inspect framework implementation source or
  installed package internals. Supply exact public references.
- Build every role prompt with the self-contained compiler `scripts/command.ts` and
  deliver it from a file. Bind downstream prompts and follow-ups to the reviewed design
  digest. Write every generated prompt, assignment, and follow-up through filesystem
  APIs and deliver it by path; never place generated Markdown in a shell argument.
- Stop after required checks and objective evidence pass. Do not iterate for optional
  polish, informational findings, or an empty critic list.

## Run the workflow

1. Read repository instructions and
   [follow the coordinator workflow](references/workflow.md).
2. Confirm the harness satisfies the
   [contract](references/harnesses/contract.md) for the current role. When Paseo is
   available, read the short [Paseo guide](references/harnesses/paseo.md); do not search
   for other orchestration instructions.
3. Initialize and maintain `design/brief.md` with the workflow's brief commands; do not
   read or recreate the packaged template directly.
4. Build only the current role prompt with the compiler. Do not read role templates or
   common prompt files yourself; the compiler expands them for the delegated agent.
5. Keep objective, decisions, current stage, critic count, and unresolved material
   issues in active coordinator context. Do not create workflow metadata or a workflow
   database.

The compiler validates bytes, inputs, release executables, follow-up size, and reviewed
design identity. It does not choose product decisions, workflow stages, approval,
criticism, repairs, or acceptance.
