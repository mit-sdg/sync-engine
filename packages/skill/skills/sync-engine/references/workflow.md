# Coordinator workflow

This reference owns product decisions, stage transitions, role launches, validation,
and handback. Compiled role prompts own delegated boundaries and outputs.

## Start safely

Read repository instructions, inspect tracked and untracked work, and preserve unrelated
changes. Never commit, merge, rebase, reset, switch branches, create a nested
repository, or otherwise alter Git history.

For a new application, initialize or reuse a Bun package, require the exact matching
`@mit-sdg/sync-engine` version, and run the installed `sync-engine setup`. For an
existing configured application, do not rerun setup merely to impose default files or
scripts. Run its documented baseline before design.

A short-lived start must exit successfully. For a long-running start, wait for its
documented readiness signal, request graceful shutdown, and require a successful exit.
A timeout, missing readiness condition, forced kill, or nonzero exit is a failed
baseline.

Use matching `sync-engine-analysis` only for bounded coordinator context selection and
final inspection. Keep raw analysis output internal. Repository search and broader
source reading are fallback for unavailable, incomplete, or ambiguous analysis, files
outside its manifest, or a concrete compiler/runtime failure. Never give analysis
output or instructions to the designer or critic.

## Maintain the product brief

Create and update `design/brief.md` from the user's request and decisions. Keep it
brief: objective, product decisions, visible success, expected refusals, assumptions,
non-goals, and open decisions. Use `User` authority for requested or interactively
settled decisions and `Assumption` for conservative coordinator choices. Run:

```sh
bunx --no-install sync-engine-skill brief check design/brief.md
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

Resolve the exact installed skill, core, catalog, and analysis release. The catalog
executable is only `sync-engine-catalog`; invoke it without package download:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

For designer and critic prompts, select at most three relevant concept designs and one
recipe by default. Zero is valid. Broader catalog exploration requires an explicit
user request. Catalog designs are alternatives, never mandatory names or contracts.

Build prompts only with `sync-engine-skill prompt build` and deliver the output file
through the selected harness guide. Do not concatenate prompts with Python, heredocs,
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

After syntax passes, launch a fresh read-only normal-reasoning critic. Two critic
passes are the maximum automatic budget. Maintain the critic count in active
coordinator state:

1. Critic pass 1 reviews the candidate.
2. No material findings ends criticism immediately.
3. Material findings may return once to the designer. Rerun syntax after repair, then
   launch fresh critic pass 2.
4. After pass 2, stop automatic criticism and show remaining material findings to the
   user.

“Review more thoroughly,” requested after the automatic budget, authorizes one more
designer repair and fresh critic pass. Each further pass requires another explicit
request. Implementation diagnostics do not create critic passes unless they reveal a
material contract mismatch.

In interactive mode, link the current brief and authored design in one concise review
and require explicit approval. In preauthorized mode, proceed without an artificial
pause after syntax and independent review complete. Either mode stops for unresolved
material uncertainty. The coordinator never approves its own design.

## Implement in bounded phases

Write each role's paths, commands, and return contract to a small temporary Markdown
assignment file using filesystem APIs, not shell interpolation.

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
only the new diagnostic and affected command. Do not create a replacement agent or
resend its full prompt. A mismatch is material when implementation requires a new
owner, action, refusal, lifecycle, application policy, external type binding,
cross-concept failure rule, or visible behavior. Return a material mismatch to design;
never silently change approved Markdown.

## Validate once and stop

Each worker runs focused validation before return. After evidence completes, run every
application-owned source-agreement, artifact, typecheck, check, test, build,
generation, and bounded host command required by the change. Never hand-edit generated
output. After a repair, rerun only checks invalidated by that change.

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
