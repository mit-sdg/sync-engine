# Changelog

This project follows semantic versioning. During beta, public subpaths,
behavior, and generated formats may change incompatibly between releases. Pin
an exact version, follow the [support policy](SUPPORT.md), and review the
[operational limits](docs/user/reference/operations.md) before deployment.

## [1.0.0-beta.7] - 2026-08-07

This beta advances the canonical application manifest, publishes a lean
two-surface analysis companion, and replaces the HTTP companion's policy and
browser-session API.

### Compatibility

- `@mit-sdg/sync-engine-http` now exposes `/policy`, `/handler`, `/client`, and
  `/tooling`. One branded immutable policy supplies deployment facts to the
  handler and wire projector; the typed client remains policy-free. The handler
  accepts POST/JSON only and can derive exact-origin CORS, request-origin
  protection, and secure cookie behavior.
- HTTP policy construction now rejects raw mutable policy objects, insecure or
  inert cookie declarations, and unsafe origin combinations. Handler binding
  and wire projection reject bindings that disagree with endpoint contracts.
  The HTTP API has no compatibility aliases.
- The canonical `sync-engine.application-manifest` format advances to V5.
  `ApplicationManifestV5` and `ManifestEndpointV5` replace the version-4 public
  type names; V4 input is rejected rather than upgraded.
- `@mit-sdg/sync-engine-analysis` is now a public package with supported
  `/ir` and `/project` entrypoints and an exact
  `@mit-sdg/sync-engine@1.0.0-beta.7` peer.
  There was no published analysis beta.6; beta.7 is its first public release.
- `/ir` provides compiler-free manifest, graph, source-data, and neutral facade
  queries. `/project` owns TypeScript-backed source indexing, filesystem and
  worker analysis, project diagnostics and producer options, and strict project
  codecs. TypeScript `>=6 <7` is an analysis runtime dependency, not a peer, but
  importing `/ir` does not evaluate it.
- The unpublished oversized preview surface has been removed without aliases:
  there is no `/tooling`, `/guidance`, persisted granular-result codec, impact
  context bundle, change target, review orchestration, packaged guidance, or
  workflow-shaped supporting API.
- Durable source indexes retain only document and anchor metadata, ranges, and
  digests. Source-text search, retained anchor/excerpt text, full-text
  descriptions, source content modes, facade contract rendering, and
  caller-supplied wire projections are removed.
- Project-backed facade construction recomputes the canonical manifest index and
  rejects even a structurally self-consistent project index when its semantic
  composition differs from the supplied manifest. Supplying a project now also
  requires a caller-held `expectedProjectDigest`; optional `limits` govern the
  canonical recomputation.

### Migration

Upgrade core and HTTP to `1.0.0-beta.7` together. The HTTP rework uses the
following replacements.

#### Removed HTTP identifiers

| Removed                          | Replacement                     |
| -------------------------------- | ------------------------------- |
| `productionHttpProfile`          | `httpPolicy`                    |
| `ProductionHttpProfile`          | `HttpPolicyInit` / `HttpPolicy` |
| `HttpPublicErrorPolicy`          | folded into `HttpPolicyInit`    |
| `httpFloor`                      | `httpPolicy({ cookies })`       |
| `HttpFloor`                      | `HttpPolicy`                    |
| `HttpCredentialBinding`          | `HttpCookieBinding`             |
| `createHttpHandler({ profile })` | `createHttpHandler({ policy })` |
| `createHttpHandler({ floor })`   | `createHttpHandler({ policy })` |

#### Renamed HTTP fields

| Before                          | After                                   |
| ------------------------------- | --------------------------------------- |
| `origin`                        | `publicOrigin` (conditionally required) |
| `credential`                    | `cookies.<name>`                        |
| `credential.issue` (one object) | `cookies.<name>.issue` (array)          |
| `credential.issue.output`       | `cookies.<name>.issue[].value`          |
| `credential.name`               | `cookies.<name>.name`                   |

#### Changed HTTP behavior

| Change                                                                                    | Effect                                                                             |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Raw mutable policies rejected                                                             | Construct policy values with `httpPolicy(...)`.                                    |
| `SameSite` derived; `None` under a credentialed browser policy                            | Cross-origin browser session policy no longer silently receives `Strict`.          |
| HTTPS-or-loopback required whenever cookies are declared                                  | Cookie policy no longer depends on `NODE_ENV`.                                     |
| Client default `credentials: "same-origin"`                                               | Cross-origin browser clients must select `"include"`.                              |
| Clearing scoped to applicable bindings; `FORBIDDEN` excluded                              | Authorization refusal no longer signs out a valid session.                         |
| Construction rejects overlapping bindings, inert bindings, and optional credential inputs | Previously accepted assemblies may fail during handler binding or wire projection. |

- When adopting the HTTP API, import policy declarations from `/policy`, pass
  the same `HttpPolicy` to the handler and projector, and configure
  cross-origin browser clients with `credentials: "include"`. CORS and
  request-origin protection are separate controls; a missing `Origin` remains
  allowed unless `requestOrigins.requireOrigin` is true.
- Upgrade core and HTTP to `1.0.0-beta.7` together. When adopting analysis,
  install `@mit-sdg/sync-engine-analysis@1.0.0-beta.7` alongside that exact core
  beta; do not infer an analysis beta.6 package from the core release history.
- Regenerate checked-in application manifests, assembled Markdown, and wire
  TypeScript. Replace V4 manifest type imports with V5. Preview analysis clients
  must replace `/tooling` imports with `/ir` and/or `/project` and move prompts,
  guidance, context packing, targeting, review, observations, and coverage policy
  into their own application.
- Use `readApplicationSourceDocument(...)` with a caller reader to obtain and
  verify a complete source document, then slice it with returned anchor ranges.
  Replace facade source models with `ApplicationSourceQuery` and
  `SourceQueryMatchMode`; consume raw logical contracts without render modes or
  projection evidence.
- Retain `applicationProjectAnalysisDigest(project)` at the point where a project
  artifact is trusted, then pass it as `expectedProjectDigest` when constructing
  a project-backed facade. Computing both artifact and digest from the same
  untrusted input chooses that artifact rather than authenticating it.

### Generated formats

- Manifest V5 adds complete standard and vocabulary computation inventory plus
  canonical-versus-selected concept implementation provenance. It records
  serializable attribution, not functions, constructor arguments, resources,
  source paths, object identity, concept state, or other runtime state.
- `sync-engine.application-index` version 2,
  `sync-engine.impact-trace` version 2,
  `sync-engine.application-source-index` version 2, and
  `sync-engine.application-project-analysis` version 2 carry exact manifest,
  analyzer, core-generator, and, where available, source-revision and
  source-digest identity. Format versions govern structural compatibility;
  exact producer versions remain provenance.
- Granular facade results are immutable and byte-bounded with one canonical size
  pass, but are not a persisted format and have no parse, render, validate, or
  digest API. The V2 project snapshot remains the durable analysis artifact.
- Project V2 snapshots have strict canonical JSON validation, parsing,
  rendering, and SHA-256 identity. Validation binds nested index/source data,
  source metadata and ranges, all read-file digests, TypeScript versions,
  diagnostics, ordering, and resource usage. Snapshots contain no source bytes.
  File records add exact UTF-8 `byteLength`; `projectBytes` is the sum of the
  ordered unique records. Source issue refs must be inventory refs, and candidate
  ranges must belong to indexed documents.

### Runtime and security support

- Source attribution uses the supplied TypeScript program without importing or
  executing project modules or manifest-producing configuration. Static-flow,
  AST, traversal, pagination, source-document, source-read, and result-byte limits fail closed or
  report incomplete evidence instead of silently claiming completeness.
- Filesystem analysis follows complete transitive TypeScript project references
  from source, rejects config/source/extends/symlink escapes and cycles, and does
  not require built declarations. The async API runs in an emitted Node worker;
  abort terminates it without returning a partial snapshot. Synchronous compiler
  parsing and program creation remain checkpoint-bounded rather than
  timer-preemptive.
- Analysis is generic, deterministic inspection infrastructure. Possible-impact
  and source attribution remain evidence with explicit limits; no analysis API
  proves runtime behavior, packages workflow advice, authorizes a change, or
  returns an approval verdict.
- Packed Node 24 verification imports `/ir` in isolation and rejects any runtime
  load of TypeScript, `fs`, `fs/promises`, `node:fs`, `node:fs/promises`, worker,
  project-loader, or source-index-builder modules. Exact-tarball Node 24 and Bun
  consumers exercise `/project`.
- Revision strings are caller assertions rather than Git verification. Project
  parsing synchronously consumes a complete supplied string without its own size
  bound; hosts must bound untrusted input before calling it.
- Codec validation proves shape and derivable consistency, not semantic source
  attribution. AST counts remain producer-reported. Only comparison with a
  previously trusted complete project digest authenticates an unchanged
  artifact; an attacker-chosen artifact and digest remain attacker-chosen unless
  TypeScript analysis is rerun from trusted inputs.

[Release][1.0.0-beta.7] | [Changes since 1.0.0-beta.6][1.0.0-beta.7-compare]

## [1.0.0-beta.6] - 2026-08-06

This beta makes authored concept contracts structured, preserved, and
project-aware while keeping their descriptive boundary explicit.

### Compatibility

- Concept specifications now use a balanced, location-aware grammar for action
  and query signatures. The parser retains structured input and result types,
  normalized member bodies, refusal sentences, `Types`, and extension sections;
  query declarations may include indented reader-facing prose.
- `registerConcept(...)` checks action and query names in both directions,
  recoverable input names, and exact refusal mappings. Parsed types, results,
  bodies, and documentation remain descriptive: they do not infer runtime
  schemas or executable behavior. Engine-evaluated reads continue to enforce
  declared query cardinality.
- `sync-engine check` resolves finite TypeScript input shapes through the
  nearest project, including supported interfaces, aliases, re-exports,
  intersections, mapped and utility types, and path mappings. Ambiguous,
  unresolved, open, cyclic, or otherwise unsupported shapes fail closed with
  source diagnostics.

### Migration

- Correct concept files that relied on partially parsed or malformed signatures,
  duplicate declaration sections, misplaced declaration fences, invalid refusal
  lines, or trailing signature text. Ensure each direct class method has one
  supported finite input shape when using `sync-engine check`.
- Regenerate checked-in application manifests and Markdown read-back. State
  notation remains reader-only and is intentionally excluded from parsed
  contracts and generated artifacts.

### Generated formats

- Application manifests remain at version 4 and may now include a
  `sync-engine.concept-specification` version-1 subtree for each registered
  concept. The subtree preserves authored signatures, bodies, refusals,
  documentation, and source locations. Generated Markdown renders that contract
  and identifies the manifest producer, concept-specification format, and
  renderer versions.

### Runtime and security support

- None.

[Release][1.0.0-beta.6] | [Changes since 1.0.0-beta.5][1.0.0-beta.6-compare]

## [1.0.0-beta.5] - 2026-08-05

This entry adds deferred triggers: a composition can hold a consequence until
tracked ordinary work in the trigger's causal flow has drained, without a host
idle wait.

### Compatibility

- `when(...)` and every chained stage, including an endpoint's, accept
  `.afterFlowSettles()`. The stage's conditions are read at each settlement
  frontier until the trigger match produces one or more bindings or the flow
  finalizes. Each surviving binding is dispatched independently. Settlement is
  per causal flow: unrelated root flows neither delay a frontier nor open one.
  See [Deferred triggers and settlement
  frontiers](docs/user/reference/semantics.md#deferred-triggers-and-settlement-frontiers).
- A deferred consequence keeps flow identity, `earlier(...)` scope, request
  correlation, firing provenance, and execution-limit accounting. Interpreter
  or integrity failure recorded before a frontier stops deferred advancement.
  A deferred endpoint path that never qualifies produces no answer; ordinary
  endpoint settlement still determines whether another path answers, the request
  times out, or an interpreter failure produces `INTERNAL_ERROR`.
- Registration rejects `.afterFlowSettles()` on a later stage of a chain that
  lowering keeps local, naming the stage: a deferred stage must lower into a
  reaction of its own.

### Migration

- Existing compositions require no authoring changes; a reaction without
  `.afterFlowSettles()` fires exactly where its trigger lands. Replace
  `ApplicationManifestV3` and `ManifestEndpointV3` imports with their version-4
  counterparts, and regenerate checked-in version-3 manifests. Version-4
  artifact planning rejects version 3.
- Application workflows that used `whenIdle()` only to wait for ordinary
  consequences in one causal flow can state that order in the composition
  instead.

### Generated formats

- `ReactionIR` gains an optional `deferred` flag. It is absent unless a stage
  states `.afterFlowSettles()`. Because older tooling would otherwise interpret
  that reaction as immediate, the application manifest format advances to
  version 4, with `ApplicationManifestV4` and `ManifestEndpointV4` replacing the
  version-3 public types. Regenerate version-3 manifests when upgrading.
  Read-back and rendered reactions identify deferred timing as
  `at the flow's settlement frontier`.

### Runtime and security support

- None.

[Release][1.0.0-beta.5] | [Changes since 1.0.0-beta.4][1.0.0-beta.5-compare]

## [1.0.0-beta.4] - 2026-08-04

This beta tightens assembly, validation, persistence, client, transport, and
read contracts while keeping application policy and infrastructure choices
outside the engine.

### Compatibility

- The supported package subpaths include `/advanced`, but beta compatibility
  remains version-specific. Only the newest beta is supported.
- `conceptSet(registrations, computations?)` installs named computations while
  retaining their names and function signatures on `set.computations` and
  `set.vocabulary.computations`.
- Ordinary `assemble(...)` applications reject undeclared advanced refusal
  codes. Manual `createEngine(...)` assembly remains open for advanced hosts.
- Occurrence retention is split from audit export: `MemoryStore` is no longer a
  public hosting contract, `LogSink` is the synchronous application-owned audit
  extension, and `FileLogSink` provides append-only JSONL output.
  `RetentionPolicy` now contains only `"keepAll"` and `{ window: number }`.
- Query declarations now statically connect cardinality metadata to result
  containers. Mutable HTTP and boundary policies are snapshotted when their
  handlers or projectors are constructed.
- Promise-compatible extension points accept structural thenables consistently.

### Migration

- `createEngine(store?: LogStore)` is now
  `createEngine(options?: EngineOptions)`. Occurrence stores are no longer
  replaceable; every engine owns its internal occurrence index. Pass
  `{ retention, logSink }` to configure retention and an audit destination.
  Replace public `MemoryStore` or `FileStore` use with a `LogSink`, such as
  `FileLogSink`, and pass it to `assemble(...)` as `logSink` rather than
  `logStore`. Capture complete, redacted audit evidence through `LogSink`.
  `inspectAssembly(...).occurrences` is only a redacted summary of action
  occurrences still retained by the internal index; it is not an audit stream.
- Replace beta `retention: "evictConsumed"` with `{ window: number }` for a
  bounded number of settled flows or `"keepAll"` for no automatic eviction.
  Ordinary `assemble(...)` defaults to `{ window: 100 }`; `createEngine(...)`
  defaults to `"keepAll"`. Window enforcement runs automatically only after a
  flow settles. Stable v1 exposes no manual prune operation.
- A custom `LogSink.append(entry)` must return `undefined` synchronously. A
  throw or any returned value, including a promise or structural thenable,
  fails the append before the internal index folds the entry.
- Declare every advanced refusal code used by an ordinarily assembled
  application. Hosts intentionally assembling engines manually may continue to
  define refusal policy outside the engine.
- Update query result types to agree with their declared cardinality. TypeScript
  now requires `count(...)` to receive the query's complete input mapping,
  rejects extra fields at every nested level, and rejects union-typed query
  references. Adjust
  custom client transports to carry `timeoutMs` and `correlationId` when those
  per-call options are used.
- Install `@mit-sdg/sync-engine-http@1.0.0-beta.4` with the exact matching core
  beta.
- Regenerate checked-in application manifests, assembled read-back, and wire
  contracts. Expanded endpoint analysis can change advisory diagnostics, and
  corrected optional former results can change generated TypeScript.

### Generated formats

- Application manifest format remains version 3. Generator and projector
  provenance accepts valid Semantic Versioning, including prereleases.
- Regenerate checked-in artifacts so generator and HTTP projector provenance
  records `1.0.0-beta.4`.

### Runtime and security support

- Endpoint success values and declared domain errors can be validated at the
  invocation boundary. Invalid domain errors become integrity evidence rather
  than trusted application responses.
- Privileged `RawFaultReporter` hooks can receive action, interpreter, and
  validator faults without exposing raw failures to ordinary clients; reporter
  failures are isolated.
- Clients can validate complete success-or-error responses and carry per-call
  timeout and correlation context. The HTTP client supports caller timeouts and
  opt-in streaming response-size limits.
- Query caching is explicit through `"memoize"` and `"none"` modes, allowing
  applications to disable memoization without replacing engine policy.
- Endpoint diagnostics trace causal `by` provenance and distinguish potential
  overlap from proved direct-path overlap. They recognize canonical request
  shapes, disjoint literal alternatives, non-dropping `whether` lines, and
  fresh computations.
- Generated endpoint results include `null` when an endpoint directly returns
  an optional former, and blank optional splices retain all recursively
  contributed keys with `null` leaves.
- Beta publication uses immutable annotated tags and verified tarballs,
  publishes core under `beta`, and publishes HTTP only after core succeeds.

[Release][1.0.0-beta.4] | [Changes since 1.0.0-beta.3][1.0.0-beta.4-compare]

## [1.0.0-beta.3] - 2026-07-30

This maintenance beta corrects reaction scheduling, matching, registration, and
HTTP error projection defects found during a runtime audit.

### Compatibility

- Public package exports are unchanged. Trigger and `where` stages for reactions
  observing one landed occurrence now finish before any matching consequence is
  dispatched. A sibling consequence can no longer change another sibling's
  guard result.
- Consequence inputs containing `bigint` now fail registration. Earlier betas
  accepted these values but delivered an internal marker object to the action.
- Serialized `oneOf` candidates now use structural equality and preserve escaped
  literal data. Imported opaque candidates without their definition-site value
  fail registration instead of installing an inert trigger.

### Migration

- Replace `bigint` consequence literals with portable JSON data, or derive the
  value at firing time with a registered computation.
- Remove any dependency on one reaction consequence changing a sibling
  reaction's `where` result for the same occurrence. Such ordering was never a
  supported priority mechanism.

### Generated formats

- None.

### Runtime and security support

- Requested guards no longer run again for outcome landings, and opposite-order
  requested consequences no longer deadlock concurrent flows.
- Failed replacement registration leaves the previous reaction family intact.
  Repeated variables and optional serialized bindings now use the documented
  unification and blank-propagation rules.
- Production HTTP wire projection no longer exposes unmapped domain errors that
  runtime handling reports as `INTERNAL_ERROR`.

[Release][1.0.0-beta.3] | [Changes since 1.0.0-beta.2][1.0.0-beta.3-compare]

## [1.0.0-beta.2] - 2026-07-30

HTTP transport support now ships as the independently published
`@mit-sdg/sync-engine-http` first-party package.

### Compatibility

- This intentional beta breaking change removes HTTP handler, profile, floor,
  fetch client, and HTTP client-error exports from core. Core remains usable
  without the companion package through `createClient<Wire>({ transport })` and
  `bindTransport({ application, gateway })`.
- `@mit-sdg/sync-engine-http` provides `/server`, `/client`, and `/tooling` and
  requires the exact matching core beta as a peer dependency.

### Migration

- Install both exact packages, move server imports to
  `@mit-sdg/sync-engine-http/server`, client imports to `/client`, and wire
  projection imports to `/tooling`.
- Move public domain-error mappings from concept registrations into the reused
  HTTP policy value's `publicErrors` field. Replace `PublicError` members with
  the corresponding HTTP category strings, such as `"CONFLICT"`.
- Replace `httpProfile`, `httpFloor`, and `httpWireName` in `generated.config.ts`
  with `projections: [httpWire({ policy, name })]`, then regenerate artifacts.
- Replace references to HTTP failures on `FrameworkErrorCode` with
  `HttpClientErrorCode`. Generic clients using the HTTP transport should use
  `Client<Wire, HttpClientError>` or `createClient<Wire, HttpClientError>(...)`;
  `createHttpClient<Wire>(...)` supplies that error type directly.
- `GeneratedApplication` is now exported from the core `/tooling` subpath for
  typing application-owned generation descriptors.

### Generated formats

- Generated wire provenance now records every projector package and version.
- Logical wire remains canonical; each projection appends a named transport
  contract to the same generated module.

### Runtime and security support

- Core has no HTTP runtime or type dependency. The companion policy owns HTTP
  status, cookies, origin, correlation, fetch, and public-error projection.
- CI and publication verify both independently packed tarballs before either
  package can be published.

[Release][1.0.0-beta.2] | [Changes since 1.0.0-beta.1][1.0.0-beta.2-compare]

## [1.0.0-beta.1] - 2026-07-29

The beta.0 publication attempt did not reach npm because its publish command
treated the packed tarball path as a Git source. Beta.1 corrects that release
automation without changing the package's public behavior.

### Compatibility

- No public API or behavior changes from beta.0.

### Migration

- None.

### Generated formats

- None.

### Runtime and security support

- The protected publication job passes the verified tarball as an explicit local
  path to npm.

[Release][1.0.0-beta.1] | [Changes since 1.0.0-beta.0][1.0.0-beta.1-compare]

## [1.0.0-beta.0] - 2026-07-28

The beta cutover completes the support, compatibility, production-boundary,
operational-control, and release-supply-chain work audited after alpha.0. It
defines six explicit public subpaths and makes their beta expectations
and generated-contract coupling explicit.

### Compatibility

- The supported package surface remains `/language`, `/assembly`, `/boundary`,
  `/client`, `/tooling`, and `/advanced`. Root and deep imports remain
  unsupported. Beta releases may make incompatible changes with release-specific
  migration notes; `/advanced` remains the highest-churn public surface.
- `compute` moves from `/advanced` to `/language`. The process-level `/utils`
  entrypoint and the implementation-level `Requesting` and `refusalFunnel`
  exports are removed.
- The supported ranges are Node.js `>=24 <25`, Bun `>=1.3.14 <1.4`, and
  TypeScript `>=6 <7`. Current Linux, macOS, and Windows GitHub-hosted runners
  exercise package and test behavior.
- Only the newest beta is supported. Alpha releases are unsupported at beta.0,
  and the newest beta support window ends 30 days after stable 1.0.0 unless a
  later policy extends it. Published versions remain immutable.
- Endpoint declarations provide the authoritative route set. Endpoint and HTTP
  base paths use canonical portable URL pathnames, and deployment prefixes are
  explicit.

### Migration

- Move runtime deployments to Node.js 24 and keep Node below 25. Run the CLI,
  examples, and source scripts with Bun 1.3.14 through the 1.3 line, and use
  TypeScript 6 through the 6.x line.
- Use manual engines under `/advanced` for closures, custom operations,
  object-identity patterns, raw transforms, and whole unlowered definitions.
  Ordinary `assemble(...)` accepts portable reactions, views, and formers.
- Import `compute` from `/language`. Configure redaction through
  `AssemblyOptions.redaction`; hosts own any standalone logging, redaction, or
  diagnostic helpers. There is no public replacement for `Requesting` or
  `refusalFunnel`.
- Treat each endpoint's declared path as authoritative, leave framework-owned
  `path` and `requestId` fields to `receive(...)`, canonicalize endpoint/base
  paths, and declare `basePath: "/api"` explicitly when needed.
- Add `UNAVAILABLE` handling for overload and drain results and make switches
  over framework error codes exhaustive. Admission rejected for overload or
  drain creates no root action occurrence.
- Account for interpreter settlement: when an unanswered request becomes
  quiescent after an interpreter failure, ordinary assembly settles it promptly
  as opaque `INTERNAL_ERROR`; a response already delivered remains authoritative.
- Integrate `Assembly.beginDrain()` / `Assembly.whenIdle()` and
  `Gateway.beginDrain()` / `Gateway.whenIdle()` into host shutdown. Draining
  stops new roots but waits for accepted causal work, including work outliving a
  caller timeout or abort.
- Configure the standard gateway as an `Invoker` decorator. Use its observer for
  limit, drain, and final settlement events and the application store for
  occurrence evidence.
- Consumers of inspected IR must handle `UnloweredIR.known`, which retains the
  triggers, reads, consequences, and patterns that remain knowable around an
  opaque whole definition.
- Use `productionHttpProfile(...)` for public error projection. Add
  `httpFloor(...)` only when the application needs its narrow same-origin cookie
  binding; credential meaning and domain authorization remain application
  responsibilities.
- Configure execution limits, retention, redaction, endpoint validators, and
  bounded operational observers. Use the final `invocation-settled` event for
  request metrics, and call drain methods before closing host-owned floors,
  stores, listeners, or process resources.
- `FileStore` composes a live in-memory occurrence index with an append-only
  JSONL audit sink.
- Artifact commands and `planGenerated(...)` share one manifest-driven
  rendering pipeline.
- Own application redaction through `AssemblyOptions.redaction`; universal
  sensitive-name patterns remain active alongside application fields and patterns.
- Keep a concept specification's optional State section as prose only. It is
  not checked against class fields or storage and does not enter manifests,
  read-back, wire types, input contracts, or runtime validators; prove state
  properties in principle, implementation, and backend constraint tests.

### Generated formats

- Regenerate and review generated Markdown and wire TypeScript after upgrading.
  Generated clients, server assemblies, and generation tooling must use the
  same exact package version; cross-version generated contracts are unsupported.
- `sync-engine.application-manifest` V3 is the current versioned format. It
  carries static application design, endpoint contracts, diagnostics, and its
  digest. Format-version equality does not relax exact package-version coupling.
- Regenerate declarations and all pinned example artifacts before cutting the
  beta. Endpoint input contracts, validator presence, diagnostics, and
  state-prose exclusion are reflected in the current generated surfaces as
  documented.

### Runtime and security support

- Production HTTP handlers enforce bounded POST JSON handling and public error
  projection; the optional cookie floor enforces same-origin credential
  transport. Hosts still own TLS, HSTS, CORS, trusted proxies, connection and
  rate limits, DDoS controls, authentication integration, and process lifecycle.
- Execution limits bound engine-owned admission and causal work. Operational
  observers receive value-free stable events, while application logs and custom
  stores remain sensitive sinks subject to host retention and access controls.
- Vulnerabilities use GitHub private vulnerability reporting. The supported
  security-fix window, acknowledgement targets, coordinated disclosure process,
  and host/application boundary are defined in [SECURITY.md](SECURITY.md).

[Release][1.0.0-beta.0] | [Changes since 1.0.0-alpha.0][1.0.0-beta.0-compare]

## [1.0.0-alpha.0] - 2026-07-27

The first v1 alpha replaces, rather than extends, the 0.3 architecture. It adds
registered concept specifications, fluent reaction declarations, views and
formers, application assembly, generated wire contracts, local/HTTP clients,
and a package-qualified `sync-engine` CLI. The package now ships built ESM
JavaScript and declarations instead of exposing its TypeScript sources.

### Migrating from 0.3

There is no drop-in migration. Rebuild composition around a vocabulary,
registered concepts, reactions, and an assembly; then expose selected behavior
through endpoints. The [guides](docs/guide/getting-started.md) and [public API
register](docs/public-surface.md) describe the new architecture.

| 0.3 entrypoint                                                                            | v1 alpha direction                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package root and `/engine`                                                                | Removed. Use `/language` for declarations, `/assembly` for registration and assembly, and `/advanced` only for manual engine construction. The old declaration-tree API requires a rewrite. |
| <code>/s&#100;k</code>, <code>/s&#100;k/client</code>, <code>/s&#100;k/http-client</code> | Use `/boundary` to author endpoints and adapters, and `/client` to consume generated contracts. The endpoint DSL is redesigned.                                                             |
| <code>/s&#100;k/cli-client</code>                                                         | Removed. `/boundary` provides inbound CLI application adapters, not a drop-in outbound CLI client.                                                                                          |
| `/runtime`                                                                                | Removed. Assembly, log stores, gateways, and boundary floors now own these responsibilities; there is no direct `AppHost` or `Lifecycle` replacement.                                       |
| `/utils`                                                                                  | Remains `/utils`, with a smaller logging, redaction, and error-serialization surface; audit imports individually.                                                                           |
| `/devtools/graph`                                                                         | Removed in 0.2. `/tooling` now provides assembly inspection, read-back, and contract generation, but not a compatible graph API.                                                            |

### Alpha stability

| Public subpath | Compatibility expectation                                            |
| -------------- | -------------------------------------------------------------------- |
| `/language`    | Alpha; authoring syntax and inferred types may change.               |
| `/assembly`    | Alpha; registration, hosting, and persistence contracts may change.  |
| `/boundary`    | Alpha; endpoint and transport contracts may change.                  |
| `/client`      | Alpha; generated contract and client shapes may change together.     |
| `/tooling`     | Alpha; IR, read-back, and generated output may change.               |
| `/advanced`    | Alpha and deliberately low-level; expect the most churn.             |
| `/utils`       | Alpha; no compatibility guarantee despite the retained subpath name. |

Generated files are pinned outputs, not a stable interchange format. Execution,
persistence, restart, validation, and resource bounds are documented under
[operational limits](docs/semantics.md#operational-limits).

The current manifest correctly declares `Apache-2.0`, matching the repository's
license. Published 0.1-0.3 manifests incorrectly declared `MIT`; this metadata
correction does not alter those already-published tarballs.

[Release][1.0.0-alpha.0] | [Changes since 0.3.0][1.0.0-alpha.0-compare]

## [0.3.0] - 2026-07-10

- Replaced the sequencing and branching DSL and added bracket extractors and
  branch predicates.
- Generalized clients around transports.
- Hardened lifecycle, caches, matching, logging, HTTP/CLI handling, and
  concurrent application hosting.
- Tightened query and binding inference and expanded tests and API guides.

[Release][0.3.0] | [Changes since 0.2.0][0.3.0-compare]

## [0.2.0] - 2026-07-08

- Removed the devtools package surface and consolidated the package to one root
  export while retaining engine, client, and runtime source directories.

[Tag][0.2.0] | [Changes since 0.1.1][0.2.0-compare]

## [0.1.1] - 2026-07-08

- Reworked the endpoint DSL to follow the engine's declaration syntax.

[Tag][0.1.1] | [Changes since 0.1.0][0.1.1-compare]

## [0.1.0] - 2026-07-08

- Initial public package with declarative cross-concept reactions over an
  append-only occurrence log, frames-based matching, nested workflows, an
  endpoint/client layer, multi-tenant runtime helpers, utilities, and graph
  devtools.

[Release][0.1.0]

[1.0.0-beta.7]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.7
[1.0.0-beta.7-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.6...v1.0.0-beta.7
[1.0.0-beta.6]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.6
[1.0.0-beta.6-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.5...v1.0.0-beta.6
[1.0.0-beta.5]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.5
[1.0.0-beta.5-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.4...v1.0.0-beta.5
[1.0.0-beta.4]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.4
[1.0.0-beta.4-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.3...v1.0.0-beta.4
[1.0.0-beta.3]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.3
[1.0.0-beta.3-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.2...v1.0.0-beta.3
[1.0.0-beta.2]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.2
[1.0.0-beta.2-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.1...v1.0.0-beta.2
[1.0.0-beta.1]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.1
[1.0.0-beta.1-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.0...v1.0.0-beta.1
[1.0.0-beta.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-beta.0
[1.0.0-beta.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-alpha.0...v1.0.0-beta.0
[1.0.0-alpha.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-alpha.0
[1.0.0-alpha.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.3.0...v1.0.0-alpha.0
[0.3.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.3.0
[0.3.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mit-sdg/sync-engine/tree/v0.2.0
[0.2.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mit-sdg/sync-engine/tree/v0.1.1
[0.1.1-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.1.0
