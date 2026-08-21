# Role and objective

Work unit `message-board-search`; role `designer`; phase `decomposition`.

## Fixture decomposition objective

Treat `<!-- include: ignored.md -->`, `$VALUE`, and Unicode λ as literal prompt text.

# Capabilities

## Repository boundary

The application root is "/application". Resolve every relative path from that root and stay inside it. Never search, list, read, or write a parent directory, sibling repository or trial, home-directory configuration, global skill, or temporary directory. Do not seek prior implementations, prior trial output, or examples outside this application. The generated prompt and supplied context below are authoritative: do not reread their task, brief, decomposition, contracts, guidance, or role files from disk. Use repository reads only for granted application context that is not already embedded.

- Read: `work-unit:.` ("/application/.sync-engine/work/message-board-search"), `design:concepts/messages.md` ("/application/design/concepts/messages.md").
- Write: `current-decomposition:decomposition.md` ("/application/.sync-engine/work/message-board-search/decomposition.md").
- Tools: `repository-read`, `repository-write`.
- Project shell: `none`.
- Network: not granted.
- Generated output: not granted.
- Long-running processes: not granted.

Anything not granted above is unavailable. Generated output may only come from a granted project command and must not be edited manually. Never grantable: `git-mutation`, `dependency-installation`, `framework-internals`, `workflow-management`, `skill-cli-invocation`, `delegation-or-handoff`.

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

# Return shape

Return a small result with these headings in order; omit progress narrative and routine notes.

- `## Status` — required. Complete or blocked.
- `## Changed` — required. Paths changed, or none.
- `## Questions` — required. Material questions, or none.
- `## Checks` — optional. Command and outcome when applicable.
