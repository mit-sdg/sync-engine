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
API](docs/user/reference/public-api.md) is the exact export register; the HTTP companion's
[Public API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md)
and the analysis companion's [Public
API](https://github.com/mit-sdg/sync-engine/blob/main/packages/analysis/public-surface.md)
are their exact export registers.

`@mit-sdg/sync-engine-http` is an independently published first-party transport
package with exactly these supported subpaths: `/server`, `/client`, and
`/tooling`. Its root and deep imports are unsupported. Its core peer dependency
requires the exact matching beta release. Core can be installed alone for custom
transports and server adapters.

`@mit-sdg/sync-engine-analysis` is an independently published first-party
analysis package. Its supported subpaths are
`@mit-sdg/sync-engine-analysis/guidance` and
`@mit-sdg/sync-engine-analysis/tooling`; its root and deep imports are
unsupported. The analysis package requires the exact matching core beta as a peer dependency.
TypeScript is a normal runtime dependency of the analysis package, because its
source attribution uses the compiler API. The supported TypeScript range is
still the one listed under [Runtime and toolchain](#runtime-and-toolchain).

## Beta compatibility

Beta releases use Semantic Versioning prerelease identifiers. A newer beta may
make incompatible changes to all six public core subpaths, including
`/advanced`, both analysis subpaths, and the three HTTP subpaths. Every
release identifies compatibility and migration effects in the
[changelog](CHANGELOG.md). Consumers should pin an exact version and review the
changelog before upgrading.

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

`sync-engine.application-manifest` version 5 is a versioned data format. It
includes a complete computation inventory and canonical-versus-selected concept
implementation provenance. Computation functions, constructor arguments,
resources, source paths, object identity, concept state, and other runtime state
are not manifest data. An incompatible structural or semantic format change
requires a new integer format version and new public type names. A package
release does not bump a format version when the existing format and meaning
remain compatible. Generated
assembly compatibility is governed by this manifest format and package SemVer.
`sync-engine.application-manifest` version 4 is rejected rather than upgraded.
The artifact planner accepts 1.x core generator identities and projector
provenance with a nonblank package name and valid SemVer version, including
prereleases.

The analysis package's comprehensive persisted formats are
`sync-engine.application-index` version 2,
`sync-engine.impact-trace` version 2, `sync-engine.impact-context` version 2,
`sync-engine.application-source-index` version 2, and
`sync-engine.application-project-analysis` version 2. Its granular query façade
returns `sync-engine.application-analysis-result` version 1. These formats carry
manifest and analyzer provenance and, where applicable, exact source revision
and digest identity. Pagination offsets are valid only for the same snapshot.
Project and granular result parsers validate canonical composition before data
is accepted or hashed.

Canonical package guidance uses `sync-engine.guidance-resource` version 1 and
`sync-engine.guidance-selection` version 1. The resource embeds exact marked
sections from the shipped consumer documentation, not `docs/user/llms.txt`, and
carries analysis/core producer versions, document digests, and a truthful source
revision. A clean release artifact must use the exact 40-hex release commit. A
dirty development checkout uses `development:<documentsDigest>` and never
claims `HEAD`. Selection remains deterministic and reports `complete: false`
when an entry or content-byte bound omits matching guidance.

Source attribution is bounded static evidence. It does not import or execute a
project module or manifest-producing configuration, and unresolved, ambiguous,
dynamic, cyclic, or over-limit flows are reported rather than guessed. The
analysis package is generic infrastructure and does not return approval verdicts.
Possible-impact results do not prove that behavior will run, and no analysis
result is an authorization allowlist or correctness decision.

Filesystem project analysis supports solution-style roots and transitive
TypeScript project references without prebuilt declarations. The async API is a
Node-worker capability: abort terminates the worker, while the synchronous
custom-reader primitive and compiler parsing remain deterministic-checkpoint,
not timer-preemptive, operations.

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
review the [operational limits](docs/user/reference/operations.md) before deployment.

## Getting help

Search or open a [GitHub issue](https://github.com/mit-sdg/sync-engine/issues)
for reproducible support requests. Include the exact package, runtime, and
TypeScript versions, the public subpath in use, a minimal reproduction, and
generated-file diffs where relevant. Report suspected vulnerabilities only
through the private process in the [security policy](SECURITY.md).
