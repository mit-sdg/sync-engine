# Execution semantics

This page defines the observable execution contract for actions, reactions,
reads, formed results, and application boundaries in the current 1.0 alpha.
The [documentation index](./index.md) points to the authoring guides, the
[example book](./book.md) demonstrates representative constructions, and the
[Public API](./public-surface.md) lists the exports.

| Category                   | Contract                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime guarantee          | Per-instance action serialization, flow-local matching, one accepted boundary answer, and the cardinality checks stated below                   |
| Type-time guarantee        | Generated wire and client types for callers that use the generated contract                                                                     |
| Application responsibility | Value validation, domain invariants, concept-state persistence, idempotency, and cross-process coordination                                     |
| Host responsibility        | Connection and workload limits, TLS, process lifecycle, resource closure, and deployment recovery                                               |
| Not provided               | Multi-action transactions, rollback, accepted-work cancellation, replay, restart recovery, distributed serialization, or exactly-once execution |

A relation's declaration, when present, controls how a plain line reads it. The
declaration determines whether the line always supplies a row, may drop the
current match, or continues once per row. An undeclared query may answer one
record or an array and is treated as potentially many. `no`, `whether`, and
`.is.not` add explicit absence or inequality behavior. `form`, the selection
folds, and the producer's declaration control the result shape. A `then(...)`
group states independent siblings; later groups state temporal dependence.

## Actions, refusals, and faults

An action occurrence begins when the engine records its ask, before the action
body runs. The ask carries an id, the concept and action names, its input, and a
flow token: the correlation identity shared by one outside request and its
consequences. An ask made by a reaction also carries the reaction name as `by`
provenance.

The action then settles in one of two outcome postures:

- **returned** — the action completed and its result was recorded;
- **refused** — the concept deliberately declined by throwing an error class
  registered for that action or by throwing the advanced `Refuse` marker.

A registered exception must belong to that action; an exception registered only
for another action is a fault. `Refuse` always creates a refusal. When an action
has an explicit refusal contract and the `Refuse` code is absent from it, the
current implementation warns rather than turning the refusal into a fault. An
action without a refusal contract produces no such warning. Applications
should use declared refusals for stable contracts.

A different throw is a **fault**, not a third action outcome. The engine records
the fault against the ask, leaves that ask without an outcome, and lets the
throw reach a direct caller. Failure delivery during reaction matching and at
the application boundary is covered in
[Failures between action asks](#failures-between-action-asks).

For a direct call through `Assembly.concepts`, a returned action resolves to its
success value and a refusal resolves to an `ActionRefusal` mapping with an
`error` code. A registered exception refusal also carries the specification's
sentence as `detail`; a `Refuse` escape hatch may carry other data. A fault
rejects the direct call. Underscore-prefixed query calls keep their declared
return shape and do not return action refusals.

The direct caller receives a scalar action return unchanged. Occurrence
matching normalizes a non-object return to an empty successful result, so
reaction output patterns cannot bind fields from that scalar. Concept action
contracts should return object mappings when composition needs their outputs.

The operations room shows three client-visible cases:

- choosing a mitigation returns `{ mitigation }`;
- joining twice makes Gathering refuse, and the client receives
  `{ error: "ALREADY_JOINED" }`;
- a contribution rejected by host-only policy follows an explicit boundary
  branch, and the client receives `{ error: "HOST_ONLY" }`.

The last two answers share the simple client shape but not their meaning.
`ALREADY_JOINED` is a concept refusal. `HOST_ONLY` is an authored boundary
response. The client shape does not erase that distinction in the runtime.

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

Each returned or refused outcome, and each fault mark watched by a framework
reaction, gives each matching public single-trigger reaction one evaluation. A
later record cannot make that reaction reconsider an earlier trigger. Manually
registered multi-trigger IR can instead join a newly landed record with earlier
unconsumed records in the flow. A `where` block may produce several bindings,
so one evaluation may produce several firings. Each firing record
names the reaction, its binding, the trigger it consumed, and the asks it
produced. Once an evaluation records a firing, consumption prevents that
reaction from evaluating the trigger again; other reactions consume it
independently.

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

The public `when(...)` form accepts one trigger. Use `earlier` for directional
correlation, views for standing policy, and concept guards for decisions that
must run once. The package exports no public multi-occurrence join form.

## Execution and concurrency

For an instrumented action, the engine performs these steps in order:

1. Append the invocation occurrence.
2. Reserve the action's position on the concept instance's serial line.
3. Evaluate reactions that watch the requested posture.
4. Run the action body when its reserved position reaches the front.
5. Append its returned/refused outcome or fault.
6. Evaluate reactions for that landed record.
7. Notify observers after the action settles.
8. Mark the root flow settled when no active action in the flow remains, then
   apply automatic window retention.

Requested-posture reactions run after the invocation is recorded and before the
ordinary action body is released. Same-concept requested consequences use an
internal reservation release to make progress without changing body-arrival
order.

One action body runs at a time per raw concept instance within one engine. An
`async` method returns a native `Promise`, which the queue awaits. An arbitrary
thenable, including a Promise from another JavaScript realm, is not covered by
that wait. Supplying one raw instance to several engines creates separate
queues and query caches and does not serialize those engines. Different concept
instances and separate root flows can overlap.
Reactions for one landed occurrence are currently evaluated sequentially, but
applications must not use that order as semantic priority. No engine-wide lock
serializes all concepts or all flows, and the guarantee does not extend across
processes.

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

Registration rejects a fresh name under a denial, an opened name that no later
line or consequence reads ("omit the key instead"), and a cycle between
views. It also generates a read-back for every reaction. The read-back identifies
paths, stages, opened and tested names, fan-out, and dropped cases.
`inspectAssembly(assemble(...)).readBack` returns the application's complete
read-back as one string.
[The example book](./book.md) quotes these read-backs entry by entry.

## Queries

A concept registry may declare each query's promise as `"one"`, `"optional"`,
or `"many"`. A `one` query returns one record. An `optional` query returns an
array containing zero or one record. A `many` query returns an array of
records. An undeclared query may return one record or an array of records;
because it makes no narrower promise, authoring treats it as potentially many.
The engine attaches the registry's promises to whichever implementation the
selected floor supplies and checks every answer when a reaction, view, or
former reads it. `null`, a scalar, an array row that is null, scalar, or another
array, or a violation of declared cardinality raises a query fault. Class
instances and other non-null, non-array objects pass this container check. This
is not row-schema validation. A record missing a field named in `.is` does not
match that pattern.

Queries are memoized by concept instance and argument between invalidation
points. Instrumented actions invalidate all query caches before and after their
bodies, and an assembled outside invocation invalidates caches before dispatch.
A rejected native `Promise` from the same JavaScript realm is removed from the
cache. Arbitrary thenables are cached as ordinary values. Direct state mutation
or an external database change that bypasses an instrumented action can remain
hidden until the next invalidation; a query call is not guaranteed to execute
its implementation on every read.

Read equality and literal action-pattern equality are structural for arrays and
plain records, timestamp-based for `Date`, and identity-based for maps, sets,
class instances, and other objects. Reusing an already bound variable in an
action pattern uses strict identity/value comparison instead. Many-row read
matching retains the first structurally distinct fill. Former `.distinct(...)`
uses JavaScript `Set` semantics and skips `undefined`. `.first(...)` uses the
first selected row after optional arrangement. `arranged("newest")` reverses
source order; it does not inspect a timestamp field.

How such a fault is delivered depends on where the read occurs. See
[Failures between action asks](#failures-between-action-asks).

## Views and formers

A **view** names a match. Its builder receives separate input, output, and free
binding bags. A predicate view ends in `.holds()`. A view with outputs defaults
to `.many()` and may instead declare `.one()` or `.optional()`. Its human name
carries no signature or cardinality. At a use-site a view takes one
object-shaped input mapping and is read exactly like a concept query. Its local
bindings do not escape. Stacked `where` blocks are alternatives; any matching
block can supply a result.

The engine checks a concept query's declared promise whenever it reads the
query and checks a view's declared promise whenever it reads the view. The
read-back states the declaration and the runtime integrity check. The current
package does not expose inferred-cardinality analysis over exported IR.

A **former** names a formed answer. Its builder receives separate input and
free binding bags. Its body matches in `where` and produces in `form`, and
production is terminal: nothing in a `where` chooses output. A record former
promises one answer unless it ends in `.optional()`. A selection-root former
always produces one result whose shape is determined by `.form`, `.count`,
`.first`, or `.distinct`; it cannot end in `.optional()` because an empty
selection already has a defined result. The human name carries neither inputs
nor cardinality. The engine checks the promise when the former is evaluated. A
record's `where` cannot open a name from a `many` source. Use `each` when the
result should contain rows.

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

Record entries may read named formers directly, plainly or under `whether`,
so absence is declared once at the source and every reader chooses how to
handle it. The engine evaluates a former when asked; it does not store the
formed result.

If a former faults while forming a reaction consequence, that consequence ask
is recorded with the fault and remains unanswered. Calling a former directly
has no action ask to mark, so the evaluation rejects instead. The operational
delivery boundary is described under
[Failures between action asks](#failures-between-action-asks).

## Decisions that must not race

A uniqueness, capacity, first-come, or answer-once decision belongs in the
action that owns the state, not in a reaction's `where`. The exact execution,
coordination, and rollback limits live under
[Ordering and state-read timing](#ordering-and-state-read-timing).

Applications must not use reaction registration order as priority or conflict
resolution. Independent reactions and sibling branches may all match. If
several branches answer one outside request, the boundary accepts one response
ask and refuses later ones with `NOT_PENDING`; the caller may receive any one
of the matching answers. See
[Operational limits](#operational-limits) for the
ordering and state-read boundary.

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
overrides that wait. Public endpoints should provide explicit coverage or
fallback branches rather than use timeout as an authored outcome.
[Cancellation](#cancellation) owns what timeout and abort do with a pending
call. The current package does not analyze or enforce branch disjointness or
endpoint coverage.

## Boundary, gateway, and client

The [application-boundary guide](./guide/application-boundary.md) owns the
authoring path from assembly through the fixed gateway and generated client.
Semantically, `assemble` gives an application its own boundary and occurrence
log. The log records what happened in that assembly; it is not concept state.
`createGateway` builds a second, fixed standard application in front of it,
with separate routing, admission, forwarding, boundary, and log. The gateway
and application share a correlation id, not a log. The public gateway factory
accepts an application and additive composition; it does not expose a general
replacement gateway vocabulary or assembly.

The local and HTTP clients resolve to the same simple shape: the endpoint's
success JSON or an `{ error, detail? }` envelope. The invoker that waits for the
boundary answer keeps domain errors and framework errors distinct. The HTTP
adapter also owns method, JSON parsing, a one-mebibyte request-body limit, and
status mapping; framework failures mapped to 5xx responses omit diagnostic
detail. Client, invocation, and CLI adapters also omit exception text when an
unknown thrown value becomes a framework error. A top-level `error` field in an
authored response denotes a domain failure, so a successful endpoint result
cannot use `error` as an ordinary top-level data field. See the exact
[cancellation boundary](#cancellation).

An opt-in `ExecutionLimits` profile bounds active root flows, pending requests,
actions and firings per flow, evaluation rows, and caller deadlines. Profile
values and explicit deadlines are positive finite integers. Work rejected for
overload or drain returns `UNAVAILABLE` and creates no root action occurrence.
An accepted flow that exceeds an action, firing, or row budget records integrity
evidence and follows interpreter-failure settlement as opaque `INTERNAL_ERROR`.

An HTTP floor may bind one logical credential input to a cookie. The application
declares the credential name and input, the endpoint that issues it and the
returned token and expiry fields, the successful endpoints that clear it, and
the public origin. Registration checks those names against the assembly. Any
endpoint whose input contract requires that credential becomes protected
without another floor edit.

The fixed floor accepts JSON `POST` requests, enforces the declared origin when
an `Origin` header is present, replaces a protected request's credential input
with the cookie value, and never accepts that value from the body. It projects
concept refusal codes through their registered public categories and keeps
framework faults opaque. The issuing endpoint's token and expiry fields become
the cookie and do not enter its HTTP response. Successful clearing endpoints
and an unauthorized protected request clear the cookie. Responses that issue
or clear the cookie use `Cache-Control: no-store`. The floor is a same-origin boundary: it does not
answer CORS preflights or emit CORS headers.

**Runtime validation boundary.** Gateway admission and the assembled invoker
validate the route and request's outer shape. The input must be a non-null,
non-array object and contain every required own key. Extra keys remain. Defaults
are shallow and apply only when a key is absent; a present value is never
overwritten. An endpoint may additionally attach application-supplied input and
successful-output validators. The input validator sees the admitted value after
defaults and runs before the application boundary ask is recorded. Invalid
input returns `INVALID_INPUT`. The output validator runs before a successful
result leaves the invoker. Invalid output records integrity evidence and becomes
opaque `INTERNAL_ERROR`; domain and framework failures are not output-validated.

Without an input validator, primitive types and nested shapes are not checked,
so explicit `null` and direct-invocation `undefined` pass required-key presence.
JSON transport removes `undefined` object fields before admission. Validators
inspect values but do not transform them, and thrown validator failures fail
closed. The generated TypeScript contract remains a static caller check rather
than runtime validation, and no schema is inferred from concept specifications.

Absent an explicit endpoint input contract, assembly derives required keys from
portable endpoint IR as the intersection of non-reserved keys mentioned by
every exported `receive(...)` pattern for that path. An executable-only endpoint
has no derived contract. An explicit contract replaces a derived contract, and
only one endpoint declaration may supply an explicit contract for a path.

Cookies are `HttpOnly`, `SameSite=Strict`, and scoped to `Path=/`, with no
`Domain`. An HTTPS origin uses a `Secure` cookie whose name has the `__Host-`
prefix; production rejects a non-HTTPS origin. Deployment responsibilities are
listed under [Boundary operations](#boundary-operations).

For JSON-representable values, both clients expose the same projected data. The
local client serializes and parses input and output before returning it. Dates
become strings and undefined object fields disappear. Projection failures do
not have identical error codes: the local transport normally reports
`TRANSPORT_ERROR`, while HTTP request serialization can report `NETWORK_ERROR`
and server response serialization can report `INTERNAL_ERROR`.

The generic HTTP adapter and credential HTTP floor are different protocol
surfaces. The generic adapter exposes ordinary domain failures as HTTP 400 and
maps selected framework codes to statuses. The credential floor projects
private codes to public categories, makes malformed request failures opaque,
and consumes or supplies credential fields through cookies. Do not infer one
adapter's status or detail behavior from the other.

## Generated wire

The application-boundary guide explains what the
[generated wire](./guide/application-boundary.md#generate-the-wire-contract)
derives and how to regenerate it. With a vocabulary type anchor, endpoint
leaves refer back to concept action parameters, action results, and query rows;
the response structure and absence rules come from the endpoint and its
formers. The generated module applies the same JSON projection as the clients,
including `Date` to `string`. Strict generation rejects any leaf that cannot be
traced to a signature. Without an anchor, the renderer emits a structural
contract and uses `Json` for leaves it cannot trace to a signature.

Ordinary assembly and artifact rendering, checking, and pinning reject an
executable endpoint that could not be lowered to portable reaction data. The
error names the endpoint and unsupported construction. Direct invocation,
gateway routing, HTTP, and generation therefore share the declaration-owned
route set instead of silently omitting a local-only endpoint. Executable-only
non-endpoint reactions remain listed in the generated read-back.

When a generated application descriptor supplies an HTTP floor, one module
contains both contracts. The contract named by `wireName` retains the logical
application inputs, outputs, and refusal codes for a local client. A second
contract, named by `httpWireName` or `${wireName}Http`, omits the cookie-bound
input from protected routes and the consumed token and expiry fields from the
issuing route's output. Its error union carries public categories rather than
private refusal codes. Both contracts share the generated type helpers and
vocabulary anchor.

These are TypeScript guarantees. Input admission is stated under
[Boundary, gateway, and client](#boundary-gateway-and-client); output validation
limits are stated under [Boundary operations](#boundary-operations).

## Operational limits

The following limits matter when an application depends on ordering, failure
delivery, cancellation, persistence, restart, or boundary operation.

### Execution and resource bounds

The HTTP adapter limits one request body to 1,048,576 bytes, automatic log
retention bounds settled-flow inspection, and `ExecutionLimits` provides the
engine-owned production budget. Row limits are checked at reaction matching,
where evaluation, and each consequence stage. They do not replace host limits
for connections, request rate, DDoS protection, exporter queues, or autoscaling.

`beginDrain()` on an assembly or gateway rejects new roots immediately and
resolves when accepted causal flows become idle. `whenIdle()` observes the same
actual-work state without changing admission. Caller timeout and abort remove a
pending wait but never release active-flow accounting. The host still owns the
listener, OS signals, hard shutdown deadline, floor and log-store closure, and
process exit.

### Ordering and state-read timing

An assembly sorts the authored composition's reactions by name before
registering them, then registers the standard fault and refusal reactions. It
evaluates reactions for one trigger record sequentially. Sibling paths carry no
priority and do not form a join; each path advances when its own preceding ask
returns. Applications must not use evaluation order as a priority mechanism.

Action bodies run one at a time per concept instance within one engine, in
arrival order. The queue awaits same-realm native Promises, including ordinary
`async` methods; arbitrary thenables are outside that guarantee. Sharing one raw
instance between engines does not share a queue or query cache. This is an
in-process guarantee. A concept's implementation and storage must supply any
atomicity or coordination required across processes. A reaction consequence
chain is not a database transaction:
earlier actions are not rolled back when a later action refuses or faults.
The runtime provides no retry deduplication or exactly-once guarantee. A retry
may repeat a completed action or overlap work that continued after timeout.

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

A `LogStore` failure is outside this interpreter-failure path. An invocation
append failure can prevent an action body from running. An outcome append
failure can occur after the action body has already changed concept state; the
engine does not roll that state back. Custom stores must define their own
failure, durability, and retry behavior.

### Cancellation

An invocation already aborted when it begins does not reach the gateway. While
a request is pending, aborting marks it to resolve with `ABORTED`. The standard
gateway forwards the signal to the application invoker, where it also ends the
wait; the signal does not cancel, prevent, or roll back accepted concept work.
Local and HTTP client calls accept the same signal as their optional second
argument. The default timeout is 30 seconds without a profile and the profile's
maximum request duration with one; `InvokeOptions.timeoutMs` selects a validated
duration no greater than that maximum, and expiry resolves with `TIMED_OUT`. Timeout and
abort end the pending wait but do not themselves record a
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

Concept state is separate from the assembly's occurrence log. The engine sends
append-only invocation, outcome, fault, firing, reaction-failure, and integrity-failure entries to
its `LogStore`, which folds them into indexes for matching and inspection.
Retention may evict indexed entries, so no assembly promises to retain every
occurrence forever.

The configured field-name redaction policy applies before entries reach a
store, observer, or inspection summary. During an active causal flow, the
interpreter privately retains original values for execution and matching, then
clears them when the outermost action settles. Ordinary process logs omit
exception messages, stacks, causes, and attached fields. `serializeError(...)`
provides that opaque class-only representation. `describeError(...)` instead
returns unredacted exception text and is suitable only for a caller-reviewed
diagnostic channel, not an automatic public error envelope.

Ordinary `assemble(...)` uses a process-local `MemoryStore` retaining the 100
most recent settled causal flows. Its `retention` option can select another
window, `"keepAll"`, or `"evictConsumed"`; the standard gateway has the same
independent option and default. Automatic window enforcement does not evict an
active flow, so active flows may temporarily exceed a window. Explicit
`evictFlow` calls and custom stores are outside that protection. Advanced
callers may pass a `FileStore`
or custom `LogStore` to `createEngine(store?)`. `FileStore` appends JSONL;
retention trims its in-memory fold without rewriting that file.
`PersistingConcept` manages an application-supplied store registry; it does not
bind concept state or install an assembly log store.

`"keepAll"` never prunes indexed evidence. `"evictConsumed"` removes only a
consumed suffix when `prune()` is called; flow settlement does not call that
prune operation automatically. A direct `MemoryStore()` defaults to
`"evictConsumed"`, while direct `FileStore(path)` defaults to `"keepAll"`.

An application may persist concept state while leaving occurrence logs in
memory, or vice versa. The engine does not load prior occurrence files, rebuild
concept state, resume interrupted reactions, restore pending requests, or
replay firings. JSONL occurrences are evidence, not restart recovery.

### Boundary operations

When `NODE_ENV=production`, the HTTP floor rejects a public origin that is not
HTTPS. A production host must set that environment value. The floor does not
provide TLS termination, HSTS, or trusted-proxy handling; deployment must supply
them. Generated wire contracts typecheck callers, but the gateway does not
validate returned values against generated output types or derive a runtime
validator from concept specifications.
