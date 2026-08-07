# @mit-sdg/sync-engine-analysis

This independently published public companion provides deterministic access to
sync-engine application IR and optional checkout-bound source evidence. It
consumes canonical V5 application manifests and never imports project modules or
executes manifest-producing configuration.

The package has no root export. It has exactly two supported entrypoints:

- `@mit-sdg/sync-engine-analysis/ir` contains portable manifest indexing,
  possible-impact tracing, plain source/project data types, pure source queries,
  neutral diagnostics, and the optional `createApplicationAnalysis(...)` query
  facade. Importing this entrypoint does not evaluate TypeScript, filesystem,
  worker, project-loader, or source-index-builder modules.
- `@mit-sdg/sync-engine-analysis/project` contains the TypeScript-backed source
  indexer, bounded filesystem project loader, cancellable Node worker, project
  diagnostics and producer options, and strict project snapshot codecs.

TypeScript `>=6 <7` remains a normal runtime dependency because this is one npm
package, but clients that only import `/ir` do not load the compiler. The package
requires the exact matching core beta as a peer dependency and supports Node.js
`>=24 <25`.

The small facade exposes only `catalog`, `search`, `describe`, `sources`,
`impact`, `navigate`, `diagnostics`, `contracts`, and `provenance`. Granular
results are bounded immutable values, not a second persisted wire format. Search
uses locale-invariant lowercase token matching over identity, raw contract, and
source-path fields. Descriptions return summaries or raw definitions. Contracts
return raw logical endpoint/input/wire IR without rendering or projections.

The persisted formats are `sync-engine.application-index` version 2,
`sync-engine.impact-trace` version 2,
`sync-engine.application-source-index` version 2, and
`sync-engine.application-project-analysis` version 2. The project format carries
exact analyzer, core generator, TypeScript, revision-label, and file-digest
provenance. Source indexes retain paths, ranges, lengths, and digests, never
source bytes or excerpts. Call `readApplicationSourceDocument(...)` with a
reader to verify a complete document before slicing an anchor range.

Project-backed facade construction recomputes the canonical index from the
supplied manifest and rejects a snapshot whose semantic composition differs. It
also requires `expectedProjectDigest`, previously retained from
`applicationProjectAnalysisDigest(project)`. Shape validation is not
authentication: computing a fresh digest from attacker-chosen data explicitly
trusts a different artifact, and no codec can prove semantic source attribution
without rerunning TypeScript.

Project file records include exact UTF-8 byte lengths; `projectBytes` is their
sum. Derivable counters and source/document relationships are integrity-checked,
while AST work remains producer-reported and gains authenticity only through a
previously trusted complete project digest. Revision strings are caller
assertions, not Git verification. The project JSON parser synchronously consumes
a complete supplied string without an input-size limit, so hosts must bound
untrusted input before calling it.

`DEFAULT_ANALYSIS_RESOURCE_LIMITS` is exported from `/ir` with literal member
types. The complete table in [the public surface](public-surface.md#ir)
documents defaults for graph, diagnostics, source attribution, static
resolution, AST work, and project file counts and bytes.

This package intentionally contains no prompts, canonical guidance, workflow
stages, context packing, change targeting, review orchestration, observations,
coverage labels, rendered advice, authorization decisions, or approval verdicts.
Clients own those policies outside the package.

See [the public surface](public-surface.md) for exact exports and behavior.
