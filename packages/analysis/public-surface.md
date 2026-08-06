# Candidate Public API

This reference defines the repository-private preview surface for
`@mit-sdg/sync-engine-analysis`. The package has no root export and no supported
deep import. It analyzes canonical application manifests and returns plain,
deterministically ordered data.

## `tooling`

`@mit-sdg/sync-engine-analysis/tooling`

<!-- register:analysis-tooling:start -->

`AnalysisIssue`, `AnalysisIssueCode`, `ApplicationIndex`, `ApplicationProjectAnalysis`, `ApplicationProjectDiagnostic`, `ApplicationProjectDiagnosticCategory`, `ApplicationProjectDiagnosticPhase`, `ApplicationProjectDiagnosticRelatedInformation`, `ApplicationProjectFile`, `ApplicationProjectProvenance`, `ApplicationSourceIndex`, `ContextBundle`, `ContextReaction`, `ContextSelection`, `DesignRef`, `ImpactCertainty`, `ImpactEdge`, `ImpactRelation`, `ImpactTrace`, `ImpactTraceEntry`, `LoadApplicationProjectOptions`, `SourceAnchor`, `SourceIndexEntry`, `SourceIndexIssue`, `SourceIndexIssueCode`, `SourcePosition`, `SourceRange`, `SourceResolution`, `SourceRole`, `TraceOptions`, `contextForImpact`, `designRefsForSourceRange`, `designRefKey`, `indexApplication`, `indexApplicationSources`, `loadApplicationProject`, `traceApplicationImpact`

<!-- register:analysis-tooling:end -->

```ts
indexApplication(manifest: ApplicationManifestV4): ApplicationIndex
traceApplicationImpact(
  index: ApplicationIndex,
  seeds: readonly DesignRef[],
  options?: TraceOptions,
): ImpactTrace
contextForImpact(
  manifest: ApplicationManifestV4,
  index: ApplicationIndex,
  trace: ImpactTrace,
  sourceIndex?: ApplicationSourceIndex,
): ContextBundle
indexApplicationSources(options: {
  manifest: ApplicationManifestV4;
  program: Program;
  projectRoot: string;
  readFile?: (absolutePath: string) => string | undefined;
}): ApplicationSourceIndex
designRefsForSourceRange(
  sourceIndex: ApplicationSourceIndex,
  range: { path: string; startOffset?: number; endOffset?: number },
): DesignRef[]
loadApplicationProject(options: LoadApplicationProjectOptions): ApplicationProjectAnalysis
```

The index models structural dependencies, explicit causal asks, and visibly
marked conservative or opaque edges. It does not prove that a reaction will
fire. Concept action-to-query edges are conservative because a manifest does
not describe which owned state each action changes. Unlowered reactions retain
only their known shell and produce an `OPAQUE_DEFINITION` issue.

An impact trace keeps one deterministic shortest witness for every reached
design reference and enforces caller-selected depth and node bounds. A context
bundle includes the selected concept inventories, rendered portable reactions,
views, formers, endpoints, computations, and an explanation of whether each
reference is a seed, affected result, or supporting dependency.

The source index overlays checkout-relative TypeScript and specification ranges
without placing paths in the canonical core manifest. It recognizes direct and
aliased public API imports, conventional concept class names, registrations,
literal view/former/endpoint names, reaction export names, and bounded semantic
footprints. Dynamic or ambiguous declarations remain unresolved and produce a
structured issue rather than a source-order guess.

`designRefsForSourceRange(...)` applies half-open overlap to every source anchor
on the requested project-relative path, treats an equal start and end as a
cursor, deduplicates logical references, and returns all matches in
`designRefKey(...)` order.

`loadApplicationProject(...)` requires explicit `repositoryRoot`,
`tsconfigPath`, `sourceRevision`, `manifest`, `manifestSourceRevision`, and
`expectedManifestDigest`; `readFile` is an optional synchronous replacement.
It rejects paths and symlinks escaping the resolved root, validates the
manifest through core, and requires both revisions and both manifest digests to
agree. It parses the tsconfig with TypeScript, preserves project references,
uses a parent-enabled compiler host, and serializes config, options, global,
syntactic, and semantic diagnostics in deterministic order.

The result has format `sync-engine.application-project-analysis`, version `1`,
and contains the unchanged V1 `applicationIndex` and `sourceIndex`. Its
provenance records the relative tsconfig and project references, TypeScript
version, revisions, manifest digest, and ordered `{ path, digest }` records for
every repository file read. File digests are SHA-256 over the exact UTF-8 text;
`sourceDigest` is SHA-256 over the JSON encoding of that ordered array. One
immutable read layer supplies config parsing, compilation, source attribution,
and hashing, and rejects a file whose bytes visibly change during the load.
The loader never imports project modules or evaluates a manifest config.
