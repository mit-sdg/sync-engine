# @mit-sdg/sync-engine-analysis

This independently published public companion provides deterministic static
application indexing, possible-impact tracing, source attribution, durable
project snapshots, bounded context selection, and revision-bound canonical
guidance for sync-engine tooling. It consumes a canonical V5
application manifest and never executes project modules, reactions, or
manifest-producing configuration.

The package has no root export. Its supported entrypoints are
`@mit-sdg/sync-engine-analysis/tooling` and
`@mit-sdg/sync-engine-analysis/guidance`, and it requires the exact matching
core beta as a peer dependency. TypeScript `>=6 <7` is installed as a normal
runtime dependency because source attribution uses the compiler API. The
published package supports Node.js `>=24 <25`.

Comprehensive application, impact, context, source, and project snapshots use
their V2 formats. Granular façade operations return V1
`sync-engine.application-analysis-result` envelopes. All source attribution and
possible-impact outputs carry explicit provenance and limits; they are generic
inspection evidence, not a semantic proof, authorization decision, or approval
verdict.

Filesystem project analysis follows complete, transitive TypeScript project
references and analyzes each config from source, including solution roots with
no files and projects whose declarations have not been built. The synchronous
`loadApplicationProject` primitive supports expert custom readers;
`analyzeApplicationProject` runs filesystem-backed work in a Node worker and
terminates that worker on abort. Project and granular results both have strict
canonical JSON validators, parsers, renderers, and SHA-256 identities.

The `/guidance` entrypoint loads a packaged V1 resource generated from exact
marked H2/H3 sections of the shipped core documentation. It provides strict
resource and selection codecs plus deterministic `ids`, `topics`, `stages`, and
`authority` filtering under entry and UTF-8 content-byte bounds. The loader
reads only its adjacent package JSON, validates and recursively freezes it, and
performs no network or repository lookup.

Guidance identity includes the analysis and core versions, repository, exact
document digests, and source revision. Clean release builds use exact Git
`HEAD`; dirty development builds use `development:<documentsDigest>` rather
than claiming the commit. `ApplicationAnalysis.guidance()` may receive a
validated selection and returns its canonical IDs, paths, and resource identity
alongside the existing issue-derived rules. Neither entrypoint defines prompts,
workflow roles, budgets, gates, or verdicts.

See [the public surface](public-surface.md) for the exact API and boundaries.
