# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` is an Agent Skill for building applications on the sync-engine framework. A coding agent loads the skill and becomes the run coordinator. The coordinator writes only the product brief and a short assignment for each role. It launches a separate agent to do every other task.

This split provides independence. The designer has not seen an implementation. The critic did not write the design. The evidence worker did not build the application it tests. Package checks reject a run that skips this structure.

## Install

```sh
pi install npm:@mit-sdg/sync-engine-skill@VERSION
```

From a checkout, point the harness skill loader at the package's `skills/sync-engine/` directory. Install one copy. Two copies under the same skill name are ambiguous.

An application never depends on this package. The skill reads its own `release.json` and installs the matching `@mit-sdg/sync-engine`, `@mit-sdg/sync-engine-analysis`, and `@mit-sdg/sync-engine-catalog` releases into the application. It refuses to continue when the installed versions disagree with its release.

## Run

Open an agent in an empty directory and ask for an application in plain language. The agent coordinates the workflow, writes output as each stage finishes, and stops at handback.

Work appears in this layout:

```text
product/brief.md   Product brief maintained by the coordinator
design/            Authored concept specifications, compositions, and types
src/               Concept and application implementation
tests/             Application tests and evidence checks
.sync-engine/      Generated workflow files and launch records
```

## Stages

A run follows this order:

1. Brief.
2. Design.
3. Design syntax check.
4. Criticism.
5. Approval.
6. Concept implementation.
7. Application implementation.
8. Frontend implementation, when the brief requests a frontend.
9. Evidence.
10. Required validation.
11. Handback.

The coordinator maintains `product/brief.md`. It records what the product does and the decisions behind it. Each decision is marked as the user's choice or the coordinator's assumption. The file stays outside `design/` because the coordinator continues to edit it.

The designer authors everything under `design/`, including concept specifications, compositions, and the types document. Every downstream role treats that directory as read-only.

Criticism repeats until a pass reports nothing material. A repair goes back to the agent that produced the work through a short follow-up file, never through a new copy of the full prompt.

By default, one concept worker implements all concepts and one application worker wires them together. Either role splits only when its prompt exceeds the byte budget or the user asks for parallel work.

## Roles

Five roles are required. A sixth is conditional:

- `designer`
- `critic`
- `concept-worker`
- `application-worker`
- `evidence-worker`
- `frontend-worker`, only when the brief requests a frontend

## Enforcement

### Generated files

The compiler writes prompts, assignments, follow-ups, launch records, and captured replies under `.sync-engine/` in the application root. It chooses each filename using a UTC timestamp and the role. The coordinator never names a generated file.

### Launch records

Every role starts through the skill's `launch` command, not through the harness CLI. The command reads the coordinator's provider, model, and reasoning setting and gives the child the same settings. It places the child in the application root, delivers the prompt as a file, and waits for the child to settle.

After settlement, `launch` writes a record with the agent ID, parent ID, prompt hash and size, brief hash, design digest, start time, and settle time.

Building a role prompt requires a settled record for the preceding role. Handback requires a record for every required role. Each record must still hash to its prompt and refer to an agent known to the harness. Work done directly by the coordinator has no record and cannot pass handback.

### Reply and path audits

After a role settles, two checks read from the harness instead of trusting the role's account of its work.

The reply check compares the final message with the role's return contract. A critic returns either the required clean sentence or its findings, optionally inside a code fence, and nothing else. A worker reports changed paths and check outcomes. A response that does not match means the role does not count.

The path check records every path the role opened, and handback reports any that fall
outside where that role may read. It does not fail the launch: the role has already
finished, and only whoever maintains the prompts can act on it. A designer or critic works from its prompt alone. An implementation worker may also read the installed engine's `examples/` and `docs/user/`, but no other location inside the installed package. No role may read the skill's own sources.

If harness tool records omit file paths, the launch record marks the audit unavailable rather than marking the role clean.

### Design and assignment checks

`design digest` hashes the authored design. Downstream prompts carry that digest, and a role launched against another digest does not count. Reopening the design after implementation requires relaunching the roles below it.

`assignment check` reads the assignment's write-path section. It rejects assignments that give a role another role's files. It also rejects a concept assignment with application-wide commands, no focused type check, or no storage guarantee for the data held by the concepts.

### Transient failures

When a role ends in an error, `launch` inspects it again after a pause because the first error may be a dropped connection. If the error remains, the role is asked to continue, at most twice. A further error fails the launch.

## Commands

Run every command as `bun "<skill-root>/scripts/command.ts" <command>`, where `<skill-root>` is the directory that contains the loaded `SKILL.md`.

```text
release check [<application-directory>]
brief init <brief.md>
brief check <brief.md>
design digest <design-directory>
prompt build --role <role> --input <slot>=<path>...
assignment new --role <role> --design-digest <sha256>
assignment check <file>
follow-up new --role <role>
follow-up check <file> --design-root <directory> --design-digest <sha256>
launch --role <role> --prompt <path> [--timeout <seconds>]
handback check --design-root <directory> --design-digest <sha256>
```

Valid roles are `designer`, `critic`, `concept-worker`, `application-worker`, `frontend-worker`, and `evidence-worker`.

Every command ends with `Next:` lines that give the exact syntax of possible following commands and name the relevant reference document. These lines describe syntax, not permission. The compiler does not decide product questions, approve a design, or decide when a stage is complete.

## Choosing what each role sees

Deciding what a role needs is the coordinator's judgement. Putting it in front of that role
is the compiler's job, and the compiler does it the same way every time.

Each role template declares named slots, and the coordinator fills them with
`--input <slot>=<path>`, repeating a slot for several files:

- `designer`: the brief, and optional catalog entries.
- `critic`: the brief, every candidate design file, and optional catalog entries.
- `concept-worker`: its assignment, the approved specifications, implementation examples,
  and an optional reference.
- `application-worker`: its assignment, the brief, the approved design, the public concept
  surfaces rather than their internals, existing shared wiring, examples, and an optional
  reference.
- `frontend-worker`: its assignment, the brief, and the assembled public interface.
- `evidence-worker`: its assignment, the brief, the contracts for its scenario, and the
  assembled public interface.

Three sources feed those slots. The catalog holds existing concepts, listed and shown with
`sync-engine-catalog`, which a designer may reuse or reject and a critic may cite to argue
for a better boundary. The installed engine ships implementation examples, and an
assignment names at most one per concept and one per mechanism. The skill packages two
references of its own, one for composition declarations and one for HTTP, given to the
workers that need them.

`sync-engine-analysis` is different. It helps the coordinator decide what to select, and
its output never reaches a designer or critic.

The compiler resolves each path, orders the inputs identically on every build, refuses a
slot the role does not declare, and refuses a required slot left empty. A role therefore
receives exactly the material named on the command line, and the prompt record lists every
source that went into it.

## Prompt compiler

Prompt templates use three directives: `include` adds shared text, `input` requires a file, and `input?` accepts an optional file.

The compiler applies a byte budget to each role: 32 KiB for the designer, 48 KiB for the critic, 24 KiB for a concept worker, 48 KiB for an application or frontend worker, and 32 KiB for the evidence worker.

Inputs have the same order on every build. The compiler reports sources, byte count, and SHA-256 separately from the prompt.

Generated Markdown is delivered as a file. It is never placed in a shell argument.

## Harness support

The `launch` command currently drives [Paseo](https://paseo.dev). The compiler, checks, and design digest are harness independent. Another harness needs its own launch module, following `references/harnesses/contract.md`.

## Read next

Start with `skills/sync-engine/SKILL.md`. It links to the coordinator workflow and the reference for each stage.

Role prompt templates declare their own inputs, and the compiler assembles them. Operators do not need to read the templates.
