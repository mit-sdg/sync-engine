# Changelog

This project follows semantic versioning. Stable v1 public subpaths, behavior,
and generated-format compatibility follow the [support policy](SUPPORT.md).
Review the [operational limits](docs/operations.md) before deployment.

## Unreleased

This release adds typed registered computations, expands endpoint diagnostics,
tightens `count(...)` contracts, and corrects optional former output shapes.

### Added

- `conceptSet(registrations, computations?)` installs named computations while
  retaining their names and function signatures on `set.computations` and
  `set.vocabulary.computations`.

### Changed

- Endpoint diagnostics trace causal `by` provenance to attribute an eventual
  response to its request path. Only a response that uses the traced request
  identifier on a direct request-to-response answer path contributes to overlap
  or coverage proof. An intermediate action posture makes the path ineligible
  for either proof.
- Overlap diagnostics describe structurally possible intersections as
  potential overlap. On direct paths, the analysis recognizes canonical
  `receive(...)` shapes, disjoint literal request alternatives, non-dropping
  `whether` lines, and fresh computations. Complementary state reads remain
  unproved because sibling reactions observe separate state snapshots.

### Fixed

- TypeScript now requires `count(...)` to receive the query's complete input
  mapping and rejects extra fields at every nested level. It rejects a
  union-typed query reference outright so the input argument cannot select or
  mask one possible query; choose one concrete query before calling `count`.
- A generated endpoint result includes `null` when the endpoint directly
  returns an optional former.
- A blank optional splice retains every recursively contributed key and assigns
  `null` to each leaf.

### Migration

- Regenerate checked-in application manifests, assembled read-back, and wire
  contracts. The expanded endpoint analysis can change advisory diagnostics,
  and corrected optional former results can change generated TypeScript.

## [1.0.0] - 2026-07-31

The first stable release tightens assembly, validation, persistence, client,
and transport contracts while keeping application policy and infrastructure
choices outside the engine.

### Compatibility

- Public API compatibility now follows Semantic Versioning across all supported
  subpaths, including `/advanced`. Only the newest stable 1.x release is
  supported.
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
- Update query result types to agree with their declared cardinality and adjust
  custom client transports to carry `timeoutMs` and `correlationId` when those
  per-call options are used.
- Install `@mit-sdg/sync-engine-http@1.0.0` with a compatible stable core 1.x
  release; its core peer range is now `^1.0.0`.

### Generated formats

- Application manifest format remains version 3. Compatible stable 1.x
  generators are accepted by format version, and projector provenance requires
  valid stable Semantic Versioning.
- Regenerate checked-in artifacts so generator and HTTP projector provenance
  records `1.0.0`.

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
- Stable publication uses immutable annotated tags and verified tarballs,
  publishes core under `latest`, and publishes HTTP only after core succeeds.

[Release][1.0.0] | [Changes since 1.0.0-beta.3][1.0.0-compare]

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

[1.0.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0
[1.0.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v1.0.0-beta.3...v1.0.0
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
