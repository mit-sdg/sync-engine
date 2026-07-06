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
bun add sync-engine       # or npm / pnpm / yarn
```

Requires **Bun** or a modern TypeScript runtime (Node 20+ with `--experimental-strip-types`).

## Quick Start

### 1. Define concepts

Each concept is a plain class. **Actions** mutate state; **queries** (prefixed with `_`) read it:

```ts
import type { Empty } from "sync-engine/engine";

class CounterConcept {
  count = 0;

  // Actions — mutate state
  increment(_: Empty) {
    this.count++;
    return { count: this.count };
  }

  // Queries — prefixed with _, read-only, auto-cached
  _getCount(_: Empty): { count: number }[] {
    return [{ count: this.count }];
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
import { actions, type Vars } from "sync-engine/engine";

// "Whenever Counter.increment executes and the count reaches 10, log it."
const LogAt10 = ({ count, msg }: Vars) => ({
  when: actions(
    [Counter.increment, {}, {}], // match any increment
  ),
  where: (frames) =>
    frames
      .query(Counter._getCount, {}, { count }) // read current count
      .filter(($) => $[count] === 10) // only when it's 10
      .map(($) => ({ ...$, [msg]: "Reached 10!" })),
  then: actions([Logger.log, { message: msg }]),
});
```

### 3. Wire everything together

```ts
import { Logging, SyncConcept } from "sync-engine/engine";

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
  await Counter.increment({});
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
  infra/          Infrastructure modules (optional, require MongoDB)
    scheduler.ts     Distributed job scheduler with MongoDB leases
    health.ts        Liveness + readiness probes
    metrics.ts        Observability sink (counters, histograms)
    readiness.ts     Generic MongoDB + index health check
  runtime/        Application runtime
    app-host.ts      Multi-tenant app registry
    lifecycle.ts     Uniform teardown registry
    job-status.ts    Lazily-read job-status aggregator
  transport/      Transport-layer types
    types.ts         AppRequest, AppResponse, Driver
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
    infra/           Scheduler, Health, Metrics
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

### `actions(...tuples)`

Normalizes sync clauses into `ActionPattern[]`:

```ts
actions([Concept.action, inputMapping, outputMapping], [OtherConcept.action, inputMapping]);
```

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
