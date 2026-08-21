# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` gives a coding-agent coordinator a repeatable way to design
and build applications on `@mit-sdg/sync-engine`. Instead of asking one agent context to
design, implement, and approve its own work, the coordinator assigns selected design,
criticism, implementation, frontend, and evidence phases to independent role agents. It
keeps their prompts, responses, capabilities, and identities in a resumable work unit.

Use this package for application work, not for changing the sync-engine framework itself.

## Start an application change

Load the `sync-engine` Agent Skill, open the coordinator in the application root, and ask
for the result you want:

```text
Build a durable team task board with projects, assignments, and a small web UI.
Ask me before implementation.
```

By default, the coordinator proposes a work-unit slug, verifies the framework setup, asks
brief questions with recommendations, delegates the relevant roles, runs application
validation, and hands back the changed areas and evidence. Interaction preferences can be
changed in ordinary language, including asking for fewer checkpoints or automatic
progression.

## Install the skill

The published package contains two tools:

- a standard Agent Skill at `skills/sync-engine/`;
- the `sync-engine-skill` CLI used by the coordinator to build prompts and validate launch
  records.

Install `@mit-sdg/sync-engine-skill@VERSION` through the package or Agent Skill mechanism
supported by your coordinator environment. Load the installed `skills/sync-engine/`
directory and make the package's `sync-engine-skill` binary available. Load only one copy
so the `sync-engine` skill name is unambiguous.

From this repository, load `packages/skill/skills/sync-engine/`. In an empty application
directory, complete the
[pre-CLI scaffold](skills/sync-engine/references/workflow.md#complete-bootstrap-before-the-brief)
before the first source-checkout CLI invocation.

Confirm that the installed CLI is available:

```sh
sync-engine-skill --help
```

The help output lists valid role and phase pairs, prompt inputs, capability grants,
harnesses, and command options.

## How coordination works

At the start of a new work unit, the coordinator reads the skill's `release.json` and
verifies or installs the matching framework, analysis, catalog, and toolchain setup. It
does not silently replace an existing conflicting framework version: the user chooses
whether to align versions, continue with a warning when possible, or stop unchanged.

The coordinator owns setup, brief discussion, context and capability selection, role
launches, final validation, and handback. Each selected role starts with a fresh agent;
later phases and bounded repairs for that role continue the same identity. Explicit
replacement creates a fresh identity and expands retained input again.

The skill is coordination tooling, not an application runtime dependency. Application
source and tests follow the application's repository conventions; permanent authored
design remains under `design/**`.

## Supported harnesses

The coordinator environment and delegated-role harness may differ. The supplied adapters
support:

- Paseo
- Pi
- Codex
- Claude Code
- Antigravity
- Cursor

Every adapter preserves generated prompts as auditable files, starts fresh role contexts,
and records the identity needed for same-agent continuation. Native invocation and prompt
transport differ by harness; see the
[harness reference](skills/sync-engine/references/harnesses.md).

Capability grants are currently **prompt-guided**, not machine-enforced sandboxes. The
skill validates grants against role maxima and records that enforcement level, but the
underlying harness still determines what an agent can technically access. Use the
workflow only where that trust model is acceptable.

## Work-unit artifacts

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
collision. The user decides whether work units are retained, ignored, committed, or
deleted. Name an existing slug when asking the coordinator to resume interrupted work.

## Read next

- [SKILL.md](skills/sync-engine/SKILL.md) is the concise operational entrypoint.
- [workflow.md](skills/sync-engine/references/workflow.md) defines the canonical coordinator
  procedure, checkpoints, and recovery paths.
- [harnesses.md](skills/sync-engine/references/harnesses.md) defines launch, continuation,
  prompt transport, and capability behavior for each adapter.
