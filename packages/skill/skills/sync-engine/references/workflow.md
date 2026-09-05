# Coordinate an application change

Use this procedure for one bounded sync-engine application work item.

## 1. Start or resume the work item

Read application instructions and inspect `.sync-engine/work/`. Each work item lives at `.sync-engine/work/<slug>/`; resume the matching slug when clear, otherwise choose a short kebab-case slug.

Run from the application root; the explicit policy flags show their defaults:

```sh
sync-engine-skill work start <slug> \
  --review required \
  --execution mixed
```

In an empty application, the command reads the skill release and creates only this initial manifest before installation:

```json
{
  "name": "sync-engine-app",
  "private": true,
  "type": "module",
  "packageManager": "bun@<exact release.toolchain.bun>"
}
```

For an existing manifest, the command preserves its fields and adds the exact `packageManager` field when absent. It installs and verifies the pinned sync-engine setup and creates `brief.md` plus immutable `policy.json`. Review is `required` by default; use `omitted` only for an explicit user decision. Execution defaults to `mixed`; select `delegated` or `simulated` when the requested condition must not change later. A framework version conflict requires an explicit choice to align, continue with a warning when usable, or stop unchanged. Stop on other bootstrap failures.

## 2. Shape the brief and record decisions

Keep `brief.md` change-scoped. Record goal, scope, observable requirements, Done When outcomes, open questions, and a concise activity history.

Under `Active decisions`, record only product or process choices later work must know. Harness and provider configuration is execution metadata, not an active decision.

- explicit deviations from a skill default;
- consequential assumptions;
- skipped or simulated independence;
- intentionally broad access;
- changed interaction or validation expectations.

Use plain language. No waiver IDs or ceremony are required. When a decision changes, preserve the old entry and mark the new one active. Include relevant active decisions in later prompts.

Ask concise questions only for material choices. When the harness lets the coordinator ask the user, ask before implementation. Otherwise proceed on conservative assumptions and record them under `Active decisions`. Always stop for unsafe ambiguity or a blocker.

## 3. Select the shortest sufficient path

Use roles only when they serve the brief:

| Role                  | Typical use                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| Designer              | Changed product decomposition or authored contracts                       |
| Critic                | Independent semantic design review or supplied-finding verification       |
| Implementation critic | Optional implemented-behavior and test review                             |
| Concept worker        | Assigned concept implementation and tests                                 |
| Application worker    | Registration, composition, assembly, configuration, host, and integration |
| Frontend worker       | Requested client surface                                                  |
| Evidence worker       | Independent outcome-to-scenario evidence                                  |

Existing accepted design may proceed directly to implementation. New behavior normally receives design and independent criticism. The user may skip, combine, replace, or simulate roles. Record a material loss such as omitted independent review, but do not block the requested path.

## 4. Select context and access

Write a short task with objective, acceptance criteria, owned outcome, diagnostics, and checks. Do not repeat supplied context.

Inline the brief and authoritative contracts. The prompt builder already includes the normal role kit:

- decomposition rubric and catalog for decomposition design and criticism;
- contract rubric, authored format, SSF, and boundary syntax for contract design;
- contract rubric, SSF-reading rules, and boundary semantics for contract criticism;
- concept implementation conventions for concept work; and
- registration, assembly, and composition API syntax for application work.

Do not add those files again; byte-identical additions are rejected. Add only relevant conditional material:

- worked composition patterns: `guidance/api/application-example.md`;
- HTTP host or client: the corresponding `guidance/api/http-*.md` file;
- read construction, persistence/recovery, or another exact installed public reference; and
- an application-specific example when it demonstrates the required construction.

Use the generic repeatable `context` input for a special request that does not fit a named slot. Prefer exact excerpts and public declarations over whole manuals. Obtain catalog contracts with `bunx --no-install sync-engine-catalog list` and `bunx --no-install sync-engine-catalog show concept/<name>`, then supply the output inline; never read package trees.

Create grants with `sync-engine-skill grant init --role <role> --phase <phase>` and its repeatable `--read <area>:<path>` and `--write <area>:<path>` options. Paths are relative to their semantic area: `assigned-design:concepts/Tasking.md` means `design/concepts/Tasking.md`, while `current-decomposition:decomposition.md` means the work-unit file. The CLI supplies role defaults and rejects design ownership in the wrong phase.

Grant explicit files or bounded directories. For implementation review or verification, grant read access to changed source and test paths, or supply a diff; do not inline whole files.

- designers and design critics: affected design plus directly relevant shared contracts;
- implementation critics: relevant changed source and test paths;
- concept workers: assigned concept/test directories and necessary project configuration;
- application workers: assigned integration areas and read-only concept public surfaces;
- frontend/evidence workers: assigned source/test areas and the public interface.

Do not grant framework internals, package `dist`, skills, harness configuration, traces, sibling workspaces, caches, or unrelated work artifacts. The coordinator supplies exact public package material inline or names one package-owned public guide/example for the task; do not browse package trees. Never inspect internal declarations, runtime exports, or another application's source. The pinned setup excludes the HTTP package; when the brief requires an HTTP boundary, the coordinator adds `@mit-sdg/sync-engine-http` at the exact pinned framework version before implementation and records it under `Active decisions`. Roles never install dependencies, and no other dependency changes happen unless the user explicitly changes setup. If a role needs another file, add it in a new prompt. Project checks may transitively read the wider project.

Role capability recommendations are starting points, not gates. The CLI warns when a grant exceeds the role recommendation or a same-phase continuation expands prior access. Inspect the warning and record only consequential choices under `Active decisions`; the grant artifact already preserves the exact access.

## 5. Build and execute the prompt

Before delegation, run `sync-engine-skill harness recommend`. Use a detected supervising harness for role creation rather than its embedded provider adapter. Follow the [harness reference](harnesses.md) for provider, model, launch, wait, and completion behavior.

For delegation:

```text
sync-engine-skill prompt build --work <slug> --role <role> --phase <phase>
  --task <path> --grant <path> --harness <harness>
  --input <slot>=<path> ...
```

For coordinator simulation:

```text
sync-engine-skill prompt build --work <slug> --role <role> --phase <phase>
  --task <path> --grant <path> --simulate <reason>
  --input <slot>=<path> ...
```

Simulate when the user requests it or delegation is unavailable. Simulation means doing the compiled assignment directly. Do not announce sending, invoking, or waiting for a role agent. From prompt preparation through completion, use only its supplied context and access grant; if more context is needed, finalize or abandon the attempt and prepare a new prompt rather than inspecting it as coordinator.

Permanent design is bound automatically when a prompt reads or writes it. Contract design may change only granted canonical design files; design is immutable for every other bound role. Completion also compares all project changes with the write grant. Contract-critic preparation requires an application contract under `design/compositions/` in supplied or existing design; use `--concepts-only <reason>` only when the review intentionally covers concepts alone. Prompt preparation reports bytes by source slot, warns when `decomposition.md` exceeds 8,000 bytes, and rejects duplicate content; remove irrelevant context when one slot dominates. A supplied real harness context limit may still reject an oversized prompt.

A simulated result records no agent identity and is not independent. Copy its result verbatim to the response path and run the printed completion command without idling or returning while the record is prepared. Continue a finalized simulated record for a compact same-role repair; the coordinator still executes it directly. If independent review was explicitly required, ask before substituting simulation. A later delegated review replaces or supplements a simulation; it does not continue one.

## 6. Design and review only when needed

Create only the work-unit `decomposition.md` when product boundaries, need placement, or cross-owner obligations change; never copy decomposition into permanent design. Continue its finalized designer record into contracts with `sync-engine-skill continue <record> --phase contracts ...`. A fresh designer requires an intentional replacement. A distinct critic performs one full design review. `critic/verification` verifies only supplied finding or routed-blocker IDs after repair; it never discovers new findings. Give its prompt every guidance file used for the original review through repeated `--input review-guidance=<path>` options. Skill-root guidance paths are accepted inputs, and the prompt retains these files for a continued critic.

After implementation, optionally run `critic/implementation` to review implemented behavior and tests against approved contracts and obligations. Treat its findings as implementation defects or routed design blockers, not as design approval.

Do not require concept-by-concept review loops. Repeat full design review only when a repair changes boundaries or materially expands affected interactions.

Validate authored design with the application command before returning contract design:

```sh
bunx --no-install sync-engine check-design <files...>
```

Contract design runs this syntax check only; source-agreement, generation, and full application checks belong after implementation exists. Return syntax diagnostics to the designer. Under the default `required` review policy, an approving critic record is bound to the exact candidate digest. Decomposition must be current before contracts, and design must be current before first implementation. During implementation, required review binds only the final design digest before handback. Batch repairs and verify them once unless a worker is blocked on the design. Critic preparation during implementation prints this final-digest rule. Workers report design gaps instead of editing design unless the user's explicit assignment changes that ownership.

## 7. Route blockers by authority

- **Implementation:** documented code can change without changing approved behavior; return it to the responsible worker.
- **Context:** supplied material does not determine the API; add exact context.
- **Design:** every documented realization changes visible behavior, ownership, ordering, failure semantics, or a selected declaration; revise and review design.
- **Environment:** checks cannot run outside the role's assignment; resolve or report it.

A child that reports it was interrupted, restarted, or cut off before finishing has an environment blocker, not a design blocker. Continue the same agent with the same assignment before doing anything else.

Batch all currently visible blockers for one authority into one repair. After a worker or critic returns, do not run another full contract review for a repair; continue the retained critic to verify the specific finding IDs. When the same authority returns the same blocker category twice, do not continue it again without new context or changed authority; replace it when continuity is optional or hand back blocked. Do not turn missing public context into framework probing.

## 8. Validate and hand back

Choose checks from the brief, changed areas, design, and repository instructions. Optionally complete implementation review before final validation. Confirm relevant design syntax, generation, types, tests, host/frontend behavior, scenarios, and Done When evidence. Route defects to the responsible role and rerun only affected checks. When execution budget is low, hand back before starting optional evidence.

Completion requires a parsable `Status` line from a designer or worker, or `Verdict` line from a critic. Its first result word must be `Complete` or `Blocked`, or `Approve`, `Revise`, or `Blocked`, respectively; parsing is case-insensitive, strips Markdown emphasis, and accepts the result inline with the heading. Finalize a result beginning with `Blocked` using `--status blocked`; completion rejects a contradictory `completed` status. Run:

```sh
sync-engine-skill work show <slug>
sync-engine-skill work finish <slug>
```

`work finish` prints the last critic verdict and refuses handback when it is `Revise` or `Blocked`; override only with `--accept critic-verdict=<reason>`. It also flags source imports from `node_modules/` or `dist/` paths, and any source file that references `req.url` or `request.url`, routes by `pathname`, or calls `Bun.serve(` without referencing `@mit-sdg/sync-engine-http`; override only with `--accept internal-imports=<reason>` or `--accept parallel-router=<reason>`. Override reasons are recorded in `.sync-engine/work/<slug>/handback.json` and shown by `work show`. Handback must reproduce unresolved findings verbatim from the last critic record. `work finish` also blocks while any run is still prepared or required review does not approve the final design digest. Update the activity section with validation and status. Hand back the goal, changed areas, delegated and simulated roles, identities where present, independent-review limitations, checks, unresolved findings, assumptions, and omitted evidence. Stop after the requested outcome and relevant checks pass.
