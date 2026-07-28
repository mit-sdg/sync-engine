# Changelog

This project follows semantic versioning. The v1 line is currently beta: public
subpaths, behavior, and generated formats may change incompatibly between beta
releases. Pin an exact version, follow the [support policy](SUPPORT.md), and
review the [operational limits](docs/operations.md) before deployment.

## [1.0.0-beta.0] - 2026-07-28

The beta cutover completes the support, compatibility, production-boundary,
operational-control, and release-supply-chain work audited after alpha.0. It
retains the seven explicit public subpaths and makes their beta expectations
and generated-contract coupling explicit.

### Compatibility

- The supported package surface remains `/language`, `/assembly`, `/boundary`,
  `/client`, `/tooling`, `/advanced`, and `/utils`. Root and deep imports remain
  unsupported. Beta releases may make incompatible changes with release-specific
  migration notes; `/advanced` remains the highest-churn public surface.
- The supported ranges are Node.js `>=24 <25`, Bun `>=1.3.14 <1.4`, and
  TypeScript `>=6 <7`. Current Linux, macOS, and Windows GitHub-hosted runners
  exercise package and test behavior.
- Only the newest beta is supported. Alpha releases are unsupported at beta.0,
  and the newest beta support window ends 30 days after stable 1.0.0 unless a
  later policy extends it. Published versions remain immutable.
- Endpoint declarations now provide the authoritative route set. Endpoint and
  HTTP base paths must use canonical portable URL pathnames; the cookie floor no
  longer supplies an implicit `/api` route.

### Migration

- Move runtime deployments to Node.js 24 and keep Node below 25. Run the CLI,
  examples, and source scripts with Bun 1.3.14 through the 1.3 line, and use
  TypeScript 6 through the 6.x line.
- Inventory every local reaction, view, and former. Non-boundary local behavior
  now requires an exact, sorted `AssemblyOptions.localBehavior` contract and a
  reviewed non-empty revision. Local behavior is forbidden in endpoints,
  transitively reached endpoint reads, and ordinary reactions that touch the
  request boundary; there is no endpoint override.
- Treat each endpoint's declared path as authoritative, remove attempts to bind
  framework-owned `path` or `requestId` fields in `receive(...)`, canonicalize
  endpoint/base paths, and declare `basePath: "/api"` explicitly when needed.
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
- Consumers of inspected IR must handle `UnloweredIR.known`, which retains the
  triggers, reads, consequences, and patterns that remain knowable around an
  opaque whole definition.
- Replace directly exposed raw HTTP adapters with `productionHttpProfile(...)`
  for public error projection. Add `httpFloor(...)` only when the application
  needs its narrow same-origin cookie binding; credential meaning and domain
  authorization remain application responsibilities.
- Configure execution limits, retention, redaction, endpoint validators, and
  bounded operational observers. Use the final `invocation-settled` event for
  request metrics, and call drain methods before closing host-owned floors,
  stores, listeners, or process resources.
- Replace process-global `configureRedaction(...)` calls with an explicitly
  owned `createRedactor(policy)`; `redact(...)` now applies only immutable
  universal sensitive-name patterns.
- Keep a concept specification's optional State section as prose only. It is
  not checked against class fields or storage and does not enter manifests,
  read-back, wire types, input contracts, or runtime validators; prove state
  properties in principle, implementation, and backend constraint tests.

### Generated formats

- Regenerate and review generated Markdown and wire TypeScript after upgrading.
  Generated clients, server assemblies, and generation tooling must use the
  same exact package version; cross-version generated contracts are unsupported.
- `sync-engine.application-manifest` V2 and
  `sync-engine.application-dependency-graph` V2 are the current versioned
  formats. Incompatible format semantics require a new integer version and new
  public type name. Format-version equality does not relax exact package-version
  coupling.
- Regenerate declarations and all pinned example artifacts before cutting the
  beta. Whole unlowered definitions, local-behavior review data, endpoint input
  contracts, validator presence, diagnostics, and state-prose exclusion are
  reflected in the current generated surfaces as documented.

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
