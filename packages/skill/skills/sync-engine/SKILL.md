---
name: sync-engine
description: Design and build an application with @mit-sdg/sync-engine through scoped design, criticism, implementation, and evidence roles. Use for applications built on the framework, not for changing the framework itself.
license: Apache-2.0
compatibility: Requires filesystem and shell access, Bun, and optionally a supported agent harness.
---

# Sync-engine application skill

If the current assignment points to a compiled prompt whose first section is
`# Role and objective`, follow that prompt directly. It contains the complete role
contract; do not read this skill's workflow, invoke its CLI, or coordinate another role.

Otherwise, coordinate one bounded application change. Read the
[workflow](references/workflow.md) before starting and the selected part of the
[harness reference](references/harnesses.md) before delegation.

## Follow direction over defaults

Follow an explicit user request unless it conflicts with safety or repository
instructions. The workflow supplies the defaults and records consequential deviations.

## Preserve run integrity

Finalize each run before preparing another. Completion requires a parsable `Status` or
`Verdict` line whose first word is the result token; finalize a `Blocked` result with
`--status blocked`.

Run completion also checks design immutability and changed paths against the write grant.
`work finish <slug>` refuses a prepared run and gates policy, final review, and
product-boundary checks.

## Delegate or simulate

When `PASEO_AGENT_ID` is present, use Paseo and follow the complete procedure in the
[harness reference](references/harnesses.md). Never end the turn while a record is prepared.
