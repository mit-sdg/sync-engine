# Execution semantics

This page owns the execution guarantees for actions, reactions, reads, formed
results, and application boundaries. The [documentation router](./README.md)
points to the authoring guides, the [example book](./book.md) demonstrates each
construction, and the [public API](./public-surface.md) lists the exports.

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

The action then settles in one of two ways:

- **returned** — the action completed and its result was recorded;
- **refused** — the concept deliberately declined by throwing an error class
  registered for that action in the vocabulary.

A different throw is a **fault**, not a third action outcome. The engine records
the fault against the ask, leaves that ask without an outcome, and lets the
throw reach a direct caller. Failure delivery during reaction matching and at
the application boundary is covered in
[Consistency and operations](./consistency-and-operations.md#failures-between-action-asks).

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

Each returned or refused outcome, and each fault mark watched by a framework
reaction, gives each matching reaction one evaluation. A later record cannot
make a reaction reconsider an earlier one. A `where` block may produce several
bindings, so one evaluation may produce several firings. Each firing record
names the reaction, its binding, the trigger it consumed, and the asks it
produced. Once an evaluation records a firing, consumption prevents that
reaction from evaluating the trigger again; other reactions consume it
independently.

Every callable consequence receives a fresh action id, inherits the trigger's
flow, and records the asking reaction as `by`. Several members of one
`then(...)` group are independent siblings: every matching sibling asks its
action, and the group carries no priority, exclusivity, or coverage claim. A
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

The advanced `when([...])` form joins matching occurrences within one flow and
consumes the joint match. Ordinary application reactions use one trigger,
`earlier` for directional correlation, views for standing policy, and concept
guards for decisions that must run once.

## Reading: declarations govern

A `where` block is an orderless conjunction of lines. Registration derives the
evaluation schedule; the authored order is a legibility choice. Each line
reads one relation — a concept query or a view, indistinguishable at
the use-site — with its input pattern in the query or view call and an output pattern in
`.is`:

- the query or view input must be fully bound — registration rejects a line whose input
  no earlier line or trigger supplies;
- in `.is`, a **fresh name opens** and binds for later lines; a **bound name
  or literal tests** the row's value; using the same variable again tests
  equality — no equality word exists;
- an **empty `.is`** (a bare call) is an existence read: the case proceeds
  once if any row matches, and drops otherwise.

When present, the relation's promise controls how many matches a plain line
receives. A `one` relation always fills. An `optional` relation fills or drops
the case. A `many` relation continues once per distinct fill. An undeclared
query is treated as potentially many. If a concept answers outside its declared
promise, the engine reports an integrity fault that names the query.

Three words mark intent beyond plain reading, and each is flat — they apply
to a plain line, never to each other:

- **`no(line)`** holds only when no such row exists at all — never "a row
  exists that differs." Under `no`, the `.is` pattern admits only names bound by
  an earlier plain line and literals.
- **`whether(line)`** lets the case survive absence: present binds, absent
  passes the case on with the opened names blank. A blank name may shape
  output — blank leaves, empty captures. A later plain line reading it in its
  query input drops the case while it is blank; a later `whether` line passes
  the blank on.
- **`.is.not({...})`** tests that this row's value differs; it admits only
  bound names and literals, and binds nothing.

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
former reads it. `null`, a scalar, a malformed row, or a violation of a
declared cardinality raises a query fault.

How such a fault is delivered depends on where the read occurs. See
[Failures between action asks](./consistency-and-operations.md#failures-between-action-asks).

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
read-back states the declaration and the runtime integrity check. Inferred
cardinality is advisory analysis over exported IR, not a registration
requirement.

A **former** names a formed answer. Its builder receives separate input and
free binding bags. Its body matches in `where` and produces in `form`, and
production is terminal: nothing in a `where` chooses output. A record former
promises one answer unless it ends in `.optional()`. A selection-root former
is many-valued and rejects `.optional()`. The human name carries neither its
inputs nor its cardinality. The engine checks the promise when the former is
evaluated. A record's `where` cannot open a name
from a `many` source. Use `each` when the result should contain rows.

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
[Failures between action asks](./consistency-and-operations.md#failures-between-action-asks).

## Decisions that must not race

A uniqueness, capacity, first-come, or answer-once decision belongs in the
action that owns the state, not in a reaction's `where`. The exact execution,
coordination, and rollback limits live under
[Ordering and state-read timing](./consistency-and-operations.md#ordering-and-state-read-timing).

Applications must not use reaction registration order as priority or conflict
resolution. Independent reactions and sibling branches may all match. If
several branches answer one outside request, the boundary accepts one response
ask and refuses later ones with `NOT_PENDING`; the caller may receive any one
of the matching answers. See
[Consistency and operations](./consistency-and-operations.md) for the
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
An endpoint records at most one answer. An uncovered input, a dropped plain
line, or a failed `where` can leave the request unanswered. Parallel endpoint
declarations and sibling answers remain ordinary alternatives, so any matching
path may answer; `NOT_PENDING` refuses another answer after settlement.
[Cancellation](./consistency-and-operations.md#cancellation) owns what timeout
and abort do with a pending call. Disjointness and coverage belong to advisory
analysis over exported IR.

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
adapter also owns method, JSON parsing, and status mapping. See the exact
[cancellation boundary](./consistency-and-operations.md#cancellation).

An HTTP floor may bind one logical credential input to a cookie. The application
declares the credential name and input, the endpoint that issues it and the
returned token and expiry fields, the successful endpoints that clear it, and
the public origin. Registration checks those names against the assembly. Any
endpoint whose input contract requires that credential becomes protected
without another floor edit.

The fixed floor accepts JSON `POST` requests, limits the body to one mebibyte,
enforces the declared origin when an `Origin` header is present, replaces a
protected request's credential input with the cookie value, and never accepts
that value from the body. It projects concept refusal codes through their
registered public categories and keeps framework faults opaque. The issuing
endpoint's token and expiry fields become the cookie and do not enter its HTTP
response. Successful clearing endpoints and an unauthorized protected request
clear the cookie. Credential responses use `Cache-Control: no-store`.

Gateway admission validates the route and the request's outer shape. The input
must be an object and contain every required key. Admission does not validate a
present value's primitive type or nested shape; explicit `null` therefore
passes a required-key check. The concept action accepts the admitted values or
refuses them through its registered vocabulary. Any unexpected throw is the
opaque framework fault `INTERNAL_ERROR`. The generated TypeScript contract
checks callers during typecheck but adds no runtime value validator.

Cookies are `HttpOnly`, `SameSite=Strict`, and scoped to `Path=/`, with no
`Domain`. An HTTPS origin uses a `Secure` cookie whose name has the `__Host-`
prefix; production rejects a non-HTTPS origin. Deployment responsibilities are
listed under [Boundary operations](./consistency-and-operations.md#boundary-operations).

Both clients apply the same JSON projection to inputs and results. The local
client serializes and parses values before returning them, just as the HTTP
boundary does. Dates become strings, undefined object fields disappear, and a
top-level value that JSON cannot represent is rejected. An in-process client
therefore cannot observe a richer success value than an HTTP client.

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

When a generated application descriptor supplies an HTTP floor, one module
contains both contracts. The contract named by `wireName` retains the logical
application inputs, outputs, and refusal codes for a local client. A second
contract, named by `httpWireName` or `${wireName}Http`, omits the cookie-bound
input from protected routes and the consumed token and expiry fields from the
issuing route's output. Its error union carries public categories rather than
private refusal codes. Both contracts share the generated type helpers and
vocabulary anchor.

These are TypeScript guarantees. The runtime validation limit is stated under
[Boundary operations](./consistency-and-operations.md#boundary-operations).

## Advanced consistency

Most applications can stop here. The separate
[Consistency and operations](./consistency-and-operations.md) note
defines the limits around ordering, faults between action asks,
cancellation, logs, restart, state-read timing, and boundary operation. It
also states explicitly which replay and as-of guarantees the shipped runtime
does not provide.
