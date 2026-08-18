# Coordinator workflow: implementation, validation, and handback

Read this once criticism and authorization have closed and the design digest is
captured.

## Implement in bounded phases

Start each assignment with the compiler, fill it, and check it before building the
prompt. It refuses one role's paths going to another, a concept worker with
application-wide commands or no focused type check, and a missing storage guarantee:

```sh
bun "<skill-root>/scripts/command.ts" assignment new --role <role> \
  --design-digest <sha256>
bun "<skill-root>/scripts/command.ts" assignment check <assignment-file>
```

List every allowed path as a backticked bullet. Never include framework checkout source,
installed package contents, build output, source maps, or paths reached by following
framework imports. Supply framework information only through exact public API references
and selected application examples, which concept and application workers require: at most
one implementation example per concept and one per mechanism, taken from the installed
`node_modules/@mit-sdg/sync-engine/examples/`. A worker with no example for a mechanism
returns a context blocker rather than discovering it. Carry the brief's durability decision into every concept assignment as a
storage guarantee, never as a claim about concept State.

Compiler slots are:

- `concept-worker`: required `assignment`, `specifications`, `examples`; optional
  `reference`;
- `application-worker`: required `assignment`, `brief`, approved `design`, completed
  public `concept-surfaces` rather than internals, existing `shared-wiring`, `examples`;
  optional `reference`;
- `frontend-worker`: required `assignment`, `brief`, assembled `public-interface`;
  optional `examples`, `reference`; and
- `evidence-worker`: required `assignment`, `brief`, scenario-relevant approved
  `contracts`, assembled `public-interface`; optional selected relevant `existing-tests`.

Use `--input <slot>=<path>`; repeat slots for multiple files.

Prompt budgets are designer 32 KiB, critic 48 KiB, concept 24 KiB, application 48 KiB,
frontend 48 KiB, and evidence 32 KiB. Split a worker into explicit batches only on budget
overflow or explicit user-requested parallelism.

Launch each worker with `launch --role <role> --prompt <prompt-file>`, never by hand.
Start one concept worker for all approved concepts, owning only assigned
concept and focused test paths. Concepts remain independent.

After concept validation passes, start one application worker owning assigned
compositions, types, registrations, concept set, assembly, configuration, host wiring,
and generated integration paths.

If the brief requests a frontend, after application validation passes start one frontend worker owning
only assigned frontend paths. It implements the requested browser, command-line, or other
shell strictly as a client of the assembled endpoints. A web-application assignment
names the projected HTTP wire and base path; the frontend owns its
`createHttpClient` construction. Pass packaged HTTP reference
`<skill-root>/prompts/inputs/http.md` to application and frontend workers as `reference`;
do not read it yourself.

Finally start one fresh evidence worker. Supply focused commands, not
the complete application. It may report existing evidence sufficient and edit only
assigned scenario/test paths.

Return an ordinary implementation defect to the original worker, not a replacement, in
a file containing only the new diagnostic, affected paths, and affected command. Do not
resend its full prompt. Before delivery require:

```sh
bun "<skill-root>/scripts/command.ts" follow-up check <file> \
  --design-root design --design-digest <sha256>
```

Application workers run focused source-agreement, artifact, integration, and bounded
host checks for assigned wiring; evidence workers run assigned scenarios or tests, not a
production-wide build chain. A mismatch is material when implementation requires a new
owner, action, refusal, lifecycle, application policy, external type binding,
cross-concept failure rule, or visible behavior. Return it to design; never silently
change approved Markdown.

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

`verify` reports `check-design`, `check`, and `artifacts check` independently, so a
failed step names its own diagnostic. Add the scenario commands the brief requires. On
failure, return that focused diagnostic to the original worker, rerun the affected
focused command, then every check invalidated by the changed paths regardless of chain
position. Do not repeat unaffected checks.

Confirm every required role ran independently before reporting anything:

```sh
bun "<skill-root>/scripts/command.ts" handback check \
  --design-root design --design-digest <sha256>
```

Inspect complete status and relevant diffs, including untracked files and `.sync-engine/`
itself; verify the brief and approved design unchanged and returned changes inside
assigned boundaries.

Required-command failure, missing objective evidence, or material design mismatch blocks
handback. Once required checks pass, hand back immediately. Record formatting, naming
polish, unchanged explanation, and informational checker advisories; do not reopen repair
or criticism.

The handback lists changed implementation areas, exact validation commands and outcomes,
known limits or remaining material uncertainty, and one request to accept, revise, or ask
for evidence. Omit routine transcripts. Acceptance closes conversation.
