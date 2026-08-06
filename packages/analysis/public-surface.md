# Candidate Public API

This reference defines the repository-private preview surface for
`@mit-sdg/sync-engine-analysis`. The package has no root export and no supported
deep import. It analyzes canonical application manifests and returns plain,
deterministically ordered data.

## `tooling`

`@mit-sdg/sync-engine-analysis/tooling`

<!-- register:analysis-tooling:start -->

`AnalysisIssue`, `AnalysisIssueCode`, `ApplicationIndex`, `ApplicationSourceIndex`, `ContextBundle`, `ContextReaction`, `ContextSelection`, `DesignRef`, `ImpactCertainty`, `ImpactEdge`, `ImpactRelation`, `ImpactTrace`, `ImpactTraceEntry`, `SourceAnchor`, `SourceIndexEntry`, `SourceIndexIssue`, `SourceIndexIssueCode`, `SourcePosition`, `SourceRange`, `SourceResolution`, `SourceRole`, `TraceOptions`, `contextForImpact`, `designRefKey`, `indexApplication`, `indexApplicationSources`, `traceApplicationImpact`

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
