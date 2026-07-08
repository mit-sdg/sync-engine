# sync-engine

Declarative synchronization engine for TypeScript — compose independent **concepts** with `when → where → then` rules, driven by an append-only action journal.

## Philosophy

Most backend code is a tangle of imperative logic: after creating a user, send a welcome email, update analytics, and create a default workspace — all buried inside a "create user" function that grows forever.

**sync-engine** inverts this: **concepts** are self-contained state machines that expose actions and queries. **Synchronizations** are declarative rules that react to the action journal and compose concepts — without concepts ever importing each other.

```
 ┌──────────┐    when     ┌──────────┐    then     ┌──────────┐
 │  Concept  │ ──────────→│   Sync    │ ──────────→│  Concept  │
 │    A      │   action    │  (rule)   │   action    │    B      │
 └──────────┘             └──────────┘             └──────────┘
                              │
                           where
                         (optional)
                              │
                         query Concept C
                         filter, map, collect
```

The result: **code that reads like a spec**.

## Installation

```bash
bun add @mit-sdg/sync-engine       # or npm / pnpm / yarn
```

Requires **Bun** or a modern TypeScript runtime (Node 20+ with `--experimental-strip-types`).

## Quick Start

### 1. Define concepts

Each concept is a plain class. **Actions** mutate state; **queries** (prefixed with `_`) read it:

```ts
class CounterConcept {
  counts = new Map<string, number>();

  // Actions — mutate state
  increment({ name }: { name: string }) {
    const count = (this.counts.get(name) ?? 0) + 1;
    this.counts.set(name, count);
    return { name, count };
  }

  // Queries — prefixed with _, read-only, auto-cached
  _getCount({ name }: { name: string }): { count: number }[] {
    return [{ count: this.counts.get(name) ?? 0 }];
  }
}

class LoggerConcept {
  messages: string[] = [];

  log({ message }: { message: string }) {
    this.messages.push(message);
    return { message };
  }
}
```

### 2. Write syncs

Syncs are `when → where → then` declarations:

```ts
import { act, type Vars, when } from "@mit-sdg/sync-engine/engine";

// "Whenever the 'main' counter reaches 10, log it."
const LogAt10 = ({ count, msg }: Vars) =>
  when(Counter.increment, { name: "main" }, { count })
    .where((frames) =>
      frames.filter(($) => $[count] === 10).map(($) => ({ ...$, [msg]: "Reached 10!" })),
    )
    .then(act(Logger.log, { message: msg }));
```

### 3. Wire everything together

```ts
import { Logging, SyncConcept } from "@mit-sdg/sync-engine/engine";

const engine = new SyncConcept();
engine.logging = Logging.TRACE;

// Instrument concepts (wraps them with journal recording)
const { Counter, Logger } = engine.instrument({
  Counter: new CounterConcept(),
  Logger: new LoggerConcept(),
});

// Register syncs
engine.register({ LogAt10 });

// Drive actions — syncs fire automatically
for (let i = 0; i < 10; i++) {
  await Counter.increment({ name: "main" });
}

console.log(Logger.messages); // ["Reached 10!"]
```

## Key Concepts

### Concepts

Concepts are independent state machines that own data and expose actions:

- **Actions** — mutators that return their output. Instrumented by the engine; every invocation is recorded in the journal.
- **Queries** — read-only methods prefixed with `_`. Automatically cached and invalidated when any action on the same concept runs. Never appear in the journal.

Concepts **never import each other**. All cross-concept behavior lives in syncs.

### Synchronizations (Syncs)

A sync is a declarative `when → where → then` rule:

| Clause  | Purpose                                                                                             |
| ------- | --------------------------------------------------------------------------------------------------- |
| `when`  | Action patterns matched against the journal. Binds **logic variables** (symbols) to matched values. |
| `where` | Optional pure transform over matched frames — filter, query, map, aggregate. Typed end-to-end.      |
| `then`  | Actions to invoke, one per surviving frame. Inputs resolve from the frame's variable bindings.      |

Syncs are **reactive** — they fire automatically after every action, and only within the same causal chain (flow).

### Action Journal

The engine maintains an append-only journal of every action invocation. Syncs match against this journal (not live state), which makes the system:

- **Replayable** — given the same journal, the same syncs produce the same effects.
- **Debuggable** — every action has a stable id, flow token, and synced map.
- **Safe from double-fire** — a sync marks consumed records so it never matches them twice.

### Flows

A **flow** is a causal chain: an action triggered from a sync's `then` inherits the triggering action's flow. Matching is restricted to a single flow, so concurrent requests never cross-match.

### Frames

The working set of a synchronization. A frame is a bag of variable bindings (keyed by symbol). `Frames` extends `Array` with relational-style helpers:

- `.query(fn, input, output)` — fan out over query results (inner join)
- `.queryOptional(fn, input, output)` — like query but preserves unmatched frames (left join)
- `.filter(…)` / `.guard(…)` / `.map(…)` — standard array transforms
- `.collectAs(keys, symbol)` — group frames into nested arrays
- `.aggregate(base, collect, as)` — like collectAs but guarantees at least one output frame
- `.bind(symbol, value)` — attach a value to every frame
- `.enrich(asyncFn)` — parallel async enrichment
- `.tap(fn)` — side-effect passthrough

## Package Structure

```
sync-engine/
  engine/         Core sync engine
    sync.ts         SyncConcept, instrumentConcept, synchronize
    frames.ts       Frames — relational intermediate results
    actions.ts      Action journal (ActionConcept)
    where.ts        Where pipe and read helpers
    vars.ts         declareVars, typed variable bindings
    types.ts        Frame, Sync, InstrumentedAction, …
    observer.ts     EngineObserver — passive journal subscriber
    introspect.ts   conceptNameOf, actionNameOf
    util.ts         uuid, inspect
  sdk/            Client + endpoint DSL
    client.ts        Type-safe HTTP client (Eden Treaty style)
    endpoints.ts     Typed endpoint authoring DSL
    error-codes.ts   Framework-level error codes
  runtime/        Application runtime
    app-host.ts      Multi-tenant app registry
    lifecycle.ts     Uniform teardown registry
    job-status.ts    Lazily-read job-status aggregator
  utils/          Shared utilities
    cache.ts         Generic memoization with TTL + LRU eviction
    logger.ts        Structured JSON + pretty logger
    redaction.ts     Sensitive-field redaction
  devtools/
    graph/         Sync-graph analyzer
      builder.ts     Build a causal graph from registered syncs
      reachability.ts BFS-based Respond reachability analysis
      diagnostics.ts Advisory correctness smells + complexity heuristics
      exporters.ts   JSON, Mermaid, Graphviz DOT, CLI report
  tests/           Framework-level tests
    engine/          Core engine tests (matching, frames, syncs, observer)
    runtime/         AppHost, Lifecycle, JobStatusRegistry
    utils/           Cache, Logger
    devtools/graph/  Graph builder, diagnostics, exporters, reachability
    golden/          Self-contained Todo app example (concepts + syncs)
```

## API Reference

### `SyncConcept`

The engine instance. Manages the journal, registered syncs, and concept instrumentation.

```ts
class SyncConcept {
  syncs: Record<string, Synchronization>;
  Action: ActionConcept;
  logging: Logging;

  constructor(actionConcept?: ActionConcept);
  register(syncs: Record<string, Sync>): void;
  instrument<T extends object>(concept: T): T;
  instrument(concepts: Record<string, object>): Record<string, object>;
  addObserver(observer: EngineObserver): () => void;
  invalidateCaches(concept: object): void;
  invalidateAllCaches(): void;
}
```

### `sync(fn)`

Declares a sync rule. An identity wrapper that gives TypeScript a place to infer
the `Vars` parameter and keeps every rule greppable by one name:

```ts
const MyRule = sync(({ userId }: Vars) => when(...).then(...));
```

### `when(action, input, output?)` / `when([...clauses])`

Starts a rule by matching one or more actions against the journal, returning a
builder. Use the single-action form for simple rules and the array form for
joins. Chain an optional `.where(...)` to transform frames, then `.then(...)` to
dispatch. The clause order `when → where? → then` is enforced by the builder's
types.

```ts
// single pattern
when(Concept.action, { inputKey: symVar }, { outputKey: symVar }).then(act(...));

// join across two actions, filtered
when([
  [Concept.a, { x: varX }],
  [Concept.b, { y: varY }],
])
  .where((frames) => frames.filter(($) => $[varX] === $[varY]))
  .then(act(Concept.c, { x: varX }));
```

### `act(action, input)`

A dispatch step. Refine it with `.as(bindings)` to bind its output into the
frame, `.where(fn)` to transform the frames before its children run, and
`.branch(...)` to react to its outcome:

```ts
act(Payment.charge, { total }).as({ paymentId }).branch(
  on(act(Receipt.send, { paymentId })),  // .as() already bound paymentId
  onError({ code: "CARD_DECLINED" }, ...),
)
```

### `on` / `onError`

Outcome branches, attached via `act(...).branch(...)` (or as steps inside
`seq(...)`). They partition an action's outcome:

- `on(...nodes)` / `on(pattern, ...nodes)` — the action produced a value or completed (any
  **non-error** outcome). The optional pattern filters or extracts further bindings.
  Omit it when `.as()` already bound what you need.
- `onError(pattern?, ...nodes)` — the action failed, whether it threw or
  returned an error record. The optional pattern unifies against the error.

### `seq(...steps)` / `par(...steps)`

Control sibling execution order inside a `then`:

```ts
// sequential: each step's `.as()` bindings feed the next; stops on error
seq(
  act(Inventory.reserve, { items }).as({ holdId }),
  act(Payment.charge, { total }).as({ paymentId }),
);

// concurrent: each child starts from the same input frame
par(act(Receipt.email, { userId }), act(Audit.record, { event: "ORDER_CREATED" }));
```

A plain `.then(act(...), act(...))` runs its siblings sequentially and
deterministically — `seq` is only needed to forward `.as()` bindings between
steps.

### `Frames`

Relational intermediate results (extends Array):

```ts
frames
  .query(Concept._getById, { id: symUserId }, { user: symUser })
  .filter(($) => $[symUser].active)
  .bind(symRole, "admin")
  .collectAs([symUser], symUsers);
```

### `declareVars<{ name: Type }>()`

Creates typed, stable symbol variables for use in sync declarations:

```ts
const { user, session } = declareVars<{ user: User; session: string }>();
```

### `Where`

Helpers for `where` clause composition:

```ts
const { pipe, read } = Where;

const result = await pipe(
  (frames) => frames.filter(($) => read($, count) > 0),
  async (frames) => frames.query(...),
)(frames);
```

### Nested Workflows

Use a nested `act(...).branch(...)` when several syncs only exist to describe one
workflow. Branches match on the step's outcome — result, error, or completion:

```ts
import { act, on, onError, seq, sync, type Vars, when } from "@mit-sdg/sync-engine/engine";

const ReviewWorkflow = sync(({ requestId, route, reason }: Vars) =>
  when(Request.submitted, { requestId }).then(
    act(Review.classify, { requestId })
      .as({ route })
      .branch(
        on({ route: "approved" }, act(Request.approve, { requestId })),
        on({ route: "manual" }, act(Queue.enqueue, { requestId })),
        onError({ detail: reason }, act(Audit.record, { event: "REVIEW_FAILED", payload: reason })),
      ),
  ),
);
```

Steps can be sequenced explicitly with `seq(...)` — each step's output feeds into
the next step's input frame via `.as()` bindings, and the sequence stops on the
first error:

```ts
then: seq(
  act(Inventory.reserve, { items }).as({ holdId }),
  act(Payment.charge, { total }).as({ paymentId }),
  act(Order.create, { holdId, paymentId }),
);
```

Use `par(...)` to declare sibling actions safe for concurrent execution. A plain
`.then(act(...), act(...))` executes its siblings sequentially for deterministic
safety.

Concept actions may throw domain errors instead of returning error records. The
engine records thrown failures as `{ kind: "error" }` outcomes, picked up by
`onError(...)` branches. `on(...)` (with or without a pattern) matches any
non-error outcome — it never fires on a failure, so it and `onError(...)` never
overlap. When `.as()` already bound the values you need, omit the pattern:
`on(act(Receipt.send, { paymentId }))`.

Use standalone syncs for reusable policies. Use nested workflows when the syncs
are only meaningful as ordered steps of one request or business process.

## Example: Todo App

See [`tests/golden/`](tests/golden/) for a complete, self-contained example:

- [`concepts.ts`](tests/golden/concepts.ts) — `TodoConcept` (create, complete, delete, queries) + `AuditConcept` (immutable event log)
- [`syncs.ts`](tests/golden/syncs.ts) — syncs that automatically audit every mutation: create, complete, delete
- [`integration.test.ts`](tests/golden/integration.test.ts) — demonstrates the full pattern end-to-end

## Design Rules

1. **Concepts never import each other.** They communicate only through syncs.
2. **Actions return their output as a plain record.** The journal captures it for matching.
3. **Queries start with `_`** and are auto-cached. They never appear in the journal.
4. **Syncs are declarative** — no side effects in `when` or the `where` clause. Side effects live in `then`.
5. **One sync, one responsibility.** A sync that creates a session, sends an email, and updates metrics should be three syncs.
6. **The engine is single-flow safe.** Actions from different causal chains never cross-match.

## License

MIT
