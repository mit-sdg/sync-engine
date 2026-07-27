# Changelog

This project follows semantic versioning. The v1 line is currently alpha: every
public subpath and generated file may change incompatibly between alpha
releases, and alpha releases carry no migration guarantee. Pin an exact version
for evaluation and review the [operational limits](docs/semantics.md#operational-limits)
before deployment.

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

[1.0.0-alpha.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-alpha.0
[1.0.0-alpha.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.3.0...v1.0.0-alpha.0
[0.3.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.3.0
[0.3.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mit-sdg/sync-engine/tree/v0.2.0
[0.2.0-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mit-sdg/sync-engine/tree/v0.1.1
[0.1.1-compare]: https://github.com/mit-sdg/sync-engine/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v0.1.0
