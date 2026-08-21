# Coordinator workflow: implementation, validation, and handback

Read this once criticism and authorization have closed and the design digest is
captured.

## Implement in bounded phases

Start each assignment with the compiler, fill it, and check it before building the
prompt. Only `Allowed write paths` grants ownership, so a read path costs a role nothing.
`assignment check` refuses cross-role paths, unbounded execution budgets, and a concept
worker with application-wide commands, no focused type check, or no storage guarantee:

```sh
bun "<skill-root>/scripts/command.ts" assignment new --role <role> \
  --design-digest <sha256>
bun "<skill-root>/scripts/command.ts" assignment check <assignment-file>
```

List allowed paths as backticked bullets. Exclude framework source, installed contents,
build output, source maps, and paths reached through imports. Concept and application
workers require selected installed `examples/`, never `dist/`: at most one per concept
and mechanism. Reactions, views, formers, and endpoints each need an example; time or ID
dependencies need one showing injection. Missing context is a blocker, not permission to
discover more. Every concept assignment states the brief's exact durability decision as
a storage guarantee, never as concept State.

Compiler slots are:

- `concept-worker`: required `assignment`, `specifications`, `examples`; optional
  `reference`;
- `application-worker`: required `assignment`, `brief`, relevant types, composition and
  obligation closure as `design`, public `concept-surfaces` (exports, constructor
  dependencies, and registries—not implementation), `shared-wiring`, and `examples`;
  optional `reference`;
- `frontend-worker`: required `assignment`, `brief`, assembled `public-interface`;
  optional `examples`, `reference`; and
- `evidence-worker`: required `assignment`, `brief`, scenario-relevant approved
  `contracts`, assembled `public-interface`; optional requested `frontend` surface and
  selected relevant `existing-tests`.

Use `--input <slot>=<path>`; repeat slots for multiple files.

Prompt budgets are 32 KiB designer, 48 critic, 24 concept, 48 application/frontend,
and 32 evidence. Worker tool-call ceilings are 24, 28, 20, and 20, with two runs per
command, one repair per diagnostic signature, and one follow-up. The compiler rejects
inflated declarations. Paseo audits observable logs; native limits are prompt-enforced
and self-reported. Split before launch only into compiler-proven disjoint concept batches
whose harness enforces paths; otherwise work sequentially.

A concept worker is gated on `design/concepts/` alone, so take its digest with
`design digest design --role concept-worker`; every other role uses the whole design. A
role relaunched only because a digest moved gets an assignment saying so, to confirm its
implementation still matches and change nothing otherwise.

Launch through the matching harness guide with a compiler-owned record. Start one concept
worker unless a checked budget requires disjoint concept batches. Each batch owns only
assigned concept and focused test paths.

After concept validation, one application worker owns assigned composition, registration,
assembly, configuration, host, and generated-integration paths. HTTP comes only from the
host reference; hand-rolled routing, redirects, or error shapes are defects.

When requested, one frontend worker follows application validation and owns only frontend
paths. It is strictly a client of assembled endpoints. Web assignments name the HTTP
wire and base path; the frontend owns `createHttpClient` construction.

Pass `<skill-root>/prompts/inputs/composition.md` as `reference` to every application
worker. For HTTP, add `<skill-root>/prompts/inputs/http-host.md` to the application worker
and `<skill-root>/prompts/inputs/http-client.md` to the frontend worker. Never read these
worker references yourself.

Finally start one fresh evidence worker. For a frontend, supply its public entry and
focused tests so evidence exercises the visible boundary. Supply focused commands; it
may accept existing evidence and edits only assigned scenario/test paths.

Return an implementation defect to the original worker in a compiler-named file with
only the verbatim diagnostic, affected paths, and reproducing command. Its one follow-up
and same-signature repair ceilings span relaunches and digest changes; a worker-reported
repair counts, and recurrence blocks. Never resend the full prompt:

```sh
bun "<skill-root>/scripts/command.ts" follow-up new --role <role>
bun "<skill-root>/scripts/command.ts" follow-up check <file> \
  --design-root design --design-digest <sha256>
```

Application workers run focused source-agreement, artifact, integration, and host checks;
evidence workers run assigned scenarios. A new owner, action, refusal, lifecycle, policy,
external binding, cross-concept failure rule, or visible behavior is a design mismatch.
Return it to the original designer naming the missing declaration; a replacement receives
`existing-design`. Never silently edit approved Markdown. If the framework cannot express
the design, no critic can settle it: revise what it asks or put the decision to the user;
preauthorization records
the coordinator's assumption. One implementation-driven design reopening is the ceiling.

## Validate once and stop

After evidence, run the complete application-owned acceptance chain once from
application root; never hand-edit generated output:

```sh
bun run generate                                    # must leave generated output unchanged
bunx --no-install sync-engine verify --format json  # design form, source agreement, artifacts
bun run check                                       # application check chain and typecheck
bun test                                            # unless the application defines another
bun run start                                       # bounded host readiness and clean exit
```

No link kind names an endpoint, so no check proves one exists; the critic and the evidence
worker are its only guards. Before handback, confirm every brief visible success and
expected refusal appears in the evidence worker's covered outcomes, and treat an uncovered
one as blocking. `verify` reports `check-design`, `check`, and `artifacts check`
independently, so a failed step names its own diagnostic. Add the scenario commands the brief requires. On
failure, return that focused diagnostic to the original worker, rerun the affected
focused command, then every check invalidated by the changed paths regardless of chain
position. Do not repeat unaffected checks.

Confirm every required role phase ran independently before reporting anything. When the
human directly waives a missing phase or asks to hand back supplied work as-is, append
`--user-override`; the report lists waived phases instead of inventing their evidence:

```sh
bun "<skill-root>/scripts/command.ts" handback check \
  --design-root design --design-digest <sha256>
```

Inspect complete status and relevant diffs, including untracked files and
`.sync-engine/`; verify the brief and approved design unchanged and returned changes
inside assigned boundaries.

Required-command failure, missing objective evidence, or material design mismatch blocks
handback. Once required checks pass, hand back immediately. Record formatting, naming
polish, unchanged explanation, and informational checker advisories; do not reopen repair
or criticism.

The handback lists changed implementation areas, exact validation commands and outcomes,
known limits or remaining material uncertainty, and one request to accept, revise, or ask
for evidence. Omit routine transcripts. Acceptance closes conversation.
