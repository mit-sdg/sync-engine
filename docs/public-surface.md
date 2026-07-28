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

`language` declares designs; it does not execute them. These are the primary
call shapes:

| API                    | Compact signature                                                            |
| ---------------------- | ---------------------------------------------------------------------------- |
| `vocabulary`           | `vocabulary({ concepts, computations })`                                     |
| `reaction`             | `reaction(vars => when(trigger).where(...conditions).then(...consequences))` |
| `returned` / `refused` | `(pattern, { by?, except?, exceptBy? }?)`                                    |
| `where`                | `where(...conditions)`                                                       |
| `no` / `whether`       | `(readLine)`                                                                 |
| `earlier`              | `earlier(action, input, output?)`                                            |
| `view`                 | `view(name, (input, output, free) => where(...))`                            |
| `count`                | `count(query, input, outputVariable)`                                        |
| `former`               | `former(name, (input, free) => form(...) \| where(...).form(...))`           |
| `form`                 | `form({ ...shape })`                                                         |
| `each`                 | `each(readLine).where(...).arranged(...).form(...)` or a fold                |
| `is`                   | `is.lt`, `is.le`, `is.gt`, `is.ge`, and `is.among` comparisons               |

| Consumer           | Result                            | Empty selection |
| ------------------ | --------------------------------- | --------------- |
| `.form({ ... })`   | One record per row                | `[]`            |
| `.count()`         | Number of rows                    | `0`             |
| `.first(value)`    | Value from the first arranged row | `null`          |
| `.distinct(value)` | First-seen distinct values        | `[]`            |

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

`ActionRefusal`, `Assembly`, `AssemblyOptions`, `ConceptFloor`, `ConceptImplementation`, `ConceptRegistration`, `FileStore`, `FiringRecord`, `ImplementationOverrides`, `Implementations`, `LogEntry`, `LogStore`, `Logging`, `MemoryStore`, `PersistingConcept`, `PublicError`, `PublicErrorCategory`, `ReactionFailureRecord`, `RegisteredConcept`, `RegisteredConceptSet`, `RetentionPolicy`, `assemble`, `conceptFloor`, `conceptSet`, `registerConcept`

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

`Assembly` exposes `concepts`, `invoker`, `publicInterface`, and
`form(fusedFormer)`. `ActionRefusal` is the direct-action refusal result.
`ConceptImplementation`, `Implementations`, and `ImplementationOverrides` name
complete or partial implementation maps.

### Registration and floors

| API               | Compact signature                                                     |
| ----------------- | --------------------------------------------------------------------- |
| `registerConcept` | `registerConcept({ class, spec, refusals?, publicErrors?, floors? })` |
| `conceptSet`      | `conceptSet({ ...registeredConcepts })`                               |
| `conceptFloor`    | `conceptFloor(vocabulary, { name, instances, resources, close })`     |

`ConceptRegistration`, `RegisteredConcept`, `RegisteredConceptSet`, and
`ConceptFloor` name those descriptors. `PublicError` contains the public HTTP
categories and `PublicErrorCategory` names their union.

### Log stores

`MemoryStore` and `FileStore` implement `LogStore`; `FileStore` appends JSONL.
`RetentionPolicy`, `LogEntry`, `FiringRecord`, and `ReactionFailureRecord` name
the corresponding contracts. `PersistingConcept` manages an
application-supplied store registry. Persistence, eviction, redaction, and
restart limits are normative in [Execution semantics](./semantics.md#logs-concept-implementations-and-restart).

## `boundary`

<!-- register:boundary:start -->

`ApplicationInterface`, `CliApp`, `CliAppOptions`, `CliCommand`, `CliResult`, `CommandInput`, `EmittedFrameworkErrorCode`, `EndpointCliCommand`, `EndpointDef`, `FrameworkErrorCode`, `Gateway`, `GatewayClientError`, `GatewayOptions`, `GatewayTarget`, `HttpCredentialBinding`, `HttpFloor`, `InputContractDecl`, `InvocationResult`, `InvokeOptions`, `Invoker`, `ParseResult`, `ParsedArgs`, `command`, `createCliApp`, `createGateway`, `createHttpHandler`, `endpoint`, `fail`, `httpFloor`, `ok`, `parseArgs`, `parseFail`, `parseOk`, `receive`, `respond`

<!-- register:boundary:end -->

### Endpoints

| API        | Compact signature                                                           |
| ---------- | --------------------------------------------------------------------------- |
| `endpoint` | `endpoint(path, vars => receive(input)...then(respond(body)), { input? }?)` |
| `receive`  | `receive(input?)`                                                           |
| `respond`  | `respond(body?)`                                                            |

`EndpointDef` and `InputContractDecl` name the declaration and optional runtime
outer-shape contract. The [application-boundary guide](./guide/application-boundary.md#receive-ask-respond)
shows the authoring path; [Execution semantics](./semantics.md#sibling-paths-and-endpoint-settlement)
owns settlement.

| `InputContractDecl` field | Default / effect                                 |
| ------------------------- | ------------------------------------------------ |
| `required`                | `[]`; missing listed keys return `INVALID_INPUT` |
| `defaults`                | `{}`; fills listed keys only when absent         |

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

| `InvokeOptions` field | Default / effect                                                             |
| --------------------- | ---------------------------------------------------------------------------- |
| `signal`              | No signal; an abort ends the wait with `ABORTED`                             |
| `timeoutMs`           | `30_000`; expiry ends the wait with `TIMED_OUT`                              |
| `correlationId`       | The generated request id; supplied values cross gateway and application logs |

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

### CLI

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
| `INVALID_INPUT`            | Gateway input admission                                        | 422                                            |
| `NOT_FOUND`                | Unknown route                                                  | 404                                            |
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

`Client`, `ClientError`, `ClientOptions`, `ClientRequest`, `ClientTransport`, `ContractShape`, `DomainErrorValue`, `HeadersOption`, `HttpClientOptions`, `createClient`, `createHttpClient`, `createHttpTransport`, `createLocalClient`

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
contracts. A `Client<Contract>` supports grouped access such as
`client.rooms.get(input)` and indexed access such as
`client["/rooms/get"]`, followed by the input call.

`ContractShape` is the path-to-input/output/error record accepted by every
constructor. `ClientError` is `{ error: EmittedFrameworkErrorCode; detail?:
string }`; `DomainErrorValue` extracts a generated route's domain error value.
Calls resolve to success or error envelopes rather than throwing for handled
transport failures. JSON projection and error delivery are normative in
[Execution semantics](./semantics.md#boundary-gateway-and-client).

## `tooling`

<!-- register:tooling:start -->

`AppIR`, `ConceptInventoryIR`, `FormerIR`, `ObservedOccurrence`, `ReactionIR`, `ViewIR`, `WireContractsIR`, `WireEndpoint`, `WireOptions`, `WireRenderOptions`, `WireType`, `floorReadBack`, `httpFloorReadBack`, `inspectAssembly`, `renderApp`, `renderInputContracts`, `renderReaction`, `renderWireTypes`, `wireContracts`

<!-- register:tooling:end -->

### Inspection and rendering

| API                    | Compact signature                                                 |
| ---------------------- | ----------------------------------------------------------------- |
| `inspectAssembly`      | `inspectAssembly(assembly)`                                       |
| `renderApp`            | `renderApp(ir): string`                                           |
| `renderReaction`       | `renderReaction(reaction): string`                                |
| `renderInputContracts` | `renderInputContracts(contracts): string`                         |
| `wireContracts`        | `wireContracts(app, options?: WireOptions): WireContractsIR`      |
| `renderWireTypes`      | `renderWireTypes(wire, moduleName? \| options?): string`          |
| `httpFloorReadBack`    | `httpFloorReadBack(application, floor): string`                   |
| `floorReadBack`        | `floorReadBack({ application, conceptFloor, httpFloor }): string` |

`AppIR`, `ReactionIR`, `ViewIR`, `FormerIR`, `ConceptInventoryIR`, and
`ObservedOccurrence` name inspected data. `WireContractsIR`, `WireEndpoint`,
and `WireType` name derived wire data.

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

This subpath crosses the ordinary application boundary.

| API             | Compact signature / role                         |
| --------------- | ------------------------------------------------ |
| `createEngine`  | `createEngine(store?: LogStore): Engine`         |
| `compute`       | `compute(namedComputation, input, output)`       |
| `custom`        | `custom(fn, inputs, outputs)`                    |
| `faulted`       | `faulted(pattern, { by?, except?, exceptBy? }?)` |
| `refusalFunnel` | `refusalFunnel(boundaryActions)`                 |

`Engine`, `EngineObserver`, and `LogEvent` name manual interpreter and
observation contracts. `Requesting` is the low-level request/response concept;
`Refuse` is the low-level refusal error. The advanced pieces do not install the
ordinary assembly's quiescent interpreter-failure settlement policy. Standard
assembly behavior is normative under [Failures between action
asks](./semantics.md#failures-between-action-asks) and
[Cancellation](./semantics.md#cancellation).

## `utils`

<!-- register:utils:start -->

`LogLevel`, `Logger`, `RedactionPolicy`, `UNIVERSAL_SENSITIVE_PATTERNS`, `configureRedaction`, `describeError`, `logger`, `redact`, `serializeError`

<!-- register:utils:end -->

`logger` is the package logger. `Logger` and `LogLevel` describe its public API.
`serializeError(...)` returns only an `Error` class name, or
`NonErrorThrown` for another thrown value, and is the opaque form for ordinary
logging. `describeError(...)` returns an `Error` message or the string form of
another thrown value. It does not sanitize or redact that text; use it only in
a caller-reviewed diagnostic channel, never automatically in a public error
envelope.

`configureRedaction(policy)` sets the process redaction policy. `redact(value)`
returns a copy that replaces values whose field names match `RedactionPolicy`
or `UNIVERSAL_SENSITIVE_PATTERNS`. The exact storage and redaction guarantees
live under [Logs, concept implementations, and restart](./semantics.md#logs-concept-implementations-and-restart).
