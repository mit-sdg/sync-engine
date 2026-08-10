# Support policy

## Public beta surface

The core package supports these six subpaths:

- `@mit-sdg/sync-engine/language`
- `@mit-sdg/sync-engine/assembly`
- `@mit-sdg/sync-engine/boundary`
- `@mit-sdg/sync-engine/client`
- `@mit-sdg/sync-engine/tooling`
- `@mit-sdg/sync-engine/advanced`

The package root and deep imports are unsupported. The [core Public
API](docs/user/reference/public-api.md) is the exact export register.

Each independently published package defines its own exports, compatibility,
runtime requirements, and support boundaries in its package README.

## Beta compatibility

Beta releases use Semantic Versioning prerelease identifiers. A newer beta may
make incompatible changes to any public core subpath or core data format. The
[changelog](CHANGELOG.md) records compatibility and migration effects for every
release. Pin an exact version and review the changelog before upgrading.

Published versions, tags, and tarballs are immutable. A correction receives a
new version; maintainers do not replace an existing release.

Only the newest beta is supported. Alpha releases are unsupported.

The current `RetentionPolicy` surface contains only `"keepAll"` and
`{ window: number }`. The earlier prerelease `"evictConsumed"` policy and manual
pruning interfaces are unsupported.

## Generated contracts

Generated Markdown and TypeScript wire files record the core generator and each
projector version that produced them. Regenerate and review generated files
after changing a package version, then typecheck their consumers.

`sync-engine.application-manifest` version 5 is a versioned core format. It
contains the computation inventory and canonical and selected concept
implementation provenance. It does not contain computation functions,
constructor arguments, resources, source paths, object identity, concept state,
or other runtime state.

An incompatible structural or semantic change requires a new integer format
version and new public type names. A package release does not change the format
version when the existing structure and meaning remain compatible.
`sync-engine.application-manifest` version 4 is rejected rather than upgraded.
The artifact planner accepts 1.x core generator identities and projector
provenance with a nonblank package name and valid SemVer version, including
prereleases.

## Runtime and toolchain

The supported core runtime and toolchain ranges are:

| Surface                                | Supported range     |
| -------------------------------------- | ------------------- |
| Built ESM library                      | Node.js `>=24 <25`  |
| Core CLI, setup, scripts, and examples | Bun `>=1.3.14 <1.4` |
| Type checking and generated TypeScript | TypeScript `>=6 <7` |

CI runs on current GitHub-hosted Linux, macOS, and Windows images. Filesystems,
databases, proxies, TLS, process management, and browser behavior remain host or
application responsibilities. Review the [operational
limits](docs/user/reference/operations.md) before deployment.

## Getting help

Search or open a [GitHub issue](https://github.com/mit-sdg/sync-engine/issues)
for reproducible support requests. Include exact package, runtime, and
TypeScript versions, the public subpath in use, a minimal reproduction, and
relevant generated-file diffs. Report suspected vulnerabilities only through
the private process in the [security policy](SECURITY.md).
