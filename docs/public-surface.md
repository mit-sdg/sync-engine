# Public API

The package has the public package subpaths listed below. Most backend files use `language`,
`assembly`, and `boundary`; frontend files use `client`; generation scripts use
`tooling`. `advanced` marks deliberate manual construction, while `utils`
contains general support functions.

| Package path                    | Role                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `@mit-sdg/sync-engine/language` | Concepts, reactions, views, formers, and their conditions     |
| `@mit-sdg/sync-engine/assembly` | Concept registration, assemblies, and occurrence-log stores   |
| `@mit-sdg/sync-engine/boundary` | Endpoints, gateways, HTTP, and CLI adapters                   |
| `@mit-sdg/sync-engine/client`   | Local and HTTP clients over a generated contract              |
| `@mit-sdg/sync-engine/tooling`  | Assembly inspection, read-back rendering, and wire generation |
| `@mit-sdg/sync-engine/advanced` | Manual engine construction and explicit escape hatches        |
| `@mit-sdg/sync-engine/utils`    | Logging, redaction, and opaque error serialization            |

The public API test compares each inventory below with the corresponding
package barrel. An export change therefore requires an explicit reference
update.

## `language`

<!-- register:language:start -->

`Condition`, `ActionCall`, `FreeBindings`, `InputBindings`, `OutputBindings`, `QueryPromise`, `ReadLine`, `RefusedActionLine`, `RelationView`, `ReturnedActionLine`, `SlotPattern`, `Vars`, `count`, `each`, `earlier`, `form`, `former`, `is`, `no`, `reaction`, `refused`, `returned`, `view`, `vocabulary`, `when`, `where`, `whether`

<!-- register:language:end -->

Use `language` to name a design: its concepts, reactions, views, and formers.

### Vocabulary

`vocabulary({ concepts, computations })` gives plain concept classes and pure
computations their application names. A concept entry may be the class itself,
or a descriptor with `class` and any of `spec`, `purpose`, `principle`,
`queries`, `outcomes`, `refusals`, and `publicErrors`. `spec` contains the concept's
markdown specification; explicit `purpose` or `principle` fields replace the
prose parsed from it. `outcomes` names action contracts, `refusals` maps each
action's stable code to its `Error` class, and `publicErrors` maps those codes
to public boundary categories. `registerConcept(...)` and `conceptSet(...)`
derive this descriptor for the ordinary registration path.

`Vars` is the inferred variable bag used by a reaction callback.
`InputBindings`, `OutputBindings`, and `FreeBindings` distinguish the binding
partitions supplied to view and former callbacks; callback parameters normally
infer them without annotations. `RelationView` is useful when a function
accepts a policy view as an argument.

```ts
import { vocabulary } from "@mit-sdg/sync-engine/language";

export const words = vocabulary({
  concepts: {
    Drafting: {
      class: Drafting,
      spec: draftingSpec,
      refusals: { publish: { DRAFT_NOT_FOUND: DraftNotFound } },
    },
  },
  computations: {
    normalizeContent: ({ content }) => String(content).trim(),
  },
});
```

### Reactions and consequences

`reaction(callback)` declares one named reaction in a composition. The
callback returns one reaction tree. The ordinary single-path frame is:

```ts
reaction(({ source, result }) =>
  when(Source.finish({ source }).responds({ result })).then(Target.record({ source, result })),
);
```

Callable action lines state posture. A bare call watches or asks at the
requested posture; `.responds(pattern?)` states a returned occurrence;
`.refuses(pattern?)` states a refusal. Trigger input patterns may be partial,
while consequence calls must supply every required input.

Several arguments in one `then(...)` group are independent siblings. Every
sibling carries a distinct trailing `.named(label)`. A later `then(...)`
extends every current path independently. `where(...).then(action).named(label)`
qualifies one sibling without asserting that siblings are disjoint or complete.
A qualified sibling may chain one action per local `.then(actionLine)` before
its trailing label. Names opened by a local returned or refused line remain on
that branch and are available to its local and parent descendants, never to a
sibling. Once the branch is named it is terminal as a sibling member.

`returned(pattern, options?)` and `refused(pattern, options?)` watch posture
channels rather than one named action. A returned channel pattern can bind
`concept`, `action`, `input`, and the whole `result`. A refused channel pattern
can bind `concept`, `action`, `input`, the whole `refusal`, and its `message`.
The `message` binding carries the registered stable refusal code, not the
specification's human sentence. These are payload-and-provenance channels, not
wrappers around an action.

Use `{ by: "ReactionName" }` to accept only occurrences asked for by that
reaction. `except` skips named concept objects and `exceptBy` skips asking
reaction names. For example, this recovery belongs only to the refusal caused
by `TryPublish`:

```ts
reaction(({ refusal }) =>
  when(refused({ action: "publish", refusal }, { by: "TryPublish" })).then(
    Reporting.record({ refusal }),
  ),
);
```

### Reads and conditions

A concept registry may declare a query as `"one"`, `"optional"`, or `"many"`.
`QueryPromise` names their union and `QueryRegistration` describes the map for
one concept class. An undeclared query keeps the general answer contract: one
record or an array of records.

Calling a concept query with its input pattern produces a `ReadLine`. Extend
the line with `.is({ ... })` to match output slots. A fresh name opens and
binds; a name already bound by the trigger or another line tests equality; a
literal tests directly. Omitting output slots ignores them. A bare call, with
no `.is`, asks only whether a row exists.

Three forms modify a plain read:

- `no(line)` holds only when no matching row exists. Its `.is` pattern may use
  bound names and literals and opens nothing.
- `whether(line)` lets authors continue matching when the source legitimately
  answers no rows; newly opened names are blank in that binding. Authors may
  pass a present value to a later query. If the value is blank, a plain query
  finds no row and matching stops for that binding. A later query wrapped in
  `whether(...)` may receive the blank value without stopping the match.
- `line.is.not({ ... })` requires each stated slot to differ. It accepts bound
  names and literals and opens nothing.

`is` supplies the closed comparisons `lt`, `le`, `gt`, `ge`, and `among` over
values that are already bound. [Execution semantics](./semantics.md#reading-declarations-govern)
owns scheduling, promise, absence, and integrity guarantees.

`earlier(action, input, output?)` is the occurrence read used in a reaction
chain. It requires a matching action occurrence strictly before the trigger
in the same causal flow, never consumes that occurrence, and drops the case
when none matches.

`Condition` names anything accepted by a `where(...)` clause. `ReadLine` names the
uniform query-or-view line, while `SlotPattern` describes its typed `.is`
pattern.

### Views

`view(name, callback)` gives a standing policy question a human name. The
callback receives separate typed proxies for input, output, and free bindings,
then returns one `where(...)` conjunction or several as alternatives. End a
predicate view in `.holds()`. An output view defaults to `.many()` and may
state `.one()`, `.optional()`, or `.many()` explicitly. The name carries no
signature or cardinality, and local bindings do not escape.

At a use-site, call a view with one object-shaped input mapping and read it
exactly like a concept query. Predicate views are bare lines; output views bind
or test only through `.is({ ... })`. `RelationView` is the type for this
callable declaration.

`count(query, input, outputVariable)` is the aggregate allowed inside a view's
`where(...)`. It binds the number of matching rows, including `0`; a later
closed line such as `is.lt(outputVariable, limit)` can test it. The count is
taken when the view is asked and is never stored.

### Formers

`former(name, callback)` names a shaped read. The callback receives separate
typed proxies for input and free bindings. A record-rooted former promises one
answer unless it ends in `.optional()`; a selection-root former is many-valued
and rejects that modifier. The name carries no signature or cardinality. The
callback produces a record with `form({ ... })` or
`where(...conditions).form({ ... })`. A plain optional line drops the candidate
record when absent; wrapping it in `whether(...)` keeps the record and leaves
its opened names blank. The former's own promise is checked against the body at
registration and enforced when needed at run.

Entries may be bound names, nested formed values, or calls to named formers.
A named former used plainly drops the host row when it declines. Under
`whether`, the host remains and the nested former's leaves become `null`.

`each(line)` captures every row of one query or view line for production. It
may refine the selection with `.where(...)` and order it with
`.arranged(...)`, then ends in one consumer:

| Consumer           | Result for matches                | Empty selection |
| ------------------ | --------------------------------- | --------------- |
| `.form({ ... })`   | one record per row                | `[]`            |
| `.count()`         | number of rows                    | `0`             |
| `.first(value)`    | value from the first arranged row | `null`          |
| `.distinct(value)` | first-seen distinct values        | `[]`            |

`.count()` ignores ordering and therefore rejects `.arranged(...)`.
`.distinct(...)` keeps first-seen order and also rejects an explicit
arrangement. `.first(...)` uses the query's declared order unless the
selection states `.arranged(variable, "ascending" | "descending")`,
`.arranged("newest")`, or `.arranged("oldest")`.

A fold over a relation promised at most one row is rejected because its
declaration already answers how many values may be returned.

A former with inputs can serve as a fragment. Fill its object-shaped input at
the use site and pass the result to `.splicing(...)` to merge its record keys into the
host record. A plain fragment call drops the host row when the fragment
declines; `whether(fragment(...))` keeps the host and fills the merged leaves
with `null`. Registration rejects key collisions and fragments that are not
record-rooted. A fragment that answers outside its promise raises an integrity
fault.

## `assembly`

<!-- register:assembly:start -->

`Assembly`, `AssemblyOptions`, `ConceptFloor`, `ConceptImplementation`, `ConceptRegistration`, `FileStore`, `FiringRecord`, `ImplementationOverrides`, `Implementations`, `LogEntry`, `LogStore`, `MemoryStore`, `PersistingConcept`, `PublicError`, `PublicErrorCategory`, `QueryRegistration`, `RefusalRegistration`, `RegisteredConcept`, `RegisteredConceptSet`, `assemble`, `conceptFloor`, `conceptSet`, `registerConcept`

<!-- register:assembly:end -->

`assemble({ vocabulary, composition, instances? })` installs one vocabulary
and composition. It returns an `Assembly` with `concepts`, `invoker`,
`publicInterface`, and `form(fusedFormer)`. `AssemblyOptions` names its input
type.

A named former is callable with one object-shaped input mapping: the former
`"the operations room"` is fused as `roomDashboard({ room })`. Pass that
fused value to the assembly when a backend caller needs the formed answer
directly:

```ts
const dashboard = await application.form(roomDashboard({ room }));
```

The former must be included in the assembly's composition. Passing the former
definition without its input mapping is invalid; the runtime reports the valid
shape as `form(roomDashboard({ room }))`. An endpoint normally carries the same
fused value through `respond({ dashboard: roomDashboard({ room }) })`, so the
outside caller receives the formed tree.

`ConceptImplementation<Class>` describes one concrete object through the
class's public concept surface. `Implementations<typeof vocabulary>` maps every
concept name to one implementation. `ImplementationOverrides<typeof
vocabulary>` makes that map partial for test substitution after a complete
implementation set has been chosen.

`conceptFloor(vocabulary, floor)` checks a `ConceptFloor`: a name, one complete
`instances` map, the names of its shared resources, and an asynchronous
`close()` operation. A floor is a runtime substrate, not an application-policy
plugin. `registerConcept(...)` and `conceptSet(...)` provide the external
integration seats that derive vocabulary entries and complete implementation
sets while plain concept classes and exception classes remain framework-free.
The registry's query promises apply to every implementation selected for that
concept name.

`MemoryStore` and `FileStore` implement `LogStore` for occurrence records.
`LogEntry` names the store's entry union, while `FiringRecord` describes one
reaction firing. Supply a log store through the advanced `createEngine(store?)`
constructor; ordinary `assemble(...)` uses its own in-memory occurrence log.
`FileStore` appends a JSONL occurrence record.

`PersistingConcept` keeps a subject registry for application-supplied
`LogStore` instances. `bind`, `release`, and its query manage the registry;
`prune` delegates to the bound store.

For the exact persistence, eviction, and restart limits, see
[Logs, concept implementations, and restart](./consistency-and-operations.md#logs-concept-implementations-and-restart).

## `boundary`

<!-- register:boundary:start -->

`ApplicationInterface`, `CliApp`, `CliAppOptions`, `CliCommand`, `CliResult`, `CommandInput`, `EmittedFrameworkErrorCode`, `EndpointCliCommand`, `EndpointDef`, `FrameworkErrorCode`, `Gateway`, `GatewayClientError`, `GatewayOptions`, `GatewayTarget`, `HttpCredentialBinding`, `HttpFloor`, `InputContractDecl`, `InvocationResult`, `InvokeOptions`, `Invoker`, `ParseResult`, `ParsedArgs`, `command`, `createCliApp`, `createGateway`, `createHttpHandler`, `endpoint`, `fail`, `httpFloor`, `ok`, `parseArgs`, `parseFail`, `parseOk`, `receive`, `respond`

<!-- register:boundary:end -->

`endpoint(path, callback)` declares one outside request. The callback begins
with `receive(input)`, may add `.where(...)`, and continues through the same
single-path or labeled-sibling `then(...)` tree as `when`. `receive` adds the
request trigger; the endpoint adds its path and optional input contract.
Callable action lines ask concept actions, and `respond(body)` answers the caller.
`EndpointDef` and `InputContractDecl` are the corresponding declaration types.

`createGateway(options)` places standard routing, input admission, forwarding,
and refusal handling before an assembled application. `GatewayOptions`,
`Gateway`, `GatewayTarget`, and `GatewayClientError` describe that
construction; a target's `publicInterface` is the `ApplicationInterface` an
assembly exposes. `Invoker`, `InvokeOptions`, and `InvocationResult` describe
transport-independent calls. `FrameworkErrorCode` contains the stable
framework codes; `EmittedFrameworkErrorCode` is the union that a boundary can
emit.

`createHttpHandler({ gateway, basePath? })` adapts the gateway to a Fetch
handler. It accepts JSON `POST` requests beneath the base path.

`httpFloor({ origin, credential })` declares one closed cookie-credential
boundary. `HttpFloor` and `HttpCredentialBinding` name that descriptor. The
application chooses the logical credential name and input, the issuing endpoint
and its token and expiry outputs, the successful clearing endpoints, and its
public origin:

```ts
const floor = httpFloor({
  origin: "https://learning.example",
  credential: {
    name: "session",
    input: "session",
    issue: { path: "/auth/login", output: "session", expires: "expiresAt" },
    clear: ["/auth/logout", "/auth/changePassword"],
  },
});

const handler = createHttpHandler({ gateway, application, floor });
```

The fixed adapter derives protected routes from their declared credential
input. [Execution semantics](./semantics.md#boundary-gateway-and-client) owns
its request, credential, projection, and failure guarantees;
[Consistency and operations](./consistency-and-operations.md#cancellation)
owns cancellation.

The CLI construction uses `command(...)` and `createCliApp(...)`.
`CliCommand`, `EndpointCliCommand`, `CommandInput`, `CliAppOptions`, and
`CliApp` describe commands and the assembled adapter. `parseArgs(...)` splits
raw arguments into `ParsedArgs`. An endpoint command's parser returns the
`ParseResult` union; `parseOk(...)` and `parseFail(...)` construct its branches.
Command handlers return `CliResult`, commonly through `ok(...)` or
`fail(...)`.

## `client`

<!-- register:client:start -->

`Client`, `ClientError`, `ClientOptions`, `ClientRequest`, `ClientTransport`, `ContractShape`, `DomainErrorValue`, `HeadersOption`, `HttpClientOptions`, `createClient`, `createHttpClient`, `createHttpTransport`, `createLocalClient`

<!-- register:client:end -->

`createHttpClient<Contract>(options?)` is the ordinary frontend construction.
It returns `Client<Contract>`, which supports both grouped paths such as
`client.rooms.get(input)` and full-path index access. Each call resolves to the
route's success body or an `{ error, detail? }` envelope.

`HttpClientOptions` selects `baseUrl`, `fetch`, `headers`, and `credentials`.
`HeadersOption` may be a header record or a function evaluated for every call.
`createHttpTransport(...)` returns the transport alone.

`createLocalClient({ invoker })` uses the same generated contract in process.
For another transport, implement `ClientTransport` over `ClientRequest` and
pass it through `ClientOptions` to `createClient(...)`.

`ContractShape` is the path-to-input/output/error record accepted by these
builders. `ClientError` is the framework envelope, and `DomainErrorValue`
extracts the error value from a generated route envelope.

## `tooling`

<!-- register:tooling:start -->

`AppIR`, `ConceptInventoryIR`, `FormerIR`, `ObservedOccurrence`, `ReactionIR`, `ViewIR`, `WireContractsIR`, `WireEndpoint`, `WireOptions`, `WireRenderOptions`, `WireType`, `floorReadBack`, `httpFloorReadBack`, `inspectAssembly`, `renderApp`, `renderInputContracts`, `renderReaction`, `renderWireTypes`, `wireContracts`

<!-- register:tooling:end -->

`inspectAssembly(assembly)` returns read-only design data without exposing the
interpreter: the application `AppIR`, concept inventories, input contracts,
`ObservedOccurrence` summaries, and the application's whole read-back as its
`readBack` string. `ReactionIR`, `ViewIR`, `FormerIR`, and `ConceptInventoryIR`
name the main pieces.

`renderApp(ir)` renders the assembly's read-back. `renderReaction(reaction)`
renders one exported reaction. A view that no reaction or
former reads does not appear in the rendering.
`wireContracts(app, options)` derives `WireContractsIR`; `renderWireTypes(...)`
prints its TypeScript contract. `WireOptions`, `WireEndpoint`, and `WireType`
describe the derivation. `WireRenderOptions` configures the generated module:
`moduleName` names its exported contract, `vocabulary: { from, export }` points
to the canonical vocabulary for type-only leaf references, and `strictLeaves`
rejects generation when a leaf has no such reference instead of falling back
to `Json`. `appWideErrorName` gives an appended contract its own error alias;
`preamble: false` reuses the first contract's imports and type helpers.
`renderInputContracts(...)` prints admitted input contracts for inspection and
tests.

`floorReadBack(...)` names the selected concept implementations and shared
resources, then appends the HTTP floor read-back. `httpFloorReadBack(application,
floor)` validates the descriptor against the
assembly and prints its public origin, credential binding, protected-route
count, issuing fields, and clearing endpoints. Neither form adds transport
details to the assembled read-back.

The package command reads `generated.config.ts`, assembles the application,
and renders, checks, or pins the assembled read-back and wire contract in
`generated/`. The application provides the descriptor; the command handles
inspection and file updates. A
descriptor with an HTTP floor emits the logical contract named by `wireName`
and the projected HTTP contract named by `httpWireName` or `${wireName}Http`
in that one wire module.
The [application-boundary guide](./guide/application-boundary.md#generate-the-wire-contract)
shows the complete path.

## `advanced`

<!-- register:advanced:start -->

`Engine`, `EngineObserver`, `LogEvent`, `Refuse`, `Requesting`, `createEngine`, `compute`, `custom`, `faulted`, `refusalFunnel`

<!-- register:advanced:end -->

This public subpath crosses the ordinary application boundary. `createEngine(store?)`
constructs the interpreter directly. `Engine` can instrument concepts,
register authored reactions or `ReactionIR`, export or render the application,
observe the log, and evaluate formers. The optional store receives
occurrence-log entries.
`Requesting` is the request/response boundary concept. It accepts one response
for a pending request and leaves a timed-out or aborted request unanswered.
`refusalFunnel` is the standard reaction pack that carries registered concept
refusals to it. `Refuse` is the low-level refusal error.

`EngineObserver` receives `LogEvent` action observations. `compute(...)` runs
a named vocabulary computation. `custom(fn, inputs, outputs)` runs an opaque
operation with an explicit variable footprint when a named computation cannot
express the work.

`faulted(pattern, options?)` watches faults from concept implementations and
other runtime code. Its payload key is `fault`; the shared channel keys are
`concept`, `action`, and `input`.
`{ by: "ReactionName" }` pins provenance exactly as it does for `returned` and
`refused`. A fault is not a concept refusal: the interrupted ask remains
unanswered. The delivery limits are documented under
[Failures between action asks](./consistency-and-operations.md#failures-between-action-asks).

## `utils`

<!-- register:utils:start -->

`LogLevel`, `Logger`, `RedactionPolicy`, `UNIVERSAL_SENSITIVE_PATTERNS`, `configureRedaction`, `logger`, `redact`, `serializeError`

<!-- register:utils:end -->

`logger` is the package logger. `Logger` and `LogLevel` describe its public API.
`serializeError(...)` returns only an `Error` class name, or
`NonErrorThrown` for another thrown value.

`configureRedaction(policy)` sets the process redaction policy. `redact(value)`
returns a copy that replaces values whose field names match `RedactionPolicy`
or `UNIVERSAL_SENSITIVE_PATTERNS`. The exact storage and redaction guarantees
live under [Logs, concept implementations, and restart](./consistency-and-operations.md#logs-concept-implementations-and-restart).
