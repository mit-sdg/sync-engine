# Execution semantics

This page defines the observable execution contract for actions, reactions,
reads, formed results, and application boundaries in the current beta.
The [Public API](public-api.md) lists the exports. The [read construction
cookbook](../guide/read-construction.md) demonstrates representative declarations without extending
this contract.

## Contract index

| Contract need                               | Section                                                                                   |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Action outcomes, refusals, and direct calls | [Actions, refusals, and faults](#actions-refusals-and-faults)                             |
| Trigger matching and consequence paths      | [Reactions](#reactions)                                                                   |
| Consequences held until causal work drains  | [Deferred triggers and settlement frontiers](#deferred-triggers-and-settlement-frontiers) |
| Portable and local definitions              | [Portable and local behavior](#portable-and-local-behavior)                               |
| In-process action serialization             | [Execution and concurrency](#execution-and-concurrency)                                   |
| Read binding, absence, and cardinality      | [Reading: declarations govern](#reading-declarations-govern)                              |
| Query promises, caching, and equality       | [Queries](#queries)                                                                       |
| Views and formed results                    | [Views and formers](#views-and-formers)                                                   |
| Placement of race-sensitive decisions       | [Decisions that must not race](#decisions-that-must-not-race)                             |
| Sibling and endpoint settlement             | [Sibling paths and endpoint settlement](#sibling-paths-and-endpoint-settlement)           |
| Gateway and client result model             | [Result model and gateway](#result-model-and-gateway)                                     |
| Runtime input and output validation         | [Runtime validation](#runtime-validation)                                                 |
| Generated caller contracts                  | [Generated wire](#generated-wire)                                                         |
| Deployment and resource limits              | [Operational limits](#operational-limits)                                                 |
| Interpreter failure delivery                | [Failures between action asks](#failures-between-action-asks)                             |
| Timeout and abort                           | [Cancellation](#cancellation)                                                             |
| Occurrence logs and restart                 | [Logs, concept implementations, and restart](#logs-concept-implementations-and-restart)   |

## Actions, refusals, and faults

An action occurrence begins when the engine records its ask, before the action
body runs. The ask carries an id, the concept and action names, its input, and a
flow token: the correlation identity shared by one outside request and its
consequences. An ask made by a reaction also carries the reaction name as `by`
provenance.

Matching snapshots arrays, plain records, and ordinary `Date` values when the
ask begins, preserving cycles and repeated references. Other object kinds retain
identity semantics. The action implementation still receives the caller's
original input object, so later mutation cannot rewrite the occurrence that
reactions match.

The action then settles in one of two outcome postures:

- **returned** — the action completed and its result was recorded;
- **refused** — the concept deliberately declined by throwing an error class
  registered for that action. The advanced `Refuse` marker also produces this
  posture when its code is accepted under the engine mode described below.

The engine classifies the outcome after the action body settles; it does not
create a concept-state transaction. State changed before the action returns or
throws is not rolled back by the engine. The concept implementation and backing
store determine whether those changes persist.

A registered exception must belong to that action; an exception registered only
for another action is a fault. Ordinary `assemble(...)` accepts `Refuse` only
when the action's refusal contract declares its code. An undeclared advanced
code is a fault: it creates no refusal outcome, a direct assembled call rejects,
and an unanswered endpoint settles as opaque `INTERNAL_ERROR`. Manual
`createEngine(...)` remains open: any `Refuse` code creates a refusal, and the
runtime warns when an explicit contract exists but omits that code. Applications
should use declared refusals for stable contracts.

A different throw is a **fault**. The engine records
the fault against the ask, leaves that ask without an outcome, and lets the
throw reach a direct caller. Failure delivery during reaction matching and at
the application boundary is covered in
[Failures between action asks](#failures-between-action-asks).

For a direct call through `Assembly.concepts`, a returned action resolves to its
success value and a refusal resolves to an `ActionRefusal` mapping with an
`error` code. A registered exception refusal also carries the specification's
sentence as `detail`; a `Refuse` escape hatch may carry other data. A fault
rejects the direct call. Underscore-prefixed query calls are asynchronous roots
with their declared answer inside the promise and do not return action refusals.

The direct caller receives a scalar action return unchanged. Occurrence
matching normalizes a non-object return to an empty successful result, so
reaction output patterns cannot bind fields from that scalar. Concept action
contracts should return object mappings when composition needs their outputs.
An action return remains successful when its object has a top-level `error`
field; only a registered refusal produces the refused posture.

## Reactions

An application reaction normally watches a returned or refused action outcome,
may read current concept state, and runs its consequence chain once for every
surviving binding. A binding is one row of named values matched from the
trigger and subsequent reads. Framework reactions may instead watch the fault
channel.

The trigger form selects the posture:

| Trigger                                          | Record watched                                 |
| ------------------------------------------------ | ---------------------------------------------- |
| `when(Concept.action(pattern))`                  | the requested ask, before the action body runs |
| `when(Concept.action(pattern).responds(result))` | the returned outcome                           |
| `when(Concept.action(pattern).refuses(refusal))` | the refused outcome                            |
| `when(returned(...))` / `when(refused(...))`     | the corresponding cross-action posture channel |

Each watched record gives each matching public single-trigger reaction one
trigger match. An ordinary reaction qualifies that match once when the record
lands. A deferred reaction matches its trigger once but may re-evaluate its
conditions at successive settlement frontiers. Manually registered
multi-trigger IR can join a newly landed record with earlier unconsumed records
in the flow. A `where` block may produce several bindings, so one qualification
may dispatch several consequences. Each recorded firing names the reaction, its
binding, the trigger occurrences it consumed, and the asks it produced. Other
reactions consume those occurrences independently.

Every callable consequence receives a fresh action id, inherits the trigger's
flow, and records the asking reaction as `by`. Several members of one
`then(...)` group are independent semantic siblings: every matching sibling is
eligible to ask its action, and the group carries no priority, exclusivity, or
coverage claim. Current execution is sequential; if an earlier sibling's
evaluation never settles, a later sibling is not reached. A
multi-member group requires one stable trailing `.named(...)` label per
sibling. Labels determine lowered path names and remain stable when source
order changes.

A later `.then(...)` group extends each current path independently after that
path's preceding action returns. It does not wait for every sibling and is not
a join. The engine lowers stages to separate reactions, pins each later
trigger to the exact preceding `by` provenance, and uses `earlier` when a
stage needs the original outside input. A refusal or fault stops that path
while other siblings continue. A qualified sibling may carry its own chain
before its trailing branch label.

A later stage does not inherit a binding opened only by an earlier standing
read. The binding reaches the later stage only when an intervening action input
or output carries it. Read the value again at the later stage when later state
is intended; do not add action fields solely to transport composition data.

The public `when(...)` form accepts one trigger. Use `earlier` for directional
correlation, views for standing policy, and concept guards for decisions that
must run once. The package exports no public multi-occurrence join form.
The engine does not detect reaction cycles. Each turn of a cycle creates new
occurrences and may continue until a condition, refusal, fault, or configured
execution limit stops it.

### Deferred triggers and settlement frontiers

`.afterFlowSettles()` holds a consequence until tracked ordinary work in the
trigger's causal flow has drained:

```ts
when(Phasing.start({ sequence }).responds({ job, attempt }))
  .afterFlowSettles()
  .where(Phasing._running({ sequence }).is({ job, attempt }))
  .then(Phasing.advance({ job, attempt }));
```

Such a trigger is **deferred**. Where an ordinary reaction prepares its firing
as the occurrence lands, a deferred one is armed there and waits for a
**settlement frontier**: the moment the flow's outermost ask is about to settle,
when all tracked ordinary work in that flow has drained. Settlement is per
causal flow. Unrelated root flows neither delay a frontier nor open one, and no
application-wide idle is involved.

At a frontier the engine reads the conditions of every deferred trigger match
armed in that flow before dispatching any consequences. This is the same rule
ordinary reactions follow for one landed occurrence. The engine runs qualified
consequences in the same flow, lets their ordinary cascades drain, and then opens
another frontier. A frontier at which no trigger combination qualifies finalizes
the flow.

A deferred consequence is an ordinary ask in every other respect. It keeps the
flow token, the anchor's bindings, `earlier(...)` scope measured from the
anchor's landing position, request correlation, `by` provenance, firing
records, and execution-limit accounting. Each watched occurrence produces one
trigger match; manually registered joint triggers may produce several trigger
combinations. A combination whose conditions produce no binding remains armed.
Before a later frontier evaluates it again, the runtime discards it if another
firing of the same reaction consumed any of its trigger occurrences. Once a
combination produces one or more bindings, it is retired and each binding is
dispatched independently. Dispatch failure does not re-arm it.

Settlement follows the tracked flow, so an action must return or await a
structural `PromiseLike` for work that should delay it. Detached asynchronous
work remains untracked and a frontier may open before it finishes. An
interpreter or integrity failure recorded before a frontier prevents deferred
advancement. Such a failure while a frontier is being qualified or dispatched
does not cancel its other matches; the engine completes that frontier and opens
no subsequent one. The flow finalizes with what it has already accepted, and the
delivery in
[Failures between action asks](#failures-between-action-asks) applies
unchanged. A deferred cascade is bounded like any other: the engine does not
detect cycles, and `maxFiringsPerFlow` and `maxActionsPerFlow` stop a runaway
one.

Deferred trigger matches are currently qualified sequentially, and prepared
consequences are dispatched sequentially. A condition or consequence that never
settles blocks later work in that frontier and prevents the flow from
finalizing. Applications must not use this order as semantic priority.

`.afterFlowSettles()` also qualifies a later stage of a chain, including an
endpoint's. Conditions on that stage can identify the terminal state from which
to form a response:

```ts
receive({ sequence })
  .then(Phasing.start({ sequence }).responds({ job }))
  .afterFlowSettles()
  .where(
    no(Phasing._running({ sequence })),
    Phasing._latest({ sequence }).is({ job, state: "finished" }),
  )
  .then(respond({ job }));
```

The deferred stage is anchored to the ask its own path made, so it answers only
at a frontier where its conditions hold. If no frontier satisfies them, that
path produces no answer. The request remains unanswered only if no sibling or
parallel path answers; the behavior in
[Sibling paths and endpoint settlement](#sibling-paths-and-endpoint-settlement)
applies. Because a later stage lowers to a reaction of its own, a chain that
lowering keeps local cannot defer a later stage; registration rejects that
composition and names the stage.

### Portable and local behavior

A definition is **portable** only when its canonical JSON representation can be
round-tripped and registered against the same named vocabulary. Named concept
actions, queries, views, formers, and vocabulary computations satisfy that
contract when their definitions contain only the portable IR vocabulary.
Closures, explicit custom operations, `$is` object-identity patterns, raw result
transforms, and whole reaction definitions that lowering cannot represent are
local executable behavior. JSON markers for local behavior make it inspectable;
they do not make its function or identity re-registerable.

Ordinary assembly accepts portable behavior only. It rejects every local
reaction, view, or former before an invoker, route set, generated plan, or
artifact write is exposed. Manual engines under the `advanced` subpath may
execute local constructs, but they do not gain ordinary assembly's application
boundary or portability guarantees.

## Execution and concurrency

For an instrumented action, the engine performs these steps in order:

1. Append the invocation occurrence.
2. Reserve the action's position on the concept instance's serial line.
3. Evaluate reactions that watch the requested posture.
4. Run the action body when its reserved position reaches the front.
5. Append its returned/refused outcome or fault.
6. Evaluate reactions for that landed record.
7. Notify observers after the action settles.
8. If this is the flow's outermost ask, process settlement frontiers until no
   deferred trigger qualifies or the flow fails.
9. Clear transient matching values, report flow quiescence, and apply automatic
   window retention.

Requested-posture reactions run after the invocation is recorded and before the
ordinary action body is released. Same-concept requested consequences use an
internal reservation release to make progress without changing body-arrival
order.

One action body runs at a time per raw concept instance within one engine. The
queue awaits a structural `PromiseLike`: any returned object or function whose
`then` property is callable. This includes native promises from another
JavaScript realm and non-native thenables. The queue reads `then` once and
invokes it in a microtask. A throwing `then` accessor, or a `then` call that
throws before settlement, faults the action. A thenable that never settles holds
the serial line just as a never-settling promise does. Supplying one raw instance
to several engines creates separate queues and query caches and does not
serialize those engines. Different concept instances and separate root flows
can overlap.
Ordinary reactions for one landed occurrence are currently evaluated
sequentially. Their trigger and `where` stages all finish before any matching
consequence is dispatched, so one sibling consequence cannot change another
sibling's guard. Deferred conditions run later at settlement frontiers.
Applications must not use evaluation order as semantic priority. No engine-wide
lock serializes all concepts or all flows, and the guarantee does not extend
across processes.

## Reading: declarations govern

A reaction or former `where` block is an orderless conjunction of lines.
Registration derives an evaluation schedule from available bindings; authored
order is a legibility choice. View blocks are checked for schedulability, but
the current implementation stores and evaluates their authored order. Until
that implementation restriction changes, write each view line after the lines
that supply its inputs. Each line reads one relation—a concept query or a
view—with its input pattern in the query or view call and an output pattern in
`.is`:

- the query or view input must be fully bound by the trigger or another
  schedulable line;
- in `.is`, a **fresh name opens** and binds for later lines; a **bound name
  or literal tests** the row's value; using the same variable again tests
  equality — no equality word exists;
- an **empty `.is`** (a bare call) is an existence read: the case proceeds
  once if any row matches, and drops otherwise.

When present, the relation's promise controls how many source rows a plain line
receives. A `one` relation supplies exactly one row, but the line can still drop
the case when its `.is` pattern does not match that row. An `optional` relation
supplies zero or one row. A `many` relation supplies any number and continues
once per distinct matching fill. An undeclared query is treated as potentially
many. If a concept answers outside its declared promise, the engine reports an
integrity fault that names the query.

Three words mark intent beyond plain reading, and each is flat — they apply
to a plain line, never to each other:

- **`no(line)`** holds only when no such row exists at all—never "a row exists
  that differs." Under `no`, the `.is` pattern admits only literals and names
  already bound by the trigger or another schedulable line.
- **`whether(line)`** lets the case survive absence: present binds, absent
  passes the case on with the opened names blank. A blank name may shape
  output — blank leaves, empty captures. A later plain line reading it in its
  query input drops the case while it is blank; a later `whether` line passes
  the blank on.
- **`.is.not({...})`** tests inequality and binds nothing. It admits only bound
  names and literals. With several stated fields, every stated field must differ
  for the row to pass.

Order comparisons (`is.lt`, `is.le`, `is.gt`, `is.ge`, …) are ordinary
built-in relations read as closed lines over bound values.

Registration rejects a fresh name under a denial, a name opened by a declarative
read that no later line or consequence uses ("omit the key instead"), and a cycle
between views. Unused trigger and action-result bindings are outside this check
and require review. Registration also generates a read-back for every reaction.
The read-back identifies paths, stages, opened and tested names, fan-out, and
dropped cases.
`inspectAssembly(assemble(...)).readBack` returns the application's complete
read-back as one string.
[The read construction cookbook](../guide/read-construction.md) quotes these read-backs entry by entry.

## Queries

A concept registry may declare each query's promise as `"one"`, `"optional"`,
or `"many"`. A `one` query returns one record. An `optional` query returns an
array containing zero or one record. A `many` query returns an array of
records. An undeclared query may return one record or an array of records;
because it makes no narrower promise, authoring treats it as potentially many.
When the authored promise is available as a TypeScript literal, the vocabulary
types reject a method whose return container does not match that promise.
The engine attaches the registry's promises to whichever implementation the
selected floor supplies and checks every answer when a reaction, view, or
former reads it. `null`, a scalar, an array row that is null, scalar, or another
array, or a violation of declared cardinality raises a query fault. Class
instances and other non-null, non-array objects pass this container check. This
is not row-schema validation. A record missing a field named in `.is` does not
match that pattern. A direct query root returns the implementation result
without this `where`-read container and cardinality check.

An ordinary assembly defaults to `queryCache: "memoize"`, which memoizes queries
by concept instance and argument between invalidation points. Instrumented
actions invalidate the acted-on concept instance's query caches before and after
their bodies, and an assembled outside invocation invalidates all concept query
caches before dispatch. `queryCache: "none"` disables this memoization; repeated
reads execute the query implementation independently.
Query implementations must not create side effects. The engine does not inspect
or enforce query purity.
A structural thenable returned by a memoized query is normalized to one native
promise before that promise is cached. Equivalent reads reuse the normalized
promise, so the original thenable's `then` is invoked once. Rejection, including
a throw while reading `then` or before the `then` call settles, evicts the entry;
a later equivalent read executes the query again. A thenable that never settles
remains cached until invalidation. Direct state mutation or an external database
change that bypasses an instrumented action can remain hidden until the next
invalidation; a query call is not guaranteed to execute its implementation on
every read. Cache-key construction traverses at most 100 nested levels. A call
with a deeper argument still executes but bypasses memoization for that call.
Cache arguments follow read equality: arrays and plain records are structural,
`Date` values use their timestamps, and maps, sets, class instances, regular
expressions, functions, symbols, and other opaque values use identity.
Equivalent acyclic structural values share entries; cyclic values are bounded
and safe but may occupy separate entries when their graph shapes differ.

Read equality and literal action-pattern equality are structural for arrays and
plain records, timestamp-based for `Date`, and identity-based for maps, sets,
class instances, and other objects. Reusing an already-bound variable in an
action pattern uses this same equality. Many-row read matching retains the first
structurally distinct fill. Former `.distinct(...)`
uses JavaScript `Set` semantics and skips `undefined`. `.first(...)` uses the
first selected row after optional arrangement. `arranged("newest")` reverses
source order; it does not inspect a timestamp field.

How such a fault is delivered depends on where the read occurs. See
[Failures between action asks](#failures-between-action-asks).

## Views and formers

A **view** names a match. Its builder receives separate input, output, and
free-binding bags. Reading a property, including by destructuring, declares a
stable logic variable. A predicate view ends in `.holds()`. A view with outputs defaults
to `.many()` and may instead declare `.one()` or `.optional()`. Its human name
carries no signature or cardinality. At a use-site a view takes one plain
object input mapping. Every enumerable own key must be declared, and every
declared input must be present according to the JavaScript `in` operator. The
view is read exactly like a concept query. Its local bindings do not escape.
Stacked `where` blocks are alternatives; any matching block can supply a result.

The engine checks a concept query's declared promise whenever it reads the
query and checks a view's declared promise whenever it reads the view. The
read-back states the declaration and the runtime integrity check. The current
package does not analyze cardinality over exported IR.

A **former** names a formed answer. Its builder receives separate input and
free-binding bags. Its body matches in `where` and produces in `form`, and
production is terminal: nothing in a `where` chooses output. A record former
promises one answer unless it ends in `.optional()`. A selection-root former
always produces one result whose shape is determined by `.form`, `.count`,
`.first`, or `.distinct`; it cannot end in `.optional()` because an empty
selection already has a defined result. The human name carries neither inputs
nor cardinality. The engine checks the promise when the former is evaluated. A
record's `where` cannot open a name from a `many` source. Use `each` when the
result should contain rows. Like a view, a former call takes one plain object
mapping with the same enumerable-own-key and required-input checks.

Production handles absence and plurality in three ways:

- an entry that reads a promised source **plainly** drops its row when the
  source declines;
- an entry that reads it under **`whether`** keeps the row and takes blank
  (`null`) leaves;
- **`each(line)`** captures every row of a promised line — query or view —
  into a selection. The selection may refine with `.where(…)` (closed
  conditions: plain lines, `no`, `whether`, comparisons), order with
  `.arranged(value, "descending")`, and then choose its shape: `.form({…})`
  carries one record per row, and the folds — `.count()`, `.first(value)`,
  `.distinct(value)` — reduce the capture to one answer. A fold over a source
  that promises at most one row is rejected: the promise already answers.

Without `.arranged(...)`, a selection retains source-row order. A view-level
`count(query, input, output)` binds `0` when the query returns no rows.

Record entries may read named formers directly, plainly or under `whether`,
so absence is declared once at the source and every reader chooses how to
handle it. The engine evaluates a former when asked; it does not store the
formed result.

`.splicing(...uses)` merges one or more record-rooted former fragments into a
host record or selection row. Each variable referenced by a fragment input must
already be bound; literal inputs are accepted. Fragment keys must not collide
with host or earlier-fragment keys. A plain optional fragment drops the host row
when absent; `whether(fragment)` preserves the row and fills the fragment leaves
with `null`. The engine checks each fragment's promise; several rows fault the
former evaluation.

If a former faults while forming a reaction consequence, that consequence ask
is recorded with the fault and remains unanswered. Calling a former directly
has no action ask to mark, so the evaluation rejects instead. The operational
fault is a `FormerFault`: `FORMER_NONE` means a former promising one answer
produced none, and `FORMER_MANY` means a record body produced several matches.
These faults use the operational failure path. The delivery boundary is described under
[Failures between action asks](#failures-between-action-asks).

## Decisions that must not race

A uniqueness, capacity, first-come, or answer-once decision belongs in the
action that owns the state. A reaction's `where` is a current observation, not
an atomic guard. [Ordering and state-read timing](#ordering-and-state-read-timing)
defines the in-process serialization and cross-process limits.

## Sibling paths and endpoint settlement

One `then(...)` group may carry several alternatives:

```ts
.then(
  where(leftCase).then(Left.handle({ item })).named("left"),
  where(rightCase).then(Right.handle({ item })).named("right"),
)
```

The engine lowers these to paths named `Reaction:left` and `Reaction:right`.
If both conditions hold, both fire. If neither holds, neither fires. Labels
record provenance and establish no preference. A later single consequence
creates `Reaction:left#2` and `Reaction:right#2`, each triggered by the return
from its own first stage. Repeated sibling groups expand the set of paths; they
do not create a runtime join.

At the application boundary, `receive(...)` supplies the outside-request
trigger to the same sibling tree. Path pinning, input contracts, request
correlation, response shaping, and wire derivation remain endpoint concerns.
The endpoint's declared path is authoritative: `receive(...)` cannot author
the boundary-owned `path`. Authored responses likewise cannot provide the
boundary-owned `requestId` or `errorKind`; framework classification travels on
a separate internal response channel and accepts only declared framework codes.
An endpoint records at most one answer. An uncovered input or a dropped plain
line can leave a fault-free request unanswered. Parallel endpoint declarations
and sibling answers remain ordinary alternatives, so any matching path may
answer; `NOT_PENDING` refuses another answer after settlement. When the root
flow becomes quiescent, an answer already delivered remains authoritative. If
no answer exists and the interpreter failed between action asks, the invocation
settles with opaque `INTERNAL_ERROR`. A fault-free unanswered invocation waits
30 seconds by default and then returns `TIMED_OUT`; `InvokeOptions.timeoutMs`
overrides that wait. Public endpoints should provide explicit complementary
case branches that answer every admitted case. An unconditional
sibling is not ordered fall-through and overlaps every conditional sibling that
can answer. A stage marked
[`.afterFlowSettles()`](#deferred-triggers-and-settlement-frontiers) answers at
a settlement frontier instead of where its trigger lands; it is still one
ordinary answering path under every rule above.
[Cancellation](#cancellation) defines what timeout and abort do with a pending
call. Runtime execution does not enforce branch disjointness or endpoint
coverage. `applicationDiagnostics(...)` traces causal `by` provenance to
attribute an eventual response to its request path. Only a response that uses
the traced request identifier contributes to an endpoint proof. Direct response
paths and recognized total action chains contribute to overlap proof; chain
overlaps are attributed to their root reactions. Coverage recognizes a linear
chain of successful action postures when every action input exactly follows the
preceding ask, every output pattern is empty, and the only intervening reads
replay guaranteed ancestors. The standard boundary funnels cover refusals and
faults with correlated response attempts. Deferred stages remain eligible. This
proof concerns portable JSON-shaped boundary values, not live object identity
or accessor behavior. It proves guard coverage after each watched posture lands,
not that an action or read eventually settles. Other intermediate action paths remain ineligible. On direct paths, the analyzer
recognizes canonical `receive(...)` shapes,
disjoint literal request alternatives, non-dropping `whether` lines, and fresh
computations. It can report a bounded set of potential overlaps and warn when
it recognizes no non-dropping total answer path. Complementary state reads
remain unproved because siblings evaluate independently and do not share a
state snapshot. The analyzer does not prove arbitrary view, computation,
validator, action-outcome, or concurrent-state logic. Warnings remain advisory
unless `sync-engine check --fail-on-warnings` runs with an application config.

## Boundary, gateway, and client

### Result model and gateway

The [application authoring guide](../guide/authoring.md#application-boundary)
shows the path from assembly through the fixed gateway and generated client.
Semantically, `assemble` gives an application its own boundary and occurrence
log. The log records what happened in that assembly; it is not concept state.
`createGateway` decorates the application's `Invoker` with route admission,
forwarding, caller timeout and abort handling, limits, observation, and ordered
drain. It does not create a second reaction engine or occurrence log. Gateway
and application observation share the effective correlation id.

The local and HTTP clients resolve to the same simple shape: the endpoint's
success JSON or an `{ error, detail? }` envelope. The invoker that waits for the
boundary answer keeps domain errors and framework errors distinct. Client and
invocation adapters omit exception text when an unknown thrown value becomes a
framework error. A top-level `error` field in an authored response denotes a
domain failure, so a successful endpoint result cannot use `error` as an
ordinary top-level data field. See the exact [cancellation
boundary](#cancellation).

Every generated client endpoint accepts an optional `ClientCallOptions` after
its input. The core client copies `signal`, `timeoutMs`, and `correlationId` to
the `ClientRequest`; the selected transport defines how it uses them. The core
client does not itself apply a timer or create a correlation header. An optional
synchronous `validateResponse` callback inspects the complete untrusted
transport result with its route. `{ ok: false }`, a throw, or a promise-like
validator result becomes `{ error: "TRANSPORT_ERROR" }`; an accepted result is
returned without transformation.

The maintained HTTP package defines its method, body, status, correlation,
timeout, response-size, and cookie behavior in the [HTTP Public
API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md).

### Limits and operational observation

An opt-in `ExecutionLimits` profile bounds active root flows, pending requests,
actions and firings per flow, evaluation rows, and caller deadlines. Profile
values and explicit deadlines are positive finite integers. Work rejected for
overload or drain returns `UNAVAILABLE` and creates no root action occurrence.
An accepted flow that exceeds an action, firing, or row budget records integrity
evidence and follows interpreter-failure settlement as opaque `INTERNAL_ERROR`.

Ordinary assembly and gateway options accept operational observers. The stable
event union reports action settlement, interpreter and integrity failure,
invocation settlement, execution-limit breach, and drain state. Applicable
events carry action id, flow, route, asking reaction, correlation id, safe
result class, wall-clock time, and monotonic duration. They never carry action
input or output.

Each public `gateway.invoke(...)` emits exactly one invocation settlement after
its final downstream or gateway rejection result is known. Gateway observers
also receive its limit and drain events, but there are no internal gateway
concept-action events. The settlement uses the caller-requested application
path, the effective gateway/application correlation id, the final result class
and framework code when applicable, and a duration through final completion.
It omits `flow` because the internal gateway root identity is not a stable
public request identity.

Observer callbacks are synchronous bounded handoff: the engine catches throws
and never awaits observer work, while queueing, exporting, and network I/O
remain host responsibilities.

### Correlation and route paths

When a direct caller omits a correlation id, the gateway establishes a fresh
UUID once at public entry and carries it through gateway and application
observation. Correlation does not deduplicate work and is not an idempotency
key. HTTP correlation resolution is specified by the [HTTP Public
API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md#server).

Endpoint paths are portable absolute URL pathnames. Their declared spelling
must survive WHATWG URL pathname handling exactly: queries,
fragments, scheme-relative paths, literal spaces or Unicode, dot-segment
normalization (including encoded dot segments), malformed percent escapes, and
other noncanonical spellings are rejected. Percent-encoded path data remains
valid when URL handling preserves it. `/` is a valid endpoint path.

### HTTP policy and browser controls

The [HTTP Public API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md#policy)
defines immutable deployment policy, public-error projection, CORS, and the
separate request-origin control. A missing `Origin` is allowed by default; when
present, a disallowed origin is rejected on cookie-touched paths.

### HTTP cookie bindings

The [HTTP Public API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md#cookie-bindings)
defines cookie injection, issuance, clearing, and generated projection.
Application-dependent binding validation occurs when the handler binds the
application and when the wire projector runs, not when deployment-only policy is
constructed.

### Runtime validation

Gateway admission and the assembled invoker
validate the route and request's outer shape. The input must be a non-null,
non-array object and contain every required own key. Extra keys remain. Defaults
are shallow and apply only when a key is absent; a present value is never
overwritten. An endpoint may additionally attach application-supplied input and
successful-output validators, plus a `domainError` validator. The input
validator sees the admitted value after defaults and runs before the application
boundary ask is recorded. Invalid input returns `INVALID_INPUT`. The output
validator runs before a successful result leaves the invoker. The domain-error
validator runs on the value under an authored response's top-level `error`
field. Invalid output records `invalid-output` integrity evidence; an invalid
domain error records `invalid-domain-error` evidence. Both become opaque
`INTERNAL_ERROR`. Framework failures are not endpoint-validated.

Without an input validator, primitive types and nested shapes are not checked,
so explicit `null` and direct-invocation `undefined` pass required-key presence.
JSON transport removes `undefined` object fields before admission. Validators
inspect values but do not transform them, and thrown validator failures fail
closed. Validators must return synchronously; a promise-like result fails
validation. A configured `rawFaultReporter` receives the original thrown value
with kind `endpoint-validator` and phase `input`, `output`, or `domain-error`.
For output and domain-error throws, ordinary integrity evidence retains only
the `ValidatorFault` class. An input-validator throw returns `INVALID_INPUT`
before an occurrence is recorded. Caller-visible errors contain no thrown
detail, and reporter failure is isolated from validation settlement. The
generated TypeScript contract provides static caller checks. Runtime validation
requires endpoint validators. Optional concept State sections are
uninterpreted human notation; they do not contribute to endpoint contracts or
validators, and no schema is inferred from concept specifications.

### Endpoint input contracts

Absent an explicit endpoint input contract, assembly derives required keys from
portable endpoint IR as the intersection of non-reserved keys mentioned by
every exported `receive(...)` pattern for that path. Local endpoint behavior is
an assembly error. An explicit contract replaces a derived contract, and only
one endpoint declaration may supply an explicit contract for a path. Assembly
rejects an explicit contract when omitting its optional keys cannot match any
receive alternative after defaults are applied.

### Production transport requirements

Transport requirements are specified by the [HTTP Public
API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md)
and [HTTP host responsibilities](operations.md#http-host-responsibilities).

### JSON projection

The local client serializes and parses input and output before returning it.
Dates become strings and undefined object fields disappear. Other transports
define their own projection failures and error codes.

## Generated wire

The authoring guide explains how to [generate the wire
contract](../guide/authoring.md#generate-the-wire-contract). With a vocabulary
type anchor, endpoint
leaves refer back to concept action parameters, action results, and query rows;
the response structure and absence rules come from the endpoint and its
formers. The generated module applies the same JSON projection as the clients,
including `Date` to `string`. Strict generation rejects any leaf that cannot be
traced to a signature. Without an anchor, the renderer emits a structural
contract and uses `Json` for leaves it cannot trace to a signature.

Ordinary assembly rejects every local reaction, view, or former. The error names
each local owner before a route or artifact plan is exposed. Direct invocation,
gateway routing, transport adapters, and generation therefore share one complete
portable design. Executable-only behavior causes assembly to fail.

When a generated application descriptor supplies ordered `projections`, one
module contains the logical contract followed by each named transport contract.
The contract named by `wireName` retains the logical application inputs, outputs,
and refusal codes for a local or custom client. The HTTP companion's
`httpWire({ policy, name })` carries public policy categories and excludes
private refusal codes. With cookie bindings, that contract also omits each
cookie-bound input from protected routes and the consumed value and expiry
fields from every issuing route's output. All contracts share generated type
helpers and the vocabulary anchor. Core records every projector package and
version in generated provenance.

Projection planning validates all names before rendering. The logical wire,
every projected wire, each app-wide error type, `Json`, and vocabulary helper
types must have distinct valid TypeScript identifiers. Provenance package names
must be nonblank, and provenance versions must be valid SemVer. Core
evaluates projectors in declaration order, and a projector or validation failure
occurs before any artifact comparison or write.

Generated assembly compatibility is governed by the application manifest
format and package SemVer. Artifact planning requires
`sync-engine.application-manifest` version 5, a 1.x core generator identity,
and SemVer projector provenance. The core generator identity must name
`@mit-sdg/sync-engine` at a 1.x version. Projector provenance accepts any
nonblank package name with any valid SemVer version; projector versions
are not restricted to 1.x. Generator and projector identities may use
prerelease versions.

Manifest V5 inventories every installed computation, including the five standard
relations and vocabulary computations that no registered definition references.
It records only the computation name, its standard/vocabulary source, and input
roles when conservative function inspection can recover them. It does not retain
the function. For concepts, the vocabulary class remains the canonical contract:
its action/query roles, query cardinalities, and refusal declarations stay
authoritative when assembly selects a structural replacement. A separate
implementation inventory records `default`, `initialize`, or `instances`
selection, plus the core-owned RequestBoundary. A named floor is retained only
when WeakMap provenance identifies it without ambiguity; omission does not imply
that no floor was used.

Generated Markdown names its manifest producer, the
`sync-engine.concept-specification` format version, and its renderer package
version. Each parsed concept contract also carries its own format and version in
the manifest.

The concept read-back reproduces parsed signatures, member bodies, refusals,
Types, and extension sections, but excludes State. Its labels distinguish
registration checks from query cardinality checks performed during evaluated
reads. Type expressions, result declarations, and behavior prose do not become
runtime validation or executable assertions.

These are TypeScript guarantees. [Runtime validation](#runtime-validation)
defines input admission and explicit input, successful-output, and domain-error
validation. None is inferred from the generated type.

## Operational limits

The following limits matter when an application depends on ordering, failure
delivery, cancellation, persistence, restart, or boundary operation.

### Supported multi-instance topology

Several application instances may use the same durable domain state when each
instance has its own assembly, concept objects, action scheduler, gateway, and
occurrence index, and host-supplied concept implementations connect them to a
transactional store. The concept action that owns a state decision must perform
its uniqueness, capacity, and durable domain-operation idempotency checks in one
storage transaction. Storage constraints or equivalent storage coordination,
not action queues or correlation ids, decide cross-instance conflicts.

Reactions and occurrence matching remain local to the assembly that observed
the action. The gateway emits operational events without owning another log. An
idempotent concept action may therefore return one stable persisted result
when retried while its surrounding reaction executes once for every successful
action occurrence.

This topology does not provide:

- exactly-once action or reaction execution;
- a distributed reaction scheduler;
- occurrence replay or reaction resumption after restart;
- rollback across actions in a reaction chain;
- cross-process serialization without application storage coordination; or
- deduplication by correlation id.

Database drivers, transactions, constraints, locks, migrations, domain
operation identifiers, and recovery policy remain application and host
responsibilities.

### Execution and resource bounds

Automatic log retention bounds settled-flow inspection, and `ExecutionLimits`
provides the engine-owned production budget. Row limits stop engine-owned
expansion during reaction matching, where evaluation, direct reads, and former
evaluation. A query implementation still owns the memory needed to construct its
answer.
These limits do not replace host limits for connections, request rate, DDoS
protection, exporter queues, or autoscaling.

`beginDrain()` on an assembly rejects its new roots immediately and resolves
when accepted causal flows become idle. A gateway first rejects new public
gateway roots, lets those accepted roots cross application admission, then
drains the downstream assembly and waits for both layers. Do not expose the
downstream invoker as a second public admission path while gateway shutdown is
in progress. `whenIdle()` observes the same ordered gateway/application work
without changing admission. Caller timeout and abort remove a pending wait but
never release active-flow accounting. The host still owns the listener, OS
signals, hard shutdown deadline, floor and custom log-sink resource closure, and
process exit.

A direct call through `Assembly.concepts`, and direct `Assembly.form(...)`
evaluation, is an assembly root: it participates in active-root limits, idle
observation, row limits, and drain admission. A rejected direct action resolves
to `{ error: "UNAVAILABLE" }` before an action occurrence is recorded; a
rejected direct query or former evaluation rejects. Pending-request limits apply
only to boundary invocations because direct roots do not create request waits.

### Ordering and state-read timing

An assembly sorts the authored composition's reactions by name before
registering them, then registers the standard fault and refusal reactions. It
evaluates reactions for one trigger record sequentially. Sibling paths carry no
priority and do not form a join; each path advances when its own preceding ask
returns. Applications must not use evaluation order as a priority mechanism.
Use [`.afterFlowSettles()`](#deferred-triggers-and-settlement-frontiers) to
observe state after ordinary work already accepted in the same causal flow has
drained. It does not order consequences prepared at the same settlement
frontier.

Action bodies run one at a time per concept instance within one engine, in
arrival order. The queue awaits native promises and structural thenables as
described under [Execution and concurrency](#execution-and-concurrency). Sharing
one raw instance between engines does not share a queue or query cache. This is
an in-process guarantee. A concept's implementation and storage must supply any
atomicity or coordination required across processes. A reaction consequence
chain commits each action independently. Earlier actions remain committed when a
later action refuses or faults.
The runtime provides no retry deduplication or exactly-once guarantee. A retry
may repeat a completed action or overlap work that continued after timeout.

Queries and read evaluation do not enter the action queue. A query can overlap
an asynchronous action body or another query and does not receive a
transactional snapshot of concept state. Query implementations must avoid side
effects; concept storage must provide any isolation required between reads and
writes.

`earlier` reads matching action records whose invocation position precedes the
trigger in the same flow. Ordinary query reads instead read concept state when
the reaction runs. A later reaction may therefore observe state changed by an
earlier cascade; the runtime provides no as-of-trigger snapshot.

If two reactions answer the same outside request, the boundary accepts the
first answer and refuses the next with `NOT_PENDING`. Keep race-sensitive
decisions in concept actions and treat all matching answer paths as live.

### Failures between action asks

Action faults and former-evaluation faults while forming a consequence have an
action ask to mark. The engine records the fault, and the standard boundary
reaction can try to answer an unanswered root request with `INTERNAL_ERROR`.
If the request already has an answer, the boundary refuses the second answer
with `NOT_PENDING`; the client keeps the first answer.

The interpreter can instead fail between asks: while matching a trigger;
evaluating a query, view, computation, custom operation, or closure; forming or
dispatching consequence input; matching consequence output; or applying a
result transform. The runtime appends a non-consuming `reaction-failure` entry
with the reaction, flow, trigger ids, stage, validated exception class, and,
for a consequence, its action and action id when available. The stages are
`trigger`, `where`, `consequence-input`, `consequence-dispatch`,
`consequence-output`, and `result-transform`. Exception messages, stacks,
causes, and attached fields are not retained in that automatic evidence.
When `rawFaultReporter` is configured, the reporter separately receives the
original `unknown` value for action and interpreter faults. Reporter throws and
rejected returned promise-like values are isolated from runtime settlement.

The failed evaluation stops without creating a fault occurrence. A trigger or
`where` failure happens before a firing and does not consume its triggers, so
later records in a multi-trigger flow may make the reaction eligible again. A
consequence-stage failure can happen after actions were already asked; its
firing keeps that consumption and provenance, and earlier effects are not
rolled back. Once the root flow becomes quiescent, the boundary keeps any answer
already delivered. If the request is still pending, it settles immediately with
opaque `INTERNAL_ERROR`. This decision uses transient active-flow state before
retention is applied; it does not depend on a retained log window. A fault-free
coverage hole still waits for its invocation deadline and returns `TIMED_OUT`.
Concepts should represent expected rejection with registered refusals and
explicit policy alternatives.

Invocation and outcome sink failures do not enter this interpreter-failure path.
A firing-append failure during consequence dispatch is handled as a
`consequence-dispatch` interpreter failure if the engine can append the resulting
reaction-failure evidence. [Logs, concept implementations, and
restart](#logs-concept-implementations-and-restart) defines its ordering and state
consequences.

### Cancellation

An invocation already aborted when it begins does not reach the gateway. While
a request is pending, aborting marks it to resolve with `ABORTED`. The standard
gateway forwards the signal to the application invoker, where it also ends the
wait; the signal does not cancel, prevent, or roll back accepted concept work.
Client calls carry `signal`, `timeoutMs`, and `correlationId` in their optional
second argument. The local client forwards those values to the invoker. Other
transports define how they apply the options.

The default invocation timeout is 30 seconds without a profile and the
profile's maximum request duration with one; `InvokeOptions.timeoutMs` selects a
validated duration no greater than that maximum, and expiry resolves with
`TIMED_OUT`. Timeout and abort end the pending wait but do not themselves record a
`RequestBoundary.respond` occurrence, so recorded application work may remain
unanswered. Continued work can later ask `respond`; after pending state is gone,
that ask is recorded and refuses with `NOT_PENDING`. If an answer was accepted
first, it remains authoritative. The
invoker allows its causal dispatch to finish only until the original deadline
or a later abort, then returns that answer even if unrelated sibling work is
still running.

Gateway and application invokers each apply `timeoutMs` as their own duration
when their layer begins waiting. The option is not an absolute deadline shared
across every layer. Routing or admission time can therefore precede a newly
started application timeout, and total gateway call time can exceed one stated
duration.

### Logs, concept implementations, and restart

Concept state is separate from the assembly's occurrence evidence. Every engine
owns a process-local occurrence index that folds invocation, outcome, fault,
firing, reaction-failure, and integrity-failure entries for matching and
inspection. The package exposes no interface for replacing the index. An
assembly configured with a window may evict indexed entries and does not promise
to retain every occurrence forever.

An optional application-owned `LogSink` receives each entry synchronously after
entry validation and redaction but before the internal fold. Arrays and plain
records in the entry are recursively copied and frozen. Invocation concept and
action identities are replaced by frozen name-bearing representatives, and
`Date` values are copied. Opaque leaves such as class instances, `Map`, `Set`,
and functions retain their ordinary runtime representation and
identity; the snapshot does not recursively freeze them. A sink must treat
opaque leaves as read-only sensitive values. `LogSink.append` must return
`undefined` synchronously. A throw or any other return value prevents the fold.
An invocation append failure can prevent the action body from running; an
outcome append failure can occur after the action changed concept state, and the
engine does not roll that state back. A sink failure while appending a deferred
firing can likewise occur after its consequence changed state. If appending the
resulting reaction failure also fails, settlement aborts and the outer action
call rejects. The engine still clears active-flow matching values and reports
quiescence; it does not roll back concept state. The sink is an audit destination;
it does not supply matching, retention, or replay. `logSink` and `retention` are
independent `AssemblyOptions` and may be used together.

Each ordinary assembly creates its own field-name redactor before entries reach
the internal index, a sink, an observer, or an inspection summary. During an
active causal flow, the interpreter privately retains original values for
execution and matching, then clears them when the outermost action settles.
Ordinary process logs omit exception messages, stacks, causes, and attached
fields. Public framework errors are likewise opaque. Assembly redaction copies
exact field names and the pattern list but retains the supplied `RegExp` objects;
callers must not mutate those expressions after constructing an assembly. There
is no setter for a process-global redaction policy.

`rawFaultReporter` is the explicit exception to that sanitized path. It receives
the original action, interpreter, or endpoint-validator thrown value together
with classified context. The reporter is privileged application code and must
be treated as a sensitive sink. Reporter failure is caught and does not replace
the action or invocation result.

Ordinary `assemble(...)` defaults to retaining the 100 most recent settled
causal flows. `RetentionPolicy` is `"keepAll" | { window: number }`; the window
must be a finite, non-negative integer. An ordinary assembly may select another
window or `"keepAll"`.
`createEngine(options?)` accepts the same `retention` and `logSink` options,
defaults retention to `"keepAll"`, and does not accept an occurrence-store
argument.
Window enforcement runs automatically only after a causal flow settles. It does
not evict an active flow, so active flows may temporarily exceed the window.
The window is ordered by latest settlement rather than flow start. Repeated
settlement moves a flow to the newest position; a new invocation under a settled
flow removes it from the settled count until the flow settles again.
`{ window: 0 }` evicts a flow after settlement; `"keepAll"` retains indexed
evidence for the engine lifetime. No public manual prune operation is available.

`FileLogSink(path)` is the supplied Node-specific sink. It appends one JSONL
audit projection per entry. The engine never reads or replays that file, and
retention never rewrites it. `FileLogSink` has no close API. A custom sink may
own resources, but the host must close those resources after drain through an
application-defined API.

An application may persist concept state while leaving occurrence logs in
memory, or vice versa. The engine does not load prior occurrence files, rebuild
concept state, resume interrupted reactions, restore pending requests, or
replay firings. Restart recovery must reconstruct state from concept-owned
storage and explicit host procedures.

### Boundary operations

Generated wire contracts do not provide runtime validation. An endpoint's
explicit validators run at the assembled invoker as described under [Runtime
validation](#runtime-validation). Host and transport obligations are listed in
[Operational limits](operations.md).
