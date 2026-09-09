# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` helps a coding-agent coordinator design and deliver bounded application changes on `@mit-sdg/sync-engine`. It compiles concise role assignments, supports delegated or coordinator-simulated work, and keeps a readable record of decisions, prompts, results, identities, and checks.

Use it for applications built on sync-engine, not for changing the framework itself.

## Trust boundary

Role access is prompt-guided unless the selected harness enforces it. The CLI validates and records declared paths, but it is not an operating-system sandbox. Run the skill only where that trust model is acceptable.

Bootstrap runs package installation and setup automatically only for an empty application directory. It uses one temporary staging directory outside the application's ancestor workspace for installation, pinned setup, and final dependency reconciliation, then copies the verified project into the application once. Direct Bun installs disable lifecycle scripts and preserve trusted user configuration, environment, and cache. Failed preparation leaves the application empty and retryable. In an existing application it prints commands for explicit review instead of executing project-controlled code.

The selected application root may use directory aliases. Within that root, bootstrap checks target containment and replaces manifest entries without modifying hard-linked external files. Filesystem checks are not a sandbox against a concurrent hostile writer. Publication errors trigger rollback, but abrupt termination or cleanup failure can leave partial files.

## Install and start

Install `@mit-sdg/sync-engine-skill@VERSION` through the package or Agent Skill mechanism supported by the coordinator. Load its `skills/sync-engine/` directory and expose the `sync-engine-skill` binary. Load one copy so the `sync-engine` skill name is unambiguous.

From this repository, load `packages/skill/skills/sync-engine/`.

```sh
sync-engine-skill --help
```

Then open the coordinator in an application root and request an outcome:

```text
Build a durable team task board with projects, assignments, and a small web UI.
Ask me before implementation.
```

The coordinator creates or resumes `.sync-engine/work/<slug>/`, follows its immutable review/execution policy, records consequential decisions, selects only useful roles, validates the result, and reports the evidence. `grant init` creates role-aware capability grants, `harness recommend` distinguishes a native execution harness from an outer supervisor, completion checks changed paths against the grant, and `work finish` catches unfinished records before handback.

## Adaptable coordination

Independent design and criticism are recommended when behavior changes. Existing accepted design may go directly to implementation. Explicit user direction can skip, combine, replace, or simulate roles.

When a role is delegated, the default first native message is a short instruction to read its generated prompt file. This avoids transporting a large assignment in the first message while keeping the complete prompt auditable. A simulated role uses the same prompt and result artifacts but records `coordinator` as executor and `independent: false` without inventing an agent identity. Same-role simulation repairs use compact continuations.

Roles receive inline authoritative context plus explicit read and write directories. The CLI warns when access exceeds a role recommendation. Roles do not inspect `node_modules`, framework internals, skills, traces, or unrelated project areas unless a higher-priority instruction explicitly changes the boundary.

## Inspect a work item

```sh
sync-engine-skill work show <slug>
```

The overview includes the work brief, active decisions, concise activity, runs, execution modes, statuses, and delegated identities. Detailed timestamped artifacts remain available in the work directory.

## Read next

- [SKILL.md](skills/sync-engine/SKILL.md) — operational entrypoint.
- [workflow.md](skills/sync-engine/references/workflow.md) — coordination procedure and context selection.
- [harnesses.md](skills/sync-engine/references/harnesses.md) — file-backed launch and continuation behavior.
