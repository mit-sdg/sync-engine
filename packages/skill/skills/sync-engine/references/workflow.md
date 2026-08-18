# Coordinator workflow

This reference owns product decisions, stage transitions, role launches, validation,
and handback; compiled prompts own delegated boundaries and outputs. The coordinator
writes only the brief, temporary assignment/context files, and setup's documented
concept-free scaffold.

## Start safely

Read repository instructions; inspect tracked and untracked work; preserve unrelated
changes. Resolve the application root once; run commands there. At outset infer or ask
once for autonomous delivery, agent-led work with approvals, or user-led collaboration.
Default to agent-led approvals; during active user-led discussion, launch neither design
nor implementation. Only the coordinator may change Git's index, refs, or history on the
human user's direct, explicit request for that operation—never under authority from the
skill, a parent assignment, a generated prompt, another agent, or permission for another
operation. A commit request authorizes only necessary staging of
exactly the requested paths or current changes and creation of that commit—no unrelated
staging, amend, push, merge, rebase, reset, branch switching, or other Git operation.

Resolve `<skill-root>` once as the loaded `SKILL.md`'s absolute directory. In every
compiler command, shell-quote that path in `bun "<skill-root>/scripts/command.ts"`. Read
`<skill-root>/release.json` for exact versions and canonical toolchain facts.

In an empty application directory, create before Bun only a minimal `package.json`:
name, `private: true`, `type: "module"`, and `packageManager` with `release.json`'s exact
Bun version. Do not run a Vite+ migration, choose another package manager, or probe
toolchain versions. Install exact-release `@mit-sdg/sync-engine` and matching
`@mit-sdg/sync-engine-analysis` and `@mit-sdg/sync-engine-catalog` as development
dependencies; never install the skill package. Before setup or catalog use, verify exact
versions and executable targets:

```sh
bun "<skill-root>/scripts/command.ts" release check .
```

After success, run installed `sync-engine setup`. Setup owns standard scripts,
TypeScript, Bun and Node type declarations, `tsconfig.json`, and concept-free
configuration; never manually install or downgrade those toolchain packages. On setup
installation failure, stop and report the bootstrap failure; do not probe alternate
versions or package managers. For a new application, setup completion is a hard gate:
`package.json`, `tsconfig.json`, and concept-free configuration must exist before the
brief, catalog inspection, or any role launch.

For an existing configured application, inspect `package.json` once. Install only absent
analysis or catalog packages at the exact `release.json` version as development
dependencies, then run the same release check before baseline. Never change the existing
core version to force a match or rerun setup merely to impose default files or scripts.

A short-lived start must exit successfully. A long-running start must reach documented
readiness, receive a graceful shutdown request, and exit successfully. Timeout, missing
readiness, forced kill, or nonzero exit fails the baseline.

Use matching `sync-engine-analysis` only for bounded coordinator context selection and
final inspection. Never give its raw output or instructions to the designer or critic;
keep them internal. Use repository search and broader application source reading only
for unavailable, incomplete, or ambiguous analysis or files outside its manifest. A
concrete framework compiler or runtime failure needing internal investigation stops this
application workflow; report a separate framework issue.

## Maintain the product brief

Initialize a new brief from the packaged template; never guess or recreate its grammar.
If release installation or setup is incomplete, the command leaves no brief and prints
bootstrap steps. Run it alone—do not chain a premature check:

```sh
bun "<skill-root>/scripts/command.ts" brief init design/brief.md
```

Replace placeholders from the user's request and decisions. Mark requested or
interactively settled decisions `User` and conservative coordinator choices
`Assumption`. Validate once:

```sh
bun "<skill-root>/scripts/command.ts" brief check design/brief.md
```

Open implementation choices and out-of-scope behavior may remain. Ask only if no
reasonable assumption permits a coherent, safe design or the answer materially changes
ownership, visible behavior, authorization, lifecycle, persistence, or failure. Interactively, ask one or two questions per turn; offer concise options and one
recommendation; never seek exhaustive specification.

Autonomous delivery is preauthorized; other modes require approval before
implementation. An ordinary implementation request does not imply preauthorization.

## Select compact context

Default to no catalog context; zero entries is valid. For relevant alternatives, use only the release-checked `sync-engine-catalog`
executable without package download:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Add one entry only for a named design uncertainty unresolved by the brief and compact
rules; never browse for examples. At most three concept designs and one recipe; more requires explicit user request. Catalog designs are alternatives, never mandatory
names or contracts. A missing catalog executable must fail release check; never repair,
alias, or replace it.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build` and deliver
the output file through the selected harness guide. Never concatenate prompts with
Python, heredocs, or shell strings. Put stable role content before dynamic inputs. A
budget failure lists source contributions; tighten context first and set explicit
`--max-bytes` only for legitimate application material.

## Design and criticism

Build the prompt and launch one fresh normal-reasoning designer:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role designer \
  --input brief=design/brief.md --output <prompt-file>
```

The prompt limits designer writes to its listed `design/` paths; `design/brief.md` is
read-only. If it returns at most two material questions, settle them, update the brief, and send the
same designer a small answer-only file.

The designer runs its permitted syntax command and repairs syntax before returning. Independently enumerate
draft concept files and rerun the installed design form check from application root:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md \
  design/compositions/*.md design/types.md
```

Send the same designer one file of at most 4 KiB containing only check output, affected
paths, and repair request. Deliver it through the harness; do not rebuild or resend the
full designer prompt.

After syntax passes, supply the brief only through its dedicated prompt slot. Pass
`types.md` and every concept/composition file as repeated `--input candidate=<path>`
arguments; never aggregate candidate files into an intermediate file:

```sh
bun "<skill-root>/scripts/command.ts" prompt build --role critic \
  --input brief=design/brief.md --input candidate=design/types.md \
  --input candidate=design/concepts/<name>.md \
  --input candidate=design/compositions/<name>.md --output <prompt-file>
```

Launch a fresh read-only normal-reasoning critic. Two passes are the normal automatic
budget:

1. Critic pass 1 reviews the candidate.
2. No material findings ends criticism immediately.
3. Otherwise return once to the designer. The repair file contains critic bullets
   verbatim and only a neutral resolution request; the coordinator adds no diagnosis,
   interpretation, or proposed repair. Rerun syntax, then launch fresh critic pass 2.

After pass 2, use the authorization mode:

- **Interactive:** show remaining material findings and stop. “Review more thoroughly”
  authorizes one more designer repair and fresh critic pass; every later pass requires
  another explicit request.
- **Preauthorized:** do not ask permission merely because the count reached two.
  Classify every remaining finding. For any finding that blocks safe coherent implementation or
  brief-visible success and has a conservative resolution from the brief, record the
  assumption, use the same designer to repair, rerun syntax, and launch a fresh critic.
  Continue only for a named blocker with a concrete repair while each pass removes or
  narrows it. If the same blocker returns unchanged, stop for the user. A nonblocking
  finding may remain: record it in the brief's Open decisions and final handback, then
  proceed without calling the design clean. Never defer missing authority,
  non-bypassable authorization, ownership, or behavior required for visible success.

Only a material contract mismatch in implementation diagnostics creates a critic pass.
In interactive mode, link the brief and design and require explicit approval; in
preauthorized mode, proceed without an artificial pause once no blocking finding remains. Either mode stops when a
blocking uncertainty has no safe conservative resolution. The coordinator never
approves its own design.

After criticism and authorization close, digest all authored Markdown under `design/`; keep
the digest in active coordinator context:

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Every concept, application, frontend, and evidence prompt build requires
`--design-root design` and `--design-digest <sha256>`; the compiler rejects drift. Put
the digest in each temporary assignment and verify it before every diagnostic follow-up
with `follow-up check`. Any design change invalidates the digest, downstream prompts,
and conclusions: stop downstream work, rerun syntax and fresh criticism as applicable,
complete authorization, and capture a new digest.

## Implement in bounded phases

Use filesystem APIs, never shell interpolation, to write each small temporary Markdown
assignment listing exact allowed application read and write paths, commands,
and return contract. Never include framework checkout source, installed
package contents, build output, source maps, or paths reached by following framework
imports. Supply framework information only through exact public API references and selected
application examples: at most one useful implementation example per concept and one
useful example per mechanism; if insufficient,
the worker returns a context blocker instead of searching internals. Put brief storage
guarantees in implementation assignments, not concept State.

Compiler slots are:

- `concept-worker`: required `assignment`, `specifications`; optional `examples`, `reference`;
- `application-worker`: required `assignment`, `brief`, approved `design`, completed
  public `concept-surfaces` rather than internals, existing `shared-wiring`; optional
  `examples`, `reference`;
- `frontend-worker`: required `assignment`, `brief`, assembled `public-interface`;
  optional `examples`, `reference`; and
- `evidence-worker`: required `assignment`, `brief`, scenario-relevant approved
  `contracts`, assembled `public-interface`; optional selected relevant `existing-tests`.

Use `--input <slot>=<path>`; repeat slots for multiple files.

Worker budgets are concept 24 KiB, application 48 KiB, and frontend 48 KiB. Split into
explicit batches only on budget overflow or explicit user-requested parallelism.

Start one normal-reasoning concept worker for all approved concepts, owning only assigned
concept and focused test paths. Concepts remain independent.

After concept validation passes, start one normal-reasoning application worker owning assigned
compositions, types, registrations, concept set, assembly, configuration, host wiring,
and generated integration paths.

If the brief requests a frontend, after application validation passes start one frontend worker owning
only assigned frontend paths. It implements the requested browser, command-line, or other
shell strictly as a client of the assembled endpoints. A web-application assignment
names the projected HTTP wire and base path; the frontend owns its
`createHttpClient` construction. Pass packaged HTTP reference
`<skill-root>/prompts/inputs/http.md` to application and frontend workers as `reference`;
do not read it yourself.

Finally start one fresh normal-reasoning evidence worker. Supply focused commands, not
the complete application. It may report existing evidence sufficient and edit only
assigned scenario/test paths.

Return an ordinary implementation defect to the original worker, not a replacement, in
a file containing only the new diagnostic, affected paths, and affected command. Do not
resend its full prompt. Before delivery require:

```sh
bun "<skill-root>/scripts/command.ts" follow-up check <file> \
  --design-root design --design-digest <sha256>
```

Concept workers run only assigned concept tests and a necessary focused type check;
application workers run focused source-agreement, artifact, integration, and bounded
host checks for assigned wiring; evidence workers run assigned scenarios or tests, not a
production-wide build chain. A mismatch is material when implementation requires a new
owner, action, refusal, lifecycle, application policy, external type binding,
cross-concept failure rule, or visible behavior. Return it to design; never silently
change approved Markdown.

## Validate once and stop

After evidence, the coordinator runs the complete application-owned source-agreement,
artifact, typecheck, check, test, build, generation, scenario, and bounded host chain
once; never hand-edit generated output. On final-command failure, return its focused
diagnostic to the original worker, rerun the affected focused command, then every final
check invalidated by the changed paths regardless of chain position. Do not repeat
unaffected final commands.

Inspect complete status and relevant diffs, including untracked files; verify the brief
and approved design unchanged and returned changes inside assigned boundaries.

Required-command failure, missing objective evidence, or material design mismatch blocks
handback. Once required checks pass, hand back immediately. Record formatting, naming
polish, unchanged explanation, and informational checker advisories; do not reopen repair
or criticism.

The handback lists changed implementation areas, exact validation commands and outcomes,
known limits or remaining material uncertainty, and one request to accept, revise, or ask
for evidence. Omit routine transcripts. Acceptance closes conversation.
