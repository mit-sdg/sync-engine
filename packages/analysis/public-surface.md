# Application Analysis API

`@mit-sdg/sync-engine-analysis` is an independently published public package.
It has no root export and supports no deep imports. Its entrypoints are
`@mit-sdg/sync-engine-analysis/guidance` and
`@mit-sdg/sync-engine-analysis/tooling`.

The package requires Node.js `>=24 <25`, the exact matching core beta as a
peer, and TypeScript `>=6 <7` as a runtime dependency. Every API below is
generic inspection infrastructure: results carry evidence and limits, never a
semantic proof, authorization decision, or approval verdict.

Byte limits use binary units: 1 KiB is 1,024 bytes and 1 MiB is 1,048,576
bytes.

## `guidance`

`@mit-sdg/sync-engine-analysis/guidance`

<!-- register:analysis-guidance:start -->

`GuidanceAuthority`, `GuidanceDocumentRecord`, `GuidanceEntry`, `GuidanceFilters`, `GuidanceProducer`, `GuidanceResource`, `GuidanceResourceV1`, `GuidanceSelection`, `GuidanceSelectionV1`, `GuidanceSource`, `GuidanceStage`, `GuidanceTopic`, `NormalizedGuidanceFilters`, `guidanceResourceDigest`, `guidanceSelectionDigest`, `loadGuidanceResource`, `parseGuidanceResource`, `parseGuidanceSelection`, `renderGuidanceResource`, `renderGuidanceSelection`, `selectGuidance`, `validateGuidanceResource`, `validateGuidanceSelection`

<!-- register:analysis-guidance:end -->

### Canonical resource

`GuidanceResourceV1` has format `sync-engine.guidance-resource`, version `1`,
and is also named by the current `GuidanceResource` alias. It carries the exact
analysis and core producer versions; repository, revision, and aggregate
document identity; ordered document path/digest records; ordered marked section
entries; and a top-level digest. Each entry carries its stable ID, heading title,
path and anchor, exact inclusive line range, authority, topic and stage tags,
exact UTF-8 section content, and content digest.

`GuidanceStage` is `design | implementation | verification | review | repair |
operation`. `GuidanceAuthority` is `criteria | procedure | reference`.
`GuidanceTopic` is the closed vocabulary `application-model`, `concept-design`,
`concept-boundaries`, `state-ownership`, `actions-queries`,
`concept-specification`, `composition`, `reactions`, `reads`, `boundaries`,
`runtime-semantics`, `failure-recovery`, `security`, `generated-artifacts`,
`verification`, `operations`, and `release-compatibility`.

V1 is a package-specific format, not a general documentation container. Its
document catalog is exactly `docs/user/design.md`,
`docs/user/guide/authoring.md`, `docs/user/guide/persistence-recovery.md`,
`docs/user/guide/read-construction.md`,
`docs/user/guide/reviewing-a-design.md`, `docs/user/overview.md`,
`docs/user/reference/concept-specification.md`,
`docs/user/reference/operations.md`, `docs/user/reference/public-api.md`, and
`docs/user/reference/semantics.md`. The validator also requires the producer
versions built into the installed beta.7 package. It does not accept a resource
from another analysis or core version.

The resource generator hashes each exact document and extracted content byte
sequence. `documentsDigest` hashes canonical JSON for the ordered document
records. The resource digest hashes canonical JSON for every field except
`digest`. Generation has no timestamp, absolute path, directory enumeration, or
environment-dependent order.

The source revision is truthful by construction. An explicit
`SYNC_ENGINE_SOURCE_REVISION` must be exactly 40 hex characters and equal Git
`HEAD` when Git is available. Without it, a clean checkout uses exact `HEAD`; a
dirty checkout or non-Git source uses
`development:<documentsDigest>`. Release verification supplies the exact tagged
commit and rejects a non-release identity in the packed artifact.

`loadGuidanceResource()` reads only `guidance-resource.json` adjacent to the
emitted Node ESM module. It performs no network, package-main URL, or repository
path lookup. The first successful load is strictly validated, recursively
frozen, and process-cached; callers receive that documented immutable value.

`validateGuidanceResource`, `parseGuidanceResource`, and
`renderGuidanceResource` enforce the exact V1 shape, producer versions, closed
tags, ordering, range non-overlap, topic/stage coverage, entry content digests,
the document list, and aggregate digests. `guidanceResourceDigest` validates
before recomputing the top-level identity. Parsing accepts non-canonical JSON;
rendering emits canonical ordinal-key JSON with a final newline.

Runtime resource validation has no repository checkout or original document
bytes. It checks the resource's internal digest relationships; it does not
independently verify document records or the claimed Git revision. Those claims
come from the package generator and release process described above.

### Deterministic selection

`selectGuidance(resource, filters)` accepts set-valued `ids`, `topics`, `stages`,
and `authority` filters. It deduplicates and ordinally sorts every filter and
applies dimensions conjunctively. An omitted or empty dimension imposes no
restriction. A named ID absent from the resource is an error. Matching entries
retain resource ID order.

`maxEntries` defaults to `50` and has a hard maximum of `1,000`. `maxBytes`
defaults to 256 KiB and has a hard maximum of 4 MiB. Both values may be zero and
must otherwise be non-negative safe integers. `maxBytes` measures the sum of
the exact UTF-8 bytes of selected entry content; it does not include entry
metadata or the rendered selection envelope. Selection takes the bounded
matching prefix and sets `complete: false` if either bound omits any match.
Observing an aborted signal at a selection checkpoint throws a DOM
`AbortError`; no partial selection is returned. Selection is synchronous, so
checkpoint cancellation is not timer-preemptive.

Malformed resources, filters, and enum values throw `TypeError`. Unknown exact
IDs and invalid or over-maximum bounds throw `RangeError`.

`GuidanceSelectionV1`, also named by `GuidanceSelection`, has format
`sync-engine.guidance-selection`, version `1`, and carries producer/source
identity, the source resource digest, normalized filters, selected full entries,
explicit completeness, and its own canonical digest. Its validate, parse,
render, and digest functions apply strict plain-JSON and internal-consistency
checks. `validateGuidanceSelection()` has no resource argument, so it cannot
establish that the entries came from the resource named by `resourceDigest` or
recompute completeness against that resource. A consumer making that claim
must retain and trust the identified resource. SHA-256 digests identify bytes;
they are not signatures.

`loadGuidanceResource()` and the parse and validate functions read or process
the complete value without a cancellation or input-size option. Selection
bounds do not bound resource loading, resource validation, or selection
metadata. Callers accepting an untrusted JSON string must impose an external
input-size bound.

## `tooling`

`@mit-sdg/sync-engine-analysis/tooling`

<!-- register:analysis-tooling:start -->

`AnalysisAbortedError`, `AnalysisAnalyzerIdentity`, `AnalysisDiagnostic`, `AnalysisDiagnosticOrigin`, `AnalysisDiagnosticRaw`, `AnalysisError`, `AnalysisErrorCode`, `AnalysisErrorData`, `AnalysisGuidance`, `AnalysisGuidanceTopic`, `AnalysisIssue`, `AnalysisIssueCode`, `AnalysisLimitError`, `AnalysisLimits`, `AnalysisManifestProvenance`, `AnalysisOptions`, `AnalysisPage`, `AnalysisPageRequest`, `AnalysisProvenance`, `AnalysisResourceUsage`, `AnalysisSeverity`, `AnalyzeApplicationProjectOptions`, `ApplicationAnalysis`, `ApplicationAnalysisIdentity`, `ApplicationAnalysisOperationOptions`, `ApplicationAnalysisProvenanceFacts`, `ApplicationAnalysisResult`, `ApplicationAnalysisResultKind`, `ApplicationIndex`, `ApplicationProjectAnalysis`, `ApplicationProjectDiagnostic`, `ApplicationProjectDiagnosticCategory`, `ApplicationProjectDiagnosticPhase`, `ApplicationProjectDiagnosticRelatedInformation`, `ApplicationProjectFile`, `ApplicationProjectProvenance`, `ApplicationSourceDocumentRead`, `ApplicationSourceIndex`, `ApplicationSourceQuery`, `ApplicationSourceReadError`, `ApplicationSourceReadErrorCode`, `CatalogFilters`, `CatalogRequest`, `CatalogResult`, `CanonicalGuidanceLink`, `CanonicalGuidanceReference`, `ChangeTargetFile`, `ChangeTargetRequest`, `ChangeTargetResult`, `ContextBundle`, `ContextReaction`, `ContextSelection`, `ContractDeclaration`, `ContractDetail`, `ContractFilters`, `ContractRenderings`, `ContractsRequest`, `ContractsResult`, `CreateApplicationAnalysisOptions`, `DescriptionDetail`, `DescriptionResult`, `DesignDefinition`, `DesignRef`, `DesignRefInput`, `DesignSummary`, `DiagnosticSeverityCounts`, `DiagnosticsFilters`, `DiagnosticsRequest`, `DiagnosticsResult`, `GuidanceFilters`, `GuidanceRequest`, `GuidanceResult`, `ImpactCertainty`, `ImpactEdge`, `ImpactRelation`, `ImpactRequest`, `ImpactResult`, `ImpactTrace`, `ImpactTraceEntry`, `IndexedSourceDocument`, `IndexApplicationSourcesOptions`, `LoadApplicationProjectOptions`, `NavigateRequest`, `NavigationDirection`, `NavigationNode`, `NavigationResult`, `ProvenanceRequest`, `ProvenanceResult`, `ReadApplicationSourceDocumentOptions`, `ReactionPortability`, `ReviewAspect`, `ReviewChangeOptions`, `ReviewChangeType`, `ReviewContractChange`, `ReviewCoverage`, `ReviewDesignChange`, `ReviewFileChange`, `ReviewResult`, `ReviewTargetDrift`, `SearchField`, `SearchHit`, `SearchRequest`, `SearchResult`, `SourceAnchor`, `SourceAttributionRoot`, `SourceAvailability`, `SourceContent`, `SourceExcerpt`, `SourceIndexEntry`, `SourceIndexIssue`, `SourceIndexIssueCode`, `SourceMatch`, `SourceMatchMetadata`, `SourceMatchMode`, `SourcePosition`, `SourceQuery`, `SourceQueryMatch`, `SourceQueryMatchMode`, `SourceQueryOptions`, `SourceQueryResult`, `SourceRange`, `SourceResolution`, `SourceRole`, `SourceSpecificity`, `SourcesRequest`, `SourcesResult`, `TraceOptions`, `analyzeApplicationProject`, `applicationAnalysisResultDigest`, `applicationProjectAnalysisDigest`, `contextForImpact`, `createApplicationAnalysis`, `designRefKey`, `designRefsForSourceRange`, `indexApplication`, `indexApplicationSources`, `loadApplicationProject`, `parseApplicationAnalysisResult`, `parseApplicationProjectAnalysis`, `parseDesignRefKey`, `queryApplicationSources`, `readApplicationSourceDocument`, `renderApplicationAnalysisResult`, `renderApplicationProjectAnalysis`, `traceApplicationImpact`, `validateApplicationAnalysisResult`, `validateApplicationProjectAnalysis`

<!-- register:analysis-tooling:end -->

## Snapshot Layers

The package has two layers that serve different persistence and query needs.

The comprehensive primitives produce V2 snapshots and bounded source queries:

```ts
indexApplication(manifest, options?)
indexApplicationSources(options)
loadApplicationProject(options)
await analyzeApplicationProject(options)
traceApplicationImpact(index, seeds, options?)
contextForImpact(manifest, index, trace, sourceIndex?, options?)
queryApplicationSources(sourceIndex, query, options?)
readApplicationSourceDocument(sourceIndex, path, options)
```

The tooling entrypoint owns these discriminated formats:

| Public type                  | `format`                                   | Version |
| ---------------------------- | ------------------------------------------ | ------- |
| `ApplicationIndex`           | `sync-engine.application-index`            | 2       |
| `ImpactTrace`                | `sync-engine.impact-trace`                 | 2       |
| `ContextBundle`              | `sync-engine.impact-context`               | 2       |
| `ApplicationSourceIndex`     | `sync-engine.application-source-index`     | 2       |
| `ApplicationProjectAnalysis` | `sync-engine.application-project-analysis` | 2       |
| `ApplicationAnalysisResult`  | `sync-engine.application-analysis-result`  | 1       |

`ApplicationIndex` is the complete logical inventory and possible-impact graph
for one canonical V5 manifest. `ApplicationSourceIndex` overlays source anchors
for one checkout. `ApplicationProjectAnalysis` combines that exact index and
source overlay with TypeScript diagnostics, file digests, revisions, and
configuration facts. Only `ApplicationProjectAnalysis` and the granular result
union have public parse, render, and validate codecs. The index, trace, context,
and source-index types are serializable data, but the package exposes no
standalone persistence codec for them; strict project validation covers their
nested V2 values.

`sourceRoots` may identify exact project-relative module exports or source
offsets when a project contains more than one compatible `assemble` call.
`indexApplicationSources` accepts either one `Program` or a program array and
indexes each canonical owned source tree once. A supplied program array must
contain at least one `Program`.

The generic façade exposes bounded granular operations without changing those
primitives:

```ts
const analysis = createApplicationAnalysis({ manifest, project? })

await analysis.catalog(request?)
await analysis.search(request)
await analysis.describe(request)
await analysis.sources(request)
await analysis.impact(request)
await analysis.diagnostics(request?)
await analysis.guidance(request?)
await analysis.navigate(request)
await analysis.target(request)
await analysis.contracts(request?)
await analysis.provenance(request?)
await analysis.reviewChange(before, options?)
```

Construction validates the canonical V5 manifest, recomputes its complete V2
application index, and rejects stale caller-supplied project/index/source
composition. It clones and recursively freezes all retained snapshots. No
project module or manifest-producing configuration is imported or executed.

## Construction Limits

`AnalysisOptions.limits` controls synchronous primitive construction.

| `AnalysisLimits` member           | Default   | Resource bounded                                                                |
| --------------------------------- | --------- | ------------------------------------------------------------------------------- |
| `maxGraphNodes`                   | 100,000   | Retained application-index nodes.                                               |
| `maxGraphEdges`                   | 500,000   | Retained application-index edges.                                               |
| `maxDiagnostics`                  | 10,000    | Retained manifest/TypeScript diagnostics and index/source issues.               |
| `maxSourceDocuments`              | 20,000    | Distinct indexed source documents.                                              |
| `maxSourceAnchors`                | 100,000   | Distinct retained source anchors.                                               |
| `maxSourceTextBytes`              | 64 MiB    | Exact UTF-8 bytes of retained anchor text, after duplicate anchors are removed. |
| `maxStaticResolutionDepth`        | 32        | Recursive static value, symbol, return, property, and class-resolution steps.   |
| `maxStaticResolutionAlternatives` | 32        | Object entries or module exports admitted by one static resolution.             |
| `maxAstCandidates`                | 100,000   | AST nodes inspected during source-call discovery.                               |
| `maxAstNodes`                     | 1,000,000 | AST nodes retained across distinct selected repository source trees.            |
| `maxProjectFiles`                 | 20,000    | Distinct repository files read by project analysis.                             |
| `maxProjectFileBytes`             | 16 MiB    | Exact UTF-8 bytes in one repository file.                                       |
| `maxProjectTotalBytes`            | 256 MiB   | Exact UTF-8 bytes across distinct repository files read by project analysis.    |

Each supplied limit must be a non-negative safe integer; zero is permitted.
There is no separate built-in maximum for a caller-supplied construction limit.
An invalid configured value throws `TypeError`. Exceeding a graph, diagnostic,
document, anchor, text, AST, or project-file limit throws `AnalysisLimitError`,
including the selected limit, maximum, and attempted value. No primitive
construction artifact is returned. Exceeding a static-resolution depth or
alternatives bound instead leaves that flow unresolved; source attribution may
then emit an unresolved or ambiguous issue.

The counters cover retained or inspected resources, not process memory. Project
analysis shares one controller across manifest diagnostics, TypeScript project
loading, graph construction, and source indexing, so its limits apply to the
combined operation. `AnalysisResourceUsage` reports the resulting deduplicated
counters.

`createApplicationAnalysis()` has no `limits` or `signal` option. It always
recomputes the V2 application index synchronously with the defaults above. A
manifest that exceeds those defaults cannot be wrapped by the façade, even if a
caller previously built a primitive index with raised limits.

## Identity, Provenance, And Persistence

`ApplicationAnalysisIdentity` carries the manifest digest, analysis digest,
analysis package version, core generator version, and, for project-backed
analysis, the source revision and source digest. A manifest-only analysis uses
the canonical digest of its recomputed comprehensive V2 index as
`analysisDigest`; a project-backed analysis uses
`applicationProjectAnalysisDigest(project)`. This identity makes offset
pagination safe only while the caller keeps using the same snapshot.

`loadApplicationProject()` requires `sourceRevision` and
`manifestSourceRevision` to be equal, but it does not inspect Git or otherwise
verify that label against the checkout. The ordered file records and
`sourceDigest` bind the repository files actually read. They do not establish
that the caller-supplied revision label is truthful or that every repository
file was read. Each file digest is SHA-256 over its exact UTF-8 text.
`sourceDigest` is SHA-256 over `JSON.stringify()` of the ordered `{ path,
digest }` records.

`validateApplicationProjectAnalysis`, `parseApplicationProjectAnalysis`, and
`renderApplicationProjectAnalysis` strictly validate every project field,
nested V2 index/source shapes and provenance, revisions, ordering, hashes,
source text/ranges, TypeScript identity, diagnostics, issues, and resource
usage. `applicationProjectAnalysisDigest` validates first and hashes canonical
JSON. Malformed JSON fails with `AnalysisError` rather than escaping as an
untyped parser exception.

The project and granular-result parse and validate functions have no input-byte
or collection-count option. They process the complete supplied JSON value
synchronously. Bound an untrusted serialized input before parsing it.

Every granular result has the shared envelope:

```ts
{
  format: "sync-engine.application-analysis-result";
  version: 1;
  kind: ApplicationAnalysisResultKind;
  identity: ApplicationAnalysisIdentity;
  provenance: AnalysisProvenance;
  complete: boolean;
  resourceUsage: AnalysisResourceUsage;
}
```

In a granular result, `resourceUsage` counts evidence retained in that result;
it is not a CPU, allocation, peak-memory, or full-scan-work measurement. The
canonical result-byte limit is separate. Every successful façade result is
recursively frozen before its promise resolves.

`renderApplicationAnalysisResult`, `parseApplicationAnalysisResult`, and
`validateApplicationAnalysisResult` enforce exact discriminator-specific
top-level fields, nested basic shape, finite numbers, and identity/provenance
agreement. `applicationAnalysisResultDigest` is SHA-256 over canonical stable
JSON. Validation rejects unknown top-level fields and verifies canonical JSON
and digest round trips; it is not a top-level cast.

Granular-result validation does not replay the operation, authenticate the
producer, or prove every operation-specific completeness claim. The digest is
computed separately and is not an embedded signature. Treat a parsed result as
trusted evidence only when its source and expected identity are trusted.

`designRefKey` encodes an unambiguous JSON tuple. `parseDesignRefKey` is its
strict inverse and rejects unknown kinds, wrong tuple arity or types, and empty
names. Façade methods accept exact `DesignRef` objects or these keys. A
well-formed reference absent from manifest inventory fails with `NOT_FOUND`;
referenced-only graph nodes are not definitions.

## Ordering And Pagination

All design collections use `designRefKey` order unless an operation documents
a stronger primary order. Search ranks first and uses `designRefKey` as its
tie-breaker. Source matches use specificity, shortest containing anchor,
resolution, and then reference/range order. Diagnostics use stable IDs,
guidance uses stable rule IDs, files use POSIX path order, and graph edges use
their full directed edge tuple. Project file records and the complete transitive
project-config path list use ordinal POSIX path order; internal program creation
uses deterministic dependency-first topological order.

The following façade collections accept `page: { offset?, limit? }`:

| Operation       | Paged collection                                 |
| --------------- | ------------------------------------------------ |
| `catalog()`     | Filtered design summaries.                       |
| `search()`      | Ranked search hits.                              |
| `sources()`     | Ranked source matches.                           |
| `diagnostics()` | Unified diagnostics.                             |
| `guidance()`    | Issue-derived guidance, not `canonicalGuidance`. |
| `contracts()`   | Endpoint declarations.                           |
| `provenance()`  | Project file digest records.                     |

For every row, `offset` defaults to `0`, `limit` defaults to `50`, and the hard
`limit` maximum is `200`. `offset` must be a non-negative safe integer, and
`limit` must be a safe integer from 1 through 200. Results carry the filtered
`total`, the current `items`, and `nextOffset`. `nextOffset` strictly advances a
non-empty page and is `null` at the end. Pagination does not change a result's
`complete` value. Offset pagination is stable only while the analysis identity
is unchanged. Set-valued filter inputs are deduplicated and invalid enum members
are rejected. For façade filters, an omitted dimension imposes no restriction;
a supplied empty array selects no items or graph edges. Search is the exception:
a supplied empty `fields` array is invalid.

Every façade operation accepts `signal` and `maxResultBytes`.
`maxResultBytes` defaults to 4 MiB, must be at least one byte, and has a hard
maximum of 64 MiB. It measures the exact UTF-8 bytes of the canonical,
pretty-printed result, including its final newline. If the complete result is
larger, the operation rejects with `LIMIT_EXCEEDED`; it does not return a
truncated result. This byte limit does not apply to primitive index, trace,
context, source-index, or project-analysis returns, nor to codec rendering.

The façade has no general request-byte limit. Except where this page states a
seed or numeric bound, filter arrays, `changedPaths`, and projection arrays have
no separate count maximum. `maxResultBytes` bounds output only. A host exposing
the façade to untrusted requests must bound request size before calling it.

## Cancellation And Partial Results

Synchronous primitives check `AnalysisOptions.signal` before work and at
deterministic checkpoints. They throw `AnalysisAbortedError` and return no
artifact when they observe abort. Checkpoint cancellation is not
timer-preemptive. In particular, TypeScript config parsing and `createProgram`
are synchronous; project analysis supplies compiler cancellation tokens where
the compiler accepts them and checks the phases around those calls.

Façade operations apply the same checkpoint model and reject with
`AnalysisError` code `ABORTED`. They check cancellation again before validating
and byte-counting the result. An abort, hard result-byte limit, invalid request,
or construction-limit failure returns no granular result.

`analyzeApplicationProject()` accepts plain structured-cloneable filesystem
options and rejects `readFile`. It observes pre-abort before worker creation and
terminates its Node worker on in-flight abort. It rejects with
`AnalysisAbortedError`, reconstructs `AnalysisLimitError` from worker failures,
and never returns or retains a partial snapshot. `loadApplicationProject()` is
synchronous and accepts a custom `readFile` for expert hosts.

## Completeness

`complete` describes one specific source of omitted evidence. It does not mean
that a page contains every matching item or that static evidence proves runtime
behavior.

| Value                                    | Rule                                                                                                                        |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `GuidanceSelection.complete`             | False if `maxEntries` or `maxBytes` omits any matching entry.                                                               |
| `CanonicalGuidanceLink.complete`         | Exactly copies the supplied guidance selection; it does not change `GuidanceResult.complete`.                               |
| `SourceQueryResult.complete`             | False if the query has any relevant source-index issue. `match: "best"` and an empty successful match do not make it false. |
| `ImpactTrace.complete`                   | False if an unknown primitive seed is present or `maxDepth` or `maxNodes` omits a reachable node.                           |
| `ContextBundle.complete`                 | Exactly copies its trace's completeness.                                                                                    |
| `SourcesResult.complete`                 | False if the source query has relevant unified source diagnostics; paging does not affect it.                               |
| `ImpactResult.complete`                  | Exactly copies its trace's completeness.                                                                                    |
| `NavigationResult.complete`              | False only when `maxNodes` or `maxEdges` omits evidence. `maxDepth` defines the requested scope and does not make it false. |
| `ChangeTargetResult.complete`            | Exactly copies the target impact trace's completeness. Source-attribution issues do not independently make it false.        |
| `ReviewResult.complete`                  | False if either review impact is incomplete or, when target drift is requested, either target is incomplete.                |
| `ReviewCoverage.impact.complete`         | False if either review impact is incomplete; target-drift completeness is not included in this nested value.                |
| Other granular façade result kinds       | The implementation returns `true`. A partial page or incomplete linked guidance selection does not change the top level.    |
| `ApplicationSourceDocumentRead.complete` | Always `true`; missing, unreadable, stale, oversized, or aborted reads throw instead of returning text.                     |
| `SourceExcerpt.complete`                 | Says only whether the excerpt spans its complete semantic anchor.                                                           |

`ApplicationIndex`, `ApplicationSourceIndex`, and
`ApplicationProjectAnalysis` have no `complete` field. They return their full
format shape or throw. A source index can still contain unresolved or ambiguous
attribution issues; full shape is not a claim of complete attribution.

## Catalog, Search, And Definitions

Catalog returns one `DesignSummary` for every inventory reference. It includes
the key, leaf and qualified names, parent concept where applicable, reaction
portability, source availability, source anchor counts and paths, and unified
diagnostic severity counts. Filters select kinds, concept names, reaction
portability, source availability, and diagnostic severity.

Search is trimmed, case-insensitive token-AND matching with stable ranking for a
fixed runtime locale. Case folding uses `toLocaleLowerCase()` without an
explicit locale, so results across different host locales are not guaranteed to
match. A query must contain 1 through 256 UTF-16 code units. Fields are
`identity`, `contract`, `rendered`, `source-path`, and `source-text`; defaults
are `identity`, `contract`, and `source-path`. `source-text` is opt-in. Search
examines only facts attached to design inventory entries and their indexed
anchors, never arbitrary repository files. Ranking prefers exact keys and
qualified names, exact leaf names, prefixes, identity token prefixes,
identity/path substrings, contract or rendered facts, and finally source text.
Snippets contain at most 160 UTF-16 code units and report truncation on each
side.

Descriptions support `summary`, `definition` (default), and `full`. Definitions
are discriminated for concepts, actions, queries, portable or unlowered
reactions, views, formers, computations, and endpoints. Action and query values
include their parsed specification member when present. Endpoints join their
input contract with every logical wire declaration for the path and app-wide
errors. `full` adds exact anchor text and relevant unified diagnostics;
`definition` never adds source text.

## Source Queries

`sources` requires a project-backed source snapshot. Queries are discriminated
as `ref`, `cursor`, `range`, or `file` and use explicit relative POSIX file
paths. Cursor and range offsets are non-negative safe UTF-16 integers; ranges
are half-open and their end may not precede their start. Roles, resolutions,
`content: "metadata" | "text"`, and
`match: "all" | "best"` are selectable. Omitted roles and resolutions admit
all values; a supplied empty role or resolution array admits no anchors.
`content` defaults to `metadata`, and `match` defaults to `all`.
Metadata reports exact UTF-8 anchor bytes, digest, half-open UTF-16 range, and
indexed document metadata. Metadata mode omits the complete anchor `text`
field, but an anchor-provided `SourceExcerpt` still includes its exact excerpt
text.

The façade requires a `ref` query to name a known inventory definition and
fails with `NOT_FOUND` otherwise. The lower-level query primitive performs no
such inventory error conversion; an absent reference normally yields no
matches.

Anchors retain the complete semantic declaration and may add a token-level
`focusRange` and bounded exact `excerpt`. A `ref` query selects every retained
anchor for that exact reference that passes the role and resolution filters.
Positional and file-query ranking tiers are
focus, exact semantic range, query contained by the shortest anchor, anchor
contained by query, partial overlap, and whole file, followed by resolution and
stable reference/range order. `best` retains all candidates tied on the exact
rank before deterministic ordering. A known unresolved reference returns an
empty successful page with relevant issues. A file, cursor, or range with no
overlap also returns an empty successful page. `queryApplicationSources`
exposes the same selection model over a primitive source index and also
defaults `match` to `all`. The primitive has no pagination, result-byte limit,
or cancellation option, and each returned `SourceAnchor` contains its complete
retained text.

`designRefsForSourceRange` remains the compatibility helper. With neither
offset supplied it searches the whole file. If either offset is supplied,
`startOffset` defaults to `0` and `endOffset` defaults to
`Number.MAX_SAFE_INTEGER`.

Source roles distinguish declaration, canonical contract, selected
implementation, implementation selection, registration, and specification
evidence. Resolution records whether evidence came from checker symbol
identity, bounded static flow, a literal or footprint match, manifest location,
or manifest provenance.

`ApplicationSourceIndex` and project snapshots retain exact source text in
their anchors. Digests and metadata mode do not redact the persisted snapshot.
A host that cannot disclose source text must not expose those snapshots.

`readApplicationSourceDocument()` accepts only an indexed project-relative
path. `maxBytes` defaults to 16 MiB and may be any non-negative safe integer;
this primitive has no separate hard maximum. It rejects before calling
`readFile` when indexed metadata already exceeds the bound, then checks the
actual UTF-8 byte length, UTF-16 length, and SHA-256 digest after the read. It
returns complete text or throws `ApplicationSourceReadError` with `ABORTED`,
`SOURCE_NOT_FOUND`, `SOURCE_UNREADABLE`, `SOURCE_TOO_LARGE`, or
`SOURCE_CHANGED`. Cancellation is checked before and after `readFile`; the API
does not interrupt the reader itself.

Manifest-only catalog and logical search report source availability as
`unavailable`; they do not fail merely because summaries have no source facts.
An operation that explicitly needs source content or source selection fails
with `CAPABILITY_UNAVAILABLE`. This includes `sources()`, `source-text` search,
full descriptions, and source-selected change targets. A reference-only change
target remains available and reports no source files.

## Static Analysis Boundary

Project analysis requires explicit `repositoryRoot`, `tsconfigPath`,
`sourceRevision`, `manifest`, `manifestSourceRevision`, and
`expectedManifestDigest` values. Both revision strings must be non-empty and
equal. `expectedManifestDigest` must equal the validated V5 manifest digest.

Source attribution never imports a project module, calls a factory, evaluates
an expression, or interprets a manifest-producing configuration file. Project
loading resolves every transitive reference with TypeScript's project-reference
rules, parses every config and `extends` through one immutable path-safe host,
rejects cycles and repository/symlink escapes, and creates one source-redirected
program per config. Solution roots may contain no files and referenced projects
do not need prebuilt declarations. Configs, source files, relative imports,
compiler path targets, and project references must remain under the resolved
repository root; the TypeScript standard-library directory is the only external
read exception. A dependency or symlink that resolves outside those roots is
unsupported. A custom synchronous `readFile` replaces file contents, not these
path and filesystem-topology checks. The loader snapshots each read and verifies
the observed files again before returning; a file that changes during analysis
causes the entire operation to fail.

Attribution recognizes the public `assemble`, `conceptSet`, `registerConcept`,
`vocabulary`, `reaction`, `endpoint`, `view`, and `former` APIs by checker symbol
identity. Exact direct imports have a narrow fallback only when TypeScript
cannot resolve their module; unrelated functions with matching names are not
treated as framework declarations. Only non-declaration source files in the
supplied TypeScript programs, plus statically resolved imported concept
specifications, become attribution documents. The indexer does not search
arbitrary repository text.

Without `sourceRoots`, every recognized `assemble` call is a candidate and
attribution needs one unambiguous assembly. A source root names a
project-relative file and may select either one module export or one UTF-16
offset, but not both; omitting both selectors uses the whole source file.
Source roots constrain candidate discovery; they do not cause project code to
execute. `indexApplicationSources()` and
`loadApplicationProject()` use TypeScript's system reader when `readFile` is
omitted.

Bounded static flow follows aliases, re-exports, namespace and destructuring
bindings, immutable local values, object properties and spreads, local function
returns, and class members. Mutable, cyclic, dynamic, over-bound, or competing
flows produce explicit unresolved or ambiguous issues rather than source-order
or nearest-name guesses. The construction limits above bound static depth,
alternatives, AST work, documents, anchors, and bytes. Canonical source paths
and repeated programs are deduplicated for accounting, but separate retained
anchors each contribute their own UTF-8 text bytes.

## Impact, Navigation, And Change Targets

Façade impact accepts 1 through 100 input seeds, requires every seed to be a
known inventory definition, and deduplicates the seeds after enforcing the
input count. Relation and certainty filters are applied to graph edges before
traversal. `detail` defaults to `trace`; `context` additionally builds a V2
context bundle. Depth counts edges in one witness path. `maxDepth` defaults to
`12`, permits `0`, and has a hard maximum of `12`. `maxNodes` defaults to `500`,
must be at least `1`, and has a hard maximum of `1,000`; reached-node accounting
includes the seeds.

The lower-level `traceApplicationImpact()` primitive also defaults to depth 12
and 500 nodes, but it has no separate depth or node hard maximum beyond safe
integer validation. It accepts an empty seed array and reports unknown seeds as
`UNKNOWN_SEED` issues instead of throwing `NOT_FOUND`. Each unknown-reference or
unknown-seed issue carries at most three same-kind suggestions.
`contextForImpact()` inherits the supplied trace's completeness; when its
optional source index is omitted, `sources` and `sourceIssues` are empty.

Navigation accepts one exact reference, `incoming | outgoing | both`, relation
and certainty filters, and bounded shortest-distance traversal. Direction
defaults to `both`. Defaults are depth 1, 100 nodes, and 250 edges. Depth may be
zero and has a hard maximum of 12; nodes must be at least 1 and have a hard
maximum of 1,000 and include the starting reference; edges may be zero and have
a hard maximum of 5,000. A node or edge bound that omits evidence produces
`complete: false` and a stable limit diagnostic. Reaching the requested depth
alone does not make navigation incomplete.

Change targets combine exact references, one source cursor or range, and extra
seeds. Omitted `refs` and `seeds` contribute no seeds. A source query selects
all matching roles and resolutions in `all` mode and retains metadata, not
source text. Each explicit `refs` or `seeds` input array has a hard maximum of
100, and the deduplicated union of explicit, source-selected, and extra seeds
also has a hard maximum of 100. An empty resulting union fails with `NOT_FOUND`.
`maxDepth` defaults to 12 with a hard maximum of 12; `maxNodes` defaults to 500
with a hard maximum of 1,000. Their minima and traversal behavior match façade
impact. Omitted relation and certainty filters admit all edges.

Targets always build strict impact context and files grouped by path with
`seed`, `affected`, and `support` roles, least certainty, contributing
references, document metadata, relevant diagnostics, and guidance. Source
selection requires a project snapshot; exact reference seeds do not. A target
is evidence for review and planning. It is never an authorization allowlist.

## Diagnostics And Guidance

Unified diagnostics combine canonical manifest diagnostics, project TypeScript
diagnostics, V2 index issues, and source-index issues. Each stable value has an
ID, origin, normalized severity, code, message, references, paths, and typed raw
evidence. Filters select origins, severities, codes, exact references, and path
prefixes.
TypeScript diagnostics additionally identify the project config that produced
them, including diagnostics from transitive referenced programs. A project
snapshot may contain compiler or manifest errors; diagnostics do not by
themselves make construction fail or a paged diagnostics result incomplete.

Guidance uses stable rule IDs and links applicable diagnostics and references.
Rules cover possible-impact caveats, opaque definitions, ambiguous or
unresolved source, source/specification mismatch, generated contracts versus
runtime validation, declaration order versus priority, and exact
revision/provenance use. Guidance can be filtered by topic, exact reference, or
diagnostic ID. It does not claim semantic proof, correctness, authorization, or
approval.

`GuidanceRequest.selection` may carry a validated canonical
`GuidanceSelection`. Construction of `ApplicationAnalysis` remains synchronous;
callers load or select canonical guidance separately. `GuidanceResult` always
contains `canonicalGuidance`, which is `null` when no selection was supplied.
Otherwise it records the selection and resource digests, producer and source
identity, completeness, and each selected entry's ID, path, anchor, and digest.
The selected doctrine content is not copied into the analysis result, and the
existing issue-derived `items` remain unchanged. A selection from another
analysis or core version is rejected.

## Logical And Projected Contracts

Contracts filter endpoint names and paths, then page endpoint declarations with
the standard offset 0, limit 50, and hard page limit 200. Detail is `summary`,
`data`, or `rendered` and defaults to `data`. Summary detail returns endpoint
definitions only. Data detail joins each paged declaration with the
corresponding input contract and all logical wire endpoints for its path.
Rendered detail adds output from core's public `renderInputContracts` and
`renderWireTypes` functions. A named endpoint or path filter that is absent from
the manifest fails with `NOT_FOUND`.

Callers may supply `PlannedWireProjection[]`. These values are cloned,
validated as serializable data, labeled with
`projectionEvidence: "caller-supplied"`, and rendered only through the public
core renderer. The façade never invokes projection code and never executes
project configuration. Without supplied data, `projectionEvidence` is `none`.
Logical wire and projected transport evidence are never conflated. App-wide
logical errors and caller projections are not paged. Projection count has no
separate hard maximum; `maxResultBytes` bounds the final result.

Provenance pages exact project file digest records and returns analyzer,
manifest generator/digest, TypeScript version, revisions, source digest,
tsconfig path, and project-reference facts when available. Manifest-only
provenance remains a successful logical result with no project file claims.

## Change Review Boundary

`after.reviewChange(before, options)` compares canonical definition, contract,
source, diagnostic, project-file, endpoint/input/wire, and app-wide contract
evidence. It reports added, removed, and modified design references with exact
aspects and optional before/after definitions; file and contract digest
changes; introduced and resolved diagnostics; bounded before/after impact; and
optional drift from one target request. `before` must be an
`ApplicationAnalysis` created by the same loaded façade implementation; a
parsed result, structurally similar object, or façade from another loaded
package copy is rejected.

`detail` defaults to `summary`; `definitions` adds before and after definitions.
`maxDepth` defaults to 3, permits 0, and has a hard maximum of 12. `maxNodes`
defaults to 500, must be at least 1, and has a hard maximum of 1,000. The depth
and node bounds apply separately to the before and after impact traces.
`maxChanges` defaults to 500, permits 0, and has a hard maximum of 10,000. Its
count is the sum of design changes, file changes, contract changes, introduced
diagnostics, and resolved diagnostics. Exceeding the selected count fails with
`LIMIT_EXCEEDED`; review never truncates these exact sets. The ordinary façade
result-byte bound still applies after review construction.

`changedPaths` is caller evidence only. It does not scope comparison or impact
traversal and does not cause additional files to be read. File coverage and
file changes refer only to the ordered files recorded as read in the two
project snapshots, not to a version-control diff or every file under the
repository root. Coverage separately states source/file availability, caller
path scope, impact completeness, and whether target drift was evaluated. A
missing `changedPaths` value reports `all-observed`; a supplied array reports
`caller-supplied`. An omitted target reports `not-requested`. A requested target
uses the change-target defaults and hard bounds documented above and reports
`evaluated` if both target operations return.

`ReviewCoverage.definitions`, `.contracts`, and `.diagnostics` are always
`complete`; over-bound exact evidence fails instead of weakening those labels.
The `sources` and `files` fields report `before-and-after`, `before-only`,
`after-only`, or `unavailable`. Missing source or file coverage is therefore an
explicit limitation, but does not by itself make `ReviewResult.complete` false.

A review result is evidence, observations, guidance, and coverage. It has no
approval verdict and must not be used as one.

## Errors And Limits

`AnalysisError` has a serializable `code` and `data`, and serializes through
`toJSON`. Codes are:

| Code                     | Meaning                                                                                              |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`       | A request, reference shape, path, enum, or bound is malformed.                                       |
| `INVALID_FORMAT`         | A manifest, snapshot, or persisted result has the wrong format or canonical shape.                   |
| `UNSUPPORTED_VERSION`    | A recognized format has an unsupported version.                                                      |
| `SNAPSHOT_MISMATCH`      | Digests, revisions, index/source composition, identity, or provenance disagree.                      |
| `NOT_FOUND`              | An exact reference/filter/selection is well formed but absent.                                       |
| `CAPABILITY_UNAVAILABLE` | Exact source evidence was requested from a manifest-only analysis.                                   |
| `LIMIT_EXCEEDED`         | A hard request, result-byte, navigation, seed, review, or primitive construction bound was exceeded. |
| `ABORTED`                | The supplied signal was observed at a deterministic checkpoint.                                      |

The façade converts primitive `AnalysisAbortedError` and `AnalysisLimitError`
to these codes. Primitive construction APIs continue exposing their existing
errors and `AnalysisOptions` limits. Worker-backed project analysis reconstructs
`AnalysisLimitError`; parent-side cancellation rejects with
`AnalysisAbortedError`. Other worker failures are ordinary `Error` values with
the serialized name, message, stack, and string code when present.

## Limitations

Possible-impact edges are structural, conservative, or opaque evidence. They
do not prove that a reaction will fire. Concept action-to-query edges are
conservative because manifests do not identify which owned state an action
changes. Unlowered definitions retain only known structure. Dynamic or
ambiguous declarations remain unresolved instead of being guessed from source
order. A generated contract describes data; validator flags separately report
whether runtime validation is wired. Stable declaration and output order is
for deterministic comparison, not execution priority.

No API in this package defines workflow roles, prompts, token budgets,
allowlists, artifact stores, tool names, approval gates, or verdicts.
