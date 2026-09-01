# Coordinate an application change

Use this procedure for one bounded sync-engine application work item. Defaults are recommendations; explicit user direction wins unless safety or repository instructions conflict.

## 1. Start or resume the work item

Read application instructions and inspect `.sync-engine/work/`. Resume the matching slug when clear; otherwise choose a short kebab-case slug.

Run from the application root:

```sh
sync-engine-skill work start <slug>
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

The command does not replace an existing manifest. It installs and verifies the pinned sync-engine setup and creates `brief.md`. A framework version conflict requires an explicit choice to align, continue with a warning when usable, or stop unchanged. Stop on other bootstrap failures.

## 2. Shape the brief and record decisions

Keep `brief.md` change-scoped. Record goal, scope, observable requirements, Done When outcomes, open questions, and a concise activity history.

Under `Active decisions`, record only choices later work must know:

- explicit deviations from a skill default;
- consequential assumptions;
- skipped or simulated independence;
- intentionally broad access;
- changed interaction or validation expectations.

Use plain language. No waiver IDs or ceremony are required. When a decision changes, preserve the old entry and mark the new one active. Include relevant active decisions in later prompts.

Ask concise questions only for material choices. Active mode asks before implementation; auto mode proceeds on conservative assumptions. Every mode stops for unsafe ambiguity or a blocker.

## 3. Select the shortest sufficient path

Use roles only when they serve the brief:

| Role               | Typical use                                                               |
| ------------------ | ------------------------------------------------------------------------- |
| Designer           | Changed product decomposition or authored contracts                       |
| Critic             | Independent semantic review or narrow repair verification                 |
| Concept worker     | Assigned concept implementation and tests                                 |
| Application worker | Registration, composition, assembly, configuration, host, and integration |
| Frontend worker    | Requested client surface                                                  |
| Evidence worker    | Independent outcome-to-scenario evidence                                  |

Existing accepted design may proceed directly to implementation. New behavior normally receives design and independent criticism. The user may skip, combine, replace, or simulate roles. Record a material loss such as omitted independent review, but do not block the requested path.

## 4. Select context and access

Write a short task with objective, acceptance criteria, owned outcome, diagnostics, and checks. Do not repeat supplied context.

Inline the brief and authoritative contracts. The prompt builder already includes the normal role kit:

- decomposition rubric and catalog for decomposition design and criticism;
- contract rubric, authored format, SSF, and boundary syntax for contract design;
- contract rubric, SSF-reading rules, and boundary semantics for contract criticism;
- concept implementation conventions for concept work; and
- registration, assembly, and composition API syntax for application work.

Do not add those files again. Add only relevant conditional material:

- worked composition patterns: `guidance/api/application-example.md`;
- HTTP host or client: the corresponding `guidance/api/http-*.md` file;
- read construction, persistence/recovery, or another exact installed public reference; and
- an application-specific example when it demonstrates the required construction.

Use the generic repeatable `context` input for a special request that does not fit a named slot. Prefer exact excerpts and public declarations over whole manuals.

Create grants with `sync-engine-skill grant init --role <role> --phase <phase>` and its repeatable `--read <area>:<path>` and `--write <area>:<path>` options. Paths are relative to their semantic area: `assigned-design:concepts/Tasking.md` means `design/concepts/Tasking.md`, while `current-decomposition:decomposition.md` means the work-unit file. The CLI supplies role defaults and rejects design ownership in the wrong phase.

Grant explicit files or bounded directories:

- designers and critics: affected design plus directly relevant shared contracts;
- concept workers: assigned concept/test directories and necessary project configuration;
- application workers: assigned integration areas and read-only concept public surfaces;
- frontend/evidence workers: assigned source/test areas and the public interface.

Do not grant `node_modules`, framework internals, skills, harness configuration, traces, or unrelated work artifacts. The coordinator supplies exact public package material inline. If a role needs another file, add it in a new prompt. Project checks may transitively read the wider project.

Role capability recommendations are starting points, not gates. The CLI warns when a grant exceeds the role recommendation or a same-phase continuation expands prior access. Inspect the warning and record only consequential choices under `Active decisions`; the grant artifact already preserves the exact access.

## 5. Build and execute the prompt

Before delegation, run `sync-engine-skill harness recommend`. Use a detected supervising harness for role creation rather than its embedded provider adapter. Preserve the coordinator's provider, model, and reasoning through the adapter when supported.

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

Permanent design is bound automatically when a prompt reads or writes it. Contract design may change only granted canonical design files; design is immutable for every other bound role. `--design-root design` remains available to introduce the same binding explicitly. Prompt size is reported; remove irrelevant context when it is excessive. A supplied real harness context limit may still reject an oversized prompt.

Delegation sends only the printed short instruction to read the prompt file. Keep the launch in the foreground when the adapter supports it, copy its returned result verbatim to the response path, and complete the record before yielding. Simulation uses that same prompt as the coordinator's complete role assignment; never idle or return while its record is prepared. Copy the result verbatim to the response path and run the printed completion command.

A simulated result records no agent identity and is not independent. If independent review was explicitly required, ask before substituting simulation.

## 6. Design and review only when needed

Create only the work-unit `decomposition.md` when product boundaries, need placement, or cross-owner obligations change; never copy decomposition into permanent design. Continue its finalized designer record into contracts with `sync-engine-skill continue <record> --phase contracts ...`. A fresh designer requires an intentional replacement. A distinct critic performs one full review, then narrowly verifies stable findings after repair.

Do not require concept-by-concept review loops. Repeat full review only when a repair changes boundaries or materially expands affected interactions.

Validate authored design with the application command before returning contract design:

```sh
bunx --no-install sync-engine check-design <files...>
```

Return syntax diagnostics to the designer. Workers report design gaps instead of editing design unless the user's explicit assignment changes that ownership.

## 7. Route blockers by authority

- **Implementation:** documented code can change without changing approved behavior; return it to the responsible worker.
- **Context:** supplied material does not determine the API; add exact context.
- **Design:** every documented realization changes visible behavior, ownership, ordering, failure semantics, or a selected declaration; revise and review design.
- **Environment:** checks cannot run outside the role's assignment; resolve or report it.

Do not turn missing public context into framework probing.

## 8. Validate and hand back

Choose checks from the brief, changed areas, design, and repository instructions. Confirm relevant design syntax, generation, types, tests, host/frontend behavior, scenarios, and Done When evidence. Route defects to the responsible role and rerun only affected checks.

Run:

```sh
sync-engine-skill work show <slug>
sync-engine-skill work finish <slug>
```

`work finish` blocks handback while any run is still prepared. Update the activity section with validation and status. Hand back the goal, changed areas, delegated and simulated roles, identities where present, independent-review limitations, checks, unresolved findings, assumptions, and omitted evidence. Stop after the requested outcome and relevant checks pass.
