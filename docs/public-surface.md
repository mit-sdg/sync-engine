# Public API

This reference lists every supported package subpath and export in the current
alpha. There is no root export and no supported deep import. The export
registers are exact; compact signatures and tables summarize the principal
call shapes and do not replace the generated TypeScript declarations.

Most backend files use `language`, `assembly`, and `boundary`; frontend files
use `client`; generation scripts use `tooling`. `advanced` marks deliberate
manual construction, while `utils` contains process-level support functions.

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
`Condition`, `ReadLine`, `SlotPattern`, and `RelationView` name reusable
declaration shapes; the binding types are normally inferred.

For progressive examples, see the [reactions guide](./guide/reactions.md) and
[views and formers guide](./guide/views-and-formers.md). The normative matching,
cardinality, sibling, absence, and production rules live in [Execution
semantics](./semantics.md#reactions).

## `assembly`

<!-- register:assembly:start -->

`ActionRefusal`, `Assembly`, `AssemblyOptions`, `ConceptFloor`, `ConceptImplementation`, `ConceptRegistration`, `ExecutionLimits`, `FileStore`, `FiringRecord`, `ImplementationOverrides`, `Implementations`, `IntegrityFailureRecord`, `LogEntry`, `LogStore`, `Logging`, `MemoryStore`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `PersistingConcept`, `PublicError`, `PublicErrorCategory`, `ReactionFailureRecord`, `RegisteredConcept`, `RegisteredConceptSet`, `RetentionPolicy`, `assemble`, `conceptFloor`, `conceptSet`, `registerConcept`

<!-- register:assembly:end -->

### Assembly construction

```ts
assemble(options: AssemblyOptions): Assembly
```

| `AssemblyOptions` field | Required | Default / effect                                                                |
| ----------------------- | -------- | ------------------------------------------------------------------------------- |
| `vocabulary`            | yes      | Declared application vocabulary                                                 |
| `composition`           | yes      | Reactions, endpoints, views, and formers to register                            |
| `initialize`            | no       | Constructor argument tuples by concept name; otherwise `[]`                     |
| `instances`             | no       | Ready implementations by concept name; each overrides `initialize`              |
| `logging`               | no       | `Logging.OFF`; alternatives are `TRACE` and `VERBOSE`                           |
| `retention`             | no       | `{ window: 100 }`; also accepts `{ window }`, `"keepAll"`, or `"evictConsumed"` |
| `logStore`              | no       | New `MemoryStore`; application-owned store, mutually exclusive with `retention` |
| `executionLimits`       | no       | Unbounded profile; validates and enforces every `ExecutionLimits` field         |
| `observers`             | no       | No operational observers                                                        |
| `redaction`             | no       | Universal sensitive-field patterns only                                         |

A retention window must be a finite, non-negative integer. `{ window: 0 }`
allows an active flow to complete before automatic eviction.

`Assembly` exposes `concepts`, `invoker`, `publicInterface`, `beginDrain()`,
`whenIdle()`, and `form(fusedFormer)`. Drain closes root admission immediately;
both lifecycle promises resolve when accepted causal work actually settles.
`ActionRefusal` is the direct-action refusal result.
`ConceptImplementation`, `Implementations`, and `ImplementationOverrides` name
complete or partial implementation maps. Assembled non-query actions are
asynchronous and conservatively resolve to their awaited result or an
`ActionRefusal`; underscore-prefixed queries retain their implementation return
shape.

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

`conceptFloor` validates a complete implementation map and returns the supplied
descriptor. Assembly does not install, own, or call the floor's `close()`
method. The host owns floor selection and lifecycle.

### Log stores

`MemoryStore` and `FileStore` implement `LogStore`; `FileStore` appends JSONL.
`new MemoryStore()` defaults to `"evictConsumed"`. Ordinary `assemble(...)`
instead supplies `{ window: 100 }`. `new FileStore(path)` defaults to
`"keepAll"`; its synchronous append completes before the entry enters the
in-memory fold, and `stop()` currently has no work to perform. Pruning does not
rewrite its file.
`RetentionPolicy`, `LogEntry`, `FiringRecord`, `ReactionFailureRecord`, and
`IntegrityFailureRecord` name the corresponding contracts. `PersistingConcept` manages an
application-supplied store registry. Persistence, eviction, redaction, and
restart limits are normative in [Execution semantics](./semantics.md#logs-concept-implementations-and-restart).

## `boundary`

<!-- register:boundary:start -->

`ApplicationInterface`, `CliApp`, `CliAppOptions`, `CliCommand`, `CliResult`, `CommandInput`, `EmittedFrameworkErrorCode`, `EndpointCliCommand`, `EndpointDef`, `EndpointOptions`, `EndpointValidator`, `EndpointValidators`, `ExecutionLimits`, `FrameworkErrorCode`, `Gateway`, `GatewayClientError`, `GatewayOptions`, `GatewayTarget`, `HttpCredentialBinding`, `HttpCorrelationOptions`, `HttpFloor`, `InputContractDecl`, `InvocationResult`, `InvokeOptions`, `Invoker`, `OperationalEvent`, `OperationalObserver`, `OperationalResultClass`, `ParseResult`, `ParsedArgs`, `ValidationResult`, `command`, `createCliApp`, `createGateway`, `createHttpHandler`, `endpoint`, `fail`, `httpFloor`, `ok`, `parseArgs`, `parseFail`, `parseOk`, `receive`, `respond`

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
Input validation follows shallow defaulting and precedes the application ask.
Invalid successful output is recorded as an integrity failure and returned as
opaque `INTERNAL_ERROR`. A path may declare each validator at most once.

### Gateway and invocation

```ts
createGateway<Contract>(options: GatewayOptions): Gateway<Contract>
invoker.invoke(path, input, options?: InvokeOptions): Promise<InvocationResult>
```

| `GatewayOptions` field  | Required | Default / effect                                              |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `application`           | yes      | `GatewayTarget` exposing `invoker` and `publicInterface`      |
| `additionalComposition` | no       | No additional gateway declarations                            |
| `logging`               | no       | `Logging.OFF` from the `assembly` subpath                     |
| `retention`             | no       | `{ window: 100 }`; same accepted values as assembly retention |
| `logStore`              | no       | New `MemoryStore`; mutually exclusive with `retention`        |
| `executionLimits`       | no       | Unbounded gateway execution                                   |
| `observers`             | no       | No gateway operational observers                              |
| `redaction`             | no       | Universal sensitive-field patterns only                       |

| `InvokeOptions` field | Default / effect                                                             |
| --------------------- | ---------------------------------------------------------------------------- |
| `signal`              | No signal; an abort ends the wait with `ABORTED`                             |
| `timeoutMs`           | `30_000`; expiry ends the wait with `TIMED_OUT`                              |
| `correlationId`       | The generated request id; supplied values cross gateway and application logs |

`ExecutionLimits` requires positive finite integers for active root flows,
pending requests, actions and firings per flow, rows per evaluation, and the
maximum caller deadline. Overload and drain return `UNAVAILABLE`. `Gateway`
also exposes `beginDrain()` and `whenIdle()` and includes the target assembly's
lifecycle when that target supplies it.

`Gateway`, `GatewayTarget`, `GatewayClientError`, `Invoker`, and
`InvocationResult` name these contracts. Timeout and abort stop waiting but do
not cancel forwarded application work. A fault-free unanswered endpoint reaches
`TIMED_OUT`; an unanswered flow with a recorded interpreter failure settles
promptly as opaque `INTERNAL_ERROR`. See [Failures between action
asks](./semantics.md#failures-between-action-asks) and
[Cancellation](./semantics.md#cancellation).

### HTTP

| API                 | Compact signature / options                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `createHttpHandler` | `({ gateway, basePath? })`, `({ invoker, basePath? })`, or `({ gateway, application, floor })`; `basePath` defaults to `""` |
| `httpFloor`         | `httpFloor({ origin, credential: { name, input, issue: { path, output, expires }, clear } })`                               |

`HttpFloor` and `HttpCredentialBinding` name the cookie-floor descriptor. The
fixed request, cookie, projection, and deployment guarantees live in [Execution
semantics](./semantics.md#boundary-gateway-and-client).

Every handler form accepts `correlation?: HttpCorrelationOptions`. Its resolver
maps an inbound request to a non-empty, control-character-free identifier of at
most 128 UTF-16 code units. A thrown or invalid result is replaced with a UUID.
`responseHeader` optionally projects the effective identifier on every response.

### CLI

The APIs in this section construct application-specific CLI programs. They are
separate from the installed `sync-engine` executable, whose commands are
defined in the [CLI reference](./cli.md).

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

### Framework Errors

`FrameworkErrorCode` is the stable value object;
`EmittedFrameworkErrorCode` is its value union. Controlled admission details
may accompany an error, but exception text from an unknown failure is omitted.

| Code                       | Ordinary source                                                | HTTP status when emitted by the server adapter |
| -------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `INVALID_INPUT`            | Gateway input admission or oversized request body              | 422 for admission; 413 for oversized body      |
| `NOT_FOUND`                | Unknown route                                                  | 404                                            |
| `UNAVAILABLE`              | Overload or draining admission                                 | 503                                            |
| `TIMED_OUT`                | Invocation wait expired                                        | 504                                            |
| `ABORTED`                  | Invocation signal aborted                                      | 499                                            |
| `INTERNAL_ERROR`           | Application, framework, or interpreter fault                   | 500                                            |
| `TRANSPORT_ERROR`          | In-process forwarding or custom transport failure              | 500                                            |
| `BAD_JSON`                 | HTTP request or response parsing                               | 400 for a bad request                          |
| `BAD_STATUS`               | Unsupported request method or client-side status normalization | 405 for an unsupported method                  |
| `NETWORK_ERROR`            | HTTP client could not complete `fetch`                         | No response                                    |
| `HEADER_RESOLUTION_FAILED` | HTTP client header provider failed                             | No response                                    |
| `UNKNOWN_ERROR`            | Unclassified framework envelope                                | 500                                            |

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

`AppIR`, `ApplicationDependencyGraphV1`, `ApplicationDiagnostic`, `ApplicationImpact`, `ApplicationManifestV1`, `ArtifactFilesystem`, `ArtifactKind`, `ArtifactPlan`, `ArtifactPlanEntry`, `ArtifactStatus`, `ConceptInventoryIR`, `DependencyEdge`, `DependencyEdgeKind`, `DependencyNode`, `DependencyNodeKind`, `DiagnosticCode`, `DiagnosticSeverity`, `FormerIR`, `GeneratedPlanOptions`, `ManifestEndpointV1`, `ObservedOccurrence`, `ReactionIR`, `ViewIR`, `WireContractsIR`, `WireEndpoint`, `WireOptions`, `WireRenderOptions`, `WireType`, `affectedNodes`, `applicationDependencyGraph`, `applicationDiagnostics`, `applicationImpact`, `applicationManifest`, `applyArtifactPlan`, `artifactPlan`, `checkArtifactPlan`, `diagnosticsFail`, `diffManifestNodes`, `floorReadBack`, `httpFloorReadBack`, `inspectAssembly`, `normalizeArtifactPath`, `planGenerated`, `renderApp`, `renderApplicationManifest`, `renderInputContracts`, `renderReaction`, `renderWireTypes`, `wireContracts`

<!-- register:tooling:end -->

### Inspection and rendering

| API                         | Compact signature                                                 |
| --------------------------- | ----------------------------------------------------------------- |
| `inspectAssembly`           | `inspectAssembly(assembly)`                                       |
| `renderApp`                 | `renderApp({ title, concepts, app }): string`                     |
| `renderReaction`            | `renderReaction(reaction): string`                                |
| `renderInputContracts`      | `renderInputContracts(contracts): string`                         |
| `wireContracts`             | `wireContracts(app, options?: WireOptions): WireContractsIR`      |
| `renderWireTypes`           | `renderWireTypes(wire, moduleName? \| options?): string`          |
| `httpFloorReadBack`         | `httpFloorReadBack(application, floor): string`                   |
| `floorReadBack`             | `floorReadBack({ application, conceptFloor, httpFloor }): string` |
| `applicationManifest`       | `applicationManifest(assembly): ApplicationManifestV1`            |
| `renderApplicationManifest` | `renderApplicationManifest(manifest): string`                     |
| `applicationDiagnostics`    | `applicationDiagnostics(app, endpoints, wire)`                    |
| `diagnosticsFail`           | `diagnosticsFail(diagnostics, "errors" \| "warnings"?)`           |

`AppIR`, `ReactionIR`, `ViewIR`, `FormerIR`, `ConceptInventoryIR`, and
`ObservedOccurrence` name inspected data. `ObservedOccurrence` contains the
concept, action, optional `by`, output, and outcome summary; it omits input,
action id, flow, and timestamp. Inspection reports only evidence retained by
the store and applies redaction again. `WireContractsIR`, `WireEndpoint`, and
`WireType` name derived wire data.

`ApplicationManifestV1` is static, versioned, JSON-round-trippable application
data: portable IR, concept inventories, declaration-owned endpoints, input
contracts, wire IR, validator-presence flags, and structured diagnostics. It
excludes occurrences, timestamps, and other runtime state.
`renderApplicationManifest` emits canonical JSON with ordinal record-key order
and a final newline. Named collections use stable order while authored reaction,
view-alternative, and former-node sequences retain semantics.

`ApplicationDiagnostic`, `DiagnosticCode`, and `DiagnosticSeverity` define the
machine-readable advisory surface. `diagnosticsFail` treats error diagnostics as
failures by default and can promote warnings; informational diagnostics remain
advisory.

`applicationDependencyGraph(manifest)` returns a versioned graph with stable
namespaced node ids, typed dependency edges, canonical node digests, and a
reverse dependent index. Nodes cover endpoints, outputs, reaction stages,
actions, queries, views, formers, computations, and opaque behavior. Concept
actions conservatively invalidate every query on that concept.
`diffManifestNodes` identifies direct digest changes, `affectedNodes` follows
the reverse index, and `applicationImpact` returns directly changed and affected
nodes plus endpoint/output summaries. An application containing opaque or
unlowered behavior uses whole-application impact when design data changes.

`planGenerated(manifest, options)` is a filesystem-free specification and wire
planner. Every `ArtifactPlanEntry` has a normalized relative POSIX path,
content, kind, and stable digest. `artifactPlan` plans caller-rendered entries,
while `normalizeArtifactPath` rejects absolute, parent, empty-segment, and
backslash paths.

`checkArtifactPlan(plan, filesystem)` classifies entries as `missing`,
`changed`, `unchanged`, or `failed`. `applyArtifactPlan` validates and reads the
complete plan before its first write, skips unchanged files, and leaves unknown
files untouched. Its environment-independent `ArtifactFilesystem.writeAtomic`
contract requires same-directory temporary-file replacement. The installed CLI
implements that contract with write and rename; public tooling has no Node
filesystem dependency.

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

| Field               | Required | Default                                                               |
| ------------------- | -------- | --------------------------------------------------------------------- |
| `assemble`          | yes      | Function that builds the application                                  |
| `title`             | yes      | Application title used to derive names                                |
| `directory`         | no       | `new URL("./generated/", configUrl)`                                  |
| `specification`     | no       | Slugged title plus `.md`                                              |
| `wire`              | no       | `"wire.ts"`                                                           |
| `wireName`          | no       | Pascal-cased title plus `Wire`                                        |
| `wireBanner`        | no       | `// Generated by sync-engine from the <title> assembly. Do not edit.` |
| `httpWireName`      | no       | `${wireName}Http` when `httpFloor` is present                         |
| `vocabulary.module` | no       | `new URL("./src/concept-set.ts", configUrl)`                          |
| `vocabulary.export` | no       | `"vocabulary"`                                                        |
| `httpFloor`         | no       | No HTTP projection                                                    |

Artifact generation always uses the vocabulary anchor with strict leaves. With
an HTTP floor, the one wire module contains the logical contract and the
projected HTTP contract. The [application-boundary guide](./guide/application-boundary.md#generate-the-wire-contract)
shows the application-owned command path; [Generated wire](./semantics.md#generated-wire)
owns derivation guarantees.

## `advanced`

<!-- register:advanced:start -->

`Engine`, `EngineObserver`, `LogEvent`, `Refuse`, `Requesting`, `createEngine`, `compute`, `custom`, `faulted`, `refusalFunnel`

<!-- register:advanced:end -->

This subpath crosses the ordinary application boundary. Prefer the ordinary
assembly APIs unless the host needs manual engine construction or an explicit
escape hatch.

| API             | Compact signature / role                         |
| --------------- | ------------------------------------------------ |
| `createEngine`  | `createEngine(store?: LogStore): Engine`         |
| `compute`       | `compute(namedComputation, input, output)`       |
| `custom`        | `custom(fn, inputs, outputs)`                    |
| `faulted`       | `faulted(pattern, { by?, except?, exceptBy? }?)` |
| `refusalFunnel` | `refusalFunnel(boundaryActions)`                 |

`Engine`, `EngineObserver`, and `LogEvent` name manual interpreter and
observation contracts. `Requesting` is the low-level request/response concept;
`Refuse` is the low-level refusal marker. Its `message` becomes the refusal's
`error` field and takes precedence over an `error` field in its optional data.
An undeclared code remains a refusal. The current implementation warns only
when the action has an explicit refusal contract that omits the code. The
advanced pieces do not install the
ordinary assembly's quiescent interpreter-failure settlement policy. Standard
assembly behavior is normative under [Failures between action
asks](./semantics.md#failures-between-action-asks) and
[Cancellation](./semantics.md#cancellation).

## `utils`

<!-- register:utils:start -->

`LogLevel`, `Logger`, `RedactionPolicy`, `Redactor`, `UNIVERSAL_SENSITIVE_PATTERNS`, `configureRedaction`, `createRedactor`, `describeError`, `logger`, `redact`, `serializeError`

<!-- register:utils:end -->

`logger` is the package logger. `Logger` and `LogLevel` describe its public API.
`serializeError(...)` returns only an `Error` class name, or
`NonErrorThrown` for another thrown value, and is the opaque form for ordinary
logging. `describeError(...)` returns an `Error` message or the string form of
another thrown value. It does not sanitize or redact that text; use it only in
a caller-reviewed diagnostic channel, never automatically in a public error
envelope.

`createRedactor(policy)` returns an immutable `Redactor` for one application.
Ordinary assembly uses this scoped form. `configureRedaction(policy)` replaces
the application-specific portion of the standalone process-global
compatibility utility; universal sensitive-name patterns remain. `redact(value)`
returns a copy that replaces values whose field names match `RedactionPolicy`
or `UNIVERSAL_SENSITIVE_PATTERNS`. The exact storage and redaction guarantees
live under [Logs, concept implementations, and restart](./semantics.md#logs-concept-implementations-and-restart).

Redaction matches field names rather than arbitrary string contents and stops
traversal after five levels. Nested cycles, unreadable values, functions,
symbols, non-finite numbers, `undefined`, and values beyond the depth limit are
replaced rather than preserved. A top-level `undefined` remains `undefined`;
other ordinary results are JSON-safe projections.
