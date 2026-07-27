# Engine architecture

This note maps the implementation for contributors. It does not define public
authoring syntax; use the [root documentation map](../README.md#examples-and-documentation), [execution
semantics](./semantics.md), and [public API](./public-surface.md) for that.

## One occurrence through the engine

```text
plain concept action
  -> instrumentation records the ask
  -> matching selects registered reactions
  -> read evaluation produces bindings
  -> firing asks consequence actions
  -> action outcome or fault is recorded
  -> later reaction stages observe that occurrence
```

`src/engine/reactions/runtime/instrumenting.ts` is the sole interception boundary
for an ordinary concept instance. It wraps actions, invalidates standing query
caches, records invocation/outcome/fault entries, and asks the reaction runtime
to process each occurrence.

`src/engine/reactions/runtime/log-store.ts` owns the append-only folded
occurrence indexes. `ActionConcept` in
`src/engine/reactions/runtime/actions.ts` is the small adapter that appends log
entries and retains unredacted values only while their causal flow is active.

## Reaction implementation map

The reaction concern has three capability areas:

| Area      | Main files                                                                                                               | Responsibility                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Authoring | `src/engine/reactions/authoring/refs.ts`, `words.ts`, `nodes.ts`, `partitions.ts`, `channels.ts`                         | Build vocabulary references, triggers, branches, and consequences as declarations without executing actions.                       |
| Concepts  | `src/engine/reactions/concepts/concept-spec.ts`, `concept-metadata.ts`, `outcomes.ts`, `refuse.ts`, `introspect.ts`      | Describe and inspect concept contracts, metadata, outcomes, and refusals independently of the interpreter.                         |
| Runtime   | `src/engine/reactions/runtime/reacting.ts`, `instrumenting.ts`, `matching.ts`, `firing.ts`, `actions.ts`, `log-store.ts` | Instrument instances, register executable reactions, land and match occurrences, fire consequences, and retain the occurrence log. |

Dependencies point toward definitions and away from execution. Both authoring
and concepts use the concern-wide contracts at the reaction root; authoring may
use concept descriptions, and runtime may use both authoring and concepts.
Concept and authoring modules do not depend on runtime modules.

The files at `src/engine/reactions/` are intentionally shared or compositional,
not a fourth capability area. `types.ts` is the type vocabulary used by all
three areas and by reads, `context.ts` owns reserved interpreter bindings shared
by authored nodes and runtime instrumentation, and `resolving.ts` bridges named
references to an assembly for registration. Keeping these files at the root
avoids assigning common contracts to one subarea and creating a reverse
dependency from its peers. `engine.ts` is the direct-host facade, while
`index.ts` gathers the internal reaction surface.

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

| Area                  | Main files                                                                    | Responsibility                                                                                                |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Vocabulary refs       | `src/engine/reactions/authoring/refs.ts`                                      | Name concept actions and queries before an assembly has instances.                                            |
| Reaction construction | `src/engine/reactions/authoring/words.ts`, `nodes.ts`, `partitions.ts`        | Build Fluent declarations without executing actions.                                                          |
| Read construction     | `src/engine/reads/lines.ts`, `where-ops.ts`, `views.ts`, `former-*.ts`        | Describe query, view, condition, and former reads.                                                            |
| Registration          | `src/engine/reads/registering.ts`, `src/engine/reactions/runtime/reacting.ts` | Resolve names, validate contracts, and register definitions atomically by base reaction.                      |
| Lowering              | `src/engine/reads/lower.ts`                                                   | Turn supported declaration paths into portable `ReactionIR`; report why a local-only path remains executable. |
| Runtime               | `src/engine/reactions/runtime/reacting.ts`, `matching.ts`, `firing.ts`        | Match one landed occurrence, evaluate reads, invoke consequences, and record firing provenance.               |

`ReactionIR` in `reads/ir.ts` is the serialized design form consumed by
inspection, read-back, wire generation, and imported-reaction registration.
The runtime can still execute explicitly local constructs such as closure-based
conditions, but tooling labels those paths as unlowered instead of presenting
them as portable IR.

`src/engine/reactions/authoring/partitions.ts` validates sibling labels,
flattens authored branch trees, and forms the cross-product when later sibling
groups extend earlier paths. `lowerReaction` then gives variables stable names
and serializes each path's triggers, reads, and consequence asks.
Definition-site closures remain live and executable in the local engine, but
appear in the export's `unlowered` list rather than masquerading as portable
data. See
[Sibling paths and endpoint settlement](./semantics.md#sibling-paths-and-endpoint-settlement)
for the resulting behavior.

## Reads and values

`reads/where-ops.ts` evaluates query and view lines against `Frames`.
`reads/schedule.ts` determines an order from bindings rather than trusting the
order in which an author happened to write conditions. `reads/frames.ts`
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
| Assembly   | `src/engine/boundary/assembly/concept-set.ts`, `assemble.ts`, `assembly-facade.ts`, `assembly-registry.ts`                                               | Turn concept registrations and a composition into one instrumented engine, invoker, forms, contracts, and application facade.                                 |
| Client     | `src/engine/boundary/client/client.ts`, `local-client.ts`, `http-client.ts`                                                                              | Expose the typed client independently of a transport, then adapt it to a local invoker or HTTP.                                                               |
| Gateway    | `src/engine/boundary/gateway/gateway.ts`, `public-gateway.ts`                                                                                            | Route admitted outside requests through an isolated engine-backed forwarding boundary.                                                                        |
| HTTP       | `src/engine/boundary/http/http.ts`, `http-floor.ts`                                                                                                      | Adapt invocation to HTTP and project credential and public-error policy onto the generated wire contract.                                                     |
| Wire       | `src/engine/boundary/wire/wire.ts`, `wire-provenance.ts`                                                                                                 | Derive and render transport-safe contracts from endpoint IR and value provenance.                                                                             |

Dependency edges point inward toward `protocol/`: invocation, wire, and client
adapters consume its transport-neutral shapes. `assembly/` composes protocol,
invocation, wire, reaction, and read capabilities. `gateway/` and `http/` are
outer adapters that consume those lower layers; lower layers do not depend on
gateway or HTTP. The standalone `src/engine/boundary/cli-app.ts` likewise adapts
protocol results and an invoker without inspecting concept state, and
`src/engine/boundary/index.ts` only gathers the internal boundary surface.

`src/engine/boundary/assembly/concept-set.ts` turns plain concept registrations
into a vocabulary, default implementations, optional named floors, and refusal
metadata. `src/engine/boundary/assembly/assemble.ts` creates one engine,
instruments its selected instances, collects tagged composition exports, and
returns the application-facing invoker/form interface. Plain concept actions
may be synchronous, but the assembled `concepts` surface types every action as
a `Promise`: recording and reaction processing occur before a caller receives
its settlement.

`src/engine/boundary/invocation/invoke.ts`,
`src/engine/boundary/gateway/gateway.ts`,
`src/engine/boundary/http/http.ts`,
`src/engine/boundary/http/http-floor.ts`, and
`src/engine/boundary/cli-app.ts` route, serialize, or cancel a request, but they
do not inspect concept state.

## Dependency rules

Public subpaths under `src/` are export-only. Engine code lives under
`src/engine/` and imports engine modules, never public barrels. Use
`@engine/<concern>/<nested/path>` when crossing an engine concern or exporting
an engine module through a public subpath. Within one concern, use relative
imports with a `.ts` extension: `./module.ts` for a sibling or
`../area/module.ts` across nested capability directories. The build rewrites
`@engine` to relative package paths and rejects unresolved aliases before
packing.
`scripts/check-architecture.ts` checks those
directions, verifies package exports, and rejects unreachable shipped source.
Run `bun run check` after moving code; it is the source of truth for the
repository's structural rules.
