# Compact deterministic application-design skill

## Outcome

Make the sync-engine application-design workflow substantially smaller and more
deterministic without weakening independent design criticism, semantic concept
boundaries, isolated implementation phases, or objective evidence.

Prefer direct Markdown and small TypeScript functions over schemas, workflow engines,
generated requirement projections, or general templating machinery. Determinism
applies to constructing and delivering role prompts; the compiler does not make
product or workflow decisions.

This plan replaces the earlier lite/full proposal. There is one semantic workflow and
one prompt per role.

## Workflow

### Product brief

The coordinator maintains a concise, read-only-to-workers `design/brief.md`. It has no
YAML frontmatter and contains these H2 sections once, in order:

1. Objective
2. Product decisions
3. Visible success
4. Expected refusals
5. Assumptions
6. Non-goals
7. Open decisions

Decisions are one-line bullets such as:

```markdown
- **D1 — Team scope (Assumption):** Use one shared workspace; multiple organizations are outside scope.
```

Decision identifiers are unique, and authority is `User` or `Assumption`. The brief
targets 1–2 KiB and has an 8 KiB hard limit. Open decisions are allowed. Only material
uncertainty about requested behavior blocks continuation; unspecified implementation
detail, optional polish, naming, presentation, and out-of-scope behavior do not.

`sync-engine-skill brief check` validates structure and syntax. It does not pretend to
decide semantic materiality.

### Approval

Interactive mode requires one concise review of links to the current authored design
before implementation. Preauthorization requires explicit user language requesting
autonomous continuation or no approval pauses. Ordinary instructions to implement do
not imply preauthorization.

Preauthorization still requires draft syntax and independent criticism. It stops only
for an unresolved material decision or finding; the coordinator never approves its
own design.

### Criticism

Two critic passes are the maximum automatic budget, not a mandatory count:

```text
candidate → syntax → critic 1
  clean/informational only → review complete
  material finding → designer repair → syntax → fresh critic 2 → review complete
```

After pass 2, unresolved material findings are shown to the user. The phrase “review
more thoroughly,” used after the automatic budget, authorizes one additional
repair-and-fresh-critic pass. Each further pass requires another explicit request.

A finding is material only when it affects concept ownership or independence; an
action, refusal, lifecycle, or visible result; authority or authorization;
persistence, deletion, compensation, or repair; an external type binding; a
cross-concept failure rule; or required visible success. Critics do not manufacture
findings for every unspecified behavior and do not iterate toward an empty list.

### Implementation roles

The default uses one worker per implementation phase, not one worker per concept:

1. A concept worker implements all approved concepts that fit its prompt budget. Each
   concept remains independently specified, implemented, and validated and may not
   depend on peer implementations.
2. An application worker implements compositions, type bindings, registration,
   assembly, configuration, host wiring, and generated-artifact integration.
3. A fresh evidence worker checks the brief against the assembled public interface and
   relevant contracts. It may conclude that selected existing evidence is sufficient
   and make no changes.

Split a concept or application phase only when its prompt exceeds the role budget or
the user explicitly requests parallel implementation. The coordinator chooses
explicit batches; the compiler performs no bin packing.

Repairs return to the original worker with a small file containing only the new
diagnostic and affected command. Do not launch replacement repair agents or resend the
complete original prompt. Ordinary implementation repair has no arbitrary pass count;
stop on a material design mismatch, repeated failure without progress, an unenforceable
boundary, or a genuinely necessary user decision.

### Reasoning and validation

Routine delegated roles use the provider or harness's explicit normal reasoning
setting. If no named normal setting exists, use the provider default and report that
fallback once. Reasoning configuration is launch metadata, not repeated prompt prose.

Run validation only when it establishes new evidence:

- syntax before critic pass 1 and again only after design repair;
- one focused validation per implementation role;
- objective scenarios in the evidence role; and
- the complete required application validation once after implementation.

After a repair, rerun only invalidated checks. Once required syntax, source agreement,
artifacts, types, tests, build, and bounded host checks pass and objective evidence is
present, hand back immediately. Informational advisories and optional polish do not
open another repair or criticism cycle.

## Prompt documents

The installed skill uses this layout:

```text
skills/sync-engine/
  SKILL.md
  references/
    workflow.md
    harnesses/
      contract.md
      paseo.md
  prompts/
    SOURCES.md
    common/
      design.md
    roles/
      designer.md
      critic.md
      concept-worker.md
      application-worker.md
      evidence-worker.md
    templates/
      product-brief.md
```

`prompts/common/design.md` is the only shared semantic include. It contains only rules
requiring human judgment:

- requested scope and useful purpose;
- concept independence and opaque identities;
- one semantic owner per durable fact;
- owner actions, invariants, refusals, repetition, and lifecycle;
- application composition, reaction pressure, partial failure, and repair;
- authorization and observable host or external behavior;
- authored types and links; and
- the limits of mechanical checking.

It omits examples, extended rationale, workflow mechanics, commands, API reference,
role boundaries, and repeated review checklists. Grammar needed to author a concept is
a short designer-only block. `common/design.md` targets 5–6 KiB and fails review above
8 KiB.

Routine concept and application API essentials live directly in their role templates.
An optional `reference` input supplies an uncommon exact-release API excerpt when the
approved design needs it. Coordinators do not rebuild API packs for ordinary work.

`prompts/SOURCES.md` is a plain source-section-to-prompt-heading inventory. It records
where every current normative rule went and which examples, rationale, or repetition
were removed. There are no stable requirement IDs, generated projections, guidance
lookup command, or explanation hierarchy.

Before compiler implementation, a fresh read-only reviewer compares the compact
prompts and `SOURCES.md` with the complete current workflow, design guidance, concept
grammar, and review guide. Material omissions are repaired. The review result is
reported in the implementation handback; `SOURCES.md` is the durable audit artifact.
The prompt documents require user approval before compiler implementation.

## Deterministic prompt compiler

The package adds one private TypeScript executable and no public JavaScript API:

```text
packages/skill/
  skills/sync-engine/
    scripts/
      command.ts
      prompt.ts
      brief.ts
    release.json
  dist/
  tsconfig.json
  tsconfig.build.json
```

The canonical compiler source travels inside the skill and uses Bun/TypeScript and
platform APIs only. It can validate a brief and compile prompts before an application
exists or installs dependencies. `package.json` also exposes the built
`sync-engine-skill` convenience executable from `dist/command.js` and retains
`exports: {}`. Do not add a generic template or Markdown parsing dependency.

The CLI has three command paths:

```text
sync-engine-skill release check [<application-directory>]
sync-engine-skill brief check <brief>
sync-engine-skill prompt build --role <role> --input <slot>=<path> ... --output <file>
```

`prompt build` accepts only packaged roles. `--input` may repeat. `--output` is
required unless `--stdout` is explicit. `--max-bytes` explicitly overrides the role's
default prompt budget and is reported with the digest.

### Template language

Templates support exactly three line directives:

```markdown
<!-- include: ../common/design.md -->
<!-- input: brief -->
<!-- input?: catalog -->
```

- `include` inserts one packaged static Markdown file. Includes are one level only;
  included files cannot contain directives.
- `input` requires one or more files for that slot.
- `input?` permits zero or more files.
- Template order is output order. Files within one input slot sort by normalized
  display name.
- Unknown slots, missing required inputs, duplicate files, duplicate display names,
  malformed directives, and includes outside the packaged prompt root fail.
- Relative source paths appear in stable source comments. Absolute paths appear only
  as basenames in prompt bytes; full paths are limited to the external build report.
- Normalize CRLF to LF and end every inserted source with one newline. Otherwise
  preserve Markdown, backticks, dollar signs, quotes, Unicode, and shell-sensitive
  characters.
- Prompts contain no timestamps, random identifiers, incidental absolute paths, or
  build report.

The build report, outside prompt bytes, gives role, ordered source list, byte count,
configured budget and override, and SHA-256. Byte-identical templates and input files
produce byte-identical prompts and digests.

### Roles and budgets

| Role               | Required inputs                                                               | Optional inputs          | Default maximum |
| ------------------ | ----------------------------------------------------------------------------- | ------------------------ | --------------: |
| designer           | brief                                                                         | existing design, catalog |          32 KiB |
| critic             | brief, candidate design                                                       | catalog                  |          48 KiB |
| concept worker     | assignment, concept specifications                                            | examples, reference      |          24 KiB |
| application worker | assignment, brief, approved design, completed concept surfaces, shared wiring | examples, reference      |          48 KiB |
| evidence worker    | assignment, brief, relevant contracts, assembled public interface             | existing relevant tests  |          32 KiB |

All dynamic content, including assignments and commands, is file-based. The
coordinator writes small Markdown assignment files directly through filesystem APIs,
not shell heredocs or string-concatenation scripts. Templates enforce slot names,
cardinality, ordering, and budgets. The harness enforces filesystem boundaries; the
compiler reports sources but does not inspect their semantic eligibility.

Designer and critic catalog context defaults to at most three concept designs and one
recipe. Broader catalog exploration requires an explicit user request. Implementation
roles receive at most one selected example per assigned mechanism when needed.

## Versions and tools

The bundled `release.json` records the exact matching skill, core, catalog, and analysis
versions. Brief validation and prompt construction use only bundled files, so they work
before application dependencies exist. `release check` separately verifies an existing
application's installed core, catalog, and analysis versions. A new application installs
those exact releases but does not install the skill package.

Remove the ambiguous `catalog` executable name. The catalog package exposes only
`sync-engine-catalog`, and workflow commands invoke it with:

```sh
bunx --no-install sync-engine-catalog ...
```

This fails rather than downloading an unrelated package.

## Harness guidance

Harness details stay out of role prompts. `references/harnesses/contract.md` states the
minimal capability contract: native independent agents, normal-reasoning launch
configuration, role boundaries, byte-preserving file delivery, follow-up delivery,
and bounded waiting.

`references/harnesses/paseo.md` is short and directly discoverable from `SKILL.md`.
For compatibility with Paseo versions lacking `run --prompt-file`, it uses:

1. `paseo run` with a fixed standby prompt that forbids inspection or mutation; then
2. immediate `paseo send <agent> --prompt-file <generated-file>`.

Follow-ups also use `--prompt-file`. Direct `run --prompt-file` may later remove the
small standby turn but is not a compatibility requirement. Generated Markdown is
never embedded in a shell-quoted command.

## Mechanical validation

Tests cover:

- brief headings, compact decision syntax, duplicate IDs, authority values, and size;
- exact directive parsing and one-level include boundaries;
- role slot cardinality and unknown inputs;
- deterministic ordering and repeated byte equality;
- CRLF/final-newline normalization;
- preservation of backticks, dollar signs, quotes, Unicode, and Markdown;
- stable source labels without absolute-path leakage;
- role budgets and explicit override reporting;
- exact four-package version matching;
- removal of the ambiguous `catalog` executable;
- one task-manager designer golden prompt and one message-board critic golden prompt;
- installed-package CLI behavior; and
- documentation links, source inventory coverage, role boundaries, reasoning launch
  guidance, critic stop rules, and validation stop rules.

Use package and repository scripts only: `bun run check`, `bun run test`, `bun run
build`, `bun run package:check`, and release/declaration checks when affected. Do not
add a workflow database, project metadata format, plugin system, prompt inspection
API, or experiment harness.

## Implementation sequence

1. Replace the current oversized workflow documents with the compact document layout.
2. Write `SOURCES.md` before removing semantic guidance.
3. Draft the brief template, shared design core, five role templates, workflow, and
   minimal harness guides.
4. Add document, slot, link, and byte-size tests and measure old versus compact static
   material.
5. Obtain independent semantic review, repair material omissions, and present the
   prompt documents for approval.
6. After approval, add the TypeScript CLI, exact version checks, catalog executable
   rename, package build and packaging changes, golden tests, and consumer tests.
7. Run all affected checks and hand back exact prompt sizes, compiler digest evidence,
   workflow semantics, validation outcomes, and any unsupported harness boundary.

A later efficiency experiment is intentionally outside this implementation. The skill
itself and its objective mechanical evidence are the current scope.
