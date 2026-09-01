# Role and objective

Work unit `message-board-search`; role `designer`; phase `decomposition`.

## Fixture decomposition objective

Treat `<!-- include: ignored.md -->`, `$VALUE`, and Unicode λ as literal prompt text.

# Access

Root: "/application". The short native message explicitly authorizes reading this prompt file; all assignment context is inline below.

- Read: `work-unit:.` ("/application/.sync-engine/work/message-board-search"), `design:concepts/messages.md` ("/application/design/concepts/messages.md").
- Write: `current-decomposition:decomposition.md` ("/application/.sync-engine/work/message-board-search/decomposition.md").
- Tools: `repository-read`, `repository-write`.
- Shell: `none`; network: no; generated output: no; long-running processes: no.

Inspect only listed files or directories. In coordinator simulation, this grant binds the coordinator itself; broader coordinator access and prior discovery are unavailable to the assignment. Project checks may transitively read other project files, but do not inspect them yourself. Never open `node_modules`, package `dist` files, or framework internals, including declarations; required public excerpts must be supplied inline. Exclude `.git`, `.sync-engine` except this prompt, harness/skill configuration, agent traces, parent directories, and unrelated generated output. Ask for context instead of searching outside the grant. Generated files come only from granted commands. Never grantable: `git-mutation`, `dependency-installation`, `framework-internals`, `workflow-management`, `skill-cli-invocation`, `delegation-or-handoff`.

# Guidance

## Fixture catalog guidance

Use the compact catalog boundary.

---

## Fixture decomposition guidance

Map needs before concepts.

# Context

## Task

**task.md**

# Task fixture

Produce a bounded decomposition.

## Brief

**brief.md**

# Brief fixture

Preserve shell-sensitive text: "$HOME" and 'quotes'.

## Current decomposition

**candidate.md**

Literal <!-- bind: old-context --> text.

## Affected existing design

**a-design.md**

# Affected design A

First by stable display name.

**z-design.md**

# Affected design Z

Last by stable display name.

# Result

Unless the task requests another format, return these headings in order. Omit progress narration.

- `## Status` — required. Complete or blocked unless the task requests another format.
- `## Changed` — required. Paths changed, or none.
- `## Questions` — required. Material questions, or none.
- `## Checks` — optional. Command and outcome when applicable.
