---
name: sync-engine
description: Design and build an application with @mit-sdg/sync-engine through scoped concept design, independent criticism, bounded implementation roles, and objective evidence. Use for applications built on the framework, not for changing the framework itself.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and a supported agent harness with fresh-agent launch and stable continuation.
---

# Sync-engine application skill

Coordinate one bounded application change at a time. Read the canonical
[workflow](references/workflow.md) before starting and the
[harness reference](references/harnesses.md) before the first role launch.

## Interact deliberately

Default to active interaction with concise options and a recommendation. The user can
request less interaction or auto mode in ordinary language and change that preference at
any time. The [workflow](references/workflow.md) defines checkpoints, assumptions, and
stopping conditions.

## Start deterministically

Before the first skill CLI invocation in an empty application directory, read
`<skill-root>/release.json` and create only this administrative scaffold:

```json
{
  "name": "<safe-package-name>",
  "private": true,
  "type": "module",
  "packageManager": "bun@<exact release.toolchain.bun>"
}
```

This is the only pre-Bun administrative scaffold; create it without asking the user. Do
not replace an existing application's manifest. Then run
`sync-engine-skill work start <slug>` from the application root. Because the scaffold is
an existing package, the command lists the pinned install and setup commands instead of
running them. Review the application, run those commands, and rerun `work start`; it then
verifies the framework, analysis, catalog, and toolchain environment and creates the
brief.

- In an existing application, stop before running installation or project-local setup
  commands. Show the commands so the user can review the project and run them explicitly.
- On a framework version conflict, offer to align with the pinned release, continue with a
  warning when the installed core remains usable, or stop unchanged.
- Stop on any other bootstrap failure; do not continue from an uncertain environment.

## Keep one resumable work unit per change

A work unit lives at `.sync-engine/work/<slug>/`. It contains `brief.md`, an optional
`decomposition.md`, and timestamped tasks, capability grants, prompts, responses, and
records. The coordinator inspects `.sync-engine/work/`, proposes a short descriptive
slug, and asks only when existing work makes the choice ambiguous. Every operation names
its slug explicitly. Resume an existing directory; `work start` does not overwrite one.

The user decides whether work-unit artifacts are retained, ignored, committed, or
deleted.

## Keep the coordinator at the boundary

The coordinator owns bootstrap, brief discussion, context selection, task and capability
selection, launches, final validation, and handback. It authors only the brief and small
task files, plus trivial setup administration. Copying a harness-returned response
verbatim into its reserved file is administrative capture, not authored role work. The
skill CLI validates that capture and finalizes the record; it does not obtain native role
output itself. Dependency installation remains coordinator-owned, including the
workflow's matching-release rule for selected HTTP work.

Delegate every selected design, criticism, concept implementation, application
integration, frontend, and evidence phase. Omitting an irrelevant role does not transfer
that role's work to the coordinator. Follow the user's, repository's, and harness's Git
safeguards; this skill adds no separate Git permission policy.

## Select only relevant roles

- **Designer:** add or revise product design. Continue the same designer through
  decomposition, contracts, and bounded repairs.
- **Critic:** review design independently. Keep one critic, distinct from the designer,
  through full reviews and narrow repair verification.
- **Concept worker:** implement owned concepts and focused tests.
- **Application worker:** assemble concepts, configuration, hosts, and integration tests.
- **Frontend worker:** implement a requested client surface against the assembled public
  interface.
- **Evidence worker:** independently connect brief outcomes to tests or scenarios and
  their results.

Each selected role starts with a fresh agent except an explicit same-role continuation.
A supplied authored design needs syntax validation, but does not by itself require new
design or criticism. New behavior exposed during implementation requires bounded design
revision and independent criticism.

## Follow a progressive flow

```text
brief
  -> compact decomposition and full independent review when needed
  -> complete affected contract set and one full changed-set review
  -> narrow repair verification when findings exist
  -> implementation
  -> bounded design feedback if implementation exposes a contract gap
  -> designer revision and critic verification
  -> implementation continuation
  -> validation and handback
```

Workers report design gaps instead of editing `design/**`. Rebuild design-bound prompts
whenever permanent authored design changes.

## Use the skill CLI

Prefer `--harness paseo` when the Paseo CLI and daemon are available, even when the
coordinator is running in another harness. Paseo's daemon-backed roles remain active
across coordinator session or CLI restarts. Otherwise select another available supported
harness.

These are the command families and their core arguments:

```text
sync-engine-skill work start <slug>
sync-engine-skill prompt build --work <slug> --role <role> --phase <phase>
  --task <path> --grant <json-path> --harness <harness>
  [--input <slot>=<path>]... [--design-root <path>] [--timeout <seconds>]
sync-engine-skill launch complete <prepared-record> --agent-id <id>
  --status <native-status>
sync-engine-skill continue <finalized-record> --phase <phase> --task <path>
  --grant <json-path> [--input <slot>=<path>]... [--replace]
  [--harness <harness>] [--design-root <path>] [--timeout <seconds>]
```

Run `sync-engine-skill --help` for valid role/phase pairs, accepted input slots, the grant
format, conditional options, model selection, and context limits.

`prompt build` prints the reserved prompt, response, and record paths plus the native
harness instruction; the prepared record binds its harness, timeout, and any canonical
design root. Trust the package-owned adapter: do not launch smoke-test agents or probe
resume behavior before useful work. The coordinator invokes the mechanism once and copies
its response verbatim into the printed response path before `launch complete`, using only
work-unit paths rather than shared temporary files. Completed status requires a nonempty
response; failed, cancelled, and timed-out launches may finalize an empty response.

`continue` returns to the recorded agent. A same-phase continuation sends a compact delta;
a phase transition or replacement sends the complete applicable role prompt. Existing
design bindings are redigested automatically; `--design-root` may only introduce a binding
when the prior record has none.
`--replace` prepares a fresh replacement and is the only mode that may select another
`--harness`.

Before handback, derive actual role identities from finalized records rather than memory
or displayed titles. The coordinator—not the skill CLI—chooses phases, accepts review
judgments, selects repairs, and performs handback.
