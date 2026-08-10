# Analysis Public Surface

`@mit-sdg/sync-engine-analysis` has no root export or supported deep imports.
Its complete public topology is `/ir` and `/project`.

## `ir`

`@mit-sdg/sync-engine-analysis/ir`

<!-- register:analysis-ir:start -->

`AnalysisAbortedError`, `AnalysisAnalyzerIdentity`, `AnalysisDiagnostic`, `AnalysisDiagnosticOrigin`, `AnalysisDiagnosticRaw`, `AnalysisError`, `AnalysisErrorCode`, `AnalysisErrorData`, `AnalysisIssue`, `AnalysisIssueCode`, `AnalysisLimitError`, `AnalysisLimits`, `AnalysisManifestProvenance`, `AnalysisOptions`, `AnalysisPage`, `AnalysisPageRequest`, `AnalysisProvenance`, `AnalysisResourceUsage`, `AnalysisSeverity`, `ApplicationAnalysis`, `ApplicationAnalysisIdentity`, `ApplicationAnalysisOperationOptions`, `ApplicationAnalysisProvenanceFacts`, `ApplicationIndex`, `ApplicationSourceDocumentRead`, `ApplicationSourceIndex`, `ApplicationSourceQuery`, `ApplicationSourceReadError`, `ApplicationSourceReadErrorCode`, `CatalogFilters`, `CatalogRequest`, `CatalogResult`, `ContractDeclaration`, `ContractFilters`, `ContractsRequest`, `ContractsResult`, `CreateApplicationAnalysisOptions`, `DEFAULT_ANALYSIS_RESOURCE_LIMITS`, `DescriptionDetail`, `DescriptionResult`, `DesignDefinition`, `DesignRef`, `DesignRefInput`, `DesignSummary`, `DiagnosticSeverityCounts`, `DiagnosticsFilters`, `DiagnosticsRequest`, `DiagnosticsResult`, `ImpactCertainty`, `ImpactEdge`, `ImpactRelation`, `ImpactRequest`, `ImpactResult`, `ImpactTrace`, `ImpactTraceEntry`, `IndexedSourceDocument`, `NavigateRequest`, `NavigationDirection`, `NavigationNode`, `NavigationResult`, `ProvenanceRequest`, `ProvenanceResult`, `ReadApplicationSourceDocumentOptions`, `ReactionPortability`, `SearchField`, `SearchHit`, `SearchRequest`, `SearchResult`, `SourceAnchor`, `SourceAvailability`, `SourceIndexEntry`, `SourceIndexIssue`, `SourceIndexIssueCode`, `SourcePosition`, `SourceQueryMatch`, `SourceQueryMatchMode`, `SourceQueryOptions`, `SourceQueryResult`, `SourceRange`, `SourceResolution`, `SourceRole`, `SourceSpecificity`, `SourcesRequest`, `SourcesResult`, `TraceOptions`, `createApplicationAnalysis`, `designRefKey`, `designRefsForSourceRange`, `indexApplication`, `parseDesignRefKey`, `queryApplicationSources`, `readApplicationSourceDocument`, `traceApplicationImpact`

<!-- register:analysis-ir:end -->

This is the lightweight consumer surface. A native ESM import may evaluate Node
crypto for canonical SHA-256 identities, but it does not evaluate the
TypeScript-backed source index builder, project modules, or worker modules. It
also does not load `typescript`, filesystem modules, or worker threads.

The persisted formats on this surface are
`sync-engine.application-index` version 2,
`sync-engine.impact-trace` version 2, and
`sync-engine.application-source-index` version 2. `DesignRef` and
`designRefKey()` provide stable identities for concepts, actions, queries,
reactions, views, formers, computations, and endpoints. `indexApplication()`
builds the deterministic inventory and possible-impact graph from an exact V5
manifest. `traceApplicationImpact()` performs bounded deterministic traversal
and reports explicit incompleteness when limits or unknown seeds prevent a
complete trace.

`ApplicationSourceIndex` is metadata-only plain data. Documents carry relative
paths, lengths, byte lengths, and SHA-256 digests. Anchors carry ranges,
resolution metadata, and slice digests; neither documents nor anchors retain
source bytes or excerpts. `ApplicationSourceQuery` is the one query model used
by `queryApplicationSources()` and the facade. Unknown query discriminants,
extra fields, and malformed `DesignRef` values are rejected.

`readApplicationSourceDocument()` is the source-byte trust boundary. It asks a
caller reader for the complete document, checks path shape, cancellation, byte
limits, length, and SHA-256 identity, and only then returns the verified string.
Clients slice that string with an anchor range and may compare the slice SHA-256
with the anchor digest. `designRefsForSourceRange()` and source queries do not
load TypeScript.

`createApplicationAnalysis(...)` accepts a manifest and an optional strict V2
project snapshot. Supplying `project` also requires `expectedProjectDigest`, a
previously trusted value returned by
`applicationProjectAnalysisDigest(project)` from `/project`. Omission, malformed
digests, and mismatches are rejected before a facade is returned. Computing a
new digest from an untrusted artifact at ingestion explicitly chooses that
different artifact; it is not authentication against prior trust.

The facade always recomputes the canonical application index from the supplied
manifest, using optional `limits`, and requires the snapshot index to have
exactly the same semantic inventory, references, graph, issues, and resource
composition. A self-consistent snapshot cannot introduce definitions absent
from the supplied manifest. Its methods are:

| Method          | Neutral result                                                 |
| --------------- | -------------------------------------------------------------- |
| `catalog()`     | Filtered, paged design inventory                               |
| `search()`      | Token-AND search over identity, contract, and source-path data |
| `describe()`    | Exact summary or raw definition                                |
| `sources()`     | Paged metadata matches for one `ApplicationSourceQuery`        |
| `impact()`      | Bounded possible-impact trace                                  |
| `navigate()`    | Bounded incoming/outgoing graph neighborhood                   |
| `diagnostics()` | Normalized manifest, TypeScript, index, and source diagnostics |
| `contracts()`   | Raw logical endpoint, input-contract, and wire IR              |
| `provenance()`  | Analyzer, manifest, project, revision, TypeScript, and files   |

Search trims a 1-256 UTF-16-unit query, applies locale-invariant
`String.prototype.toLowerCase()`, splits on Unicode whitespace, and requires
every token in the explicitly selected fields. It performs no stemming or
locale-sensitive case mapping.

Requests reject unknown fields and invalid exact references with typed
`AnalysisError` values. Operations check cancellation at deterministic points,
enforce a hard canonical UTF-8 result-byte bound with one size pass, and deeply
freeze returned data. Granular results deliberately have no persisted format,
parser, renderer, validator, or digest API.

`DEFAULT_ANALYSIS_RESOURCE_LIMITS` publishes the exact defaults used when a
member of `AnalysisLimits` is omitted:

| Limit                             | Default     | Resource bounded                                           |
| --------------------------------- | ----------- | ---------------------------------------------------------- |
| `maxGraphNodes`                   | 100,000     | Retained application graph nodes.                          |
| `maxGraphEdges`                   | 500,000     | Retained application graph edges.                          |
| `maxDiagnostics`                  | 10,000      | Retained manifest, TypeScript, index, and source findings. |
| `maxSourceDocuments`              | 20,000      | Distinct indexed source documents.                         |
| `maxSourceAnchors`                | 100,000     | Distinct retained source anchors.                          |
| `maxStaticResolutionDepth`        | 32          | Recursive static-value and symbol resolution steps.        |
| `maxStaticResolutionAlternatives` | 32          | Alternatives retained by one static resolution.            |
| `maxAstCandidates`                | 100,000     | AST nodes inspected during source discovery.               |
| `maxAstNodes`                     | 1,000,000   | AST nodes retained across unique repository source trees.  |
| `maxProjectFiles`                 | 20,000      | Distinct project files.                                    |
| `maxProjectFileBytes`             | 16,777,216  | UTF-8 bytes in one project file (16 MiB).                  |
| `maxProjectTotalBytes`            | 268,435,456 | UTF-8 bytes across project files (256 MiB).                |

Every supplied override must be a non-negative safe integer; zero is allowed.
Exceeding a retained-resource limit throws `AnalysisLimitError` without a
partial artifact. Static-resolution depth and alternatives instead bound the
resolution attempt and can produce unresolved or ambiguous source evidence.

## `project`

`@mit-sdg/sync-engine-analysis/project`

<!-- register:analysis-project:start -->

`AnalyzeApplicationProjectOptions`, `ApplicationProjectAnalysis`, `ApplicationProjectDiagnostic`, `ApplicationProjectDiagnosticCategory`, `ApplicationProjectDiagnosticPhase`, `ApplicationProjectDiagnosticRelatedInformation`, `ApplicationProjectFile`, `ApplicationProjectProvenance`, `IndexApplicationSourcesOptions`, `LoadApplicationProjectOptions`, `SourceAttributionRoot`, `analyzeApplicationProject`, `applicationProjectAnalysisDigest`, `indexApplicationSources`, `loadApplicationProject`, `parseApplicationProjectAnalysis`, `renderApplicationProjectAnalysis`, `validateApplicationProjectAnalysis`

<!-- register:analysis-project:end -->

`sync-engine.application-project-analysis` version 2 is the durable aggregate
format. `indexApplicationSources()` is the TypeScript compiler-backed producer
for metadata-only source indexes. `loadApplicationProject()` loads a complete
transitive TypeScript project graph through a repository-contained immutable
read host. It rejects config, source, import, project-reference, extends, and
symlink escapes; it never executes a project module. Resource limits cover graph
data, diagnostics, source documents and anchors, AST work, project files,
individual file bytes, and total project bytes.

`sourceRevision` and `manifestSourceRevision` are nonblank caller assertions.
Analysis checks that the two assertions agree, but does not invoke Git, inspect a
VCS, or prove that either value names the bytes read. File and aggregate source
digests identify the observed bytes independently of those labels.

`analyzeApplicationProject()` runs filesystem-backed analysis in an emitted
Node worker and terminates that worker on abort. The synchronous loader supports
expert custom readers and observes cancellation at deterministic compiler and
analysis checkpoints, but compiler calls are not timer-preemptive.

`validateApplicationProjectAnalysis()`, `parseApplicationProjectAnalysis()`,
`renderApplicationProjectAnalysis()`, and `applicationProjectAnalysisDigest()`
strictly enforce and identify V2. The parser synchronously consumes one complete
supplied string and has no streaming or input-size option; hosts must bound
untrusted strings before calling it. Validation checks that issue refs belong to
the inventory, anchor and candidate ranges belong to indexed documents, source
documents agree with project file digests and byte lengths, and `projectBytes`
is the exact sum of ordered unique file records. `astNodes` remains a
producer-reported counter. Resource counters are integrity-checked where
derivable, but none is authenticated evidence without comparison to the
previously trusted complete project digest.

Shape validation and canonical hashing do not prove that source attribution is
semantically correct; that would require rerunning TypeScript analysis. A trusted
digest only proves that the complete artifact is unchanged from the artifact the
caller trusted earlier. Exact producer versions remain provenance, and the codec
does not reject a structurally valid snapshot merely for another analyzer
version. Facade construction separately requires semantic equality with the
index recomputed by the running analyzer.

## Boundary

IR and source attribution are deterministic evidence, not proof that behavior
will execute. The package does not provide guidance, prompts, stages, context
packs, change targets, review orchestration, observations, coverage verdicts,
rendered recommendations, authorization allowlists, or approval decisions.
