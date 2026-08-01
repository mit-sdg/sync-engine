# Public API

This reference lists every supported core package subpath and export in the
current stable 1.x release. There is no root export and no supported deep import.
The export registers are exact; compact signatures and tables summarize the
principal call shapes and do not replace the generated TypeScript declarations.

The independently published HTTP companion has its own [public API reference](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md).

The [support policy](../SUPPORT.md) defines stable SemVer compatibility,
generated-assembly compatibility, and format-version rules. The
[security policy](../SECURITY.md) defines the supported security-fix window.

Most backend files use `language`, `assembly`, and `boundary`; frontend files
use `client`; generation scripts use `tooling`. `advanced` marks deliberate
manual construction and explicit escape hatches.

| Package path                                 | Role                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| [`@mit-sdg/sync-engine/language`](#language) | Concepts, reactions, views, formers, and their conditions     |
| [`@mit-sdg/sync-engine/assembly`](#assembly) | Concept registration, assemblies, retention, and audit sinks  |
| [`@mit-sdg/sync-engine/boundary`](#boundary) | Endpoints, invocation, gateways, and transport binding        |
| [`@mit-sdg/sync-engine/client`](#client)     | Local and custom clients over a generated contract            |
| [`@mit-sdg/sync-engine/tooling`](#tooling)   | Assembly inspection, read-back rendering, and wire generation |
| [`@mit-sdg/sync-engine/advanced`](#advanced) | Manual engine construction and explicit escape hatches        |

| Task                                      | Primary APIs                                                |
| ----------------------------------------- | ----------------------------------------------------------- |
| Declare reactions and current-state reads | `reaction`, `when`, `view`, `former`, `where`, `each`       |
| Register and install concepts             | `registerConcept`, `conceptSet`, `assemble`                 |
| Expose application routes                 | `endpoint`, `receive`, `respond`, `createGateway`           |
| Call generated routes                     | `createLocalClient`, `createClient`, or a transport package |
| Inspect or generate contracts             | `inspectAssembly`, `applicationManifest`, `renderWireTypes` |
| Construct a manual local engine           | `createEngine` from `advanced`                              |

The public API test compares each inventory below with the corresponding
package barrel. An export change therefore requires an explicit reference
update.

## `language`

<!-- register:language:start -->

`Condition`, `Former`, `QueryPromise`, `ReadLine`, `RelationView`, `count`, `compute`, `each`, `earlier`, `form`, `former`, `is`, `no`, `reaction`, `refused`, `returned`, `view`, `vocabulary`, `when`, `where`, `whether`

<!-- register:language:end -->

`language` declares designs; it does not execute them. These are the primary
call shapes:

| API                    | Compact signature                                                            |
| ---------------------- | ---------------------------------------------------------------------------- |
| `vocabulary`           | `vocabulary({ concepts, computations? })`                                    |
| `reaction`             | `reaction(vars => when(trigger).where(...conditions).then(...consequences))` |
| `returned` / `refused` | `(pattern?, { by?, except?, exceptBy? }?)`                                   |
| `where`                | `where(...conditions)`                                                       |
| `no` / `whether`       | `(readLine)`                                                                 |
| `earlier`              | `earlier(action, input, output?)`                                            |
| `view`                 | `view(name, (input, output, free) => where(...))`                            |
| `count`                | `count(query, input, outputVariable)`                                        |
| `compute`              | `compute(namedComputation, input, output)`                                   |
| `former`               | `former(name, (input, free) => form(...) \| where(...).form(...))`           |
| `form`                 | `form({ ...shape })`                                                         |
| `each`                 | `each(readLine).where(...).arranged(...).form(...)` or a fold                |
| `is`                   | `is.lt`, `is.le`, `is.gt`, `is.ge`, and `is.among` comparisons               |

| Consumer           | Result                                                       | Empty selection |
| ------------------ | ------------------------------------------------------------ | --------------- |
| `.form({ ... })`   | One record per row                                           | `[]`            |
| `.count()`         | Number of rows                                               | `0`             |
| `.first(value)`    | Value from the first selected row after optional arrangement | `null`          |
| `.distinct(value)` | First-seen distinct values                                   | `[]`            |

Concept entries accepted by `vocabulary` are either a concept class or
`{ class, spec?, purpose?, principle?, queries?, outcomes?, refusals? }`.
`QueryPromise` is `"one" | "optional" | "many"`.
When a query promise is available as a TypeScript literal, the vocabulary types
link `"one"` to a record return and `"optional"` or `"many"` to an array of
records. Runtime evaluation checks the same container and cardinality contract.
`Condition`, `ReadLine`, `RelationView`, and `Former` name reusable declaration
shapes. View and former builders receive callable binding selectors: one name,
as in `inputs("name")`, returns one logic variable; several names, as in
`bindings("first", "second")`, return a keyed object. Literal selectors let
TypeScript infer view inputs, view outputs, former inputs, and complete former
results from the concept signatures and formed tree. Authors may instead
annotate an exported declaration with `RelationView<Input, Output>` or
`Former<Input, Result>`; known inferred fields must agree with that contract.

For worked examples, see the [reactions guide](./guide/reactions.md) and
[views and formers guide](./guide/views-and-formers.md). The normative matching,
cardinality, sibling, absence, and production rules live in [Execution
semantics](./semantics.md#reactions).

## `assembly`

<!-- register:assembly:start -->

`ActionRefusal`, `Assembly`, `AssemblyOptions`, `ConceptFloor`, `ConceptImplementation`, `ConceptRegistration`, `ExecutionLimits`, `FileLogSink`, `FiringRecord`, `ImplementationOverrides`, `Implementations`, `IntegrityFailureRecord`, `LogEntry`, `LogSink`, `Logging`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `QueryCacheMode`, `ReactionFailureRecord`, `RawFaultReport`, `RawFaultReporter`, `RegisteredConcept`, `RegisteredConceptSet`, `RetentionPolicy`, `assemble`, `conceptFloor`, `conceptSet`, `registerConcept`

<!-- register:assembly:end -->

### Assembly construction

```ts
assemble(options: AssemblyOptions): Assembly
```

| `AssemblyOptions` field | Required    | Default / effect                                                                                             |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------------ |
| `vocabulary`            | yes         | Declared application vocabulary                                                                              |
| `composition`           | yes         | Reactions, endpoints, views, and formers to register                                                         |
| `initialize`            | conditional | Constructor tuples; required when canonical classes need arguments and `instances` does not supply them      |
| `instances`             | no          | Ready implementations by concept name; each overrides `initialize`                                           |
| `logging`               | no          | `Logging.OFF`; alternatives are `TRACE` and `VERBOSE`                                                        |
| `retention`             | no          | `{ window: 100 }`; accepts any valid `{ window: number }` or `"keepAll"`                                     |
| `queryCache`            | no          | `"memoize"`; `"none"` disables query-result memoization                                                      |
| `logSink`               | no          | No external sink; `append` receives each validated, redacted entry and must return `undefined` synchronously |
| `executionLimits`       | no          | Unbounded profile; validates and enforces every `ExecutionLimits` field                                      |
| `observers`             | no          | No operational observers                                                                                     |
| `rawFaultReporter`      | no          | No privileged raw action, interpreter, or endpoint-validator failure handoff                                 |
| `redaction`             | no          | Universal sensitive-field patterns only                                                                      |

`RetentionPolicy` is `"keepAll" | { window: number }`. A retention window must
be a finite, non-negative integer. Window enforcement runs automatically only
after a causal flow settles. `{ window: 0 }` therefore allows an active flow to
complete before evicting it. The public assembly and engine surfaces expose no
manual prune operation.
Every assembly owns an internal occurrence index. `logSink` does not replace
that index, and `logSink` may be combined with any `retention` policy.

`Assembly` exposes `concepts`, `invoker`, `publicInterface`, `beginDrain()`,
`whenIdle()`, and `form(fusedFormer)`. Drain closes root admission immediately;
both lifecycle promises resolve when accepted action, query, and former work
actually settles. `form(...)` resolves to the supplied former's inferred result;
an optional record former contributes `null` to that result.
`ActionRefusal` is the direct-action refusal result.
`ConceptImplementation`, `Implementations`, and `ImplementationOverrides` name
complete or partial implementation maps. Assembled non-query actions are
asynchronous and conservatively resolve to their awaited result or an
`ActionRefusal`; underscore-prefixed queries resolve asynchronously to their
declared implementation answer.

Closures, explicit `custom` operations, `$is` object-identity patterns, raw
transforms, and whole unlowered reactions are local. Ordinary assembly rejects
every local reaction, view, and former before returning an invoker or public
route set. Manual engines under `advanced` retain those explicit escape hatches.

`OperationalEvent` is the stable discriminated union for action settlement,
interpreter and integrity failure, invocation settlement, limit breach, and
drain state. `OperationalObserver` callbacks are synchronous bounded handoff:
the engine catches throws and never awaits returned work; exporters and network
I/O belong behind a host-owned queue. Events carry no action input or output.
`OperationalResultClass` names the safe result categories.
`RawFaultReport` is the privileged discriminated union for the original
`unknown` values thrown by actions, interpreter stages, and endpoint validators.
`RawFaultReporter` failures are isolated: a throw or rejected returned
promise-like value does not change the action or invocation result. Raw values
do not enter ordinary occurrence evidence, operational events, process logs, or
public framework errors. Restrict access to this reporter as for any other
sensitive host sink.

### Registration and floors

| API               | Compact signature                                                 |
| ----------------- | ----------------------------------------------------------------- |
| `registerConcept` | `registerConcept({ class, spec, refusals?, floors? })`            |
| `conceptSet`      | `conceptSet({ ...registeredConcepts }, computations?)`            |
| `conceptFloor`    | `conceptFloor(vocabulary, { name, instances, resources, close })` |

`ConceptRegistration`, `RegisteredConcept`, `RegisteredConceptSet`, and
`ConceptFloor` name those descriptors. Floor names must be non-empty, and each
supplied floor value must be a factory function. A floor name is available
through the typed `implementations(...)` overload only when every concept
supplies it. If an incomplete floor is selected by bypassing that type
restriction, selection fails at runtime. The zero-argument `implementations()`
form is available only when every canonical class can be constructed without
required arguments; otherwise use a named floor.

The optional second `conceptSet` argument is a record of named pure computation
functions. The returned set exposes vocabulary-owned references under both
`set.computations` and `set.vocabulary.computations`; their names, inputs, and
results remain inferred from the supplied functions. Compose raw computation
records before constructing one set. Refs from separate vocabularies cannot be
combined.

`conceptFloor` validates a complete implementation map and returns the supplied
descriptor. Assembly does not install, own, or call the floor's `close()`
method. The host owns floor selection and lifecycle.

`RegisteredConcept.specification` is the machine-readable `ConceptSpec`
extracted from purpose, principle, action, query, and refusal declarations. An
optional State section is uninterpreted human notation and produces no
`ConceptSpec` field. Registration and source checking do not compare it with
class fields, floor implementations, databases, or storage. State properties
belong in principle, implementation, and backend constraint tests; future
machine conformance requires a separately designed backend-neutral descriptor.

### Occurrence index and log sinks

Every engine owns an internal `MemoryStore` occurrence index. This private
implementation is
the source for reaction matching and retained inspection; `RetentionPolicy`
governs its contents.

`LogSink.append(entry)` is the synchronous application-owned audit extension
point. The engine validates an entry and redacts engine-created mappings, calls
the sink with a structural snapshot, and only then folds the entry into the
internal index. Arrays and plain records are recursively copied and frozen.
Invocation concept and action fields become frozen, name-preserving
representatives. `Date` values are copied.
Opaque leaves such as class instances, `Map`, `Set`, and functions
retain their runtime representation and identity. The snapshot does not
recursively freeze opaque leaves. The sink must treat opaque leaves as read-only
sensitive values; structural readonly types do not make those leaves immutable.
`append` must return `undefined` synchronously. A throw or any other return
value, including a promise or structural thenable, fails the append before the
fold. An invocation append failure can prevent the action body from running. An
outcome append failure can occur after the body has changed concept state; the
engine does not roll that state back.

`FileLogSink(path)` implements `LogSink` with one append-only JSON audit
projection per entry. Concept instances and action functions are represented by
name. It never reads or replays existing lines, and retention never rewrites the
file. `FileLogSink` has no close API. A custom sink remains responsible for its
own durability, concurrency, retry, and resource lifecycle; the host closes
custom resources after drain through an application-defined API.

`LogEntry`, `FiringRecord`, `ReactionFailureRecord`, and
`IntegrityFailureRecord` name the corresponding contracts. Persistence,
eviction, redaction, sink failure, and restart limits are normative in
[Execution semantics](./semantics.md#logs-concept-implementations-and-restart).
The [persistence and restart recipe](./advanced-recipes.md#persistence-restart-and-recovery)
shows separate concept-state and occurrence files plus explicit derived-state
recovery.

## `boundary`

<!-- register:boundary:start -->

`ApplicationInterface`, `TransportBinding`, `WireProjectionFacts`, `EndpointDef`, `EndpointOptions`, `EndpointValidator`, `EndpointValidators`, `ExecutionLimits`, `FrameworkErrorCode`, `Gateway`, `GatewayOptions`, `GatewayTarget`, `InputContractDecl`, `InvocationResult`, `InvokeOptions`, `Invoker`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `ValidationResult`, `assertPortableRoutePath`, `bindTransport`, `createGateway`, `endpoint`, `receive`, `respond`, `serializeJsonValue`

<!-- register:boundary:end -->

### Endpoints

| API        | Compact signature                                                                        |
| ---------- | ---------------------------------------------------------------------------------------- |
| `endpoint` | `endpoint(path, vars => receive(input)...then(respond(body)), { input?, validators? }?)` |
| `receive`  | `receive(input?)`                                                                        |
| `respond`  | `respond(body?)`                                                                         |

`EndpointDef`, `EndpointOptions`, and `InputContractDecl` name the declaration
and optional runtime outer-shape contract. `EndpointValidator`,
`EndpointValidators`, and `ValidationResult` define schema-library-neutral
input, successful-output, and domain-error checks. The domain-error validator
receives exactly the value of the authored response's top-level `error` field.
The [application-boundary guide](./guide/application-boundary.md#receive-ask-respond)
shows the endpoint authoring path, and [Add runtime
validation](./guide/application-boundary.md#add-runtime-validation) shows the
validator call shape. [Execution semantics](./semantics.md#sibling-paths-and-endpoint-settlement)
defines settlement.

Endpoint paths must be canonical portable absolute URL pathnames. Queries,
fragments, scheme-relative paths, dot-segment normalization, malformed percent
escapes, literal spaces, and literal Unicode are rejected; the declared spelling
must survive WHATWG pathname handling unchanged. See [Correlation and route
paths](./semantics.md#correlation-and-route-paths). `receive(...)` cannot author
the framework-owned `path` or `requestId` fields. `respond(...)` cannot author
`requestId` or `errorKind`.

Applications supply endpoint validators explicitly. Generated types and concept
State notation have no runtime schema semantics.

| `InputContractDecl` field | Default / effect                                 |
| ------------------------- | ------------------------------------------------ |
| `required`                | `[]`; missing listed keys return `INVALID_INPUT` |
| `defaults`                | `{}`; fills listed keys only when absent         |

Without an explicit contract, assembly derives required keys from portable
endpoint IR: it intersects the non-reserved keys mentioned by every exported
`receive(...)` pattern for the path. A key outside that intersection cannot be
required because at least one path alternative does not mention it. An
executable-only endpoint has no derived contract. An explicit contract is
authoritative and replaces the derived contract; it does not merge with it. At
most one endpoint declaration may supply an explicit contract for a given path.
Assembly rejects an explicit contract when omitting its optional keys cannot
match any receive alternative after declared defaults are applied.
Input validation follows shallow defaulting and precedes the application ask.
Invalid successful output is recorded as an integrity failure and returned as
opaque `INTERNAL_ERROR`. An invalid domain-error value records
`invalid-domain-error` integrity evidence and also returns opaque
`INTERNAL_ERROR`. A thrown validator fails closed and reaches
`rawFaultReporter`, when configured, as an unsanitized `endpoint-validator`
report. An input-validator throw returns `INVALID_INPUT` before the boundary ask;
output and domain-error integrity evidence retain only the `ValidatorFault`
class. A path may declare each validator at most once.

### Gateway and invocation

```ts
createGateway<Contract>(options: GatewayOptions): Gateway<Contract>
invoker.invoke(path, input, options?: InvokeOptions): Promise<InvocationResult>
```

| `GatewayOptions` field | Required | Default / effect                                         |
| ---------------------- | -------- | -------------------------------------------------------- |
| `application`          | yes      | `GatewayTarget` exposing `invoker` and `publicInterface` |
| `executionLimits`      | no       | Unbounded gateway admission and caller deadline          |
| `observers`            | no       | Drain, limit, and final public-call settlement events    |

| `InvokeOptions` field | Default / effect                                                                    |
| --------------------- | ----------------------------------------------------------------------------------- |
| `signal`              | No signal; an abort ends the wait with `ABORTED`                                    |
| `timeoutMs`           | `30_000` without `executionLimits`; otherwise `maxRequestDurationMs`                |
| `correlationId`       | The generated request id; supplied values cross gateway and application observation |

`ExecutionLimits` requires positive finite integers for active root flows,
pending requests, actions and firings per flow, rows per evaluation, and the
maximum caller deadline. Overload and drain return `UNAVAILABLE`. `Gateway`
also exposes `beginDrain()` and `whenIdle()` and includes the target assembly's
lifecycle when that target supplies it.

An explicit `timeoutMs` must be a positive finite integer. When execution limits
are configured, it must not exceed the layer's maximum request duration. An
invalid value returns `INVALID_INPUT` before work is recorded. Gateway and
application invokers apply the option as separate durations; it is not one
absolute deadline shared by both layers.

The gateway decorates the target application's `Invoker` and uses the target's
reaction engine. Observers
receive gateway limit and drain events plus exactly one `invocation-settled`
event for each public `invoke` call after the final result is known. That event uses the
requested application route and effective correlation id, includes the final
result class and applicable framework code, measures through the final
caller-visible result, and may omit `flow`. Accepted sibling work can continue
afterward; use `whenIdle()` to observe flow quiescence.

`Gateway`, `GatewayTarget`, `Invoker`, and `InvocationResult` name these
contracts. Timeout and abort stop waiting but do
not cancel forwarded application work. A fault-free unanswered endpoint reaches
`TIMED_OUT`; an unanswered flow with a recorded interpreter failure settles
promptly as opaque `INTERNAL_ERROR`. See [Failures between action
asks](./semantics.md#failures-between-action-asks) and
[Cancellation](./semantics.md#cancellation).

### Transport binding

| API                       | Compact signature / role                                    |
| ------------------------- | ----------------------------------------------------------- |
| `bindTransport`           | `bindTransport({ application, gateway }): TransportBinding` |
| `assertPortableRoutePath` | Rejects noncanonical public route spellings                 |
| `serializeJsonValue`      | Shared JSON serialization for a transport adapter           |

`bindTransport(...)` verifies that a gateway belongs to the supplied assembly
and returns only a narrowed invoker plus frozen route and logical-wire facts.
It never exposes reaction state, mutable assembly registries, or lifecycle
controls. Same-version duplicate core packages retain the existing global
identity behavior. A custom server adapter can invoke this capability without
installing any first-party transport package.

`WireProjectionFacts` is the immutable route and logical-wire input passed to a
generated projection. It remains transport-neutral; core owns strict leaf
checks, vocabulary anchoring, rendering, provenance, and atomic artifact
writes.

### Framework errors

`FrameworkErrorCode` is the stable core value object; its value union names the
core boundary and client framework failures. Transport packages may add their
own error unions, such as `HttpClientError`. Controlled admission details may
accompany an error, but exception text from an unknown failure is omitted.

| Code              | Ordinary source                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| `INVALID_INPUT`   | Invoker, gateway, or HTTP timeout option; shape, contract, or input validation |
| `NOT_FOUND`       | Unknown logical route                                                          |
| `UNAVAILABLE`     | Overload or draining admission                                                 |
| `TIMED_OUT`       | Invocation or HTTP transport wait expired                                      |
| `ABORTED`         | Invocation or client signal aborted                                            |
| `INTERNAL_ERROR`  | Application, framework, validation, or interpreter fault                       |
| `TRANSPORT_ERROR` | Forwarding, transport, or client-response validation failure                   |
| `UNKNOWN_ERROR`   | Unclassified framework envelope                                                |

## `client`

<!-- register:client:start -->

`Client`, `ClientCallOptions`, `ClientError`, `ClientOptions`, `ClientRequest`, `ClientResponseValidator`, `ClientTransport`, `ContractShape`, `DomainErrorValue`, `createClient`, `createLocalClient`

<!-- register:client:end -->

### Constructors

| API                 | Compact signature                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `createLocalClient` | `createLocalClient<Contract>({ invoker, validateResponse? }): Client<Contract>`                                            |
| `createClient`      | `createClient<Contract, TransportError = ClientError>({ transport, validateResponse? }): Client<Contract, TransportError>` |

`ClientOptions.transport` and `createLocalClient`'s `invoker` are required.
`ClientOptions.validateResponse` is an optional synchronous check of each
complete untrusted transport result. It receives `(value, { path })`. A
`{ ok: false }` result, throw, or promise-like result resolves to
`{ error: "TRANSPORT_ERROR" }`; an accepted value is returned unchanged.
`ClientTransport` and `ClientRequest` name the extension contract. Every
endpoint call accepts an optional second `ClientCallOptions` argument:

| Field           | Transport request effect                                                        |
| --------------- | ------------------------------------------------------------------------------- |
| `signal`        | Carries caller abort; cancellation behavior depends on the selected transport   |
| `timeoutMs`     | Carries a transport-local timeout; the core client does not interpret the value |
| `correlationId` | Carries a trace token when the selected transport supports correlation          |

`ClientRequest` carries the same three optional fields. None promises rollback
or cancellation of accepted server work.
A `Client<Contract>` supports grouped access such as
`client.rooms.get(input)` and indexed access such as
`client["/rooms/get"]`, followed by the input call.

`ContractShape` is the path-to-input/output/error record accepted by every
constructor. `ClientError` is `{ error: FrameworkErrorCode; detail?:
string }`; `DomainErrorValue` extracts a generated route's domain error value.
Calls resolve handled transport failures as error envelopes. JSON projection
and error delivery are normative in
[Execution semantics](./semantics.md#boundary-gateway-and-client).

`createClient` replaces a nullish input with `{}`. A transport throw or rejected
promise resolves as `{ error: "TRANSPORT_ERROR" }`. Transport-specific failures
are owned by the selected transport package. Pass their error type as the
second generic, for example
`createClient<Wire, HttpClientError>({ transport: createHttpTransport() })`;
`createHttpClient<Wire>(...)` composes the maintained HTTP transport directly.
Neither form weakens generated endpoint input and output types.

## `tooling`

<!-- register:tooling:start -->

`AppIR`, `ApplicationDiagnostic`, `ApplicationManifestV3`, `ConceptInventoryIR`, `DiagnosticCode`, `DiagnosticSeverity`, `FormerIR`, `GeneratedApplication`, `ManifestEndpointV3`, `ObservedOccurrence`, `PlannedWireProjection`, `ProjectionProvenance`, `ProjectionRenderOptions`, `ReactionIR`, `ViewIR`, `WireContractsIR`, `WireEndpoint`, `WireOptions`, `WireProjection`, `WireProjectionResult`, `WireRenderOptions`, `WireType`, `applicationDiagnostics`, `applicationManifest`, `diagnosticsFail`, `inspectAssembly`, `renderApp`, `renderApplicationManifest`, `renderInputContracts`, `renderReaction`, `renderWireTypes`, `wireContracts`

<!-- register:tooling:end -->

### Inspection and rendering

| API                         | Compact signature                                            |
| --------------------------- | ------------------------------------------------------------ |
| `inspectAssembly`           | `inspectAssembly(assembly)`                                  |
| `renderApp`                 | `renderApp({ title, concepts, app }): string`                |
| `renderReaction`            | `renderReaction(reaction): string`                           |
| `renderInputContracts`      | `renderInputContracts(contracts): string`                    |
| `wireContracts`             | `wireContracts(app, options?: WireOptions): WireContractsIR` |
| `renderWireTypes`           | `renderWireTypes(wire, moduleName? \| options?): string`     |
| `applicationManifest`       | `applicationManifest(assembly): ApplicationManifestV3`       |
| `renderApplicationManifest` | `renderApplicationManifest(manifest): string`                |
| `applicationDiagnostics`    | `applicationDiagnostics(app, endpoints, wire)`               |
| `diagnosticsFail`           | `diagnosticsFail(diagnostics, "errors" \| "warnings"?)`      |

`AppIR`, `ReactionIR`, `ViewIR`, `FormerIR`, `ConceptInventoryIR`, and
`ObservedOccurrence` name inspected data. `ObservedOccurrence` contains the
concept, action, optional `by`, output, and outcome summary; it omits input,
action id, flow, and timestamp. Inspection reports only evidence retained by
the internal occurrence index and applies redaction again. `WireContractsIR`, `WireEndpoint`, and
`WireType` name derived wire data.
`WireEndpoint.inputAdmissionError` preserves whether framework input admission
contributed `INVALID_INPUT`, so production projection remains distinct from a
registered domain refusal using the same code.

`ApplicationManifestV3` has format `sync-engine.application-manifest`, version
`3`, and is static canonical JSON-round-trippable application data. Its
`generator` records the exact `@mit-sdg/sync-engine` package version. It
contains the application IR, concept inventories, declaration-owned
`ManifestEndpointV3` entries, input contracts, wire IR, validator-presence
flags, structured diagnostics, and `digest`. The digest covers every other
manifest field. It excludes occurrences, timestamps, other runtime state, and
uninterpreted concept State sections. State notation likewise contributes
nothing to the assembled read-back or generated wire.
`renderApplicationManifest` emits canonical JSON with ordinal record-key order
and a final newline. Named collections use stable order while authored reaction,
view-alternative, and former-node sequences retain semantics.

`ApplicationDiagnostic`, `DiagnosticCode`, and `DiagnosticSeverity` define the
machine-readable advisory surface. `diagnosticsFail` treats error diagnostics as
failures by default and can promote warnings; informational diagnostics remain
advisory.
Endpoint diagnostics trace response paths through lowered `by` provenance.
`ENDPOINT_PATH_OVERLAP` reports bounded potential overlaps such as duplicate
complete guards, an unconditional answer beside a conditional answer, or a bare
existence branch that subsumes a more specific read. It does not prove that a
conditional guard is inhabited. `MISSING_ENDPOINT_FALLBACK`
means no non-dropping total answer path was recognized; it does not imply that
an unconditional sibling would be a safe ordered fallback. Coverage analysis
leaves complementary reads unproved because siblings observe separate state snapshots. The
analysis is conservative and does not prove arbitrary view, computation,
validator, action-outcome, or concurrent-state logic.

The structural argument consumed by `renderApp` has `title: string`,
`concepts: ConceptInventoryIR[]`, and `app: AppIR`. The package does not export
a separate public name for that aggregate argument type.

| `WireOptions` field | Default                     |
| ------------------- | --------------------------- |
| `boundary.concept`  | `"RequestBoundary"`         |
| `boundary.request`  | `"request"`                 |
| `boundary.respond`  | `"respond"`                 |
| `contracts`         | No declared input contracts |
| `inventories`       | No concept inventories      |

| `WireRenderOptions` field | Default / effect                                                        |
| ------------------------- | ----------------------------------------------------------------------- |
| `moduleName`              | `"WireContracts"`                                                       |
| `vocabulary`              | No type anchor; `{ from, export }` enables signature references         |
| `strictLeaves`            | `false`; `true` requires an anchor and rejects unresolved `Json` leaves |
| `appWideErrorName`        | `"AppWideError"`                                                        |
| `preamble`                | `true`; set `false` when appending another contract to one module       |
| `sharedWires`             | `[]`; later contracts whose required helpers this preamble must emit    |

A render with `preamble: false` emits no imports or shared helper types. The
earlier render that emits the module preamble must receive every later
`preamble: false` contract in `sharedWires`; otherwise `renderWireTypes` can omit
a helper alias used by a later contract.

### Generated descriptor

The `sync-engine artifacts` command reads the default export of the
application-owned `generated.config.ts`. `GeneratedApplication` names the
descriptor type exported from `/tooling`.

| Field                 | Required | Default                                                            |
| --------------------- | -------- | ------------------------------------------------------------------ |
| `assemble`            | yes      | Function that builds the application                               |
| `title`               | yes      | Application title used to derive names                             |
| `close`               | no       | Runs after the generated assembly drains                           |
| `directory`           | no       | `new URL("./generated/", configUrl)`                               |
| `specification`       | no       | Slugged title plus `.md`                                           |
| `specificationBanner` | no       | HTML generator comment naming package version, title, and assembly |
| `wire`                | no       | `"wire.ts"`                                                        |
| `wireName`            | no       | Pascal-cased title plus `Wire`                                     |
| `wireBanner`          | no       | Exact package/version generator banner                             |
| `vocabulary.module`   | no       | `new URL("./src/concept-set.ts", configUrl)`                       |
| `vocabulary.export`   | no       | `"vocabulary"`                                                     |
| `projections`         | no       | Ordered transport-specific projections                             |

The default specification banner is
`<!-- Generated by @mit-sdg/sync-engine@<version> from the <title> assembly. Do not edit. -->`.
A custom specification banner receives a second mandatory HTML generator
comment. The default wire banner is
`// Generated by @mit-sdg/sync-engine@<version> from the <title> assembly. Do not edit.`
A custom wire banner receives a second mandatory generator line. Artifact
generation always uses the vocabulary anchor with strict leaves. Every
`WireProjection` receives frozen `WireProjectionFacts` and returns a named
`WireContractsIR`; core selects the shared preamble, rendering options, ordering,
strict-leaf checks, and provenance. A projection list can be empty or contain
multiple transport contracts in one wire module. `projections` must be an array,
and each entry must provide `project(facts)`. The logical wire name, projected
wire names, app-wide error names, `Json`, and generated vocabulary-helper names
must be distinct TypeScript identifiers. Projection provenance must contain a
nonblank package name and a valid stable SemVer version. Projector versions are
not restricted to 1.x. Artifact planning separately requires the manifest's
core generator identity to name `@mit-sdg/sync-engine` at a stable 1.x version;
neither generator nor projector provenance accepts a prerelease version. Core
evaluates projections in declaration order and rejects any projection or naming
failure before an artifact command compares or writes files. The HTTP companion's
`httpWire({ policy, name })` additionally removes cookie-consumed credential
fields for a floor. The
[application-boundary guide](./guide/application-boundary.md#generate-the-wire-contract)
shows the application-owned command path; [Generated wire](./semantics.md#generated-wire)
defines derivation guarantees.

## `advanced`

<!-- register:advanced:start -->

`Engine`, `EngineObserver`, `EngineOptions`, `LogEvent`, `Refuse`, `createEngine`, `custom`, `faulted`

<!-- register:advanced:end -->

This subpath crosses the ordinary application boundary. Prefer the ordinary
assembly APIs unless the host needs manual engine construction or an explicit
escape hatch. Despite its low-level role, `/advanced` follows the same stable
SemVer policy as every other public subpath.

| API            | Compact signature / role                         |
| -------------- | ------------------------------------------------ |
| `createEngine` | `createEngine(options?: EngineOptions): Engine`  |
| `custom`       | `custom(fn, inputs, outputs)`                    |
| `faulted`      | `faulted(pattern, { by?, except?, exceptBy? }?)` |

`Engine`, `EngineObserver`, and `LogEvent` name manual interpreter and
observation contracts. `Refuse` is the low-level refusal marker. Its `message`
becomes the refusal's `error` field and takes precedence over an `error` field in
its optional data.
`EngineOptions` accepts `retention` and `logSink`; the default retention policy
is `"keepAll"`. The engine still owns its internal occurrence index. The optional
sink receives a synchronous audit copy and must return `undefined` from each
`append` call.

A manually created engine accepts an undeclared `Refuse` code as a refusal. It
warns when an explicit refusal contract omits that code. Ordinary
`assemble(...)` is closed instead: an undeclared advanced refusal is recorded as
a fault, and an unanswered endpoint settles as opaque `INTERNAL_ERROR`. The
advanced pieces do not install the
ordinary assembly's quiescent interpreter-failure settlement policy. Standard
assembly behavior is normative under [Failures between action
asks](./semantics.md#failures-between-action-asks) and
[Cancellation](./semantics.md#cancellation).
