# Support policy

## Public beta surface

The supported public API is exactly these seven package subpaths:

- `@mit-sdg/sync-engine/language`
- `@mit-sdg/sync-engine/assembly`
- `@mit-sdg/sync-engine/boundary`
- `@mit-sdg/sync-engine/client`
- `@mit-sdg/sync-engine/tooling`
- `@mit-sdg/sync-engine/advanced`
- `@mit-sdg/sync-engine/utils`

The package root and all deep imports are unsupported. The [Public
API](docs/public-surface.md) is the exact export register.

## Beta compatibility

Beta releases use Semantic Versioning prerelease identifiers. A newer beta may
make incompatible API, behavior, or generated-format changes. Every release
must identify those changes under `Compatibility` and `Migration`, even when
there are none. Consumers should pin an exact version and review the
[changelog](CHANGELOG.md) before upgrading.

Published versions, tags, and tarballs are immutable. A bad release is not
replaced or silently corrected; a fix receives a new version with migration
notes. The `/advanced` surface may change between package versions, but it is
never changed in place within an immutable version.

Only the newest beta is supported. Alpha releases are unsupported as of
`1.0.0-beta.0`. After stable `1.0.0` is released, the newest beta remains
supported for 30 days, after which beta support ends unless a later policy
explicitly extends it.

## Generated contracts

Generated Markdown and TypeScript wire files belong to the exact sync-engine
version that produced them. Regenerate and review all generated files for every
version change. A generated client, server assembly, and generation tool must
use the same exact package version; cross-version generated contracts are not
supported, even when their shapes happen to match.

`sync-engine.application-manifest` version 2 and
`sync-engine.application-dependency-graph` version 2 are versioned data formats.
An incompatible structural or semantic format change requires a new integer
format version and new public type names. A package release does not bump a
format version when the existing format and meaning remain compatible. Format
version equality alone does not override the exact-package-version policy for
generated Markdown, wire contracts, manifests, or dependency graphs.

## Runtime and toolchain

The supported runtime and toolchain ranges are:

| Surface                                     | Supported range       |
| ------------------------------------------- | --------------------- |
| Built ESM library                           | Node.js `>=24 <25`    |
| CLI, source scripts, examples, and scaffold | Bun `>=1.3.14 <1.4`   |
| Type checking and generated TypeScript      | TypeScript `>=5.9 <6` |

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
