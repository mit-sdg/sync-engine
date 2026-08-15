# Isolated implementation roles

Implementation begins only after conversational approval of the current Markdown.
Every role is a native subagent using normal reasoning. The coordinator assigns exact,
non-overlapping mutation paths before starting a role and rejects any returned change
outside those paths.

## Concept worker batch

Start one worker per approved concept and run all independent concept workers
concurrently. Each worker receives only:

- that concept's approved specification;
- the relevant concept-authoring and public API excerpt from the installed core;
- at most one selected catalog or local implementation example;
- its exact `src/concepts/<name>/` directory and focused test paths; and
- the focused validation command it must run.

Implementation source from the catalog is disclosed only when that worker is
implementing or adapting the selected concept. Its exact context normally makes
analysis unnecessary: do not supply analysis output or permit
`sync-engine-analysis` unless its assigned source attribution is explicitly
incomplete or ambiguous. The worker may not inspect another concept, composition,
assembly, configuration, generated output, unrelated tests, or package-wide source. Its source directory and focused tests are its entire mutation
boundary. It returns changed paths, focused validation, and any contract blocker.

A worker may implement less than an example when the approved specification requires
less. It may not add example behavior absent from the approved design.

## Composition worker batch

After concept workers complete without contract blockers, start one worker for each
approved `design/compositions/<name>.md` and paired `src/compositions/<name>.ts`.
Run path-disjoint composition workers concurrently. Each receives only:

- its one approved composition document;
- approved `design/types.md`;
- only the concept specifications referenced by that document;
- the relevant composition public API and authoring excerpt;
- at most one local composition example;
- its exact source and focused test paths; and
- its focused validation command.

Before constructing each composition prompt, the coordinator may use bounded
`sync-engine-analysis search`, `describe`, and `sources` queries to select exact
referenced declarations and locations. Supply only those selected materials, not the
analysis transcript. The worker may read only those supplied materials and assigned
files. It may not edit concepts, another composition module, shared registration,
assembly, configuration, generated output, or approved Markdown. Exact reaction,
view, former, and computation identities must realize the adjacent links in the
supplied document.

## Integration worker

After both implementation batches, start one integration worker. No earlier worker
may opportunistically perform this role. Assign the shared concept set, registrations,
assembly, application configuration, composition aggregate, host wiring, and generated
artifact integration paths to this worker alone.

Use bounded `sync-engine-analysis search`, `describe`, `sources`, and `impact`
queries first to identify the exact declarations, shared relationships, and source
locations needed for integration. Supply the approved Markdown, the selected public
surfaces of completed worker outputs, the existing shared integration files, and the
exact generation/check commands. Do not supply analysis transcripts or unrelated
implementation internals. The integration worker may repair shared
wiring defects, but it must return a material concept or composition mismatch to the
coordinator instead of changing the design or a worker-owned contract.

Keep host entrypoints thin. Observable command, process, filesystem, clock, or network
behavior normally belongs in approved concepts and composition. An inert adapter may
remain direct when it introduces no application policy, lifecycle, or durable fact;
do not invent a concept solely to remove a harmless call from a host file.

## Evidence worker

Finally, start one evidence worker. Its mutation boundary contains only newly assigned
objective-driven scenario and test paths. Use bounded `sync-engine-analysis
diagnostics`, `sources`, and `impact` results to select the contracts, declarations,
and relationships relevant to the objective. Supply the objective, approved
Markdown, only that selected assembled public interface, and focused test commands;
do not supply a raw analysis dump.
It may add evidence for visible success, expected refusal, authorization, repetition,
lifecycle, integration, or host behavior required by the objective. It must not edit
production source, generated output, design files, or existing unrelated tests.

## Contract blockers

No worker may weaken, reinterpret, or silently edit approved Markdown. A mismatch is
material when honoring the design requires a new owner, action, refusal, lifecycle,
application policy, cross-concept failure rule, external type binding, or observable
behavior. Stop the build, return that issue to the design protocol, show the revised
Markdown to the user, and obtain renewed approval before resuming affected workers.
Routine type spelling, import wiring, and implementation defects that do not change
the contract remain implementation work.
