# Public API

This reference lists every supported package subpath and export in the current
beta. There is no root export and no supported deep import. The export
registers are exact; compact signatures and tables summarize the principal
call shapes and do not replace the generated TypeScript declarations.

The [support policy](../SUPPORT.md) defines beta compatibility, `/advanced`
churn, exact-version generated contracts, and format-version rules. The
[security policy](../SECURITY.md) defines the supported security-fix window.

Most backend files use `language`, `assembly`, and `boundary`; frontend files
use `client`; generation scripts use `tooling`. `advanced` marks deliberate
manual construction and explicit escape hatches.

| Package path                                                   | Role                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| [`@mit-sdg/sync-engine/language`](#language)                   | Concepts, reactions, views, formers, and their conditions     |
| [`@mit-sdg/sync-engine/assembly`](#assembly)                   | Concept registration, assemblies, and occurrence-log stores   |
| [`@mit-sdg/sync-engine/boundary`](#boundary)                   | Endpoints, invocation, gateways, and transport binding        |
| [`@mit-sdg/sync-engine/client`](#client)                       | Local and custom clients over a generated contract            |
| [`@mit-sdg/sync-engine-http/server`](#http-companion-package)  | First-party HTTP handler and policy                           |
| [`@mit-sdg/sync-engine-http/client`](#http-companion-package)  | First-party fetch client                                      |
| [`@mit-sdg/sync-engine-http/tooling`](#http-companion-package) | Generated HTTP wire projection                                |
| [`@mit-sdg/sync-engine/tooling`](#tooling)                     | Assembly inspection, read-back rendering, and wire generation |
| [`@mit-sdg/sync-engine/advanced`](#advanced)                   | Manual engine construction and explicit escape hatches        |

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

`Condition`, `QueryPromise`, `ReadLine`, `RelationView`, `count`, `compute`, `each`, `earlier`, `form`, `former`, `is`, `no`, `reaction`, `refused`, `returned`, `view`, `vocabulary`, `when`, `where`, `whether`

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
`Condition`, `ReadLine`, and `RelationView` name reusable declaration shapes;
bindings are inferred from their declaration callbacks.

For worked examples, see the [reactions guide](./guide/reactions.md) and
[views and formers guide](./guide/views-and-formers.md). The normative matching,
cardinality, sibling, absence, and production rules live in [Execution
semantics](./semantics.md#reactions).

## `assembly`

<!-- register:assembly:start -->

`ActionRefusal`, `Assembly`, `AssemblyOptions`, `ConceptFloor`, `ConceptImplementation`, `ConceptRegistration`, `ExecutionLimits`, `FileStore`, `FiringRecord`, `ImplementationOverrides`, `Implementations`, `IntegrityFailureRecord`, `LogEntry`, `LogStore`, `Logging`, `MemoryStore`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `ReactionFailureRecord`, `RegisteredConcept`, `RegisteredConceptSet`, `RetentionPolicy`, `assemble`, `conceptFloor`, `conceptSet`, `registerConcept`

<!-- register:assembly:end -->

### Assembly construction

```ts
assemble(options: AssemblyOptions): Assembly
```

| `AssemblyOptions` field | Required    | Default / effect                                                                                        |
| ----------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `vocabulary`            | yes         | Declared application vocabulary                                                                         |
| `composition`           | yes         | Reactions, endpoints, views, and formers to register                                                    |
| `initialize`            | conditional | Constructor tuples; required when canonical classes need arguments and `instances` does not supply them |
| `instances`             | no          | Ready implementations by concept name; each overrides `initialize`                                      |
| `logging`               | no          | `Logging.OFF`; alternatives are `TRACE` and `VERBOSE`                                                   |
| `retention`             | no          | `{ window: 100 }`; also accepts `{ window }`, `"keepAll"`, or `"evictConsumed"`                         |
| `logStore`              | no          | New `MemoryStore`; a supplied store remains caller-owned and excludes `retention`                       |
| `executionLimits`       | no          | Unbounded profile; validates and enforces every `ExecutionLimits` field                                 |
| `observers`             | no          | No operational observers                                                                                |
| `redaction`             | no          | Universal sensitive-field patterns only                                                                 |

A retention window must be a finite, non-negative integer. `{ window: 0 }`
allows an active flow to complete before automatic eviction.

`Assembly` exposes `concepts`, `invoker`, `publicInterface`, `beginDrain()`,
`whenIdle()`, and `form(fusedFormer)`. Drain closes root admission immediately;
both lifecycle promises resolve when accepted action, query, and former work
actually settles.
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

### Registration and floors

| API               | Compact signature                                                 |
| ----------------- | ----------------------------------------------------------------- |
| `registerConcept` | `registerConcept({ class, spec, refusals?, floors? })`            |
| `conceptSet`      | `conceptSet({ ...registeredConcepts })`                           |
| `conceptFloor`    | `conceptFloor(vocabulary, { name, instances, resources, close })` |

`ConceptRegistration`, `RegisteredConcept`, `RegisteredConceptSet`, and
`ConceptFloor` name those descriptors. Floor names must be non-empty, and each
supplied floor value must be a factory function. A floor name is available
through the typed `implementations(...)` overload only when every concept
supplies it. If an incomplete floor is selected by bypassing that type
restriction, selection fails at runtime. The zero-argument `implementations()`
form is available only when every canonical class can be constructed without
required arguments; otherwise use a named floor.

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

### Log stores

`MemoryStore` and `FileStore` implement `LogStore`. `MemoryStore` is the runtime
occurrence index. `FileStore` composes a fresh `MemoryStore` with a Node-specific
append-only JSONL audit sink.
`new MemoryStore()` defaults to `"evictConsumed"`. Ordinary `assemble(...)`
instead supplies `{ window: 100 }`. `new FileStore(path)` defaults to
`"keepAll"`; its synchronous append completes before the entry enters the
in-memory fold. Pruning does not rewrite its file.
Assembly never closes a supplied `LogStore`. `LogStore` itself has no
close method; the host invokes any resource-specific method exposed by its
chosen implementation after drain.
`RetentionPolicy`, `LogEntry`, `FiringRecord`, `ReactionFailureRecord`, and
`IntegrityFailureRecord` name the corresponding contracts. Persistence,
eviction, redaction, and restart limits are normative in [Execution
semantics](./semantics.md#logs-concept-implementations-and-restart).
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
input and successful-output checks. The [application-boundary guide](./guide/application-boundary.md#receive-ask-respond)
shows the endpoint authoring path, and [Add runtime
validation](./guide/application-boundary.md#add-runtime-validation) shows the
validator call shape. [Execution semantics](./semantics.md#sibling-paths-and-endpoint-settlement)
defines settlement.

Endpoint paths must begin with `/`. `receive(...)` cannot author the
framework-owned `path` or `requestId` fields. `respond(...)` cannot author
`requestId` or `errorKind`.

Endpoint validators are supplied explicitly by the application. They are not
derived from generated types or concept State notation, and the engine infers
no runtime schema from a concept specification.

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
opaque `INTERNAL_ERROR`. A path may declare each validator at most once.

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

The gateway is an `Invoker` decorator, not a second reaction engine. Observers
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

### HTTP companion package

Install the maintained companion explicitly:

```sh
bun add @mit-sdg/sync-engine@1.0.0-beta.2 @mit-sdg/sync-engine-http@1.0.0-beta.2
```

During beta the companion declares an exact core peer dependency. Its supported
entrypoints are `@mit-sdg/sync-engine-http/server`, `/client`, and `/tooling`.

| Entry point | Principal APIs                                                   |
| ----------- | ---------------------------------------------------------------- |
| `/server`   | `createHttpHandler`, `productionHttpProfile`, `httpFloor`        |
| `/client`   | `createHttpClient`, `createHttpTransport`, `HttpClientErrorCode` |
| `/tooling`  | `httpWire({ policy, name })`                                     |

`productionHttpProfile` and `httpFloor` own public domain-error categories via
their `publicErrors` policy field. Reuse the exact immutable policy value in
`createHttpHandler(...)` and `httpWire(...)`; the latter derives the browser
contract from that policy, including credential field omission for a floor.
The package owns POST, JSON, body-size, origin, status, cookie, correlation, and
fetch behavior. See the [production example](../examples/production-http/README.md)
for the complete policy.

### Framework errors

`FrameworkErrorCode` is the stable value object; its value union names every
framework failure a shipped boundary may emit. Controlled admission details may
accompany an error, but exception text from an unknown failure is omitted.

| Code              | Ordinary source                                                                |
| ----------------- | ------------------------------------------------------------------------------ |
| `INVALID_INPUT`   | Invoker or gateway option, outer-shape, contract, or input-validator admission |
| `NOT_FOUND`       | Unknown logical route                                                          |
| `UNAVAILABLE`     | Overload or draining admission                                                 |
| `TIMED_OUT`       | Invocation wait expired                                                        |
| `ABORTED`         | Invocation or client signal aborted                                            |
| `INTERNAL_ERROR`  | Application, framework, validation, or interpreter fault                       |
| `TRANSPORT_ERROR` | In-process forwarding or custom transport failure                              |
| `UNKNOWN_ERROR`   | Unclassified framework envelope                                                |

## `client`

<!-- register:client:start -->

`Client`, `ClientCallOptions`, `ClientError`, `ClientOptions`, `ClientRequest`, `ClientTransport`, `ContractShape`, `DomainErrorValue`, `createClient`, `createLocalClient`

<!-- register:client:end -->

### Constructors

| API                 | Compact signature                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| `createLocalClient` | `createLocalClient<Contract>({ invoker }): Client<Contract>`                                            |
| `createClient`      | `createClient<Contract, TransportError = ClientError>({ transport }): Client<Contract, TransportError>` |

`ClientOptions.transport` and `createLocalClient`'s `invoker` are required.
`ClientTransport` and `ClientRequest` name the extension contract. Every
endpoint call accepts an optional second `ClientCallOptions`
argument whose signal cancels transport and waiting, not accepted server work.
A `Client<Contract>` supports grouped access such as
`client.rooms.get(input)` and indexed access such as
`client["/rooms/get"]`, followed by the input call.

`ContractShape` is the path-to-input/output/error record accepted by every
constructor. `ClientError` is `{ error: FrameworkErrorCode; detail?:
string }`; `DomainErrorValue` extracts a generated route's domain error value.
Calls resolve to success or error envelopes rather than throwing for handled
transport failures. JSON projection and error delivery are normative in
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
the store and applies redaction again. `WireContractsIR`, `WireEndpoint`, and
`WireType` name derived wire data.
`WireEndpoint.inputAdmissionError` preserves whether framework input admission
contributed `INVALID_INPUT`, so production projection remains distinct from a
registered domain refusal using the same code.

`ApplicationManifestV3` has format `sync-engine.application-manifest`, version
`3`, and is static canonical JSON-round-trippable application data. Its
`generator` identifies the exact `@mit-sdg/sync-engine` package version. It
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
multiple transport contracts in one wire module. The HTTP companion's
`httpWire({ policy, name })` additionally removes cookie-consumed credential
fields for a floor. The
[application-boundary guide](./guide/application-boundary.md#generate-the-wire-contract)
shows the application-owned command path; [Generated wire](./semantics.md#generated-wire)
defines derivation guarantees.

## `advanced`

<!-- register:advanced:start -->

`Engine`, `EngineObserver`, `LogEvent`, `Refuse`, `createEngine`, `custom`, `faulted`

<!-- register:advanced:end -->

This subpath crosses the ordinary application boundary. Prefer the ordinary
assembly APIs unless the host needs manual engine construction or an explicit
escape hatch.

| API            | Compact signature / role                         |
| -------------- | ------------------------------------------------ |
| `createEngine` | `createEngine(store?: LogStore): Engine`         |
| `custom`       | `custom(fn, inputs, outputs)`                    |
| `faulted`      | `faulted(pattern, { by?, except?, exceptBy? }?)` |

`Engine`, `EngineObserver`, and `LogEvent` name manual interpreter and
observation contracts. `Refuse` is the low-level refusal marker. Its `message` becomes the refusal's
`error` field and takes precedence over an `error` field in its optional data.
An undeclared code remains a refusal. The current implementation warns only
when the action has an explicit refusal contract that omits the code. The
advanced pieces do not install the
ordinary assembly's quiescent interpreter-failure settlement policy. Standard
assembly behavior is normative under [Failures between action
asks](./semantics.md#failures-between-action-asks) and
[Cancellation](./semantics.md#cancellation).
