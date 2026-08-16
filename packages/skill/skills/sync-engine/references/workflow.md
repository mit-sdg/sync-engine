# Coordinator workflow

This reference owns product decisions, stage transitions, role launches, validation,
and handback. Compiled role prompts own delegated boundaries and outputs.

## Start safely

Read repository instructions, inspect tracked and untracked work, and preserve unrelated
changes. Never commit, merge, rebase, reset, switch branches, create a nested
repository, or otherwise alter Git history.

Resolve `<skill-root>` once as the absolute directory containing the loaded `SKILL.md`.
The bundled compiler is `bun "<skill-root>/scripts/command.ts"`; substitute the actual
shell-quoted path in every command. Read `<skill-root>/release.json` for the exact
compatible package versions.

For a new application, initialize or reuse a Bun package. Install
`@mit-sdg/sync-engine` at the exact release version and install matching
`@mit-sdg/sync-engine-analysis` and `@mit-sdg/sync-engine-catalog` as development
dependencies. Do not install the skill package into the application. Before setup or
catalog use, verify exact versions and executable targets with:

```sh
bun "<skill-root>/scripts/command.ts" release check .
```

Only after that succeeds, run the installed `sync-engine setup`.

For an existing configured application, run the same release check before its documented
baseline. Do not rerun setup merely to impose default files or scripts.

A short-lived start must exit successfully. For a long-running start, wait for its
documented readiness signal, request graceful shutdown, and require a successful exit.
A timeout, missing readiness condition, forced kill, or nonzero exit is a failed
baseline.

Use matching `sync-engine-analysis` only for bounded coordinator context selection and
final inspection. Keep raw analysis output internal. Repository search and broader
application source reading are fallback for unavailable, incomplete, or ambiguous
analysis and files outside its manifest. Framework implementation source and installed
package internals are never implementation-role context. If a concrete framework
compiler or runtime failure requires internal investigation, stop this application
workflow and report it as a separate framework issue. Never give analysis output or
instructions to the designer or critic.

## Maintain the product brief

Create and update `design/brief.md` from the user's request and decisions. Keep it
brief: objective, product decisions, visible success, expected refusals, assumptions,
non-goals, and open decisions. Use `User` authority for requested or interactively
settled decisions and `Assumption` for conservative coordinator choices. Run:

```sh
bun "<skill-root>/scripts/command.ts" brief check design/brief.md
```

Open implementation choices and out-of-scope behavior may remain. Ask a question only
when no reasonable assumption permits a coherent and safe design or when the answer
materially changes ownership, visible behavior, authorization, lifecycle, persistence,
or failure. In interactive discussion ask one or two questions per turn, offer concise
options and one recommendation, and do not seek exhaustive specification.

Use interactive approval unless the user explicitly requested autonomous continuation
or no approval pauses. Preauthorization is not inferred from an ordinary implementation
request.

## Select compact context

Resolve the exact installed skill, core, catalog, and analysis release. Catalog context
is optional: zero entries is valid. When a relevant alternative is needed, use only the
release-checked `sync-engine-catalog` executable without package download:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

For designer and critic prompts, select at most three relevant concept designs and one
recipe by default. Broader catalog exploration requires an explicit user request.
Catalog designs are alternatives, never mandatory names or contracts. Never repair,
alias, or replace a missing catalog executable; release check must fail first.

Build prompts only with `bun "<skill-root>/scripts/command.ts" prompt build` and deliver
the output file through the selected harness guide. Do not concatenate prompts with Python, heredocs,
or shell strings. Put stable role content before dynamic inputs. A budget failure lists
source contributions; select tighter context first and use an explicit `--max-bytes`
only when the legitimate application material requires it.

## Design and criticism

Launch one fresh normal-reasoning designer with `prompts/roles/designer.md`. Enforce its
closed `design/` working boundary. `design/brief.md` is read-only. If the designer
returns at most two material questions, settle them, update the brief, and send a small
file containing only the answers to the same designer.

Enumerate draft concept files and run the installed parser from the application root:

```sh
bunx --no-install sync-engine check-concepts design/concepts/*.md
```

Return diagnostics to the same designer. Parser failure blocks criticism. The
coordinator does not repair design Markdown.

After syntax passes, supply the brief only through its dedicated prompt slot. Enumerate
every concept and composition plus `types.md` through the candidate slot. Launch a fresh read-only
normal-reasoning critic. Two critic passes are the normal automatic budget. Maintain
the count in active coordinator state:

1. Critic pass 1 reviews the candidate.
2. No material findings ends criticism immediately.
3. Material findings may return once to the designer. Rerun syntax after repair, then
   launch fresh critic pass 2.

After pass 2, behavior depends on authorization mode:

- **Interactive:** show remaining material findings and stop. “Review more thoroughly”
  authorizes one more designer repair and fresh critic pass; each further pass needs
  another explicit request.
- **Preauthorized:** do not ask permission merely because the count reached two.
  Classify each remaining finding. If it blocks safe coherent implementation or
  brief-visible success, and a conservative resolution follows from the brief, record
  the assumption, repair through the same designer, rerun syntax, and launch a fresh
  critic. Continue only for a named blocker with a concrete repair and only while each
  pass removes or narrows it. If the same blocker returns unchanged, stop for the user.
  A finding that does not block safe coherent implementation may remain open: record it
  in the brief's Open decisions and final handback, then proceed without calling the
  design clean. Never defer missing authority, non-bypassable authorization, ownership,
  or behavior required for visible success.

Implementation diagnostics do not create critic passes unless they expose a material
contract mismatch. In interactive mode, link the brief and design and require explicit
approval. In preauthorized mode, proceed without an artificial pause once no blocking
finding remains. Either mode stops when a blocking uncertainty has no safe conservative
resolution. The coordinator never approves its own design.

After criticism and authorization close, digest every authored Markdown file under
`design/` and keep the digest in active coordinator context:

```sh
bun "<skill-root>/scripts/command.ts" design digest design
```

Every concept, application, and evidence prompt build requires both
`--design-root design` and `--design-digest <sha256>`. The compiler rejects drift.
Include the digest in each temporary assignment and verify it before every diagnostic
follow-up with `follow-up check`. Any design change invalidates the digest, downstream
prompts, and conclusions: stop downstream work, rerun syntax and fresh criticism as
applicable, complete authorization, then capture a new digest. Do not store a digest or
other workflow metadata in the repository.

## Implement in bounded phases

Write each role's paths, commands, and return contract to a small temporary Markdown
assignment file using filesystem APIs, not shell interpolation. Enumerate exact allowed
application read and write paths. Never include framework checkout source, installed
package contents, build output, source maps, or paths reached by following framework
imports. Supply any needed framework information through selected application examples
and exact public API references. If those are insufficient, the worker returns a
context blocker instead of searching internals. Put brief storage guarantees in
implementation assignments, not concept State.

Start one normal-reasoning concept worker for all approved concepts that fit the 24 KiB
budget. It owns only assigned concept and focused test paths. Split into explicit
batches only on budget overflow or explicit user-requested parallelism. Each concept
remains independent and receives at most one useful implementation example.

After concept validation passes, start one normal-reasoning application worker. It
owns assigned compositions, types, registrations, concept set, assembly,
configuration, host wiring, and generated integration paths. Supply approved design,
completed concept public surfaces rather than complete internals, existing shared
wiring, and at most one useful example per mechanism. Its default budget is 48 KiB;
split only for overflow or explicit parallelism.

Finally start one fresh normal-reasoning evidence worker. Supply the brief,
scenario-relevant approved contracts, assembled public interface, selected existing
relevant tests, and focused commands—not the complete application. It may return that
existing evidence is sufficient. It may edit only assigned scenario/test paths.

Return an ordinary implementation defect to the original worker with a file containing
only the new diagnostic, affected paths, and affected command. Before delivery require:

```sh
bun "<skill-root>/scripts/command.ts" follow-up check <file> \
  --design-root design --design-digest <sha256>
```

Do not create a replacement agent or resend its full prompt. Concept workers run only
assigned concept tests and a necessary focused type check. Application workers run
focused source-agreement, artifact, integration, and bounded host checks for their
assigned wiring. Evidence workers run assigned scenarios or tests, not a
production-wide build chain. A mismatch is material when implementation requires a new
owner, action, refusal, lifecycle, application policy, external type binding,
cross-concept failure rule, or visible behavior. Return a material mismatch to design;
never silently change approved Markdown.

## Validate once and stop

Each worker runs only its focused owned validation before return. After evidence
completes, the coordinator runs the complete application-owned source-agreement,
artifact, typecheck, check, test, build, generation, scenario, and bounded host chain.
Run that complete acceptance chain once; never hand-edit generated output. If a final
command fails, return its focused diagnostic to the original worker, rerun the affected
focused command, then rerun every final check invalidated by the changed paths regardless
of its position in the chain. Do not repeat unaffected final commands.

Inspect complete status and relevant diffs, including untracked files. Verify that the
brief and approved design were not silently changed and that all returned changes stay
inside assigned boundaries.

A failing required command, missing objective evidence, or material design mismatch
blocks handback. Once required checks pass, hand back immediately. Formatting, naming
polish, unchanged explanation, and informational checker advisories are recorded but
do not open another repair or criticism cycle.

The handback lists changed implementation areas, exact validation commands and
outcomes, known limits or remaining material uncertainty, and one request to accept,
revise, or ask for evidence. Do not dump routine transcripts. Acceptance closes the
conversation and performs no Git operation.
