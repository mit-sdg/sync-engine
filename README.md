# sync-engine

`sync-engine` is a small TypeScript library for joining independent pieces of
an application without making them call each other.

A piece of domain state is a **concept**. A rule that connects concepts is a
**synchronization**. If creating an account should also create a workspace and
write an audit entry, those are two rules rather than two extra calls hidden
inside `Account.create`.

```text
Account.create --when--> CreateDefaultWorkspace --then--> Workspace.create
        |
        +------when----> RecordAccountCreation ---then--> Audit.record
```

The distinction is useful in applications where one event has several
consequences, workflows cross domain boundaries, or you need to understand why
an action happened after the fact. For straightforward CRUD with no
cross-domain behavior, ordinary function calls will probably be simpler.

## Install

```bash
bun add @mit-sdg/sync-engine
# or: npm install @mit-sdg/sync-engine
```

The package ships TypeScript source and has no runtime dependencies. Bun is the
most direct way to run it. Modern TypeScript-aware bundlers work as well.

## A complete first example

Concepts are plain classes. Public methods are actions; methods beginning with
`_` are read-only queries.

```ts
import type { Empty } from "@mit-sdg/sync-engine/engine";

export class TodoConcept {
  private items = new Map<string, { id: string; title: string; done: boolean }>();

  add({ id, title }: { id: string; title: string }) {
    if (this.items.has(id)) return { error: "EXISTS", detail: `${id} already exists` };
    this.items.set(id, { id, title, done: false });
    return { id, title };
  }

  complete({ id }: { id: string }) {
    const item = this.items.get(id);
    if (!item) return { error: "NOT_FOUND", detail: `${id} does not exist` };
    item.done = true;
    return { id };
  }

  _open(_: Empty) {
    return [...this.items.values()].filter((item) => !item.done);
  }
}

export class AuditConcept {
  readonly entries: string[] = [];

  record({ message }: { message: string }) {
    this.entries.push(message);
    return { message };
  }
}
```

The concepts do not import or refer to each other. Their relationship is
declared separately:

```ts
import { act, type Vars, when } from "@mit-sdg/sync-engine/engine";
import type { AuditConcept, TodoConcept } from "./concepts.ts";

export function makeSyncs(Todo: TodoConcept, Audit: AuditConcept) {
  const RecordCompletedTodo = ({ id }: Vars) =>
    when(Todo.complete, { id }, { id }).then(act(Audit.record, { message: id }));

  return { RecordCompletedTodo };
}
```

Finally, instrument the concept instances and register the rules. Always give
syncs the instrumented instances returned by `instrument`.

```ts
import { Logging, SyncConcept } from "@mit-sdg/sync-engine/engine";
import { AuditConcept, TodoConcept } from "./concepts.ts";
import { makeSyncs } from "./syncs.ts";

const engine = new SyncConcept();
engine.logging = Logging.OFF;

const { Todo, Audit } = engine.instrument({
  Todo: new TodoConcept(),
  Audit: new AuditConcept(),
});

engine.register(makeSyncs(Todo, Audit));

await Todo.add({ id: "T1", title: "Read the example" });
await Todo.complete({ id: "T1" });

console.log(Todo._open({})); // []
console.log(Audit.entries); // ["T1"]
```

## The model

### Concepts own state

A concept should make sense on its own. It owns its data, validates its action
inputs, and exposes the queries needed by rules or adapters. It should not know
which other concepts react to it.

- An **action** is any instrumented method whose name does not start with `_`.
  Its input and output are recorded in the action journal.
- A **query** starts with `_`. Queries are cached by input until an action on
  that concept runs.
- A domain failure can be returned as `{ error, detail }` or thrown. The engine
  records it as an error outcome rather than a successful result.

Because query results are cached, treat returned values as read-only. An action
on one concept invalidates that concept's cache, not every cache in the engine.

### Syncs describe policy

Every rule has the same shape:

```text
when action records match
where the matched data passes optional queries or filters
then dispatch one or more actions
```

Variables in a sync are symbols supplied through `Vars`. Reusing a variable
means the values must agree. In this rule, the `id` in the input and output must
be the same:

```ts
const OnCompleted = ({ id }: Vars) =>
  when(Todo.complete, { id }, { id }).then(act(Audit.record, { message: id }));
```

Matching the success-only output is also what prevents this rule from running
when `complete` returns `{ error: "NOT_FOUND", ... }`.

### Flows keep requests apart

An external action starts a flow. Actions dispatched by its syncs stay in that
flow, and journal matching never combines records from unrelated flows. A sync
is marked against records it has consumed, so it does not fire twice for the
same match.

This gives deterministic causal behavior, but it is not a database transaction.
If several actions must commit atomically, keep that guarantee in your storage
layer or inside one concept action.

## Working with data in `where`

`where` receives `Frames`, a relational-style array of variable bindings. The
most common operation is querying another concept and binding fields from each
result:

```ts
const CloseTasksWhenProjectArchives = ({ project, task }: Vars) =>
  when(Project.archive, { id: project }, { id: project })
    .where((frames) => frames.query(Task._byProject, { project }, { id: task }))
    .then(act(Task.close, { id: task }));
```

Useful frame operations include:

| Method                    | Use                                           |
| ------------------------- | --------------------------------------------- |
| `query`                   | Inner join: one output frame per query result |
| `queryOptional`           | Left join: retain frames with no query result |
| `filter` / `guard`        | Remove frames that should not continue        |
| `bind`                    | Add a constant binding                        |
| `map`                     | Perform a custom pure transform               |
| `collectAs` / `aggregate` | Group values for a batch action               |
| `enrich`                  | Add data asynchronously in parallel           |

Keep `where` free of mutations. Changes belong in actions dispatched by
`then`.

## Multi-step work

`then(...)` is a pipeline: a step's declared output bindings feed the next
step and an error stops the pipeline. Use `par(...)` only when children are
safe to run concurrently.

```ts
import { act, declareVars, guard, on, onError } from "@mit-sdg/sync-engine/engine";

when(Order.checkout, { items, total }).then(
  act(Inventory.reserve, { items }, { reservation }),
  act(Payment.charge, { total }, { payment }).match(
    onError({ error: reason }, act(Inventory.release, { reservation, reason })),
  ),
  act(Order.place, { reservation, payment }),
);
```

`on(...)` handles non-error outcomes. `onError(...)` handles returned or thrown
errors. `match(...)` selects the first matching case, and `otherwise(...)`
handles outcomes not claimed by an earlier case.

Put the most-specific success cases first. Use `guard(...)` after a pattern for
conditions involving several bindings. `declareVars` carries binding types into
the guard reader:

```ts
const { route, amount } = declareVars<{ route: string; amount: number }>();

act(Review.classify, { requestId }).match(
  on(
    { route: "manual", amount },
    guard(($) => $(amount) > 1000, "amount > 1000"),
    act(Escalate.priority, { requestId }),
  ),
  on({ route: "manual" }, act(Escalate.standard, { requestId })),
  on({ route }, act(Request.approve, { requestId, route })),
);
```

## Seeing what the engine is doing

Set `engine.logging` while developing a rule:

```ts
engine.logging = Logging.TRACE;
```

Trace logs show action records, flow ids, matches, and dispatched actions. For
programmatic tooling, `engine.addObserver(observer)` subscribes to journal
events and returns an unsubscribe function.

When a sync does not fire, check these in order:

1. The sync was registered after the concepts were instrumented.
2. The `when` action is the instrumented method, not the original instance.
3. Literal fields and repeated variables really match the recorded input/output.
4. The action succeeded if the rule expects fields from a success output.
5. The `where` clause still has at least one frame after queries and filters.

## SDK and runtime helpers

The package includes optional application-boundary utilities in addition to the
engine:

- `@mit-sdg/sync-engine/sdk` provides a typed endpoint DSL and a
  transport-independent client with no code generation.
- `createHttpClient` sends endpoint calls over `fetch`.
- `createCliClient` sends one JSON request to a child process over stdin and
  reads one JSON response from stdout.
- `@mit-sdg/sync-engine/runtime` provides app hosting, lifecycle cleanup, and
  job-status aggregation for long-running processes.

These modules are independent conveniences. You can use the engine without
them.

## Examples worth reading

- [`tests/golden/stitch`](tests/golden/stitch) is a real persistent CLI with
  `Work`, `Focus`, and `History` concepts. Its full terminal sessions are golden
  tested..
- [`tests/golden/todo`](tests/golden/todo) is a small todo app.
- [`tests/golden/lms`](tests/golden/lms) demonstrates joins, fan-out, branches,
  cascades, and error handling across six concepts.

## Development

The repository uses Bun and Vite Plus:

```bash
bun install
bun run typecheck
bun run test
bun run check
```

Source is split by responsibility:

```text
engine/   journal, matching, frames, and the sync DSL
sdk/      endpoint contracts and HTTP/CLI clients
runtime/  hosting and lifecycle helpers
utils/    cache, logging, and redaction
tests/    unit, integration, and golden applications
```

The project is available under the [Apache License 2.0](LICENSE).
