# Changelog

This project follows semantic versioning. The v1 line is currently alpha: every
public subpath and generated file may change incompatibly between alpha
releases, and alpha releases carry no migration guarantee. Pin an exact version
for evaluation and review the [operational limits](docs/semantics.md#operational-limits)
before deployment.

## [1.0.0-alpha.0] - 2026-07-28

The first supported sync-engine release introduces registered concept
specifications, fluent reaction declarations, views and formers, application
assembly, generated wire contracts, local and HTTP clients, occurrence logging,
and the package-qualified `sync-engine` CLI. The package ships built ESM
JavaScript and declarations through seven explicit public subpaths.

The [documentation index](docs/index.md), [guided
curriculum](docs/guide/getting-started.md), and [Public API
register](docs/public-surface.md) describe the supported surface.

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

[Release][1.0.0-alpha.0]

[1.0.0-alpha.0]: https://github.com/mit-sdg/sync-engine/releases/tag/v1.0.0-alpha.0
