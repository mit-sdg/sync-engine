# Support policy

## Public beta surface

The core package's supported public API is exactly these six package subpaths:

- `@mit-sdg/sync-engine/language`
- `@mit-sdg/sync-engine/assembly`
- `@mit-sdg/sync-engine/boundary`
- `@mit-sdg/sync-engine/client`
- `@mit-sdg/sync-engine/tooling`
- `@mit-sdg/sync-engine/advanced`

The package root and all deep imports are unsupported. The [core Public
API](docs/public-surface.md) is the exact export register; the HTTP companion's
[Public API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md)
is its exact export register.

`@mit-sdg/sync-engine-http` is an independently published first-party transport
package with exactly these supported subpaths: `/server`, `/client`, and
`/tooling`. Its root and deep imports are unsupported. Its core peer dependency
requires the exact matching beta release. Core can be installed alone for custom
transports and server adapters.

## Beta compatibility

Beta releases use Semantic Versioning prerelease identifiers. A newer beta may
make incompatible changes to all six public core subpaths, including
`/advanced`, and the three HTTP subpaths. Every release identifies compatibility
and migration effects in the [changelog](CHANGELOG.md). Consumers should pin an
exact version and review the changelog before upgrading.

Published versions, tags, and tarballs are immutable. A bad release is not
replaced or silently corrected; a fix receives a new version with migration
notes.

Only the newest beta is supported. Alpha releases are unsupported.

The current `RetentionPolicy` surface contains only `"keepAll"` and
`{ window: number }`. The earlier prerelease `"evictConsumed"` policy and manual
pruning interfaces are no longer supported.

## Generated contracts

Generated Markdown and TypeScript wire files record the exact core generator and
projector versions that produced them. Regenerate and review generated files for
every package version change and typecheck their consumers.

`sync-engine.application-manifest` version 3 is a versioned data format. An
incompatible structural or semantic format change requires a new integer format
version and new public type names. A package release does not bump a format
version when the existing format and meaning remain compatible. Generated
assembly compatibility is governed by this manifest format and package SemVer.
The artifact planner accepts 1.x core generator identities and projector
provenance with a nonblank package name and valid SemVer version, including
prereleases.

## Runtime and toolchain

The supported runtime and toolchain ranges are:

| Surface                                     | Supported range     |
| ------------------------------------------- | ------------------- |
| Built ESM library                           | Node.js `>=24 <25`  |
| CLI, source scripts, examples, and scaffold | Bun `>=1.3.14 <1.4` |
| Type checking and generated TypeScript      | TypeScript `>=6 <7` |

CI exercises current GitHub-hosted Linux, macOS, and Windows images for package
and test behavior. Host-specific filesystems, databases, proxies, TLS, process
management, and browser behavior remain host or application responsibilities;
review the [operational limits](docs/operations.md) before deployment.

## Getting help

Search or open a [GitHub issue](https://github.com/mit-sdg/sync-engine/issues)
for reproducible support requests. Include the exact package, runtime, and
TypeScript versions, the public subpath in use, a minimal reproduction, and
generated-file diffs where relevant. Report suspected vulnerabilities only
through the private process in the [security policy](SECURITY.md).
