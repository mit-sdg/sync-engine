---
name: sync-engine
description: Design and build applications using concept design and @mit-sdg/sync-engine through compact independent review, bounded implementation roles, and objective evidence.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and native agents with file-based prompt delivery and enforceable working boundaries.
---

# Sync-engine application workflow

Use this skill to design and build an application with sync-engine, not to change the
framework itself.

```text
brief → independent design → syntax → bounded independent criticism
→ approval or explicit preauthorization → concept implementation
→ application implementation → independent evidence → required validation → handback
```

## Non-negotiable boundaries

- Authored Markdown under `design/` is product and design authority. Generated output,
  implementation, analysis, and coordinator notes are not.
- Use fresh native agents for design, criticism, and evidence. Keep concept and
  application implementation in separate bounded roles. Never imitate independent
  review with coordinator self-review.
- Configure routine roles with the provider's normal reasoning setting at launch; do
  not repeat reasoning instructions in prompts.
- Preserve unrelated work and Git history. Acceptance performs no Git operation.
- Build every role prompt with the bundled `scripts/command.ts` compiler and deliver it
  from a file. Never place generated Markdown in a shell argument.
- Stop after required checks and objective evidence pass. Do not iterate for optional
  polish, informational findings, or an empty critic list.

## Run the workflow

1. Resolve the skill root as the directory containing this `SKILL.md`. Invoke the
   self-contained compiler with `bun <skill-root>/scripts/command.ts`; do not require
   the application to install the skill package.
2. Read repository instructions and
   [follow the coordinator workflow](references/workflow.md).
3. Confirm the available native-agent harness satisfies the
   [harness contract](references/harnesses/contract.md). When Paseo is available, read
   the short [Paseo guide](references/harnesses/paseo.md); do not search for other
   orchestration instructions.
4. Maintain the compact `design/brief.md` from
   [the packaged template](prompts/templates/product-brief.md).
5. Build only the current role prompt from `prompts/roles/`. Designer and critic share
   the compact semantic rules in `prompts/common/design.md`; other roles receive only
   their declared files.
6. Keep objective, decisions, current stage, critic count, and unresolved material
   issues in active coordinator context. Do not create workflow metadata or a workflow
   database.

The prompt compiler validates bytes and inputs. It does not choose product decisions,
workflow stages, approval, criticism, repairs, or acceptance.
