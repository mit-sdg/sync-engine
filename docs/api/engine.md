# Engine API

```ts
import { SyncConcept, when, act, Frames, Logging, declareVars } from "@mit-sdg/sync-engine/engine";
```

## SyncConcept

The synchronization engine. Manages concept instrumentation, sync registration, journal matching, and action dispatch.

```ts
const engine = new SyncConcept();
engine.logging = Logging.TRACE; // or Logging.VERBOSE, Logging.OFF
```

### instrument(concepts)

Wraps concept instances in a proxy that journals every action (method not starting with `_`) and drives sync matching. Queries (methods starting with `_`) are auto-cached. Always pass instrumented instances to sync rules, not the originals.

```ts
const { Todo, Audit } = engine.instrument({
  Todo: new TodoConcept(),
  Audit: new AuditConcept(),
});
engine.register(makeSyncs(Todo, Audit));
```

### register(syncs)

Registers named sync functions. Each receives `$vars` to produce its declaration, then is indexed by every action in its `when`. Re-registering a name replaces the previous sync for that name.

### addObserver(observer) / clearObservers()

Subscribe to journal events for every non-query action. Returns an unsubscribe function.

```ts
const unsub = engine.addObserver({
  onAction(ev) {
    console.log(ev.concept, ev.action, ev.durationMs);
  },
});
```

`JournalEvent`: `{ concept, action, input, output, flow, durationMs, ts }`.

### invalidateCaches(concept) / invalidateAllCaches()

Force-clear cached query results for the given instrumented concept (or all concepts). Useful after external DB mutations the engine didn't orchestrate.

### ActionConcept (journal)

The append-only journal backing all matching, exposed as `engine.Action`. Supports flow-based eviction:

```ts
engine.Action.evictFlow(flowToken); // drop all records for a flow
engine.Action.evictSyncedFlows(); // drop consumed trailing records
```

---

## The sync DSL

A sync reads as one sentence:

```ts
export const RecordCompletedTodo = ({ id }: Vars) =>
  when(Todo.complete, { id }, { id }).then(act(Audit.record, { message: id }));
```

### sync(fn) — sync function wrapper

Identity wrapper that helps TypeScript infer the `Vars` parameter. Makes every rule greppable.

```ts
export const OnRegistered = sync(({ user }) =>
  when(Auth.register, { user }, { user }).then(act(Profile.create, { user })),
);
```

### when(action, input, output?) → WhenBuilder

Start a sync rule. The `when` builder offers a `.where()` (optional frame transform) and a `.then()` (required dispatch pipeline).

Two forms:

- `when(action, input, output?)` — single action clause
- `when([[action, input, output?], ...])` — multi-clause, all must match within the same flow

The `output` pattern defaults to `{}` (empty = success only; reject errors). An empty output rejects error outcomes, so a sync only fires when its `when` action succeeds.

### where(frames: Frames) → Frames | Promise\<Frames\>

An optional pure transform on the matched frames. See [Frames operations](#frames-operations).

```ts
when(Project.archive, { id: project }, { id: project })
  .where((frames) => frames.query(Task._byProject, { project }, { id: task }))
  .then(act(Task.close, { id: task }));
```

### act(action, input, output?) → ActChain

A dispatch step. Its optional `output` binding extends the frame for subsequent pipeline steps.

```ts
act(Audit.record, { message: id });
```

An `ActChain` supports:

- **`.where(fn)`** — transform the step's output frames before downstream nodes
- **`.match(...cases)`** — branch on the step's outcome (see below)

### act(...).match(on(...), onError(...), otherwise(...))

Branch on a step's outcome (success, error, or fall-through). Cases are ordered; the first match wins.

```ts
act(Payment.charge, { total }, { payment }).match(
  onError({ error: reason }, act(Inventory.release, { reservation, reason })),
  on({ payment }, act(Order.place, { reservation, payment })),
);
```

#### on(pattern?, guard?, ...nodes) → CaseNode

Matches a non-error outcome. If no pattern is given, matches any success. An optional `guard(...)` further filters.

#### onError(pattern?, guard?, ...nodes) → CaseNode

Matches an error outcome (returned `{ error, detail }` or thrown errors). Pattern keys must exist in the error record.

#### otherwise(...nodes) → CaseNode

Catch-all fall-through. Must be the last case in a match (if present).

### guard(fn, label?) → Guard

A synchronous cross-binding match guard. The `fn` receives a `GuardReader` — a function `(variable: Var<T>) => T` that reads a binding from the current frame.

```ts
const { route, amount, requestId } = declareVars<{
  route: string;
  amount: number;
  requestId: string;
}>();

act(Review.classify, { requestId }).match(
  on(
    { route: "manual", amount },
    guard(($) => $(amount) > 1000),
    act(Escalate.priority, { requestId }),
  ),
  on({ route: "manual" }, act(Escalate.standard, { requestId })),
);
```

### par(...children) → ParallelNode

Run children concurrently from the same input frame. Each child is either a node or a local pipeline array.

```ts
const OnTaskCreated = ({ id, projectId }: Vars) =>
  when(Task.create, { id }, { id }).then(
    par(
      [act(Audit.record, { event: "task_created", id })],
      act(Project.updateStats, { projectId }),
    ),
  );
```

### oneOf(...candidates) / is(predicate, label?) → Matcher

Value matchers for use inside `when` / `on` patterns:

```ts
when(Request.submit, { status: oneOf("pending", "review") });
when(Job.finish, { code: is((v) => typeof v === "number" && v >= 200 && v < 300, "2xx") });
```

---

## Variables

### Vars — untyped variable proxy

Sync functions receive a `Vars` proxy as their parameter (the internal `$vars` object). Destructuring it creates fresh symbols — reusing a variable across `when` patterns means values must agree (unification).

```ts
// The `vars` parameter is a proxy; every property access creates a unique Symbol:
export const OnRegistered = sync(({ user }) =>
  when(Auth.register, { user }, { user }).then(act(Profile.create, { user })),
);
```

The proxy is not exported — it's injected by `engine.register()` when calling each sync function.

### declareVars\<T\>() — typed variables

Stable (memoized) symbols for a file's variable vocabulary. Each sync in the file shares the same symbols.

```ts
const v = declareVars<{ project: string; task: string; title: string }>();
const { project, task, title } = v;
```

### Where.pipe / Where.read

`Where.pipe(...gates)` composes async gates into a single `where` pipeline:

```ts
import { Where } from "@mit-sdg/sync-engine/engine";
const { pipe } = Where;

when(Request.submit, { id })
  .where(pipe(auth.granted, validation.passes, enrich))
  .then(act(Request.process, { id }));
```

`Where.read(frame, variable)` reads a binding typed from its `Var` brand:

```ts
const v = declareVars<{ user: string }>();
const { user } = v;

when(Auth.login, { user })
  .where((frames) => frames.guard((f) => Where.read(f, user) !== "blocked"))
  .then(act(Session.start, { user }));
```

---

## Frames operations

`Frames` extends `Array<Frame>` — a relational-style intermediate result. Standard array methods (`map`, `filter`, `flatMap`, `slice`, `concat`) return `Frames` again, keeping the fluent API closed.

### query(queryFn, input, output) — inner join

Fan each frame over query rows. Frames with zero results are dropped. Chainable because it returns `Frames` or `Promise<Frames>`.

```ts
frames.query(Task._byProject, { project }, { id: task });
// for each frame, calls Task._byProject({ project: frame[project] }),
// binds each result row's "id" field to symbol `task`,
// and drops frames where the query returned nothing.
```

### queryOptional(queryFn, input, output) — left join

Like `query` but preserves source frames even when the query returns zero rows (output symbols remain unbound).

### queryAsync / queryOptionalAsync

Always-async variants for query functions that return a `Promise`.

### innerJoin / leftJoin

Aliases for `query` / `queryOptional`. Readable when nesting inside a chain:

```ts
frames
  .innerJoin(Task._byProject, { project }, { id: task })
  .leftJoin(User._byId, { id: assignee }, { name: assigneeName });
```

### filter(predicate) / guard(predicate)

Remove frames. `guard` delegates to `filter` (alias for readability).

```ts
frames.guard((f) => f[count] >= 5);
```

### bind(symbol, valueOrFn)

Add a constant or computed binding to every frame.

```ts
frames.bind(session, (f) => extractSession(f[request]));
```

### map(fn)

Transform each frame.

```ts
frames.map((f) => ({ ...f, [fullName]: `${f[first]} ${f[last]}` }));
```

### collectAs(collect: symbol[], as: symbol) → Frames

Group frames by their non-collected keys, gathering collected values into arrays.

```ts
// After fanning out over tasks, collect task ids into a list:
frames.collectAs([task], tasks);
// Result: one frame per group with { [tasks]: [{ task: "T1" }, { task: "T2" }] }
```

### aggregate(base: Frame, collect: symbol[], as: symbol) → Frames

Like `collectAs`, but guarantees at least one output frame. When the input is empty, emits `base` with `as` bound to `[]`. Prevents a sync from silently failing when a query returns nothing.

```ts
when(List.get, {}, { request })
  .where((frames) => frames.query(Task._all, {}, { id: task }).collectAs([task], tasks))
  // Would break if _all returned nothing — use aggregate instead:
  .where((frames) => {
    const base = frames[0];
    return frames.query(Task._all, {}, { id: task }).aggregate(base, [task], tasks);
  });
```

### enrich(fn) → Promise\<Frames\>

Add data asynchronously in parallel. Calls `fn` for each frame concurrently
and merges the returned keys.

Returned string keys are converted to fresh internal symbols. The enriched
fields are accessible when further processing frames inside the same
`where` clause (e.g. chaining `.bind`, `.guard`, or `.map`), but they
cannot be referenced by declared `Var` variables in downstream DSL steps
such as `on(...)`, `act(...)`, or `.then(...)`.

```ts
await frames.enrich(async (f) => {
  const details = await fetchDetails(f[id]);
  return { category: details.category, priority: details.priority };
});
```

### tap(effect)

Run a side effect for each frame, passing frames through unchanged.

```ts
frames.tap((f) => console.log("processing", f[id]));
```

### collectOne(symbol, key) → Frames

Collect one value from each frame into an array, bound to `symbol`. Produces a single output frame.

---

## Other exports

### sanitize(obj)

Redact sensitive data. Delegates directly to `utils/redaction`'s `redact()`
function — use whichever name is more convenient for your calling context.

### actions(...clauses)

Normalize action clauses into `ActionPattern[]`. Used internally by `when`
and `then`. **Not re-exported from the public barrel** — listed here for
completeness when reading the engine source.

### normalizeOutcome(output)

Normalize raw action output into `ActionOutcome` (see Key Types table).

### conceptNameOf / actionNameOf / actionNodeId

Introspection helpers:

```ts
conceptNameOf(myConcept); // "Todo"
actionNameOf(instrumentedAction); // "add"
actionNodeId({ concept, action }); // "Todo.add"
```

---

## Key types

| Export               | Description                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Sync`               | `(vars: Vars) => SyncDeclaration` — a sync function signature                                                        |
| `Vars`               | `Record<string, symbol>` — untyped variable proxy type                                                               |
| `TypedVars<T>`       | `{ [K in keyof T]: Var<T[K]> }` — typed variable record                                                              |
| `Var<T>`             | `symbol & { __varType?: T }` — branded logic variable                                                                |
| `Frame`              | `Record<symbol, unknown>` — one row of variable bindings                                                             |
| `Mapping`            | `Record<string, unknown>` — an action's input/output shape                                                           |
| `Empty`              | `Record<PropertyKey, never>` — canonical no-fields mapping                                                           |
| `ActionOutcome`      | `{ kind: "result", value } \| { kind: "error", error } \| { kind: "complete" }`                                      |
| `Gate`               | `(frames: Frames) => Frames \| Promise<Frames>`                                                                      |
| `GuardReader`        | `<T>(variable: Var<T>) => T`                                                                                         |
| `InstrumentedAction` | An action callable with `concept` and `action` back-references                                                       |
| `EngineObserver`     | `{ onAction(ev: JournalEvent): void }`                                                                               |
| `JournalEvent`       | `{ concept: string; action: string; input: Mapping; output: Mapping; flow: string; durationMs: number; ts: number }` |
