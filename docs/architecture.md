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
| Boundary  | `src/engine/boundary/`  | Assembly, invocation, routing, clients, transport binding, endpoint protocol, and wire derivation    |
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
  -> firing evaluates and dispatches consequences
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

`src/engine/reactions/runtime/log-store.ts` owns the append-driven folded
occurrence index through the internal `MemoryStore`. Each engine constructs its
own index and defaults to `"keepAll"`; ordinary assembly supplies its default
`{ window: 100 }` policy explicitly. A window is enforced automatically after a
flow settles. `MemoryStore.append(...)` validates the entry, calls an optional
application-owned `LogSink` synchronously, and folds only when the sink returns
`undefined`. Before the call, `snapshotValue(...)` copies arrays, plain records,
and `Date` values. Invocation identities become frozen name-bearing
representatives, and the structural arrays and records are frozen. Opaque leaves
retain their runtime identity and are not recursively frozen. Any other sink
return value or a throw prevents the fold.
`ActionConcept` in `src/engine/reactions/runtime/actions.ts` is the small adapter
that appends log entries and retains unredacted values only while their causal
flow is active.

`Reacting` remains the internal host facade, but it owns no reaction catalog.
`reaction-catalog.ts` exclusively owns executable reactions, trigger indexes,
exported lowered/unlowered definitions, and base registration names. One
`ConceptInstrumentation` owns one explicit `InstrumentationState` containing
proxy identities, raw-concept links, weak concept references, and query caches;
`instrumenting.ts` operates on that persistent state rather than rebuilding it
for each operation. Its `QueryCacheMode` selects memoized wrappers by default or
uncached wrappers for `"none"`.

The interpreter stages likewise have explicit boundaries:

| Owner            | Responsibility                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `TriggerMatcher` | Match the landed record or join records within its flow, including channel exclusions and consumption guards. |
| `FiringPipeline` | Run trigger and where stages, form consequence inputs, ask actions, match outputs, and record stage failures. |
| `FiringBook`     | Own in-flight consumption counts and transfer successful marks to durable firing records.                     |
| `ActionConcept`  | Redact and append action, fault, integrity, and interpreter-failure evidence to the engine-owned index.       |
| `LogSink`        | Receive each validated, redacted append before the fold and return `undefined` synchronously.                 |

## Reaction implementation map

The reaction concern has three capability areas:

| Area      | Main files                                                                                                                                                            | Responsibility                                                                                                                                       |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authoring | `src/engine/reactions/authoring/refs.ts`, `words.ts`, `nodes.ts`, `partitions.ts`, `channels.ts`                                                                      | Build vocabulary references, triggers, branches, and consequences as declarations without executing actions.                                         |
| Concepts  | `src/engine/reactions/concepts/concept-spec.ts`, `concept-metadata.ts`, `outcomes.ts`, `refuse.ts`, `introspect.ts`                                                   | Describe and inspect concept contracts, metadata, outcomes, and refusals independently of the interpreter.                                           |
| Runtime   | `src/engine/reactions/runtime/reacting.ts`, `reaction-catalog.ts`, `instrumenting.ts`, `matching.ts`, `firing-pipeline.ts`, `firing.ts`, `actions.ts`, `log-store.ts` | Register executable reactions, instrument instances, match landed occurrences, run firing pipelines, record failures, and retain the occurrence log. |

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

| Area                  | Main files                                                                                    | Responsibility                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Vocabulary refs       | `src/engine/reactions/authoring/refs.ts`                                                      | Name concept actions and queries before an assembly has instances.                                                    |
| Reaction construction | `src/engine/reactions/authoring/words.ts`, `nodes.ts`, `partitions.ts`                        | Build Fluent declarations without executing actions.                                                                  |
| Read construction     | `src/engine/reads/lines.ts`, `where-ops.ts`, `views.ts`, `former-*.ts`                        | Describe query, view, condition, and former reads.                                                                    |
| Registration          | `src/engine/reads/definition-registry.ts`, `src/engine/reactions/runtime/reaction-catalog.ts` | Register definitions and executable reactions atomically by base reaction behind stable facades.                      |
| Resolution            | `src/engine/reads/authored-reference-resolution.ts`, `imported-ir-binding.ts`                 | Resolve authored vocabulary references and bind portable IR names to installed definitions.                           |
| Validation            | `src/engine/reads/view-former-validation.ts`                                                  | Validate view and former bindings, schedules, promises, dependencies, markers, and opaque values.                     |
| Lowering              | `src/engine/reads/reaction-lowering.ts`                                                       | Turn supported declaration paths into portable `ReactionIR`; retain known dependencies when a whole path stays local. |
| Portability analysis  | `src/engine/reads/local-behavior.ts`                                                          | Walk local and opaque occurrences once so ordinary assembly can reject executable-only definitions.                   |
| Runtime               | `src/engine/reactions/runtime/matching.ts`, `firing-pipeline.ts`, `firing.ts`                 | Match one landed occurrence, evaluate reads, invoke consequences, and record firing provenance.                       |

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

`Registry` in `src/engine/reads/definition-registry.ts` owns the concept,
computation, view, and former maps and the cached read environment.
`AuthoredReferenceResolver` resolves a fresh authored declaration,
`ViewFormerValidator` owns validation memoization, and `ImportedIrBinder`
constructs live definitions from portable IR. Each collaborator receives the
lookups or validation operations it consumes rather than the complete registry.

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

`src/engine/utils/memoize.ts` owns query-cache key generation and
rejected-promise eviction. Instrumentation creates those wrappers and decides
when each concept instance's query caches are invalidated.

## Assembly and boundary

The boundary concern separates transport-neutral contracts from the adapters
and composition that use them:

| Area       | Main files                                                                                                                                  | Responsibility                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Protocol   | `src/engine/boundary/protocol/types.ts`, `endpoints.ts`, `admit.ts`, `envelope.ts`, `validation.ts`, `route-path.ts`, `gateway-registry.ts` | Define endpoint inputs, application-facing route facts, admission, result envelopes, validation, canonical paths, and gateway identity without choosing a transport or host. |
| Invocation | `src/engine/boundary/invocation/invoke.ts`, `funnel.ts`, `lifecycle.ts`                                                                     | Correlate one request with one response, apply timeout and abort settlement, limits, and drain, and turn reaction refusals into boundary replies.                            |
| Assembly   | `src/engine/boundary/assembly/concept-set.ts`, `assemble.ts`, `locality-validation.ts`, `assembly-facade.ts`, `assembly-registry.ts`        | Turn portable composition into one engine, reject executable-only definitions, then expose the invoker and forms.                                                            |
| Client     | `src/engine/boundary/client/client.ts`, `local-client.ts`                                                                                   | Build typed calls, carry per-call control and correlation, validate complete responses when configured, and adapt to a local invoker.                                        |
| Gateway    | `src/engine/boundary/gateway/gateway.ts`, `transport-binding.ts`                                                                            | Decorate an invoker and expose a verified narrow capability for external server adapters.                                                                                    |
| Wire       | `src/engine/boundary/wire/wire-contracts.ts`, `wire-inference.ts`, `wire-provenance.ts`, `wire-renderer.ts`, `wire-types.ts`                | Derive and render transport-safe contracts from endpoint IR and value provenance.                                                                                            |

Dependency edges point inward toward `protocol/`: invocation, wire, and client
adapters consume its transport-neutral shapes. `assembly/` composes protocol,
invocation, wire, reaction, and read capabilities. `gateway/` exposes the
verified server-adapter seam; lower layers do not depend on adapters.

`src/engine/boundary/assembly/concept-set.ts` turns plain concept registrations
into a vocabulary, default implementations, floor-specific implementation
factories, complete implementation maps, and refusal metadata. A host-created
`ConceptFloor` descriptor separately groups one such map with resources and a
`close()` operation. `src/engine/boundary/assembly/assemble.ts` creates one engine,
its internal occurrence index, and an optional independent audit sink;
instruments its selected instances; collects tagged composition exports; and
returns the application-facing invoker/form interface. It also selects query
memoization, installs privileged raw-fault reporting, and makes ordinary
instrumentation reject undeclared advanced refusal codes. Plain concept actions
may be synchronous, but the assembled `concepts` surface types every action as
a `Promise`: recording and reaction processing occur before a caller receives
its settlement.

`src/engine/boundary/invocation/invoke.ts` and
`src/engine/boundary/gateway/gateway.ts` route, serialize, or end waiting for a
request, but they do not inspect concept state. Invocation applies the
endpoint's input, successful-output, and domain-error validators. Validator
throws pass to the assembly's raw-fault reporter while caller-visible failures
stay classified. `transport-binding.ts` snapshots only the facts an external
server adapter needs.

## Hosting and generated artifacts

`src/engine/hosting/file-store.ts` provides `FileLogSink`, a Node-specific
append-only JSONL audit destination. It does not own the engine's occurrence
index, load an existing file, replay entries, or expose a close operation.

`src/engine/tooling/inspection.ts` projects one assembly into app IR, concept
inventories, input contracts, retained occurrence summaries, and diagnostic
read-back. `manifest.ts` emits manifest V3 and its digest. `artifact-plan.ts` is
the single specification and wire renderer. `generated-artifacts.ts` resolves a
project descriptor, gives its ordered projections immutable logical facts, and
checks or writes the two pinned files only after the complete plan succeeds.

The installed executable under `src/command/` is an adapter over those
capabilities. `check.ts` parses supported TypeScript method signatures;
`artifacts.ts` imports an application descriptor; `scaffold.ts` renders the
project template. Command code may import engine concerns through `@engine`,
but engine concerns do not import the command.

## Public package boundary

Each supported core subpath has one export-only file under `src/<subpath>/index.ts`.
The workspace catalog also describes independently packed companion packages
under `packages/`; each has its own export-only entrypoints, declaration
snapshot, tarball checks, and exact peer rules. The public API test checks exact
symbol identity, nested constants, unsupported historical names, and
package-path reachability. The packed-consumer fixture separately checks the
emitted type graph.

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
