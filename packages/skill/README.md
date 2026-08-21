# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` lets a coding agent design, review, implement, and validate a
bounded application change on `@mit-sdg/sync-engine`. The coding agent acts as
coordinator and delegates selected design, criticism, implementation, frontend, and
evidence work to independent role agents.

Install it, open a coordinator environment that exposes a supported adapter in a new or
existing application directory, and describe the result you want:

```text
Build a durable team task board with projects, assignments, and a small web UI.
Ask me before implementation.
```

The coordinator installs the release pinned by the skill, creates a resumable work unit,
asks concise questions with recommendations, and hands back changed areas and validation
results.

## Install

With Pi:

```sh
pi install npm:@mit-sdg/sync-engine-skill@VERSION
```

Replace `VERSION` with the published skill version you want to load. Pi is a skill loader
and coordinator environment, not another harness adapter. The Pi environment must expose
one of the supported adapter mechanisms listed below.

With another Agent Skill loader, select the package's `skills/sync-engine/` directory.
From this checkout, load `packages/skill/skills/sync-engine/`. Load one copy of the
`sync-engine` skill so its name is unambiguous. In an empty application directory,
complete the [pre-CLI scaffold](skills/sync-engine/references/workflow.md#complete-bootstrap-before-the-brief)
before the first source-checkout CLI invocation.

The installed CLI documents valid role/phase pairs, inputs, grants, harnesses, and all
command options:

```sh
sync-engine-skill --help
```

The application does not depend on the skill package. At the start of each work unit, the
coordinator reads `release.json` and verifies or installs the matching framework,
analysis, catalog, and toolchain setup. An existing conflicting framework version is
changed only after the user chooses to align it.

## Use

Start the coordinator environment in the application root and ask for an application
change in ordinary language. State a different interaction preference conversationally;
the [canonical workflow](skills/sync-engine/references/workflow.md) defines its behavior.

For an existing work unit, name its slug or ask the coordinator to resume it. The
coordinator proposes a slug when starting new work and asks only when existing work makes
the choice ambiguous.

## Work-unit layout

Each bounded change keeps its coordination artifacts together:

```text
.sync-engine/work/<slug>/
  brief.md
  decomposition.md                       # only when design changes
  <timestamp>-<role>-<phase>.task.md
  <timestamp>-<role>-<phase>.capabilities.json
  <timestamp>-<role>-<phase>.prompt.md
  <timestamp>-<role>-<phase>.response.md
  <timestamp>-<role>-<phase>.record.json
```

One readable UTC timestamp stem identifies each launch; a suffix handles a timestamp
collision. Permanent authored design remains under `design/**`, while implementation and
tests follow the application's repository conventions. The user decides whether work
units are retained, ignored, committed, or deleted.

## Supported harnesses

The same coordinator-mediated flow supports:

- Paseo
- Codex
- Claude Code
- Antigravity
- Cursor

Through each adapter, the coordinator launches fresh role agents with descriptive title
metadata, preserves same-agent continuation, keeps generated prompts as auditable files,
and prefers native file-backed
prompt delivery that does not spend coordinator output tokens. The coordinator copies
native output verbatim for skill CLI validation and record finalization. Harness-specific
invocation details are documented in
[the harness reference](skills/sync-engine/references/harnesses.md).

## Read next

- [SKILL.md](skills/sync-engine/SKILL.md) is the concise operational entrypoint.
- [workflow.md](skills/sync-engine/references/workflow.md) is the canonical coordinator procedure.
- [harnesses.md](skills/sync-engine/references/harnesses.md) covers adapter invocation.
