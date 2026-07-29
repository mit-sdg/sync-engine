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

| Package path                                 | Role                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| [`@mit-sdg/sync-engine/language`](#language) | Concepts, reactions, views, formers, and their conditions     |
| [`@mit-sdg/sync-engine/assembly`](#assembly) | Concept registration, assemblies, and occurrence-log stores   |
| [`@mit-sdg/sync-engine/boundary`](#boundary) | Endpoints, gateways, HTTP, and CLI adapters                   |
| [`@mit-sdg/sync-engine/client`](#client)     | Local and HTTP clients over a generated contract              |
| [`@mit-sdg/sync-engine/tooling`](#tooling)   | Assembly inspection, read-back rendering, and wire generation |
| [`@mit-sdg/sync-engine/advanced`](#advanced) | Manual engine construction and explicit escape hatches        |

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
`{ class, spec?, purpose?, principle?, queries?, outcomes?, refusals?,
publicErrors? }`. `QueryPromise` is `"one" | "optional" | "many"`.
`Condition`, `ReadLine`, and `RelationView` name reusable declaration shapes;
bindings are inferred from their declaration callbacks.

For progressive examples, see the [reactions guide](./guide/reactions.md) and
[views and formers guide](./guide/views-and-formers.md). The normative matching,
cardinality, sibling, absence, and production rules live in [Execution
semantics](./semantics.md#reactions).

## `assembly`

<!-- register:assembly:start -->

`ActionRefusal`, `Assembly`, `AssemblyOptions`, `ConceptFloor`, `ConceptImplementation`, `ConceptRegistration`, `ExecutionLimits`, `FileStore`, `FiringRecord`, `ImplementationOverrides`, `Implementations`, `IntegrityFailureRecord`, `LogEntry`, `LogStore`, `Logging`, `MemoryStore`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `PublicError`, `PublicErrorCategory`, `ReactionFailureRecord`, `RegisteredConcept`, `RegisteredConceptSet`, `RetentionPolicy`, `assemble`, `conceptFloor`, `conceptSet`, `registerConcept`

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

| API               | Compact signature                                                     |
| ----------------- | --------------------------------------------------------------------- |
| `registerConcept` | `registerConcept({ class, spec, refusals?, publicErrors?, floors? })` |
| `conceptSet`      | `conceptSet({ ...registeredConcepts })`                               |
| `conceptFloor`    | `conceptFloor(vocabulary, { name, instances, resources, close })`     |

`ConceptRegistration`, `RegisteredConcept`, `RegisteredConceptSet`, and
`ConceptFloor` name those descriptors. `PublicError` contains the public HTTP
categories and `PublicErrorCategory` names their union.

`publicErrors` may categorize only refusal codes declared by the concept
specification. Floor names must be non-empty, and each supplied floor value
must be a factory function. A floor name is available through the typed
`implementations(...)` overload only when every concept supplies it. If an
incomplete floor is selected by bypassing that type restriction, selection
fails at runtime. `conceptSet` also rejects conflicting public categories.
The zero-argument `implementations()` form is available only when every
canonical class can be constructed without required arguments; otherwise use a
named floor.

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

`ApplicationInterface`, `CliApp`, `CliAppOptions`, `CliCommand`, `CliResult`, `CommandInput`, `EmittedFrameworkErrorCode`, `EndpointCliCommand`, `EndpointDef`, `EndpointOptions`, `EndpointValidator`, `EndpointValidators`, `ExecutionLimits`, `FrameworkErrorCode`, `Gateway`, `GatewayOptions`, `GatewayTarget`, `HttpCredentialBinding`, `HttpCorrelationOptions`, `HttpFloor`, `InputContractDecl`, `InvocationResult`, `InvokeOptions`, `Invoker`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `ParseResult`, `ParsedArgs`, `ProductionHttpProfile`, `ValidationResult`, `command`, `createCliApp`, `createGateway`, `createHttpHandler`, `endpoint`, `fail`, `httpFloor`, `ok`, `parseArgs`, `parseFail`, `parseOk`, `productionHttpProfile`, `receive`, `respond`

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
shows the authoring path; [Execution semantics](./semantics.md#sibling-paths-and-endpoint-settlement)
owns settlement.

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

### HTTP

| API                     | Compact signature / options                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `createHttpHandler`     | Profile `({ gateway, application, profile })`; cookie floor `({ gateway, application, floor })`          |
| `productionHttpProfile` | `productionHttpProfile({ origin, basePath? }): ProductionHttpProfile`                                    |
| `httpFloor`             | `httpFloor({ origin, basePath?, credential: { name, input, issue: { path, output, expires }, clear } })` |

`ProductionHttpProfile` is the credential-free production policy. It requires
an HTTP or HTTPS public origin, accepts an optional normalized base path, and
uses the assembly's registered public-error categories. `HttpFloor` extends
that shape with one `HttpCredentialBinding`; `httpFloor` is the narrow
same-origin cookie preset. Both production forms use the same bounded request,
JSON, status, category, success-value, and correlation pipeline. The fixed
request, cookie, projection, and deployment guarantees live in [Execution
semantics](./semantics.md#boundary-gateway-and-client).

`httpFloor(...)` requires identifier-shaped credential and output field names,
canonical issue and clear paths, and distinct clear paths. Assembly validation
requires those paths to exist, at least one endpoint to require the credential
input, and every top-level alternative of the issue endpoint's successful
output to expose the token and expiry fields. At runtime, a token that is not a
string or an expiry that is not a valid `Date` or date-parsable value produces
opaque `INTERNAL_ERROR`.

Endpoint and base paths must be canonical portable URL pathnames. `/` remains a
supported endpoint and no-prefix base, and trailing base-path slashes normalize
away. `HttpFloor` has no implicit `/api` alias; declare `basePath: "/api"` when
that prefix is part of the deployment URL.

Every handler form requires a standard gateway targeting the supplied assembly;
construction rejects unrecognized gateways and gateways for another assembly.
Gateway execution limits and observers remain configured through `createGateway`.
Same-version duplicate package copies share this identity through the global
registry; interoperability across different package versions is not guaranteed.

Every handler form accepts `correlation?: HttpCorrelationOptions`. Its resolver
maps an inbound request to a non-empty, control-character-free ByteString of at
most 128 code units, without leading or trailing spaces. A thrown,
non-ByteString, or otherwise invalid result is replaced with a UUID.
`responseHeader` optionally projects the effective
identifier on every response. Invalid header names are rejected at handler
construction, and response decoration never rejects a handled request.

### CLI

The APIs in this section construct application-specific CLI programs. They are
separate from the installed `sync-engine` executable, whose commands are
defined in the [CLI reference](./cli.md). The [inbound application CLI
recipe](./advanced-recipes.md#an-inbound-application-cli) connects one to a real
assembled endpoint and projects its result onto a process.

| API                     | Compact signature                                        |
| ----------------------- | -------------------------------------------------------- |
| `command`               | `command({ path }, { description?, parse, format })`     |
| `createCliApp`          | `createCliApp(commands, { name?, version?, invoker? }?)` |
| `parseArgs`             | `parseArgs(args): ParsedArgs`                            |
| `parseOk` / `parseFail` | Constructors for `ParseResult`                           |
| `ok` / `fail`           | Constructors for `CliResult` with exit codes `0` / `1`   |

`CliAppOptions.name` and `.version` default to `""`; `invoker` defaults to
absent and is required only by endpoint commands. `CliCommand`,
`EndpointCliCommand`, and `CommandInput` name command contracts.
Command entries are own properties, and `help`, `--help`, and `-h` are reserved
for built-in help.

### Framework Errors

`FrameworkErrorCode` is the stable value object;
`EmittedFrameworkErrorCode` is its value union. Controlled admission details
may accompany an error, but exception text from an unknown failure is omitted.

| Code                       | Ordinary source                                                |
| -------------------------- | -------------------------------------------------------------- |
| `INVALID_INPUT`            | Gateway input admission or oversized request body              |
| `NOT_FOUND`                | Unknown route                                                  |
| `UNAVAILABLE`              | Overload or draining admission                                 |
| `TIMED_OUT`                | Invocation wait expired                                        |
| `ABORTED`                  | Invocation signal aborted                                      |
| `INTERNAL_ERROR`           | Application, framework, or interpreter fault                   |
| `TRANSPORT_ERROR`          | In-process forwarding or custom transport failure              |
| `BAD_JSON`                 | HTTP request or response parsing                               |
| `BAD_STATUS`               | Unsupported request method or client-side status normalization |
| `NETWORK_ERROR`            | HTTP client could not complete `fetch`                         |
| `HEADER_RESOLUTION_FAILED` | HTTP client header provider failed                             |
| `UNKNOWN_ERROR`            | Unclassified framework envelope                                |

## `client`

<!-- register:client:start -->

`Client`, `ClientCallOptions`, `ClientError`, `ClientOptions`, `ClientRequest`, `ClientTransport`, `ContractShape`, `DomainErrorValue`, `HeadersOption`, `HttpClientOptions`, `createClient`, `createHttpClient`, `createHttpTransport`, `createLocalClient`

<!-- register:client:end -->

### Constructors

| API                   | Compact signature                                                           |
| --------------------- | --------------------------------------------------------------------------- |
| `createHttpClient`    | `createHttpClient<Contract>(options?: HttpClientOptions): Client<Contract>` |
| `createHttpTransport` | `createHttpTransport(options?: HttpClientOptions): ClientTransport`         |
| `createLocalClient`   | `createLocalClient<Contract>({ invoker }): Client<Contract>`                |
| `createClient`        | `createClient<Contract>({ transport }: ClientOptions): Client<Contract>`    |

| `HttpClientOptions` field | Default / effect                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `baseUrl`                 | `API_BASE_URL`, then `"/api"`                                                      |
| `fetch`                   | `globalThis.fetch`                                                                 |
| `headers`                 | No extra headers; a record or synchronous/asynchronous provider evaluated per call |
| `credentials`             | `"include"`; also accepts `"omit"` or `"same-origin"`                              |

`ClientOptions.transport` and `createLocalClient`'s `invoker` are required.
`HeadersOption`, `ClientTransport`, and `ClientRequest` name those extension
contracts. Every endpoint call accepts an optional second `ClientCallOptions`
argument whose signal cancels transport and waiting, not accepted server work.
A `Client<Contract>` supports grouped access such as
`client.rooms.get(input)` and indexed access such as
`client["/rooms/get"]`, followed by the input call.

`ContractShape` is the path-to-input/output/error record accepted by every
constructor. `ClientError` is `{ error: EmittedFrameworkErrorCode; detail?:
string }`; `DomainErrorValue` extracts a generated route's domain error value.
Calls resolve to success or error envelopes rather than throwing for handled
transport failures. JSON projection and error delivery are normative in
[Execution semantics](./semantics.md#boundary-gateway-and-client).

`createClient` replaces a nullish input with `{}`. A transport throw or rejected
promise resolves as `{ error: "TRANSPORT_ERROR" }`. `createHttpTransport`
resolves header-provider, network, response-JSON, and unexpected-status failures
to the corresponding framework codes. Handled transport failures do not reject
the client call.

## `tooling`

<!-- register:tooling:start -->

`AppIR`, `ApplicationDiagnostic`, `ApplicationManifestV3`, `ConceptInventoryIR`, `DiagnosticCode`, `DiagnosticSeverity`, `FormerIR`, `ManifestEndpointV3`, `ObservedOccurrence`, `ReactionIR`, `ViewIR`, `WireContractsIR`, `WireEndpoint`, `WireOptions`, `WireRenderOptions`, `WireType`, `applicationDiagnostics`, `applicationManifest`, `diagnosticsFail`, `inspectAssembly`, `renderApp`, `renderApplicationManifest`, `renderInputContracts`, `renderReaction`, `renderWireTypes`, `wireContracts`

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
application-owned `generated.config.ts`. The descriptor is a CLI configuration
shape rather than an exported package type.

| Field               | Required | Default                                                    |
| ------------------- | -------- | ---------------------------------------------------------- |
| `assemble`          | yes      | Function that builds the application                       |
| `title`             | yes      | Application title used to derive names                     |
| `close`             | no       | Runs after the generated assembly drains                   |
| `directory`         | no       | `new URL("./generated/", configUrl)`                       |
| `specification`     | no       | Slugged title plus `.md`                                   |
| `wire`              | no       | `"wire.ts"`                                                |
| `wireName`          | no       | Pascal-cased title plus `Wire`                             |
| `wireBanner`        | no       | Exact package/version generator banner                     |
| `httpWireName`      | no       | `${wireName}Http` when an HTTP profile or floor is present |
| `vocabulary.module` | no       | `new URL("./src/concept-set.ts", configUrl)`               |
| `vocabulary.export` | no       | `"vocabulary"`                                             |
| `httpProfile`       | no       | No production HTTP projection                              |
| `httpFloor`         | no       | No cookie-bound production HTTP projection                 |

The default wire banner is
`// Generated by @mit-sdg/sync-engine@<version> from the <title> assembly. Do not edit.`
A custom banner receives a second mandatory generator line. `httpProfile` and
`httpFloor` are mutually exclusive. Artifact generation always uses the
vocabulary anchor with strict leaves. With either descriptor, the one wire
module contains the logical contract and the projected public HTTP contract. A
floor additionally removes cookie-consumed credential fields. The
[application-boundary guide](./guide/application-boundary.md#generate-the-wire-contract)
shows the application-owned command path; [Generated wire](./semantics.md#generated-wire)
owns derivation guarantees.

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
