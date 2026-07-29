# Engine architecture

This explanation maps the implementation for contributors. It describes the
current source tree, not a stable public module contract. Use the [documentation
index](./index.md), [Execution semantics](./semantics.md), and [Public
API](./public-surface.md) for supported behavior.

## Concern map

Engine dependencies point from hosting and adapters toward transport-neutral
contracts and from runtime execution toward authoring definitions. Public
entrypoints export selected capabilities but are never imported by engine code.

```text
public barrels and command
          |
          v
boundary / tooling / hosting
          |
          v
   reactions <-> reads
          |
          v
         utils
```

The bidirectional conceptual connection between reactions and reads is split by
module-level dependency rules: reaction contracts are shared at the concern
root, read authoring builds declarations, and runtime reaction modules evaluate
registered read operations. `bun run check` enforces the actual import graph.

| Concern   | Directory               | Responsibility                                                                                       |
| --------- | ----------------------- | ---------------------------------------------------------------------------------------------------- |
| Reactions | `src/engine/reactions/` | Concept references, reaction declarations, instrumentation, matching, firing, and occurrence storage |
| Reads     | `src/engine/reads/`     | Query contracts, views, formers, scheduling, evaluation, IR, and rendering                           |
| Boundary  | `src/engine/boundary/`  | Assembly, invocation, routing, clients, HTTP, endpoint protocol, and wire derivation                 |
| Hosting   | `src/engine/hosting/`   | File-backed occurrence auditing                                                                      |
| Tooling   | `src/engine/tooling/`   | Assembly inspection and pinned generated artifacts                                                   |
| Utilities | `src/engine/utils/`     | Runtime helpers, case conversion, logging, redaction, and framework-code definitions                 |

## One occurrence through the engine

```text
plain concept action
  -> instrumentation records the ask
  -> the catalog selects eligible reactions
  -> trigger matching joins occurrences within one flow
  -> read evaluation produces bindings
  -> firing dispatches consequence pipelines
  -> action outcome or fault is recorded
  -> later reaction stages observe that occurrence
```

`src/engine/reactions/runtime/instrumenting.ts` is the sole interception boundary
for an ordinary concept instance. It selects and memoizes action or query
wrappers, invalidates standing query caches, records invocation/outcome/fault
entries, and asks the reaction runtime to process each occurrence. It delegates
action-body reservation and execution to `action-scheduler.ts`, whose isolated
per-concept state machine preserves arrival order, releases same-flow reentrant
work, and removes the final serial line after settlement.

`src/engine/reactions/runtime/log-store.ts` owns the append-only folded
occurrence indexes. `ActionConcept` in
`src/engine/reactions/runtime/actions.ts` is the small adapter that appends log
entries and retains unredacted values only while their causal flow is active.

`Reacting` remains the internal host facade, but it owns no reaction catalog.
`reaction-catalog.ts` exclusively owns executable reactions, trigger indexes,
exported lowered/unlowered definitions, and base registration names. One
`ConceptInstrumentation` owns one explicit `InstrumentationState` containing
proxy identities, raw-concept links, weak concept references, and query caches;
`instrumenting.ts` operates on that persistent state rather than rebuilding it
for each operation.

The interpreter stages likewise have explicit boundaries:

| Owner                 | Responsibility                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `TriggerMatcher`      | Match the landed record or join records within its flow, including channel exclusions and consumption guards. |
| `FiringPipeline`      | Run trigger and where stages, preserve causal provenance, enforce row limits, and dispatch matched frames.    |
| `ConsequencePipeline` | Form consequence inputs, evaluate formers, ask actions, match outputs, transform results, and record firings. |
| `InterpreterFailures` | Append sanitized interpreter failures with their exact stage and consequence provenance.                      |
| `FiringBook`          | Own in-flight consumption counts and transfer successful marks to durable firing records.                     |

## Reaction implementation map

The reaction concern has three capability areas:

| Area      | Main files                                                                                                                                                                                                             | Responsibility                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring | `src/engine/reactions/authoring/refs.ts`, `words.ts`, `nodes.ts`, `partitions.ts`, `channels.ts`                                                                                                                       | Build vocabulary references, triggers, branches, and consequences as declarations without executing actions.                                               |
| Concepts  | `src/engine/reactions/concepts/concept-spec.ts`, `concept-metadata.ts`, `outcomes.ts`, `refuse.ts`, `introspect.ts`                                                                                                    | Describe and inspect concept contracts, metadata, outcomes, and refusals independently of the interpreter.                                                 |
| Runtime   | `src/engine/reactions/runtime/reacting.ts`, `reaction-catalog.ts`, `instrumenting.ts`, `trigger-matching.ts`, `firing-pipeline.ts`, `consequence-pipeline.ts`, `interpreter-failures.ts`, `actions.ts`, `log-store.ts` | Register executable reactions, instrument instances, match landed occurrences, fire consequence pipelines, record failures, and retain the occurrence log. |

Dependencies point toward definitions and away from execution. Both authoring
and concepts use the concern-wide contracts at the reaction root; authoring may
use concept descriptions, and runtime may use both authoring and concepts.
Concept and authoring modules do not depend on runtime modules.

The architecture checker encodes those permissions as a complete area matrix:
`authoring` may depend on `authoring`, `concepts`, and the reaction root;
`concepts` may depend on `concepts` and the root; and `runtime` may depend on all
three areas and the root. Root modules may depend on authoring and concepts;
`engine.ts` is the explicit root-to-runtime facade bridge.
Reads may consume reaction root, authoring, and concept modules, but not runtime
modules.

The files at `src/engine/reactions/` are intentionally shared or compositional,
not a fourth capability area. `types.ts` is the type vocabulary used by all
three areas and by reads, `context.ts` owns reserved interpreter bindings shared
by authored nodes and runtime instrumentation, and `resolving.ts` bridges named
references to an assembly for registration. Keeping these files at the root
avoids assigning common contracts to one subarea and creating a reverse
dependency from its peers. `engine.ts` is the direct-host facade.

## Authored design to executable reaction

```text
vocabulary refs and language words
  -> reaction declarations and branch partitions
  -> registration, validation, and binding analysis
  -> lowered ReactionIR where possible
  -> executable reactions indexed by trigger
```

The roles are deliberately separate even where the current implementation is
co-located:

| Area                  | Main files                                                                                                      | Responsibility                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vocabulary refs       | `src/engine/reactions/authoring/refs.ts`                                                                        | Name concept actions and queries before an assembly has instances.                                                    |
| Reaction construction | `src/engine/reactions/authoring/words.ts`, `nodes.ts`, `partitions.ts`                                          | Build Fluent declarations without executing actions.                                                                  |
| Read construction     | `src/engine/reads/lines.ts`, `where-ops.ts`, `views.ts`, `former-*.ts`                                          | Describe query, view, condition, and former reads.                                                                    |
| Registration          | `src/engine/reads/registering.ts`, `definition-registry.ts`, `src/engine/reactions/runtime/reaction-catalog.ts` | Register definitions and executable reactions atomically by base reaction behind stable facades.                      |
| Resolution            | `src/engine/reads/authored-reference-resolution.ts`, `imported-ir-binding.ts`                                   | Resolve authored vocabulary references and bind portable IR names to installed definitions.                           |
| Validation            | `src/engine/reads/view-former-validation.ts`                                                                    | Validate view and former bindings, schedules, promises, dependencies, markers, and opaque values.                     |
| Lowering              | `src/engine/reads/reaction-lowering.ts`                                                                         | Turn supported declaration paths into portable `ReactionIR`; retain known dependencies when a whole path stays local. |
| Portability analysis  | `src/engine/reads/local-behavior.ts`                                                                            | Walk local and opaque occurrences once so ordinary assembly can reject executable-only definitions.                   |
| Runtime               | `src/engine/reactions/runtime/trigger-matching.ts`, `firing-pipeline.ts`, `consequence-pipeline.ts`             | Match one landed occurrence, evaluate reads, invoke consequences, and record firing provenance.                       |

`ReactionIR` in `reads/ir.ts` is the serialized design form consumed by
inspection, read-back, wire generation, and imported-reaction registration.
The runtime can still execute explicitly local constructs such as closure-based
conditions outside the application boundary. Custom operations and `$is`
patterns remain in IR as opaque markers; whole unlowered reactions retain a
JSON-safe shell of known triggers, reads, consequences, and patterns. None of
those markers claims the local function or identity can be re-registered.

`src/engine/reactions/authoring/partitions.ts` validates sibling labels,
flattens authored branch trees, and forms the cross-product when later sibling
groups extend earlier paths. `lowerReaction` then gives variables stable names
and serializes each path's triggers, reads, and consequence asks.
`local-behavior.ts` is the dependency-neutral owner for custom,
identity-pattern, and unlowered occurrence discovery. Ordinary assembly rejects
every owner reported by that analysis, while manual advanced engines retain the
underlying executable constructs. See
[Sibling paths and endpoint settlement](./semantics.md#sibling-paths-and-endpoint-settlement)
for the resulting behavior.

`Registry` remains the stable read-definition facade. Its
`DefinitionRegistry` collaborator is the sole owner of the concept,
computation, view, and former maps and the cached read environment.
`AuthoredReferenceResolver` mutates only a fresh declaration,
`ViewFormerValidator` owns validation memoization, and `ImportedIrBinder`
constructs live definitions from portable IR. Each collaborator receives only
the name lookups or validation operations it consumes; none receives the
complete `Registry` facade.

## Reads and values

`reads/where-ops.ts` defines the authored query/view operations, while
`reads/where-evaluation.ts` evaluates them against `Frames`.
`reads/schedule.ts` determines an order from bindings for reactions and
formers. View registration currently validates that such an order exists but
stores the authored block; view evaluation therefore still follows authored
order. `reads/frames.ts`
extends and deduplicates bindings. `reads/value-equality.ts` is the one
structural equality rule shared by reads and action-pattern matching: arrays,
plain records, and dates compare by value; other objects compare by identity.

`src/engine/reactions/runtime/query-cache.ts` is intentionally independent of
instrumentation. It owns cache key generation and rejected-promise eviction.
Instrumentation only decides when every query cache is invalidated.

## Assembly and boundary

The boundary concern separates transport-neutral contracts from the adapters
and composition that use them:

| Area       | Main files                                                                                                                                               | Responsibility                                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol   | `src/engine/boundary/protocol/endpoints.ts`, `application-interface.ts`, `contract-shape.ts`, `admit.ts`, `envelope.ts`, `errors.ts`, `public-errors.ts` | Define endpoint inputs, application-facing route facts, admission, result envelopes, and public error categories without choosing a transport or engine host. |
| Invocation | `src/engine/boundary/invocation/invoke.ts`, `funnel.ts`                                                                                                  | Correlate one request with one response, apply cancellation and timeout behavior, and turn reaction refusals into boundary replies.                           |
| Assembly   | `src/engine/boundary/assembly/concept-set.ts`, `assemble.ts`, `locality-validation.ts`, `assembly-facade.ts`, `assembly-registry.ts`                     | Turn portable composition into one engine, reject executable-only definitions, then expose the invoker and forms.                                             |
| Client     | `src/engine/boundary/client/client.ts`, `local-client.ts`, `http-client.ts`                                                                              | Expose the typed client independently of a transport, then adapt it to a local invoker or HTTP.                                                               |
| Gateway    | `src/engine/boundary/gateway/gateway.ts`                                                                                                                 | Decorate an invoker with route admission, forwarding, limits, observation, and ordered drain.                                                                 |
| HTTP       | `src/engine/boundary/http/http.ts`, `http-profile.ts`, `http-floor.ts`                                                                                   | Adapt invocation to production HTTP, project registered public errors, and optionally bind cookie credentials.                                                |
| Wire       | `src/engine/boundary/wire/wire-contracts.ts`, `wire-inference.ts`, `wire-provenance.ts`, `wire-renderer.ts`, `wire-types.ts`                             | Derive and render transport-safe contracts from endpoint IR and value provenance.                                                                             |

Dependency edges point inward toward `protocol/`: invocation, wire, and client
adapters consume its transport-neutral shapes. `assembly/` composes protocol,
invocation, wire, reaction, and read capabilities. `gateway/` and `http/` are
outer adapters that consume those lower layers; lower layers do not depend on
gateway or HTTP. The standalone `src/engine/boundary/cli-app.ts` likewise adapts
protocol results and an invoker without inspecting concept state.

`src/engine/boundary/assembly/concept-set.ts` turns plain concept registrations
into a vocabulary, default implementations, floor-specific implementation
factories, complete implementation maps, and refusal metadata. A host-created
`ConceptFloor` descriptor separately groups one such map with resources and a
`close()` operation. `src/engine/boundary/assembly/assemble.ts` creates one engine,
instruments its selected instances, collects tagged composition exports, and
returns the application-facing invoker/form interface. Plain concept actions
may be synchronous, but the assembled `concepts` surface types every action as
a `Promise`: recording and reaction processing occur before a caller receives
its settlement.

`src/engine/boundary/invocation/invoke.ts`,
`src/engine/boundary/gateway/gateway.ts`,
`src/engine/boundary/http/http.ts`,
`src/engine/boundary/http/http-profile.ts`,
`src/engine/boundary/http/http-floor.ts`, and
`src/engine/boundary/cli-app.ts` route, serialize, or cancel a request, but they
do not inspect concept state.

## Hosting and generated artifacts

`src/engine/hosting/file-store.ts` provides `FileStore`. It composes a fresh
in-memory occurrence index with a Node-specific append-only JSONL audit sink. It
does not load an existing file or replay it.

`src/engine/tooling/inspection.ts` projects one assembly into app IR, concept
inventories, input contracts, retained occurrence summaries, and diagnostic
read-back. `manifest.ts` emits manifest V3 and its digest. `artifact-plan.ts` is
the single specification and wire renderer. `generated-artifacts.ts` resolves a
project descriptor, derives an optional production HTTP projection while the
assembly is available, delegates rendering to the planner, and checks or writes
the two pinned files only after the complete plan succeeds.

The installed executable under `src/command/` is an adapter over those
capabilities. `check.ts` parses supported TypeScript method signatures;
`artifacts.ts` imports an application descriptor; `scaffold.ts` renders the
project template. Command code may import engine concerns through `@engine`,
but engine concerns do not import the command.

## Public package boundary

Each supported subpath has one export-only file under `src/<subpath>/index.ts`.
`package.json` exposes exactly those six subpaths and no root barrel. The
public API test checks exact symbol identity, nested constants, unsupported
historical names, and package-path reachability. The declaration snapshot and
packed-consumer fixture separately check the emitted type graph.

## Dependency rules

Public subpaths under `src/` are export-only. Engine code lives under
`src/engine/` and imports engine modules, never public barrels. Use
`@engine/<concern>/<nested/path>` when crossing an engine concern or exporting
an engine module through a public subpath. Within one concern, use relative
imports with a `.ts` extension: `./module.ts` for a sibling or
`../area/module.ts` across nested capability directories. The build rewrites
`@engine` to relative package paths and rejects unresolved aliases before
packing.
`scripts/check-architecture.ts` enforces those spellings and dependency
directions, verifies each package export's source and emitted targets, rejects
engine barrels, checks generated-file provenance, and rejects
unreachable shipped source. It rejects every strongly connected component in
the engine's runtime import graph while ignoring type-only imports and exports.
Run `bun run check` after moving code; it remains the aggregate source of truth
for the repository's structural rules, specifications, formatting, lint, and
types.
