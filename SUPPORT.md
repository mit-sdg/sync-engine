# Support policy

## Public stable surface

The core package's supported public API is exactly these six package subpaths:

- `@mit-sdg/sync-engine/language`
- `@mit-sdg/sync-engine/assembly`
- `@mit-sdg/sync-engine/boundary`
- `@mit-sdg/sync-engine/client`
- `@mit-sdg/sync-engine/tooling`
- `@mit-sdg/sync-engine/advanced`

The package root and all deep imports are unsupported. The [Public
API](docs/public-surface.md) is the exact export register.

`@mit-sdg/sync-engine-http` is an independently published first-party transport
package with exactly these supported subpaths: `/server`, `/client`, and
`/tooling`. Its root and deep imports are unsupported. Its core peer dependency
is `^1.0.0`. Core can be installed alone for custom transports and server
adapters.

## Stable compatibility

Stable releases follow Semantic Versioning. All six public core subpaths,
including `/advanced`, and the three HTTP subpaths follow the same stable SemVer
policy. The current stable release is `1.0.0`. Every release identifies
compatibility and migration effects in the [changelog](CHANGELOG.md). Consumers
should use `@latest` for the current release or pin an exact version for
reproducibility, and review the changelog before upgrading.

Published versions, tags, and tarballs are immutable. A bad release is not
replaced or silently corrected; a fix receives a new version with migration
notes.

Only the newest stable 1.x release is supported. Alpha and beta releases are
unsupported after stable `1.0.0`.

## Generated contracts

Generated Markdown and TypeScript wire files record the exact core generator and
projector versions that produced them. Regenerate and review generated files for
every package version change and typecheck their consumers.

`sync-engine.application-manifest` version 3 is a versioned data format. An
incompatible structural or semantic format change requires a new integer format
version and new public type names. A package release does not bump a format
version when the existing format and meaning remain compatible. Generated
assembly compatibility is governed by this manifest format and stable package
SemVer. The artifact planner accepts stable 1.x core generator identities and
projector provenance with a nonblank package name and stable SemVer version;
prerelease generator and projector identities are not accepted.

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
