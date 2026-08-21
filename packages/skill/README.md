# @mit-sdg/sync-engine-skill

`@mit-sdg/sync-engine-skill` is an Agent Skill for building applications on the sync-engine framework. A coding agent loads the skill and becomes the run coordinator. The coordinator writes only the product brief and a short assignment for each role. It launches a separate agent to do every other task.

This split provides independence. The designer has not seen an implementation. The critic did not write the design. The evidence worker did not build the application it tests. Package checks require a launch record for every role; outside Paseo, the active harness's agent UI remains the evidence that the coordinator actually delegated it.

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
2. Decomposition map.
3. Independent map review.
4. Authored contracts by the same designer.
5. Design syntax check.
6. Independent contract review and approval.
7. Concept implementation.
8. Application implementation.
9. Frontend implementation, when requested.
10. Evidence.
11. Required validation and handback.

The coordinator maintains `product/brief.md`. It records what the product does and the decisions behind it. Each decision is marked as the user's choice or the coordinator's assumption. The file stays outside `design/` because the coordinator continues to edit it.

The designer authors everything under `design/`, including concept specifications, compositions, and the types document. Every downstream role treats that directory as read-only.

The designer first places every brief need in a concept, composition, host, implementation, or evidence layer and writes only the decomposition map. A prompt-read-only map critic settles every concept row, need placement, authority, and obligation before the same recorded designer receives a compact contract-phase continuation. Two map and contract reviews are the default; pass two receives the prior map report. A clean contract verdict includes auditable checks for every map obligation. A direct human instruction may waive any workflow phase or review judgment, adopt a supplied design, or request another pass with `--user-override`; records and handback disclose every waived phase rather than calling it independent completion or critic approval.

By default, one concept worker implements all concepts and one application worker wires them together. Only compiler-proven disjoint concept batches may run in parallel, and only when the harness enforces their paths.

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

Every role is recorded through the skill's `launch` commands. In Paseo, `launch` starts and inspects the child directly. In Codex, Claude Code, and Antigravity, `launch prepare` binds the prompt to a ticket, the coordinator uses the harness's native subagent tool, and `launch complete` validates the captured return and writes the record.

Managed records contain the harness-observed agent identity, configuration, prompt hash and size, brief hash, design digest, timing, response, and available tool audit. Native records contain the native agent ID and the same compiler-verifiable hashes, but are marked coordinator-attested because the compiler cannot query another harness's in-session agent UI.

By default, building a role prompt requires a settled record for the preceding phase, and the continuing designer contract phase gets its own record tied to the map designer's agent-and-harness identity. A direct `--user-override` may launch from supplied context instead. Handback requires records for every non-waived phase and names each waived phase explicitly. Each record must still hash to its prompt and captured response. A managed record must also refer to an agent still known to Paseo. Native handback reports that independent harness attestation was unavailable; the harness's own agent UI or transcript remains inspectable. Work done directly by the coordinator has no valid native delegation and is forbidden even though portable records cannot prove that boundary cryptographically.

### Reply and path audits

After a role settles, two checks read from the harness instead of trusting the role's account of its work.

The reply check enforces complete map row and need-placement verdicts, every required clean-contract obligation check, and the worker `Changed`/`Checks`/`Blocker`/`Budget` envelope; it rejects empty responses. Portable harnesses treat execution counts as self-reported rather than machine-attested.

The path check records every path the role opened, and handback reports any that fall
outside where that role may read. It does not fail the launch: the role has already
finished, and only whoever maintains the prompts can act on it. Designers and critics use only compiled prompt material. Workers use only compiled material and assignment-listed read paths, write paths, and commands. No role may read the skill's sources or discover extra framework context.

If harness tool records omit file paths, the launch record marks the audit unavailable rather than marking the role clean.

### Design and assignment checks

`design digest` hashes the authored design. Downstream prompts carry that digest, and a role launched against another digest does not count. Reopening the design after implementation requires relaunching the roles below it.

`assignment check` validates role-owned paths and fixed execution budgets. It also rejects a concept assignment with application-wide commands, no focused type check, or no storage guarantee.

### Transient failures

When a role ends in an error, `launch` inspects it again after a pause because the first error may be a dropped connection. If the error remains, the role is asked to continue, at most twice. A further error fails the launch.

## Commands

Run every command as `bun "<skill-root>/scripts/command.ts" <command>`, where `<skill-root>` is the directory that contains the loaded `SKILL.md`.

```text
release check [<application-directory>]
brief init <brief.md>
brief check <brief.md>
design digest <design-directory> [--role <role>]
prompt build --role <role> [--mode map|contract] --input <slot>=<path>... [--user-override]
assignment new --role <role> --design-digest <sha256>
assignment check <file>
follow-up new --role <role>
follow-up check <file> --design-root <directory> --design-digest <sha256>
launch --role <role> --prompt <path> [--continue-agent <id>] [--timeout <seconds>]
launch prepare --harness <harness> --role <role> --prompt <path> [--continue-agent <id>]
launch complete --ticket <path> --agent-id <id>
handback check --design-root <directory> --design-digest <sha256> [--user-override]
```

Valid roles are `designer`, `critic`, `concept-worker`, `application-worker`, `frontend-worker`, and `evidence-worker`.

Every command ends with `Next:` lines that give the exact syntax of possible following commands and name the relevant reference document. These lines describe syntax, not permission. The compiler does not decide product questions, approve a design, or decide when a stage is complete.

## Choosing what each role sees

The coordinator decides what a role needs. The compiler puts it in the prompt.

Each role template declares named slots, and the coordinator fills them with
`--input <slot>=<path>`, repeating a slot for several files:

- map `designer`: the brief and compact catalog purpose/operation cards.
- contract `designer`: hash bindings for the brief, accepted map, and review already retained by that same agent, plus full contracts only for `catalog-unchanged` entries.
- map `critic`: the brief, decomposition map, compact catalog cards, compiler-bound pass count, and the prior report on later passes.
- contract `critic`: the brief, accepted map, and every candidate contract file.
- `concept-worker`: its assignment, the approved specifications, implementation examples,
  and an optional reference.
- `application-worker`: its assignment, the brief, the approved design, the public concept
  surfaces rather than their internals, relevant types/composition/obligation closure,
  existing shared wiring, examples, and an optional reference.
- `frontend-worker`: its assignment, the brief, and the assembled public interface.
- `evidence-worker`: its assignment, the brief, scenario contracts, the assembled public
  interface, and, when requested, the frontend surface; existing tests are optional.

Three sources fill those slots. `sync-engine-catalog` lists and shows existing concepts,
which a map designer can reuse or reject. The installed engine ships implementation
examples; the coordinator compiles at most one per concept and mechanism into worker
prompts. The skill carries composition, HTTP-host, and HTTP-client references and sends
only the relevant one to each worker.

`sync-engine-analysis` is for the coordinator alone. It helps decide what to select, and
its output never reaches a designer or critic.

The compiler resolves each path, keeps the inputs in a fixed order, rejects a slot the role
does not declare, and rejects a required slot left empty. A role gets exactly the files
named on the command line, and the prompt record lists all of them.

## Prompt compiler

Prompt templates use five directives: `include` adds shared text; `input` and `input?` add required or optional file bytes; `bind` and `bind?` hash-bind required or optional files without resending bytes already retained by a continuing agent.

The compiler applies byte budgets of 32 KiB for designer prompts, 48 KiB for critics, 24 KiB for concept workers, 48 KiB for application and frontend workers, and 32 KiB for evidence. Checked assignments reject declared tool ceilings above 24, 28, 20, and 20 respectively, with two runs per command and one informed repair per diagnostic signature. Paseo audits observable logs; portable harnesses record that these limits are prompt-enforced.

Inputs have the same order on every build. The compiler reports sources, byte count, and SHA-256 separately from the prompt.

Generated Markdown is delivered as a file. It is never placed in a shell argument.

## Harness support

The compiler directly drives [Paseo](https://paseo.dev). Codex, Claude Code, and Antigravity use their native in-session delegation tools through the portable prepare/complete protocol. This preserves fresh role contexts and compiler-owned records without nested headless CLI sessions. Paseo records are harness-attested; portable records are coordinator-attested and say which audits were unavailable. See `references/harnesses/contract.md` and the matching harness guide.

## Read next

Start with `skills/sync-engine/SKILL.md`. It links to the coordinator workflow and the reference for each stage.

Role prompt templates declare their own inputs, and the compiler assembles them. Operators do not need to read the templates.
