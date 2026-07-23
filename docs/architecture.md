# Engine architecture

This note maps the implementation for contributors. It does not define public
authoring syntax; use the [guide router](./README.md), [execution
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

`src/engine/reactions/instrumenting.ts` is the sole interception boundary
for an ordinary concept instance. It wraps actions, invalidates standing query
caches, records invocation/outcome/fault entries, and asks the reaction runtime

`src/engine/reactions/log-store.ts` owns the append-only folded occurrence
indexes. `ActionConcept` in `actions.ts` is the small adapter that appends log
entries and retains unredacted values only while their causal flow is active.

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

| Area                  | Main files                                                  | Responsibility                                                                                                |
| --------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Vocabulary refs       | `reactions/refs.ts`                                         | Name concept actions and queries before an assembly has instances.                                            |
| Reaction construction | `reactions/words.ts`, `nodes.ts`, `partitions.ts`           | Build Fluent declarations without executing actions.                                                          |
| Read construction     | `reads/lines.ts`, `where-ops.ts`, `views.ts`, `former-*.ts` | Describe query, view, condition, and former reads.                                                            |
| Registration          | `reads/registering.ts`, `reactions/reacting.ts`             | Resolve names, validate contracts, and register definitions atomically by base reaction.                      |
| Lowering              | `reads/lower.ts`                                            | Turn supported declaration paths into portable `ReactionIR`; report why a local-only path remains executable. |
| Runtime               | `reactions/reacting.ts`, `matching.ts`, `firing.ts`         | Match one landed occurrence, evaluate reads, invoke consequences, and record firing provenance.               |

`ReactionIR` in `reads/ir.ts` is the serialized design form consumed by
inspection, read-back, wire generation, and imported-reaction registration.
The runtime can still execute explicitly local constructs such as closure-based
conditions, but tooling labels those paths as unlowered instead of presenting
them as portable IR.

## Reads and values

`reads/where-ops.ts` evaluates query and view lines against `Frames`.
`reads/schedule.ts` determines an order from bindings rather than trusting the
order in which an author happened to write conditions. `reads/frames.ts`
extends and deduplicates bindings. `reads/value-equality.ts` is the one
structural equality rule shared by reads and action-pattern matching: arrays,
plain records, and dates compare by value; other objects compare by identity.

`reactions/query-cache.ts` is intentionally independent of instrumentation.
It owns cache key generation and rejected-promise eviction. Instrumentation
only decides when every query cache is invalidated.

## Assembly and boundary

`boundary/concept-set.ts` turns plain concept registrations into a vocabulary,
default implementations, optional named floors, and refusal metadata.
`boundary/assemble.ts` creates one engine, instruments its selected instances,
collects tagged composition exports, and returns the application-facing
invoker/form interface. Plain concept actions may be synchronous, but the
assembled `concepts` surface types every action as a `Promise`: recording and
reaction processing occur before a caller receives its settlement.

`boundary/invoke.ts`, `gateway.ts`, `http.ts`, `http-floor.ts`, `cli-app.ts`,
route, serialize, or cancel a request, but they do not inspect concept state.

## Dependency rules

Public subpaths under `src/` are export-only. Engine code lives under
`src/engine/` and imports engine modules, never public barrels.
`scripts/check-architecture.ts` checks those
directions, verifies package exports, and rejects unreachable shipped source.
Run `bun run check` after moving code; it is the source of truth for the
repository's structural rules.
