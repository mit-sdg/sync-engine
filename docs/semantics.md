# Execution semantics

This page defines the observable execution contract for actions, reactions,
reads, formed results, and application boundaries in the current 1.0 beta.
The [documentation index](./index.md) points to the authoring guides, the
[read construction cookbook](./book.md) demonstrates representative constructions, and the
[Public API](./public-surface.md) lists the exports.

| Category                   | Contract                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime guarantee          | Per-instance action serialization, flow-local matching, one accepted boundary answer, and the cardinality checks stated below                   |
| Type-time guarantee        | Generated wire and client types for callers that use the generated contract                                                                     |
| Application responsibility | Value validation, domain invariants, concept-state persistence, idempotency, and cross-process coordination                                     |
| Host responsibility        | Connection and workload limits, TLS, process lifecycle, resource closure, and deployment recovery                                               |
| Not provided               | Multi-action transactions, rollback, accepted-work cancellation, replay, restart recovery, distributed serialization, or exactly-once execution |

## Contract index

| Contract need                               | Section                                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------- |
| Action outcomes, refusals, and direct calls | [Actions, refusals, and faults](#actions-refusals-and-faults)                           |
| Trigger matching and consequence paths      | [Reactions](#reactions)                                                                 |
| Portable and local definitions              | [Portable and local behavior](#portable-and-local-behavior)                             |
| In-process action serialization             | [Execution and concurrency](#execution-and-concurrency)                                 |
| Read binding, absence, and cardinality      | [Reading: declarations govern](#reading-declarations-govern)                            |
| Query promises, caching, and equality       | [Queries](#queries)                                                                     |
| Views and formed results                    | [Views and formers](#views-and-formers)                                                 |
| Placement of race-sensitive decisions       | [Decisions that must not race](#decisions-that-must-not-race)                           |
| Sibling and endpoint settlement             | [Sibling paths and endpoint settlement](#sibling-paths-and-endpoint-settlement)         |
| Gateway and client result model             | [Result model and gateway](#result-model-and-gateway)                                   |
| Runtime input and output validation         | [Runtime validation](#runtime-validation)                                               |
| Production HTTP projection                  | [Production HTTP profile](#production-http-profile)                                     |
| Cookie credential binding                   | [Cookie credential floor](#cookie-credential-floor)                                     |
| Generated caller contracts                  | [Generated wire](#generated-wire)                                                       |
| Deployment and resource limits              | [Operational limits](#operational-limits)                                               |
| Interpreter failure delivery                | [Failures between action asks](#failures-between-action-asks)                           |
| Timeout and abort                           | [Cancellation](#cancellation)                                                           |
| Occurrence logs and restart                 | [Logs, concept implementations, and restart](#logs-concept-implementations-and-restart) |

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
rejects the direct call. Underscore-prefixed query calls are asynchronous roots
with their declared answer inside the promise and do not return action refusals.

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

Each requested ask, returned or refused outcome, and fault mark watched by a
framework reaction gives each matching public single-trigger reaction one
evaluation. A later record cannot make that reaction reconsider an earlier
trigger. Manually registered multi-trigger IR can instead join a newly landed
record with earlier unconsumed records in the flow. A `where` block may produce
several bindings, so one evaluation may produce several firings. Each firing record
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
Reactions for one landed occurrence are currently evaluated sequentially. Their
trigger and `where` stages all finish before any matching consequence is
dispatched, so one sibling consequence cannot change another sibling's guard.
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

Registration rejects a fresh name under a denial, an opened name that no later
line or consequence reads ("omit the key instead"), and a cycle between
views. It also generates a read-back for every reaction. The read-back identifies
paths, stages, opened and tested names, fan-out, and dropped cases.
`inspectAssembly(assemble(...)).readBack` returns the application's complete
read-back as one string.
[The read construction cookbook](./book.md) quotes these read-backs entry by entry.

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
points. Instrumented actions invalidate the acted-on concept instance's query
caches before and after their bodies, and an assembled outside invocation
invalidates all concept query caches before dispatch.
A rejected native `Promise` from the same JavaScript realm is removed from the
cache. Arbitrary thenables are cached as ordinary values. Direct state mutation
or an external database change that bypasses an instrumented action can remain
hidden until the next invalidation; a query call is not guaranteed to execute
its implementation on every read. Cache-key construction traverses at most 100
nested levels. A call with a deeper argument still executes but bypasses
memoization for that call.
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

A **view** names a match. Its builder receives separate input, output, and free
binding bags. A predicate view ends in `.holds()`. A view with outputs defaults
to `.many()` and may instead declare `.one()` or `.optional()`. Its human name
carries no signature or cardinality. At a use-site a view takes one plain
object input mapping. Every enumerable own key must be declared, and every
declared input must be present according to the JavaScript `in` operator. The
view is read exactly like a concept query. Its local bindings do not escape.
Stacked `where` blocks are alternatives; any matching block can supply a result.

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

Record entries may read named formers directly, plainly or under `whether`,
so absence is declared once at the source and every reader chooses how to
handle it. The engine evaluates a former when asked; it does not store the
formed result.

If a former faults while forming a reaction consequence, that consequence ask
is recorded with the fault and remains unanswered. Calling a former directly
has no action ask to mark, so the evaluation rejects instead. The operational
fault is a `FormerFault`: `FORMER_NONE` means a former promising one answer
produced none, and `FORMER_MANY` means a record body produced several matches.
These faults are not domain refusals. The operational delivery boundary is described under
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
[Cancellation](#cancellation) defines what timeout and abort do with a pending
call. Runtime execution does not enforce branch disjointness or endpoint
coverage. `applicationDiagnostics(...)` can warn about a limited set of
duplicate answer conditions and missing unconditional fallbacks. Those warnings
remain advisory unless a repository runs `sync-engine check --fail-on-warnings`
with an application config.

## Boundary, gateway, and client

### Result model and gateway

The [application-boundary guide](./guide/application-boundary.md) shows the
authoring path from assembly through the fixed gateway and generated client.
Semantically, `assemble` gives an application its own boundary and occurrence
log. The log records what happened in that assembly; it is not concept state.
`createGateway` decorates the application's `Invoker` with route admission,
forwarding, caller timeout and abort handling, limits, observation, and ordered
drain. It does not create a second reaction engine or occurrence log. Gateway
and application observation share the effective correlation id.

The local and HTTP clients resolve to the same simple shape: the endpoint's
success JSON or an `{ error, detail? }` envelope. The invoker that waits for the
boundary answer keeps domain errors and framework errors distinct. Every HTTP
handler owns method checks, JSON parsing, a one-mebibyte request-body limit, and
status mapping. Client and invocation adapters omit exception text when
an unknown thrown value becomes a framework error. A top-level `error` field in
an authored response denotes a domain failure, so a successful endpoint result
cannot use `error` as an ordinary top-level data field. See the exact
[cancellation boundary](#cancellation).

The maintained HTTP client resolves its base URL when the client or transport is
constructed: an explicit nonblank `baseUrl` takes precedence, followed by
`API_BASE_URL`, then `/api`. Trailing slashes are removed, while `/` means no
prefix. It sends `POST`, serializes nullish input as `{}`, supplies
`Content-Type: application/json`, and uses Fetch credentials mode `include` by
default. A header record or synchronous/asynchronous header provider is merged
after the initial content type for each request.

The HTTP client reads every response as text. An empty body becomes `{}`; a
nonempty body must parse as JSON regardless of response `Content-Type`. A
non-2xx parsed object with an `error` property is returned unchanged. Other
non-2xx responses become `BAD_STATUS`; unreadable or invalid JSON becomes
`BAD_JSON`; header-provider failure becomes `HEADER_RESOLUTION_FAILED`; and
Fetch rejection becomes `NETWORK_ERROR`. Abort before Fetch, while headers are
pending, or while a body is read becomes the core `ABORTED` result. The header
provider itself is not cancellable. Neither status handling nor parsing validates
the result against the generated TypeScript contract.

The HTTP handler accepts only `POST`. An absent `Content-Type` is accepted; a
present content type must be `application/json`, optionally followed by
parameters. Routing uses `URL.pathname`, so query parameters do not select a
different route. Empty request text becomes `{}`. Malformed, unreadable, or
larger-than-1,048,576-byte bodies become `INVALID_REQUEST`/400. The handler
checks both declared `Content-Length` and bytes read from the stream. Every
response uses JSON content type, and every successful invocation uses status 200. Serialization failure becomes opaque `INTERNAL_ERROR`/500.

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

HTTP handlers in `@mit-sdg/sync-engine-http/server` may resolve an inbound correlation id and project the effective
value in a response header. Accepted identifiers are non-empty,
control-character-free ByteStrings of at most 128 code units without leading or
trailing spaces; invalid, non-ByteString, or faulting resolver results become a fresh UUID. Response
header names are validated when a handler is constructed, and decoration cannot
reject a handled request. A handler also rejects construction unless its
standard gateway targets the supplied assembly. When direct callers omit a
correlation id, the gateway establishes a fresh UUID once at public entry and
carries it through gateway and application observation. Correlation does not
deduplicate work and is not an idempotency key.

Endpoint paths are portable absolute URL pathnames. The HTTP companion applies
the same grammar to its base paths. Their
declared spelling must survive WHATWG URL pathname handling exactly: queries,
fragments, scheme-relative paths, literal spaces or Unicode, dot-segment
normalization (including encoded dot segments), malformed percent escapes, and
other noncanonical spellings are rejected. Percent-encoded path data remains
valid when URL handling preserves it. `/` is a valid endpoint path and means no
prefix when used as a base path. A trailing base-path slash is accepted and
removed before routing, so `/api/` and `/api` declare the same base.

### Production HTTP profile

`productionHttpProfile(...)` in `@mit-sdg/sync-engine-http/server` declares a
public origin, optional base path, and policy-owned `publicErrors` map. The
handler form carrying that profile and the assembly is the production
credential-free policy. It accepts JSON `POST` requests, preserves ordinary
successful values, and projects only policy-mapped domain refusals. A private,
unknown, non-string, or dynamically open domain failure becomes
`{ error: "INTERNAL_ERROR" }`. Framework input and route failures become
`INVALID_REQUEST` and `NOT_FOUND`; every framework server failure becomes the
same opaque internal response. Diagnostic detail never crosses this policy. The
declared origin identifies public deployment and enforces the production HTTPS
check; the credential-free profile does not use an inbound `Origin` header as an
authorization or CORS decision.

### Cookie credential floor

An HTTP floor may additionally bind one logical credential input to a cookie.
The policy declares the credential name and input, the endpoint that
issues it and the returned token and expiry fields, the successful endpoints
that clear it, and the public origin. Credential and output field names must be
JavaScript-style identifiers. Issue and clear paths must be canonical portable
paths, and clear paths must be distinct. Projection validation requires every
named path to exist, at least one endpoint to require the credential input, and
every top-level alternative of the issuing endpoint's successful output to
contain the token and expiry fields. Any endpoint whose input contract requires
that credential becomes protected without another floor edit.

The fixed floor uses the production profile's request and public-error policy,
enforces the declared origin when
an `Origin` header is present, replaces a protected request's credential input
with the cookie value, and never accepts that value from the body. It projects
domain refusal codes through the same policy categories. The issuing
endpoint's token and expiry fields become the cookie and do not enter its HTTP
response. At runtime, the token must be a string and the expiry must be a valid
`Date` or a value whose string representation is date-parsable; malformed issue
output becomes opaque `INTERNAL_ERROR`. Successful clearing endpoints and an
unauthorized protected request clear the cookie. Responses that issue or clear
the cookie use `Cache-Control: no-store`. The floor performs this conditional
origin check and uses a strict same-site cookie; it does not require an `Origin`
header, compare the configured origin with `request.url`, answer CORS preflights,
or emit CORS headers.
The floor adds no implicit `/api` route alias; serving below `/api` requires an
explicit `basePath: "/api"` declaration.

### Runtime validation

Gateway admission and the assembled invoker
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
than runtime validation. Optional concept State sections are uninterpreted human
notation; they do not contribute to endpoint contracts or validators, and no
schema is inferred from concept specifications.

### Endpoint input contracts

Absent an explicit endpoint input contract, assembly derives required keys from
portable endpoint IR as the intersection of non-reserved keys mentioned by
every exported `receive(...)` pattern for that path. Local endpoint behavior is
an assembly error. An explicit contract replaces a derived contract, and only
one endpoint declaration may supply an explicit contract for a path. Assembly
rejects an explicit contract when omitting its optional keys cannot match any
receive alternative after defaults are applied.

### Production transport requirements

Production profiles and floors reject a non-HTTPS public origin when
`NODE_ENV=production`. Cookies are `HttpOnly`, `SameSite=Strict`, and scoped to `Path=/`, with no
`Domain`. An HTTPS origin uses a `Secure` cookie whose name has the `__Host-`
prefix. Deployment responsibilities are listed under [Boundary
operations](#boundary-operations).

### JSON projection

For JSON-representable values, both clients expose the same projected data. The
local client serializes and parses input and output before returning it. Dates
become strings and undefined object fields disappear. Projection failures do
not have identical error codes: the local transport normally reports
`TRANSPORT_ERROR`, while the HTTP client reports its package-owned
`HttpClientError` union and server response serialization can report
`INTERNAL_ERROR`.

The production profile exposes only policy-mapped categories and opaque protocol
failures. The credential floor adds cookie consumption and issuance to that
production policy. Both handlers apply the same request limits, JSON projection,
correlation, and public status mapping.

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

Ordinary assembly rejects every local reaction, view, or former. The error names
each local owner before a route or artifact plan is exposed. Direct invocation,
gateway routing, transport adapters, and generation therefore share one complete
portable design instead of silently omitting executable-only behavior.

When a generated application descriptor supplies ordered `projections`, one
module contains the logical contract followed by each named transport contract.
The contract named by `wireName` retains the logical application inputs, outputs,
and refusal codes for a local or custom client. The HTTP companion's
`httpWire({ policy, name })` carries public policy categories rather than private
refusal codes. With `httpFloor`, that contract also omits the cookie-bound input
from protected routes and the consumed token and expiry fields from the issuing
route's output. All contracts share generated type helpers and the vocabulary
anchor. Core records every projector package and version in generated
provenance.

Projection planning validates all names before rendering. The logical wire,
every projected wire, each app-wide error type, `Json`, and vocabulary helper
types must have distinct valid TypeScript identifiers. Provenance package names
and versions must be nonblank. Core evaluates projectors in declaration order,
and a projector or validation failure occurs before any artifact comparison or
write.

These are TypeScript guarantees. [Runtime validation](#runtime-validation)
defines input admission and explicit successful-output validation. Neither is
inferred from the generated type.

## Operational limits

The following limits matter when an application depends on ordering, failure
delivery, cancellation, persistence, restart, or boundary operation.

### Supported multi-instance topology

Several application instances may use the same durable domain state when each
instance has its own assembly, concept objects, action scheduler, gateway, and
occurrence store, and host-supplied concept implementations connect them to a
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

Every HTTP handler limits one request body to 1,048,576 bytes, automatic log
retention bounds settled-flow inspection, and `ExecutionLimits` provides the
engine-owned production budget. Row limits stop engine-owned expansion during
reaction matching, where evaluation, direct reads, and former evaluation. A
query implementation still owns the memory needed to construct its answer.
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
signals, hard shutdown deadline, floor and log-store closure, and process exit.

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

Each ordinary assembly creates its own field-name redactor before entries reach
a store, observer, or inspection summary. During an active causal flow, the
interpreter privately retains original values for execution and matching, then
clears them when the outermost action settles. Ordinary process logs omit
exception messages, stacks, causes, and attached fields. Caller-reviewed
diagnostic channels may expose exception text, but automatic public error
envelopes do not. Assembly redaction copies exact field names and the pattern
list but retains the supplied `RegExp` objects; callers must not mutate those
expressions after constructing an assembly. There is no setter for a
process-global redaction policy.

Ordinary `assemble(...)` uses a process-local `MemoryStore` retaining the 100
most recent settled causal flows. Its `retention` option can select another
window, `"keepAll"`, or `"evictConsumed"`; `logStore` installs an
application-owned store instead and is mutually exclusive with `retention`.
Assembly does not close a supplied store. The host must close any
resources behind a custom store after drain, using the store's own API.
Automatic window enforcement does not evict an active flow, so active flows may
temporarily exceed a window. Explicit
`evictFlow` calls and custom stores are outside that protection. Advanced
callers may also pass a `FileStore` or custom `LogStore` to
`createEngine(store?)`. `FileStore` composes an in-memory occurrence index with
an append-only JSONL audit sink; retention trims the index without rewriting
that file.

`"keepAll"` never prunes indexed evidence. `"evictConsumed"` removes only a
consumed suffix when `prune()` is called; flow settlement does not call that
prune operation automatically. A direct `MemoryStore()` defaults to
`"evictConsumed"`, while direct `FileStore(path)` defaults to `"keepAll"`.

An application may persist concept state while leaving occurrence logs in
memory, or vice versa. The engine does not load prior occurrence files, rebuild
concept state, resume interrupted reactions, restore pending requests, or
replay firings. JSONL occurrences are evidence, not restart recovery.

### Boundary operations

When `NODE_ENV=production`, production HTTP profiles and floors reject a public
origin that is not HTTPS. A production host must set that environment value.
The Fetch handler does not provide CORS policy, TLS termination, HSTS,
trusted-proxy handling, reverse-proxy policy, or authentication; deployment and
application code must supply them. Generated wire contracts typecheck callers,
but the gateway does not automatically validate returned values against
generated output types or derive a runtime validator from concept
specifications. An endpoint's explicit successful-output validator runs at the
assembled invoker as described under [Runtime validation](#runtime-validation).
