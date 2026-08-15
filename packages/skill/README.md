# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` gives a coding agent a human-reviewed workflow for
designing and building a sync-engine application. It uses independent native
subagents for design, criticism, implementation, integration, and evidence. If an
agent harness cannot create native subagents, the workflow pauses rather than
simulating an independent review.

Install the exact beta and expose its skill directory to your Agent Skills loader:

```sh
bun add --dev --exact @mit-sdg/sync-engine-skill@beta
```

```text
node_modules/@mit-sdg/sync-engine-skill/skills/sync-engine
```

The skill package depends on the exact matching releases of
`@mit-sdg/sync-engine-analysis` and `@mit-sdg/sync-engine-catalog`, so installation
also exposes the read-only `sync-engine-analysis` and `catalog` context tools. These
dependencies are for the agent workflow; they do not change ordinary `sync-engine
setup` applications.

The entrypoint is [`skills/sync-engine/SKILL.md`](skills/sync-engine/SKILL.md).
A normal run establishes a working start baseline, asks no more than three material
product questions, produces a complete Markdown design, obtains an independent
criticism and user approval, then builds through path-isolated workers.

## The review you receive

Before implementation, the agent links the actual files under:

```text
design/concepts/*.md
design/compositions/*.md
design/types.md
```

The review briefly states the objective, proposed concept capabilities, composition
decisions, alternatives, non-goals, open concerns, and syntax/criticism status. You
approve or revise that Markdown once; routine registration and host wiring do not add
another checkpoint. A material design change during implementation returns to the
same review before work resumes.

After implementation, the agent lists the implementation areas, exact validation
outcome, known limits, and asks you to accept, revise, or request more evidence.
Acceptance does not perform a Git operation.

## What is packaged

This remains a documentation-only Agent Skill: the skill package itself ships no
executable, JavaScript API, project scanner, workflow database, or generated evidence
format. Its installed analysis dependency supplies the separate read-only context
command. Draft concept
syntax is checked by the installed core `sync-engine check-concepts` command because
the concept grammar belongs to sync-engine. Ordinary application files and the
coordinator's active context carry the work.

The role contracts are:

- [Coordinator workflow](skills/sync-engine/references/workflow.md)
- [Independent design roles](skills/sync-engine/references/design-roles.md)
- [Isolated implementation roles](skills/sync-engine/references/implementation-roles.md)

The coordinator uses analysis first to select a bounded application inventory and
focused integration/evidence context. Designer and critic prompts remain closed and
analysis-free; isolated concept workers normally remain analysis-free as well.
Repository search and source reading are limited to unavailable, incomplete, or
ambiguous analysis, files outside the manifest, and concrete compiler/runtime failure
investigation. Analysis output remains internal and is not pasted into design or
final reviews.

Generic concept boundaries, authoring rules, and the concept grammar live in the
installed core package under `docs/user/`, not in this skill.
