# Canonical coordinator workflow

This is the detailed procedure for coordinating one sync-engine application work unit.
Role objectives and return formats belong to the typed role specifications and prompt
guidance; harness-specific invocation belongs in [harnesses.md](harnesses.md). Run
`sync-engine-skill --help` for the exhaustive CLI contract.

## Prepare the application and work unit

1. Read the application repository's instructions and resolve the application root and
   loaded skill root once. Preserve unrelated work and follow the user's, repository's,
   and harness's Git safeguards.
2. Establish the interaction preference from the conversation. Active interaction is the
   default; less-interactive and auto modes are ordinary conversational choices, not CLI
   state.
3. Inspect `.sync-engine/work/`. Resume an unambiguous existing slug when appropriate;
   otherwise propose a short descriptive slug. Ask only if the intended work unit is
   ambiguous.

Keep one work unit sequential within an application workspace. For genuinely parallel
application changes, use separate worktrees under repository and harness safeguards
rather than coordinating concurrent writes across work units.

### Complete bootstrap before the brief

Before the first skill CLI invocation in an empty application directory, the coordinator
reads `<skill-root>/release.json` and writes `package.json` with exactly the initial fields
below:

```json
{
  "name": "<safe-package-name>",
  "private": true,
  "type": "module",
  "packageManager": "bun@<exact release.toolchain.bun>"
}
```

Choose a package-safe name and use the exact Bun release from the manifest. Do not ask the
user. This `package.json` is the only pre-Bun administrative scaffold. Do not create a
replacement manifest for an existing application or alter its unrelated manifest content.

Then start a new slug from the application root:

```sh
sync-engine-skill work start <slug>
```

`work start` re-reads the release manifest and lists the pinned framework, analysis,
catalog, and setup commands required by the existing scaffold. Review the application,
run those commands explicitly, and rerun `work start`; it then verifies the declared Bun,
Node, and TypeScript toolchain and executable targets and creates `brief.md`. When an
installed executable is invoked directly in an empty directory with no `package.json`, it
can still create the minimal manifest and complete the initial bootstrap automatically.

For an existing application, `work start` does not run package installation or a
project-local setup executable. When either is needed, it stops and prints the exact
commands. Review the application, run those commands explicitly, and rerun `work start`.
If the framework version conflicts with the pinned release, present three choices with a
recommendation: align to the pinned release, continue with a recorded warning, or stop
without changing the application. Continuing requires a usable installed core
executable; otherwise align or stop. Any other installation, executable, toolchain, or
setup failure stops the work unit. Do not try alternate package managers or versions.

If the command reports a framework conflict, present the choices above and rerun with the
selected value:

```sh
sync-engine-skill work start <slug> \
  --conflict <align-pinned-release|continue-with-warning|stop-unchanged>
```

`work start` never overwrites an existing work unit. To resume, use the existing slug
without running `work start` again. Every later operation names the slug or a record that
already identifies it.

## Shape a change-scoped brief

Edit `.sync-engine/work/<slug>/brief.md`. Keep it small enough to guide this change rather
than redescribing the application. Recommended sections are:

- Goal
- Scope
- Requirements
- Decisions and Assumptions
- Done When
- Open Questions

The headings and order are flexible. Use `User:` and `Assumption:` labels when they make
a consequential decision easier to audit; they need no identifiers or special syntax.
Whenever stored facts are in scope, record whether they survive process restart as
`User:` or `Assumption:`. This durability advice is not a schema gate. Record
consequential automatic assumptions and any review the user chooses to waive.

When an external transport is selected, consult its supplied public guide before fixing
interface details in the brief. Distinguish the executable endpoint pathname declared in
design from any transport-projected public route. Record methods, public paths, input and
output fields, credentials, and error envelope. If the user did not prescribe them, choose
a form the selected transport supports. If a user-prescribed interface cannot be represented, surface
that conflict instead of recording one interface and silently implementing another.

Ask one concise question at a time, or a small related set, with concrete options and a
recommendation. Ask while the brief is materially incomplete, when criticism exposes a
product choice, and once before implementation in active mode. Do not ask for choices
that can be resolved safely from the request and repository.

In less-interactive mode, consolidate questions and make conservative assumptions between
checkpoints. In auto mode, skip routine approval and continue on reasonable assumptions.
Every mode stops for unsafe ambiguity or a material blocker, and the user may change mode
at any time.

An unreadable, empty, or out-of-work-unit brief is an integrity error. Recommended
context is coordinator guidance, not a CLI warning. A designer may still report semantic
insufficiency as a question or blocker.

## Select phases and context

Choose phases from the bounded change, not from a fixed stage checklist. A change to
product boundaries or contracts normally needs design and criticism. Existing accepted
design can go directly to the relevant implementation roles. Frontend and evidence work
are selected only when they serve the brief.

For each selected phase:

1. Write a short task that states the objective, acceptance criteria, relevant
   diagnostics, owned outcomes, and expected checks. Do not restate supplied context or
   capability metadata; the generated prompt carries both. A task cannot authorize an
   alternate framework or transport path that conflicts with supplied public references,
   or request an endpoint without its exact approved reaction link and endpoint entry.
2. Select an effective capability grant within the role's typed maximum. The prompt
   builder validates the grant, and listed check commands are not a shell allowlist. For
   application work, enumerate exact integration files or dedicated directories; never
   grant a parent path that contains concept implementations or concept tests.
3. Supply the smallest sufficient set of the brief, affected design, additional public
   framework references, application paths, and examples. Built-in role guidance is
   already present: do not also pass those same files as `public-references`. Name useful
   starting paths, while allowing implementation and evidence workers targeted reads
   elsewhere in the application.
4. Select Paseo when its CLI and daemon are available, regardless of the coordinator's
   own harness. Its daemon-backed launches remain active across coordinator session or CLI
   restarts. Otherwise select another available supported harness. Build the prompt with
   every required role input:

   ```text
   sync-engine-skill prompt build --work <slug> --role <role> --phase <phase>
     --task <path> --grant <json-path> --harness <harness>
     --input <slot>=<path> [--input <slot>=<path>]... [--timeout <seconds>]
   ```

   Repeat `--input` once per file. Add `--design-root design` when the prompt must bind
   permanent design. `--timeout` is the coordinator's native-launch limit and defaults to
   1800 seconds; the prepared record stores it, while the skill CLI does not observe the
   harness. Use the prepared record and response path it creates. Prompt size stops the
   build only when a selected harness or model supplies a real `--context-limit` and the
   prompt exceeds it.

5. Launch through the selected harness as described in [harnesses.md](harnesses.md). The
   coordinator copies the native role output verbatim into the reserved response file as
   administrative capture, then runs `sync-engine-skill launch complete` to validate it
   and finalize the record.

The coordinator uses public framework documentation, examples, and catalog entries and
never reverse-engineers framework source or internals. Do not ask a role to inspect
framework source, source maps, runtime internals, or broad installed-package contents.
Give it public documentation and examples instead. If a role lacks required public API
context, provide that context through a continuation.

The compact catalog materially informs design. Give the decomposition designer and critic
the same complete compact catalog. Use the release-checked commands from the application
root:

```sh
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show <entry> --raw
```

Catalog entries are design alternatives, not mandatory names or contracts. Supply full
unchanged catalog contracts only where reuse actually requires them.

`sync-engine-analysis` is an optional coordinator aid, not a phase. Distill only relevant
conclusions into a task. Do not inject raw analysis output automatically, and do not let
an ambiguous analysis result prevent ordinary scoped investigation.

When selected work needs an HTTP host or client, the coordinator installs
`@mit-sdg/sync-engine-http` at the selected core framework's exact release before building
or launching role prompts. Delegated roles never install it. Then supply only the relevant
HTTP guidance as a `public-references` input:

- Host work:
  `--input public-references=<skill-root>/prompts/guidance/api/http-host.md`
- Client work:
  `--input public-references=<skill-root>/prompts/guidance/api/http-client.md`

Repeat `public-references` for other required public API context. These are additional
references and are optional when built-in guidance is sufficient. Do not repeat built-in
guidance or supply HTTP guidance to work that does not use its corresponding surface.

## Design and criticism

Authored Markdown under `design/**` is the application's design authority. The work-unit
brief scopes the change; `decomposition.md` maps the affected design before permanent
contracts are edited. Generated output, implementation, and coordinator notes do not
replace authored design.

### Adopt supplied or accepted authored design

When work starts from supplied or previously accepted authored design, preserve it as
authority and run authored-design syntax validation. Adoption alone does not require a
new decomposition, designer, critic, or earlier work-unit records.

A safe assumption may only interpret behavior already expressible within the authored
surface. It cannot add an owner, action, obligation, or other new behavior. A real design
gap requires bounded design revision and independent criticism.

If a real gap or syntax repair is found, continue the prior designer when one exists;
otherwise launch a fresh designer with the complete brief, authored design, diagnostic or
blocker, and affected context. After the designer produces the bounded revision, continue
the prior distinct critic when one exists; otherwise launch a distinct fresh critic to
review that revision and its effects. Continue the selected designer and critic identities
normally for later repair and verification. Record the choice and result in the brief and
handback.

### Decompose only design changes

Create `.sync-engine/work/<slug>/decomposition.md` only when the work introduces or
changes product design. It should place affected needs, identify new, changed,
reused-unchanged, and unaffected-context concepts, and name cross-concept obligations
with stable IDs. Reference existing approved contracts instead of redescribing the whole
application.

Continue one fresh designer agent through decomposition, contracts, and any repairs. Use
a separate fresh critic agent throughout design work:

1. The critic performs a full semantic review of the bounded decomposition.
2. Initial blocker and material findings receive stable IDs.
3. The same designer repairs the candidate through a continuation.
4. The same critic narrowly verifies each original finding as resolved, unresolved, or
   directly regressed. Verification does not restart a holistic review or introduce
   unrelated findings.

Use the compact canonical three-section layout. Exact table columns are advisory;
semantic completeness decides whether the decomposition is useful. The coordinator or
user decides whether an unresolved non-blocking concern is acceptable and records that
decision.

Revise the decomposition later only when concept boundaries, need placement, or
obligations change. A smaller contract correction updates only the affected permanent
design.

### Author and review contracts

Continue the original designer once with the accepted decomposition when one exists,
resolved findings, affected existing contracts, and relevant catalog contracts. In that
assignment, author the complete affected set of concept contracts, application types, and
composition needed to realize the bounded change. Do not default to separate concept-by-concept author/review
loops; they cost additional turns without preserving interactions for review. The
designer edits only the assigned permanent design paths. If no designer identity exists,
establish one with the complete-context fresh-designer flow above.

Before the initial `designer/contracts` prompt, pass `--design-root design` to
`sync-engine-skill prompt build`. Bind the canonical path even when `design/` is absent,
new, or empty: the prepared record captures the empty before digest, and
`sync-engine-skill launch complete` captures the after digest produced by contract
authoring. Do not launch initial contract design without this binding.

The designer runs the project-local authored-design check. The coordinator reruns it from
the application root before contract criticism and again before implementation when
needed:

```sh
bunx --no-install sync-engine check-design <authored-design-files...>
```

Return syntax diagnostics to the same designer through a continuation. When the syntax
diagnostic is the first need for design work, apply the fresh identity selection above.
Do not duplicate framework parser rules in coordinator logic.

The prior critic, or the distinct fresh critic selected above, then performs one full
review of the complete changed contract set against the brief, affected approved
contracts, the accepted decomposition when one exists, and affected interactions. Repairs return to the established designer as a bounded revision,
and the critic narrowly verifies the stable findings afterward. Do not repeat the full
review after a repair unless the repair changed boundaries or materially expanded the
affected interaction set.

The critic may read the work unit and all permanent design for context, but reports only
issues in the current work unit, changed contracts, and affected interactions. An
unrelated pre-existing issue is in scope only when it blocks the change or the change
materially worsens it. A user-requested fresh second-opinion critic supplies additional
bounded advice; it does not alter the first critic's finding lifecycle.

### Verify repairs with the original review guidance

`critic/verification` has no built-in review rubric. Continue the original critic with the
brief, stable findings or routed implementation blocker, revised candidate, and every
guidance file used for the original review. Pass guidance through the repeatable
`review-guidance` input.

For decomposition verification:

```text
sync-engine-skill continue <decomposition-critic-record> --phase verification
  --task <path> --grant <json-path>
  --input brief=.sync-engine/work/<slug>/brief.md
  --input original-findings=<path>
  --input revised-candidate=.sync-engine/work/<slug>/decomposition.md
  --input review-guidance=<skill-root>/prompts/guidance/design/decomposition.md
  --input review-guidance=<skill-root>/prompts/guidance/catalog.md
```

For contract verification:

```text
sync-engine-skill continue <contract-critic-record> --phase verification
  --task <path> --grant <json-path>
  --input brief=.sync-engine/work/<slug>/brief.md
  --input original-findings=<path>
  --input revised-candidate=<changed-contract-path>
  --input review-guidance=<skill-root>/prompts/guidance/design/contracts.md
  --input review-guidance=<skill-root>/prompts/guidance/design/ssf-reading.md
  --input review-guidance=<skill-root>/prompts/guidance/design/boundary.md
```

Repeat `revised-candidate` and `affected-design` inputs when the bounded revision needs
more files. An already design-bound critic continuation redigests its canonical design
automatically; do not pass `--design-root` again.

### Bind implementation to permanent design

Use the canonical `<application>/design/` directory for every permanent-design binding.
Pass `--design-root design` to `sync-engine-skill prompt build` for initial
design-dependent work, including the initial contract designer described above. The
prepared record fixes the canonical root and before digest. The completion command takes
no design option: it reads the recorded root, verifies non-writing roles against the before
digest, and records an after digest for `designer/contracts`.

A continuation whose prior record is already bound redigests that canonical root
automatically; passing `--design-root` again is invalid. Use `--design-root design` on
`continue` only to introduce a binding when the prior record has none. A permanent-design
change still makes any already prepared non-writing prompt stale, so rebuild affected
prompts after validation and applicable bounded criticism.

## Implement in bounded ownership areas

Select concept, application, frontend, and evidence workers according to the brief and
changed paths. Each selected implementation role starts fresh and does not inherit
another implementation role's conversation. Evidence work is fresh and independent from
the implementation it examines. Send repairs to the original role agent when available.

Use dedicated owned directories or exact path families, so a worker can create focused
helpers and tests without receiving a parent that also contains another owner's source.
Expanding write ownership requires a new explicit grant or another role. Implementation
and evidence workers may run
project-local inspection, focused checks, filters, and formatters within their
capabilities. A contract designer may run assigned design validation; a decomposition
designer has no shell, and a critic has neither writes nor shell. Designers and critics
read the current work unit and `design/**`, not application source.

Network access, generated output, and long-running processes require explicit grants.
Generated files may be produced by a granted project command but are never edited by
hand. Git mutation, dependency installation, workflow management, delegation,
framework-internal access, skill CLI invocation, and run-artifact edits are outside every
delegated role; dependency changes remain coordinator-owned.

Use diagnostics as repair evidence, not as permission to discover undocumented APIs.
Workers may read complete diagnostics and repair their assigned source. A worker reports
an unresolved issue as a design, context, or environment blocker.

### Route implementation feedback

Classify feedback by authority rather than by which command exposed it:

- **Implementation:** documented syntax, binding, staging, or branching can change while
  preserving approved behavior. Return it to the same implementation identity.
- **Context:** the supplied public references, examples, generated public contracts, or
  application context do not determine the required API. Add the missing public context;
  do not revise design.
- **Design:** every documented realization would change visible behavior, ownership,
  acknowledgement ordering, failure semantics, or a selected declaration. Route the
  behavioral decision through design revision and independent criticism.
- **Environment:** an assigned check cannot run for a reason outside the implementation.

A blocked implementation response must preserve the concrete diagnostic or failing
scenario, affected behavioral commitment, why ordinary documented realizations do not
satisfy it, the smallest decision or link revision needed, and unaffected commitments.
Do not translate a framework-syntax uncertainty into a design change.

For an implementation defect, prepare a same-agent continuation:

```text
sync-engine-skill continue <finalized-record> --phase <phase> --task <path>
  --grant <json-path> --input <slot>=<path> [--input <slot>=<path>]...
  [--timeout <seconds>]
```

Put the diagnostic, affected paths, and requested outcome in the task. Repeat `--input`
for the phase's required context. Within the same phase, reuse or narrow the capability grant; an explicit phase transition
uses a grant validated against the new phase maximum. A same-phase continuation is a
compact delta containing the current task, current grant, changed or unseen context, and a
return-heading reminder; its prior role and guidance remain authoritative. A phase
transition or replacement receives the full applicable role prompt. Unchanged retained
inputs already known by the agent are bound rather than expanded.

For a context blocker, add the missing public reference or application context in a
continuation. Do not direct the worker into framework internals.

For a design blocker:

1. Stop the affected implementation; the worker does not edit authored design.
2. Continue the prior designer with the categorized gap. If no prior designer exists,
   launch a fresh designer with the complete current brief, authored design, blocker, and
   affected context.
3. Revise the decomposition only if boundaries, placement, or obligations changed;
   otherwise revise the affected contracts.
4. Continue the prior critic with `critic/verification` to test the routed stable blocker
   against the bounded revision and its direct effects. Supply the original review guidance
   through `review-guidance`. Use another full contracts review only when the revision
   changes boundaries or materially expands the affected interaction set. If no prior
   critic exists, launch a distinct fresh critic after the candidate revision exists.
5. Validate the revised permanent design and continue the original worker. Its existing
   design binding redigests automatically. Only if the prior worker record was unbound,
   add `--design-root design` to introduce the canonical binding.

After fresh design identities are established, use normal same-agent continuations for
that bounded design lifecycle. An interpretation within the existing authored surface may
be recorded as a safe assumption; implementation of new behavior always follows the
design-revision path.

If an original agent becomes unavailable, add `--replace` to `continue`; the prompt
builder expands retained inputs in full for the fresh replacement. Only replacement mode
may also select `--harness <harness>`. A replacement critic verifies only the existing
finding IDs. In
active interaction, offer replacement, proceeding without that verification, or stopping.
Auto mode may choose a reasonable replacement. Never present a fresh agent as a
continuation.

The coordinator copies every native role response verbatim as administrative capture.
The skill CLI validates and finalizes that captured response and parses its requested
structure on a best-effort basis; it does not obtain native output itself. `completed`
requires nonempty UTF-8. `failed`, `cancelled`, and `timed-out` may finalize an empty
response. A malformed nonempty response warns but does not erase useful work or cause an
automatic rerun. After an agent, harness, or provider error, preserve any partial response
and terminal status, then choose whether to continue the same agent, run a fresh
replacement, or stop.

## Validate the delivered scope

Tasks identify focused checks for each role. After role work, the coordinator selects
final checks from the brief, changed areas, authored design, and repository instructions.
Full application validation is the default for full delivery; a bounded change needs only
the checks relevant to its effects. Do not substitute a universal command list for the
application's own check chain.

Confirm that:

- authored design syntax is valid when design is present or changed;
- generated artifacts were produced only by their owning commands and are current;
- focused type, unit, integration, host, frontend, and scenario checks relevant to the
  change pass;
- each applicable Done When outcome has objective evidence; and
- changed files remain within the selected ownership areas.

When validation finds an implementation defect, return the focused diagnostic to the
original worker, rerun the affected check, and rerun checks invalidated by the repair.
Do not repeat unaffected checks. A contract gap follows the design-feedback path above.

The validator stops on an uncertain bootstrap, an artifact escaping its application or
work unit, missing required prompt context, a capability grant above a role maximum, a
prompt changed after preparation, a stale design digest, continuation through another
agent or harness, or a harness that cannot provide the adapter contract.

Warnings call for coordinator judgment rather than automatic failure or mandatory cleanup.
They include malformed structured responses, prompt-guided capabilities, release mismatch,
and conservative project analysis. Investigate a warning when it indicates a plausible gap
in a required outcome; otherwise successful behavioral evidence may be sufficient. Carry
only material unresolved diagnostics to handback. The skill CLI validates artifact and
continuity integrity; the coordinator chooses phases, review acceptance, and repair.

## Hand back directly

Before handback, read role identities from the finalized work-unit records rather than
reconstructing them from memory or displayed titles. Handback is a coordinator response
based on those records, the other work-unit artifacts, and final validation. Report:

- the goal and completion status;
- changed areas;
- roles actually used, their record-derived identities, and unresolved findings;
- checks run and their pass or fail outcomes;
- material unresolved diagnostics;
- relevant checks omitted and why;
- blockers, material concerns, consequential assumptions, and waived review; and
- in an interactive mode, one choice to accept, revise, or request more evidence.

Omit routine transcripts, provider details, and model details. Once the selected delivery
checks pass, hand back without adding optional polish cycles.
