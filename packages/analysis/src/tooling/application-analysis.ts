import { createHash } from "node:crypto";
import {
  renderInputContracts,
  renderReaction,
  renderWireTypes,
  validateApplicationManifest,
  type ApplicationDiagnostic,
  type ApplicationManifestV5,
  type ConceptSpecificationIR,
  type PlannedWireProjection,
  type SpecificationActionIR,
  type SpecificationQueryIR,
} from "@mit-sdg/sync-engine/tooling";
import { ANALYSIS_PACKAGE_VERSION } from "../package-version.ts";
import { validateGuidanceSelection, type GuidanceSelection } from "../guidance/guidance.ts";
import {
  contextForImpact,
  designRefKey,
  indexApplication,
  traceApplicationImpact,
  type AnalysisIssue,
  type ApplicationIndex,
  type ContextBundle,
  type DesignRef,
  type ImpactCertainty,
  type ImpactEdge,
  type ImpactRelation,
  type ImpactTrace,
} from "./application-impact.ts";
import { AnalysisAbortedError, AnalysisLimitError } from "./analysis-foundation.ts";
import type { AnalysisResourceUsage, AnalysisSeverity } from "./analysis-foundation.ts";
import {
  AnalysisError,
  type AnalysisErrorCode,
  type AnalysisErrorData,
} from "./application-analysis-error.ts";
import {
  renderApplicationAnalysisResult,
  validateApplicationAnalysisResult,
} from "./application-analysis-result.ts";
import {
  applicationProjectAnalysisDigest,
  type ApplicationProjectAnalysis,
  type ApplicationProjectDiagnostic,
  type ApplicationProjectDiagnosticRelatedInformation,
} from "./application-project.ts";
import { validateApplicationProjectAnalysis } from "./application-project-format.ts";
import {
  assertArtifactProvenance,
  assertSameProvenance,
  canonicalAnalysisDigest,
  canonicalAnalysisJson,
  type AnalysisProvenance,
} from "./analysis-provenance.ts";
import {
  queryApplicationSources,
  type ApplicationSourceQuery,
  type ApplicationSourceIndex,
  type IndexedSourceDocument,
  type SourceAnchor,
  type SourceExcerpt,
  type SourceIndexIssue,
  type SourceRange,
  type SourceResolution,
  type SourceRole,
} from "./source-index.ts";

export type { AnalysisErrorCode, AnalysisErrorData } from "./application-analysis-error.ts";
export { AnalysisError } from "./application-analysis-error.ts";

export interface ApplicationAnalysisIdentity {
  readonly manifestDigest: string;
  readonly analysisDigest: string;
  readonly sourceRevision?: string;
  readonly sourceDigest?: string;
  readonly analyzerVersion: string;
  readonly coreVersion: string;
}

export interface ApplicationAnalysisOperationOptions {
  /** Checked before and at deterministic checkpoints during synchronous scans. */
  readonly signal?: AbortSignal;
  /** Canonical UTF-8 result bound. Defaults to 4 MiB; the hard maximum is 64 MiB. */
  readonly maxResultBytes?: number;
}

export interface AnalysisPageRequest {
  /** Zero-based result offset. Defaults to 0. */
  readonly offset?: number;
  /** Positive page size. Defaults to 50; the hard maximum is 200. */
  readonly limit?: number;
}

export interface AnalysisPage<Item> {
  readonly total: number;
  readonly items: readonly Item[];
  /** The strictly advancing offset for another page, or null when complete. */
  readonly nextOffset: number | null;
}

export type SourceAvailability =
  | "available"
  | "ambiguous"
  | "unresolved"
  | "not-indexed"
  | "unavailable";

export type ReactionPortability = "portable" | "unlowered";

export interface DiagnosticSeverityCounts {
  readonly error: number;
  readonly warning: number;
  readonly info: number;
}

export interface DesignSummary {
  readonly ref: DesignRef;
  readonly key: string;
  readonly name: string;
  readonly qualifiedName: string;
  readonly parentConcept?: string;
  readonly portability?: ReactionPortability;
  readonly sourceAvailability: SourceAvailability;
  readonly anchorCount: number;
  readonly sourcePaths: readonly string[];
  readonly diagnostics: DiagnosticSeverityCounts;
}

export interface CatalogFilters {
  readonly kinds?: readonly DesignRef["kind"][];
  readonly concepts?: readonly string[];
  readonly portability?: readonly ReactionPortability[];
  readonly sourceAvailability?: readonly SourceAvailability[];
  readonly diagnosticSeverities?: readonly AnalysisSeverity[];
}

export interface CatalogRequest extends ApplicationAnalysisOperationOptions {
  readonly filters?: CatalogFilters;
  readonly page?: AnalysisPageRequest;
}

interface ApplicationAnalysisResultBase<Kind extends ApplicationAnalysisResultKind> {
  readonly format: "sync-engine.application-analysis-result";
  readonly version: 1;
  readonly kind: Kind;
  readonly identity: ApplicationAnalysisIdentity;
  readonly provenance: AnalysisProvenance;
  readonly complete: boolean;
  readonly resourceUsage: AnalysisResourceUsage;
}

export interface CatalogResult
  extends ApplicationAnalysisResultBase<"catalog">, AnalysisPage<DesignSummary> {}

export type SearchField = "identity" | "contract" | "rendered" | "source-path" | "source-text";

export interface SearchRequest extends ApplicationAnalysisOperationOptions {
  readonly query: string;
  readonly fields?: readonly SearchField[];
  readonly page?: AnalysisPageRequest;
}

export interface SearchHit {
  readonly ref: DesignRef;
  readonly key: string;
  readonly qualifiedName: string;
  readonly rank: number;
  readonly matchedField: SearchField;
  readonly snippet: string;
  readonly truncatedStart: boolean;
  readonly truncatedEnd: boolean;
}

export interface SearchResult
  extends ApplicationAnalysisResultBase<"search">, AnalysisPage<SearchHit> {
  readonly query: string;
  readonly fields: readonly SearchField[];
}

export type DescriptionDetail = "summary" | "definition" | "full";
export type DesignRefInput = DesignRef | string;

type ConceptInventory = ApplicationManifestV5["concepts"][number];
type ActionInventory = ConceptInventory["actions"][number];
type QueryInventory = ConceptInventory["queries"][number];
type ReactionDefinition = ApplicationManifestV5["application"]["reactions"][number];
type UnloweredDefinition = ApplicationManifestV5["application"]["unlowered"][number];
type ViewDefinition = ApplicationManifestV5["application"]["views"][number];
type FormerDefinition = ApplicationManifestV5["application"]["formers"][number];
type ComputationDefinition = ApplicationManifestV5["computations"][number];
type EndpointDefinition = ApplicationManifestV5["endpoints"][number];
type WireEndpointDefinition = ApplicationManifestV5["wire"]["endpoints"][number];

export type DesignDefinition =
  | {
      readonly kind: "concept";
      readonly concept: ConceptInventory;
      readonly implementation?: ApplicationManifestV5["conceptImplementations"][number];
    }
  | {
      readonly kind: "action";
      readonly concept: string;
      readonly action: ActionInventory;
      readonly specification?: SpecificationActionIR;
    }
  | {
      readonly kind: "query";
      readonly concept: string;
      readonly query: QueryInventory;
      readonly specification?: SpecificationQueryIR;
    }
  | {
      readonly kind: "reaction";
      readonly portability: "portable";
      readonly reaction: ReactionDefinition;
      readonly rendered: string;
    }
  | {
      readonly kind: "reaction";
      readonly portability: "unlowered";
      readonly reaction: UnloweredDefinition;
    }
  | { readonly kind: "view"; readonly view: ViewDefinition }
  | { readonly kind: "former"; readonly former: FormerDefinition }
  | { readonly kind: "computation"; readonly computation: ComputationDefinition }
  | {
      readonly kind: "endpoint";
      readonly endpoint: EndpointDefinition;
      readonly inputContract: ApplicationManifestV5["inputContracts"][string];
      readonly wire: {
        readonly endpoints: readonly WireEndpointDefinition[];
        readonly appWide: readonly string[];
      };
    };

export interface DescribeRequest extends ApplicationAnalysisOperationOptions {
  readonly ref: DesignRefInput;
  readonly detail?: DescriptionDetail;
}

export interface DescriptionResult extends ApplicationAnalysisResultBase<"description"> {
  readonly ref: DesignRef;
  readonly detail: DescriptionDetail;
  readonly summary: DesignSummary;
  readonly definition?: DesignDefinition;
  readonly sources?: readonly SourceMatch[];
  readonly diagnostics?: readonly AnalysisDiagnostic[];
}

export type SourceQuery =
  | { readonly kind: "ref"; readonly ref: DesignRefInput }
  | { readonly kind: "cursor"; readonly path: string; readonly offset: number }
  | {
      readonly kind: "range";
      readonly path: string;
      readonly start: number;
      readonly end: number;
    }
  | { readonly kind: "file"; readonly path: string };

export type SourceContent = "metadata" | "text";
export type SourceMatchMode = "all" | "best";
export type SourceSpecificity =
  | "focus"
  | "exact-semantic-range"
  | "query-contained-by-anchor"
  | "anchor-contained-by-query"
  | "partial-overlap"
  | "whole-file";

export interface SourceMatchMetadata {
  readonly path: string;
  readonly range: SourceRange;
  readonly digest: string;
  readonly bytes: number;
  readonly document?: IndexedSourceDocument;
  readonly focusRange?: SourceRange;
  readonly excerpt?: SourceExcerpt;
}

export interface SourceMatch {
  readonly ref: DesignRef;
  readonly role: SourceRole;
  readonly resolution: SourceResolution;
  readonly specificity: SourceSpecificity;
  readonly rank: number;
  readonly metadata: SourceMatchMetadata;
  readonly text?: string;
}

export interface SourcesRequest extends ApplicationAnalysisOperationOptions {
  readonly query: SourceQuery;
  readonly roles?: readonly SourceRole[];
  readonly resolutions?: readonly SourceResolution[];
  readonly content?: SourceContent;
  readonly match?: SourceMatchMode;
  readonly page?: AnalysisPageRequest;
}

export interface SourcesResult
  extends ApplicationAnalysisResultBase<"sources">, AnalysisPage<SourceMatch> {
  readonly query: SourceQuery;
  readonly content: SourceContent;
  readonly match: SourceMatchMode;
  readonly issues: readonly AnalysisDiagnostic[];
}

export interface ImpactRequest extends ApplicationAnalysisOperationOptions {
  readonly seeds: readonly DesignRefInput[];
  readonly detail?: "trace" | "context";
  readonly relations?: readonly ImpactRelation[];
  readonly certainties?: readonly ImpactCertainty[];
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface ImpactResult extends ApplicationAnalysisResultBase<"impact"> {
  readonly trace: ImpactTrace;
  readonly context?: ContextBundle;
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export type AnalysisDiagnosticOrigin = "manifest" | "typescript" | "index" | "source" | "analysis";

export type AnalysisDiagnosticRaw =
  | { readonly kind: "manifest"; readonly diagnostic: ApplicationDiagnostic }
  | { readonly kind: "typescript"; readonly diagnostic: ApplicationProjectDiagnostic }
  | { readonly kind: "index"; readonly issue: AnalysisIssue }
  | { readonly kind: "source"; readonly issue: SourceIndexIssue }
  | { readonly kind: "analysis"; readonly evidence: Readonly<Record<string, unknown>> };

export interface AnalysisDiagnostic {
  readonly id: string;
  readonly origin: AnalysisDiagnosticOrigin;
  readonly severity: AnalysisSeverity;
  readonly code: string;
  readonly message: string;
  readonly refs: readonly DesignRef[];
  readonly paths: readonly string[];
  readonly raw: AnalysisDiagnosticRaw;
}

export interface DiagnosticsFilters {
  readonly origins?: readonly AnalysisDiagnosticOrigin[];
  readonly severities?: readonly AnalysisSeverity[];
  readonly codes?: readonly string[];
  readonly refs?: readonly DesignRefInput[];
  readonly pathPrefixes?: readonly string[];
}

export interface DiagnosticsRequest extends ApplicationAnalysisOperationOptions {
  readonly filters?: DiagnosticsFilters;
  readonly page?: AnalysisPageRequest;
}

export interface DiagnosticsResult
  extends ApplicationAnalysisResultBase<"diagnostics">, AnalysisPage<AnalysisDiagnostic> {}

export type AnalysisGuidanceTopic =
  | "impact"
  | "definitions"
  | "sources"
  | "contracts"
  | "ordering"
  | "provenance";

export interface AnalysisGuidance {
  readonly id: string;
  readonly ruleId: string;
  readonly topic: AnalysisGuidanceTopic;
  readonly title: string;
  readonly message: string;
  readonly documentationPath: string;
  readonly refs: readonly DesignRef[];
  readonly diagnosticIds: readonly string[];
}

export interface GuidanceFilters {
  readonly topics?: readonly AnalysisGuidanceTopic[];
  readonly refs?: readonly DesignRefInput[];
  readonly diagnosticIds?: readonly string[];
}

export interface GuidanceRequest extends ApplicationAnalysisOperationOptions {
  readonly filters?: GuidanceFilters;
  /** Optional canonical guidance selected separately from the synchronous analysis snapshot. */
  readonly selection?: GuidanceSelection;
  readonly page?: AnalysisPageRequest;
}

export interface CanonicalGuidanceReference {
  readonly id: string;
  readonly path: string;
  readonly anchor: string;
  readonly digest: string;
}

export interface CanonicalGuidanceLink {
  readonly selectionDigest: string;
  readonly resourceDigest: string;
  readonly producer: GuidanceSelection["producer"];
  readonly source: GuidanceSelection["source"];
  readonly entries: readonly CanonicalGuidanceReference[];
  readonly complete: boolean;
}

export interface GuidanceResult
  extends ApplicationAnalysisResultBase<"guidance">, AnalysisPage<AnalysisGuidance> {
  readonly canonicalGuidance: CanonicalGuidanceLink | null;
}

export type NavigationDirection = "incoming" | "outgoing" | "both";

export interface NavigateRequest extends ApplicationAnalysisOperationOptions {
  readonly ref: DesignRefInput;
  readonly direction?: NavigationDirection;
  readonly relations?: readonly ImpactRelation[];
  readonly certainties?: readonly ImpactCertainty[];
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxEdges?: number;
}

export interface NavigationNode {
  readonly ref: DesignRef;
  readonly distance: number;
}

export interface NavigationResult extends ApplicationAnalysisResultBase<"navigation"> {
  readonly ref: DesignRef;
  readonly direction: NavigationDirection;
  readonly nodes: readonly NavigationNode[];
  readonly edges: readonly ImpactEdge[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export interface ChangeTargetRequest extends ApplicationAnalysisOperationOptions {
  readonly refs?: readonly DesignRefInput[];
  readonly source?: Extract<SourceQuery, { kind: "cursor" | "range" }>;
  readonly seeds?: readonly DesignRefInput[];
  readonly relations?: readonly ImpactRelation[];
  readonly certainties?: readonly ImpactCertainty[];
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface ChangeTargetFile {
  readonly path: string;
  readonly roles: readonly ("seed" | "affected" | "support")[];
  readonly leastCertainty: ImpactCertainty;
  readonly refs: readonly DesignRef[];
  readonly document: IndexedSourceDocument;
}

export interface ChangeTargetResult extends ApplicationAnalysisResultBase<"change-target"> {
  readonly seeds: readonly DesignRef[];
  readonly impact: ImpactTrace;
  readonly context: ContextBundle;
  readonly sourceAvailability: "available" | "unavailable";
  readonly files: readonly ChangeTargetFile[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly guidance: readonly AnalysisGuidance[];
}

export type ContractDetail = "summary" | "data" | "rendered";

export interface ContractFilters {
  readonly endpoints?: readonly string[];
  readonly paths?: readonly string[];
}

export interface ContractDeclaration {
  readonly endpoint: EndpointDefinition;
  readonly inputContract?: ApplicationManifestV5["inputContracts"][string];
  readonly wireEndpoints?: readonly WireEndpointDefinition[];
}

export interface ContractsRequest extends ApplicationAnalysisOperationOptions {
  readonly filters?: ContractFilters;
  readonly detail?: ContractDetail;
  /** Precomputed projection data is retained as caller evidence and is never executed. */
  readonly projections?: readonly PlannedWireProjection[];
  readonly page?: AnalysisPageRequest;
}

export interface ContractRenderings {
  readonly inputContracts: string;
  readonly logicalWire: string;
  readonly projections: readonly { readonly name: string; readonly rendered: string }[];
}

export interface ContractsResult
  extends ApplicationAnalysisResultBase<"contracts">, AnalysisPage<ContractDeclaration> {
  readonly detail: ContractDetail;
  readonly appWide: readonly string[];
  readonly projectionEvidence: "none" | "caller-supplied";
  readonly projections: readonly PlannedWireProjection[];
  readonly rendered?: ContractRenderings;
  readonly guidance: readonly AnalysisGuidance[];
}

export interface ProvenanceRequest extends ApplicationAnalysisOperationOptions {
  readonly page?: AnalysisPageRequest;
}

export interface ApplicationAnalysisProvenanceFacts {
  readonly analyzer: AnalysisProvenance["analyzer"];
  readonly manifest: AnalysisProvenance["manifest"];
  readonly project?: {
    readonly sourceRevision: string;
    readonly manifestSourceRevision: string;
    readonly sourceDigest: string;
    readonly tsconfigPath: string;
    readonly typescriptVersion: string;
    readonly projectReferences: readonly string[];
  };
}

export interface ProvenanceResult
  extends
    ApplicationAnalysisResultBase<"provenance">,
    AnalysisPage<ApplicationProjectAnalysis["provenance"]["files"][number]> {
  readonly facts: ApplicationAnalysisProvenanceFacts;
}

export type ReviewAspect = "definition" | "contract" | "source" | "diagnostics";
export type ReviewChangeType = "added" | "removed" | "modified";

export interface ReviewDesignChange {
  readonly ref: DesignRef;
  readonly change: ReviewChangeType;
  readonly aspects: readonly ReviewAspect[];
  readonly beforeDigest?: string;
  readonly afterDigest?: string;
  readonly beforeDefinition?: DesignDefinition;
  readonly afterDefinition?: DesignDefinition;
}

export interface ReviewFileChange {
  readonly path: string;
  readonly change: ReviewChangeType;
  readonly beforeDigest?: string;
  readonly afterDigest?: string;
  readonly declaredChanged: boolean;
}

export interface ReviewContractChange {
  readonly kind: "endpoint" | "input" | "wire-endpoint" | "wire-app-wide";
  readonly key: string;
  readonly change: ReviewChangeType;
  readonly beforeDigest?: string;
  readonly afterDigest?: string;
}

export interface ReviewTargetDrift {
  readonly before: ChangeTargetResult;
  readonly after: ChangeTargetResult;
  readonly addedAffected: readonly DesignRef[];
  readonly removedAffected: readonly DesignRef[];
  readonly addedFiles: readonly string[];
  readonly removedFiles: readonly string[];
}

export interface ReviewCoverage {
  readonly definitions: "complete";
  readonly contracts: "complete";
  readonly diagnostics: "complete";
  readonly sources: "before-and-after" | "before-only" | "after-only" | "unavailable";
  readonly files: "before-and-after" | "before-only" | "after-only" | "unavailable";
  readonly changedPaths: "all-observed" | "caller-supplied";
  readonly impact: {
    readonly maxDepth: number;
    readonly maxNodes: number;
    readonly complete: boolean;
  };
  readonly target: "not-requested" | "evaluated";
}

export interface ReviewChangeOptions extends ApplicationAnalysisOperationOptions {
  readonly changedPaths?: readonly string[];
  readonly detail?: "summary" | "definitions";
  readonly maxDepth?: number;
  readonly maxNodes?: number;
  readonly maxChanges?: number;
  readonly target?: Omit<ChangeTargetRequest, keyof ApplicationAnalysisOperationOptions>;
}

export interface ReviewResult extends ApplicationAnalysisResultBase<"review"> {
  readonly beforeIdentity: ApplicationAnalysisIdentity;
  readonly designChanges: readonly ReviewDesignChange[];
  readonly fileChanges: readonly ReviewFileChange[];
  readonly contractChanges: readonly ReviewContractChange[];
  readonly introducedDiagnostics: readonly AnalysisDiagnostic[];
  readonly resolvedDiagnostics: readonly AnalysisDiagnostic[];
  readonly beforeImpact: ImpactTrace;
  readonly afterImpact: ImpactTrace;
  readonly targetDrift?: ReviewTargetDrift;
  readonly observations: readonly string[];
  readonly guidance: readonly AnalysisGuidance[];
  readonly coverage: ReviewCoverage;
}

export type ApplicationAnalysisResultKind =
  | "catalog"
  | "search"
  | "description"
  | "sources"
  | "impact"
  | "diagnostics"
  | "guidance"
  | "navigation"
  | "change-target"
  | "contracts"
  | "provenance"
  | "review";

export type ApplicationAnalysisResult =
  | CatalogResult
  | SearchResult
  | DescriptionResult
  | SourcesResult
  | ImpactResult
  | DiagnosticsResult
  | GuidanceResult
  | NavigationResult
  | ChangeTargetResult
  | ContractsResult
  | ProvenanceResult
  | ReviewResult;

export interface ApplicationAnalysis {
  readonly manifest: Readonly<ApplicationManifestV5>;
  readonly project?: Readonly<ApplicationProjectAnalysis>;
  readonly index: Readonly<ApplicationIndex>;
  readonly sourceIndex?: Readonly<ApplicationSourceIndex>;
  readonly identity: ApplicationAnalysisIdentity;
  readonly catalog: (request?: CatalogRequest) => Promise<CatalogResult>;
  readonly search: (request: SearchRequest) => Promise<SearchResult>;
  readonly describe: (request: DescribeRequest) => Promise<DescriptionResult>;
  readonly sources: (request: SourcesRequest) => Promise<SourcesResult>;
  readonly impact: (request: ImpactRequest) => Promise<ImpactResult>;
  readonly diagnostics: (request?: DiagnosticsRequest) => Promise<DiagnosticsResult>;
  readonly guidance: (request?: GuidanceRequest) => Promise<GuidanceResult>;
  readonly navigate: (request: NavigateRequest) => Promise<NavigationResult>;
  readonly target: (request: ChangeTargetRequest) => Promise<ChangeTargetResult>;
  readonly contracts: (request?: ContractsRequest) => Promise<ContractsResult>;
  readonly provenance: (request?: ProvenanceRequest) => Promise<ProvenanceResult>;
  readonly reviewChange: (
    before: ApplicationAnalysis,
    options?: ReviewChangeOptions,
  ) => Promise<ReviewResult>;
}

export interface CreateApplicationAnalysisOptions {
  readonly manifest: ApplicationManifestV5;
  readonly project?: ApplicationProjectAnalysis;
}

const DEFAULT_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_LIMIT = 200;
const DESIGN_KINDS: readonly DesignRef["kind"][] = [
  "concept",
  "action",
  "query",
  "reaction",
  "view",
  "former",
  "computation",
  "endpoint",
];
const SEARCH_FIELDS: readonly SearchField[] = [
  "identity",
  "contract",
  "rendered",
  "source-path",
  "source-text",
];
const DEFAULT_SEARCH_FIELDS: readonly SearchField[] = ["identity", "contract", "source-path"];
const SOURCE_ROLES: readonly SourceRole[] = [
  "declaration",
  "canonical-contract",
  "selected-implementation",
  "selection",
  "registration",
  "specification",
];
const SOURCE_RESOLUTIONS: readonly SourceResolution[] = [
  "symbol",
  "static-flow",
  "literal-name",
  "name-and-footprint",
  "manifest-location",
  "manifest-provenance",
];
const IMPACT_RELATIONS: readonly ImpactRelation[] = [
  "concept-member",
  "action-trigger",
  "channel-trigger",
  "provenance-trigger",
  "action-called",
  "reaction-asks",
  "earlier-action",
  "query-read",
  "view-read",
  "former-use",
  "computation-use",
  "endpoint-stage",
  "stage-affects-endpoint",
  "same-concept-state",
];
const IMPACT_CERTAINTIES: readonly ImpactCertainty[] = ["structural", "conservative", "opaque"];
const SEVERITIES: readonly AnalysisSeverity[] = ["error", "warning", "info"];
const DIAGNOSTIC_ORIGINS: readonly AnalysisDiagnosticOrigin[] = [
  "manifest",
  "typescript",
  "index",
  "source",
  "analysis",
];
const GUIDANCE_TOPICS: readonly AnalysisGuidanceTopic[] = [
  "impact",
  "definitions",
  "sources",
  "contracts",
  "ordering",
  "provenance",
];
const EMPTY_USAGE: AnalysisResourceUsage = {
  graphNodes: 0,
  graphEdges: 0,
  diagnostics: 0,
  sourceDocuments: 0,
  sourceAnchors: 0,
  sourceTextBytes: 0,
  astNodes: 0,
  projectFiles: 0,
  projectBytes: 0,
};
const analysisStates = new WeakMap<object, FacadeState>();
type MutableResourceUsage = { -readonly [Key in keyof AnalysisResourceUsage]: number };
type MutableSeverityCounts = { -readonly [Key in keyof DiagnosticSeverityCounts]: number };

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function error(code: AnalysisErrorCode, message: string, data?: AnalysisErrorData): never {
  throw new AnalysisError(code, message, data);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    error("INVALID_ARGUMENT", `${label} must be an object`, { label });
  }
  return value as Record<string, unknown>;
}

function allowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) {
    error("INVALID_ARGUMENT", `${label} contains unsupported fields`, {
      label,
      fields: unexpected.sort(ordinal),
    });
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    error("INVALID_ARGUMENT", `${label} must be a non-empty string`, { label });
  }
  return value;
}

function enumValue<Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string,
): Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    error("INVALID_ARGUMENT", `${label} has an unsupported value`, {
      label,
      value: typeof value === "string" ? value : String(value),
      allowed: values,
    });
  }
  return value as Value;
}

function enumSet<Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string,
): ReadonlySet<Value> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) error("INVALID_ARGUMENT", `${label} must be an array`, { label });
  const result = new Set<Value>();
  for (const entry of value) result.add(enumValue(entry, values, `${label}[]`));
  return result;
}

function stringSet(value: unknown, label: string): ReadonlySet<string> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) error("INVALID_ARGUMENT", `${label} must be an array`, { label });
  const result = new Set<string>();
  for (const entry of value) result.add(nonEmptyString(entry, `${label}[]`));
  return result;
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || (selected as number) < minimum) {
    error("INVALID_ARGUMENT", `${label} must be a safe integer from ${minimum} to ${maximum}`, {
      label,
      value: selected,
    });
  }
  if ((selected as number) > maximum) {
    error("LIMIT_EXCEEDED", `${label} exceeds its hard maximum`, {
      limit: label,
      maximum,
      attempted: selected,
    });
  }
  return selected as number;
}

function pageRequest(value: unknown): { readonly offset: number; readonly limit: number } {
  if (value === undefined) return { offset: 0, limit: 50 };
  const page = record(value, "page");
  allowedKeys(page, ["offset", "limit"], "page");
  return {
    offset: boundedInteger(page.offset, 0, 0, Number.MAX_SAFE_INTEGER, "page.offset"),
    limit: boundedInteger(page.limit, 50, 1, MAX_PAGE_LIMIT, "page.limit"),
  };
}

function pageOf<Item>(
  values: readonly Item[],
  request: { readonly offset: number; readonly limit: number },
): AnalysisPage<Item> {
  const items = values.slice(request.offset, request.offset + request.limit);
  const following = request.offset + items.length;
  return {
    total: values.length,
    items,
    nextOffset: following < values.length ? following : null,
  };
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    const child = (object as Record<PropertyKey, unknown>)[key];
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function detached<Value>(value: Value, label: string): Value {
  let clone: Value;
  try {
    clone = structuredClone(value);
    canonicalAnalysisJson(clone);
  } catch (cause) {
    error("INVALID_ARGUMENT", `${label} must be detached serializable data`, {
      label,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  return clone!;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sameCanonical(left: unknown, right: unknown): boolean {
  if (left === undefined || right === undefined) return left === right;
  return canonicalAnalysisJson(left) === canonicalAnalysisJson(right);
}

function validRelativePosixPath(value: unknown, label: string): string {
  const path = nonEmptyString(value, label);
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    path.endsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    error("INVALID_ARGUMENT", `${label} must be an explicit relative POSIX file path`, {
      label,
      path,
    });
  }
  return path;
}

function validRelativePosixPrefix(value: unknown, label: string): string {
  const path = nonEmptyString(value, label);
  const parts = path.split("/");
  if (
    path.startsWith("/") ||
    path.includes("\\") ||
    parts.some(
      (part, position) =>
        part === "." || part === ".." || (part === "" && position !== parts.length - 1),
    )
  ) {
    error("INVALID_ARGUMENT", `${label} must be a relative POSIX path prefix`, {
      label,
      path,
    });
  }
  return path;
}

function sortedUniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(ordinal);
}

function sortedUniqueRefs(values: Iterable<DesignRef>): DesignRef[] {
  return [...new Map([...values].map((ref) => [designRefKey(ref), ref])).entries()]
    .sort(([left], [right]) => ordinal(left, right))
    .map(([, ref]) => ref);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(ordinal);
  const sortedExpected = [...expected].sort(ordinal);
  if (!sameCanonical(actual, sortedExpected)) {
    error("INVALID_ARGUMENT", `${label} has malformed fields`, {
      label,
      expected: sortedExpected,
      actual,
    });
  }
}

function designRefFromUnknown(value: unknown, label: string): DesignRef {
  if (typeof value === "string") return parseDesignRefKey(value);
  const ref = record(value, label);
  const kind = enumValue(ref.kind, DESIGN_KINDS, `${label}.kind`);
  switch (kind) {
    case "concept":
      exactKeys(ref, ["kind", "concept"], label);
      return { kind, concept: nonEmptyString(ref.concept, `${label}.concept`) };
    case "action":
      exactKeys(ref, ["kind", "concept", "action"], label);
      return {
        kind,
        concept: nonEmptyString(ref.concept, `${label}.concept`),
        action: nonEmptyString(ref.action, `${label}.action`),
      };
    case "query":
      exactKeys(ref, ["kind", "concept", "query"], label);
      return {
        kind,
        concept: nonEmptyString(ref.concept, `${label}.concept`),
        query: nonEmptyString(ref.query, `${label}.query`),
      };
    case "reaction":
      exactKeys(ref, ["kind", "reaction"], label);
      return { kind, reaction: nonEmptyString(ref.reaction, `${label}.reaction`) };
    case "view":
      exactKeys(ref, ["kind", "view"], label);
      return { kind, view: nonEmptyString(ref.view, `${label}.view`) };
    case "former":
      exactKeys(ref, ["kind", "former"], label);
      return { kind, former: nonEmptyString(ref.former, `${label}.former`) };
    case "computation":
      exactKeys(ref, ["kind", "computation"], label);
      return { kind, computation: nonEmptyString(ref.computation, `${label}.computation`) };
    case "endpoint":
      exactKeys(ref, ["kind", "endpoint", "path"], label);
      return {
        kind,
        endpoint: nonEmptyString(ref.endpoint, `${label}.endpoint`),
        path: nonEmptyString(ref.path, `${label}.path`),
      };
  }
}

/** Strict inverse of {@link designRefKey}. */
export function parseDesignRefKey(key: string): DesignRef {
  if (typeof key !== "string") error("INVALID_ARGUMENT", "design reference key must be a string");
  let tuple: unknown;
  try {
    tuple = JSON.parse(key);
  } catch (cause) {
    error("INVALID_ARGUMENT", "design reference key is not valid JSON", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!Array.isArray(tuple)) error("INVALID_ARGUMENT", "design reference key must encode a tuple");
  const [kind] = tuple;
  if (typeof kind !== "string" || !DESIGN_KINDS.includes(kind as DesignRef["kind"])) {
    error("INVALID_ARGUMENT", "design reference key has an unknown kind", { kind: String(kind) });
  }
  const arity = kind === "action" || kind === "query" || kind === "endpoint" ? 3 : 2;
  if (tuple.length !== arity) {
    error("INVALID_ARGUMENT", "design reference key has the wrong tuple arity", {
      kind,
      expected: arity,
      actual: tuple.length,
    });
  }
  for (let index = 1; index < tuple.length; index += 1) {
    if (typeof tuple[index] !== "string" || tuple[index].trim() === "") {
      error("INVALID_ARGUMENT", "design reference key names must be non-empty strings", { index });
    }
  }
  switch (kind) {
    case "concept":
      return { kind, concept: tuple[1] as string };
    case "action":
      return { kind, concept: tuple[1] as string, action: tuple[2] as string };
    case "query":
      return { kind, concept: tuple[1] as string, query: tuple[2] as string };
    case "reaction":
      return { kind, reaction: tuple[1] as string };
    case "view":
      return { kind, view: tuple[1] as string };
    case "former":
      return { kind, former: tuple[1] as string };
    case "computation":
      return { kind, computation: tuple[1] as string };
    case "endpoint":
      return { kind, endpoint: tuple[1] as string, path: tuple[2] as string };
    default:
      return error("INVALID_ARGUMENT", "design reference key has an unknown kind");
  }
}

function validateUsage(value: unknown, label: string): void {
  const usage = record(value, label);
  exactKeys(usage, Object.keys(EMPTY_USAGE), label);
  for (const key of Object.keys(EMPTY_USAGE) as Array<keyof AnalysisResourceUsage>) {
    if (!Number.isSafeInteger(usage[key]) || (usage[key] as number) < 0) {
      error("SNAPSHOT_MISMATCH", `${label}.${key} must be a non-negative safe integer`, {
        label: `${label}.${key}`,
      });
    }
  }
}

function assertPosition(value: unknown, label: string): void {
  const position = record(value, label);
  exactKeys(position, ["offset", "line", "column"], label);
  for (const key of ["offset", "line", "column"] as const) {
    const minimum = key === "offset" ? 0 : 1;
    if (!Number.isSafeInteger(position[key]) || (position[key] as number) < minimum) {
      error("SNAPSHOT_MISMATCH", `${label}.${key} is malformed`);
    }
  }
}

function assertRange(value: unknown, label: string): asserts value is SourceRange {
  const range = record(value, label);
  exactKeys(range, ["path", "start", "end"], label);
  validRelativePosixPath(range.path, `${label}.path`);
  assertPosition(range.start, `${label}.start`);
  assertPosition(range.end, `${label}.end`);
  const start = range.start as unknown as SourceRange["start"];
  const end = range.end as unknown as SourceRange["end"];
  if (end.offset < start.offset) error("SNAPSHOT_MISMATCH", `${label} has a reversed range`);
}

function assertSourceAnchor(value: unknown, label: string): asserts value is SourceAnchor {
  const anchor = record(value, label);
  const required = ["role", "range", "text", "digest", "resolution"];
  const optional = ["focusRange", "excerpt"];
  const missing = required.filter((key) => !Object.hasOwn(anchor, key));
  const extra = Object.keys(anchor).filter(
    (key) => !required.includes(key) && !optional.includes(key),
  );
  if (missing.length > 0 || extra.length > 0) {
    error("SNAPSHOT_MISMATCH", `${label} has malformed fields`, { label, missing, extra });
  }
  enumValue(anchor.role, SOURCE_ROLES, `${label}.role`);
  enumValue(anchor.resolution, SOURCE_RESOLUTIONS, `${label}.resolution`);
  assertRange(anchor.range, `${label}.range`);
  if (typeof anchor.text !== "string") error("SNAPSHOT_MISMATCH", `${label}.text is malformed`);
  if (anchor.digest !== sha256(anchor.text)) {
    error("SNAPSHOT_MISMATCH", `${label} has stale source text digest`);
  }
  const range = anchor.range;
  if (range.end.offset - range.start.offset !== anchor.text.length) {
    error("SNAPSHOT_MISMATCH", `${label} text length does not match its range`);
  }
  if (anchor.focusRange !== undefined) {
    assertRange(anchor.focusRange, `${label}.focusRange`);
    if (
      anchor.focusRange.path !== range.path ||
      anchor.focusRange.start.offset < range.start.offset ||
      anchor.focusRange.end.offset > range.end.offset
    ) {
      error("SNAPSHOT_MISMATCH", `${label}.focusRange is outside its semantic range`);
    }
  }
  if (anchor.excerpt !== undefined) {
    const excerpt = record(anchor.excerpt, `${label}.excerpt`);
    exactKeys(excerpt, ["range", "text", "complete"], `${label}.excerpt`);
    assertRange(excerpt.range, `${label}.excerpt.range`);
    if (typeof excerpt.text !== "string" || typeof excerpt.complete !== "boolean") {
      error("SNAPSHOT_MISMATCH", `${label}.excerpt is malformed`);
    }
    const excerptRange = excerpt.range as unknown as SourceRange;
    if (
      excerptRange.path !== range.path ||
      excerptRange.start.offset < range.start.offset ||
      excerptRange.end.offset > range.end.offset ||
      excerptRange.end.offset - excerptRange.start.offset !== excerpt.text.length
    ) {
      error("SNAPSHOT_MISMATCH", `${label}.excerpt range is inconsistent`);
    }
    const relativeStart = excerptRange.start.offset - range.start.offset;
    const relativeEnd = excerptRange.end.offset - range.start.offset;
    if (anchor.text.slice(relativeStart, relativeEnd) !== excerpt.text) {
      error("SNAPSHOT_MISMATCH", `${label}.excerpt text is not an exact source slice`);
    }
    if (
      excerpt.complete !==
      (excerptRange.start.offset === range.start.offset &&
        excerptRange.end.offset === range.end.offset)
    ) {
      error("SNAPSHOT_MISMATCH", `${label}.excerpt completeness is inconsistent`);
    }
  }
}

function assertSourceIndex(
  sourceIndex: ApplicationSourceIndex,
  manifest: ApplicationManifestV5,
  index: ApplicationIndex,
): void {
  try {
    assertArtifactProvenance(sourceIndex, "source index", manifest);
    assertSameProvenance(index, sourceIndex, "source index");
  } catch (cause) {
    error("SNAPSHOT_MISMATCH", "source index provenance does not match the manifest and index", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (sourceIndex.format !== "sync-engine.application-source-index") {
    error("INVALID_FORMAT", "project sourceIndex has an unsupported format");
  }
  if (sourceIndex.version !== 2) {
    error("UNSUPPORTED_VERSION", "project sourceIndex must be version 2", {
      version: sourceIndex.version,
    });
  }
  if (
    !Array.isArray(sourceIndex.documents) ||
    !Array.isArray(sourceIndex.entries) ||
    !Array.isArray(sourceIndex.issues)
  ) {
    error("SNAPSHOT_MISMATCH", "project sourceIndex is incomplete");
  }
  const documents = new Map<string, IndexedSourceDocument>();
  for (const [position, document] of sourceIndex.documents.entries()) {
    const item = record(document, `sourceIndex.documents[${position}]`);
    exactKeys(
      item,
      ["path", "digest", "length", "byteLength"],
      `sourceIndex.documents[${position}]`,
    );
    const path = validRelativePosixPath(item.path, `sourceIndex.documents[${position}].path`);
    if (documents.has(path)) error("SNAPSHOT_MISMATCH", `sourceIndex repeats document ${path}`);
    if (typeof item.digest !== "string" || !/^[a-f0-9]{64}$/.test(item.digest)) {
      error("SNAPSHOT_MISMATCH", `sourceIndex document ${path} has a malformed digest`);
    }
    for (const key of ["length", "byteLength"] as const) {
      if (!Number.isSafeInteger(item[key]) || (item[key] as number) < 0) {
        error("SNAPSHOT_MISMATCH", `sourceIndex document ${path} has malformed ${key}`);
      }
    }
    documents.set(path, document);
  }
  const expectedKeys = index.inventory.map(designRefKey);
  const actualKeys: string[] = [];
  for (const [position, entry] of sourceIndex.entries.entries()) {
    const item = record(entry, `sourceIndex.entries[${position}]`);
    exactKeys(item, ["ref", "sources"], `sourceIndex.entries[${position}]`);
    const ref = designRefFromUnknown(item.ref, `sourceIndex.entries[${position}].ref`);
    actualKeys.push(designRefKey(ref));
    if (!Array.isArray(item.sources)) {
      error("SNAPSHOT_MISMATCH", `sourceIndex.entries[${position}].sources must be an array`);
    }
    for (const [anchorPosition, anchor] of item.sources.entries()) {
      assertSourceAnchor(anchor, `sourceIndex.entries[${position}].sources[${anchorPosition}]`);
      if (!documents.has(anchor.range.path)) {
        error(
          "SNAPSHOT_MISMATCH",
          `source anchor references unknown document ${anchor.range.path}`,
        );
      }
    }
  }
  if (!sameCanonical(actualKeys, expectedKeys)) {
    error("SNAPSHOT_MISMATCH", "sourceIndex entries are not the exact application inventory");
  }
  for (const [position, issue] of sourceIndex.issues.entries()) {
    const item = record(issue, `sourceIndex.issues[${position}]`);
    enumValue(
      item.code,
      [
        "AMBIGUOUS_DESIGN_SOURCE",
        "UNRESOLVED_DESIGN_SOURCE",
        "MISSING_CONCEPT_REGISTRATION",
        "AMBIGUOUS_CONCEPT_REGISTRATION",
        "UNRESOLVED_VOCABULARY_SOURCE",
        "AMBIGUOUS_VOCABULARY_SOURCE",
        "AMBIGUOUS_ASSEMBLY_SOURCE",
        "UNRESOLVED_ASSEMBLY_SOURCE",
        "UNRESOLVED_IMPLEMENTATION_SELECTION",
        "AMBIGUOUS_ENDPOINT_SOURCE",
        "UNRESOLVED_COMPUTATION_SOURCE",
        "SOURCE_OUTSIDE_PROJECT",
        "SPECIFICATION_UNREADABLE",
        "SPECIFICATION_MISMATCH",
      ] as const,
      `sourceIndex.issues[${position}].code`,
    );
    if (typeof item.message !== "string") {
      error("SNAPSHOT_MISMATCH", `sourceIndex.issues[${position}] is malformed`);
    }
    enumValue(item.severity, SEVERITIES, `sourceIndex.issues[${position}].severity`);
    if (item.role !== undefined) {
      enumValue(item.role, SOURCE_ROLES, `sourceIndex.issues[${position}].role`);
    }
    if (item.ref !== undefined)
      designRefFromUnknown(item.ref, `sourceIndex.issues[${position}].ref`);
    if (item.candidates !== undefined) {
      if (!Array.isArray(item.candidates)) {
        error("SNAPSHOT_MISMATCH", `sourceIndex.issues[${position}].candidates is malformed`);
      }
      item.candidates.forEach((range, candidate) =>
        assertRange(range, `sourceIndex.issues[${position}].candidates[${candidate}]`),
      );
    }
  }
  validateUsage(sourceIndex.resourceUsage, "sourceIndex.resourceUsage");
}

function assertProjectDiagnosticDetail(value: unknown, label: string, phase: boolean): void {
  const diagnostic = record(value, label);
  const required = ["severity", "category", "code", "message", ...(phase ? ["phase"] : [])];
  const optional = [
    "source",
    "path",
    "startOffset",
    "endOffset",
    "line",
    "column",
    ...(phase ? ["projectConfigPath", "relatedInformation"] : []),
  ];
  const missing = required.filter((key) => !Object.hasOwn(diagnostic, key));
  const extra = Object.keys(diagnostic).filter(
    (key) => !required.includes(key) && !optional.includes(key),
  );
  if (missing.length > 0 || extra.length > 0) {
    error("SNAPSHOT_MISMATCH", `${label} has malformed fields`, { label, missing, extra });
  }
  enumValue(diagnostic.severity, SEVERITIES, `${label}.severity`);
  enumValue(
    diagnostic.category,
    ["warning", "error", "suggestion", "message"] as const,
    `${label}.category`,
  );
  if (phase) {
    enumValue(
      diagnostic.phase,
      ["config", "options", "global", "syntactic", "semantic"] as const,
      `${label}.phase`,
    );
  }
  if (!Number.isSafeInteger(diagnostic.code) || (diagnostic.code as number) < 0) {
    error("SNAPSHOT_MISMATCH", `${label}.code is malformed`);
  }
  if (typeof diagnostic.message !== "string") {
    error("SNAPSHOT_MISMATCH", `${label}.message is malformed`);
  }
  for (const key of ["source", "path"] as const) {
    if (diagnostic[key] !== undefined) nonEmptyString(diagnostic[key], `${label}.${key}`);
  }
  for (const key of ["startOffset", "endOffset"] as const) {
    if (
      diagnostic[key] !== undefined &&
      (!Number.isSafeInteger(diagnostic[key]) || (diagnostic[key] as number) < 0)
    ) {
      error("SNAPSHOT_MISMATCH", `${label}.${key} is malformed`);
    }
  }
  for (const key of ["line", "column"] as const) {
    if (
      diagnostic[key] !== undefined &&
      (!Number.isSafeInteger(diagnostic[key]) || (diagnostic[key] as number) < 1)
    ) {
      error("SNAPSHOT_MISMATCH", `${label}.${key} is malformed`);
    }
  }
  if (
    diagnostic.startOffset !== undefined &&
    diagnostic.endOffset !== undefined &&
    (diagnostic.endOffset as number) < (diagnostic.startOffset as number)
  ) {
    error("SNAPSHOT_MISMATCH", `${label} has a reversed source range`);
  }
  if (phase && diagnostic.relatedInformation !== undefined) {
    if (!Array.isArray(diagnostic.relatedInformation)) {
      error("SNAPSHOT_MISMATCH", `${label}.relatedInformation must be an array`);
    }
    diagnostic.relatedInformation.forEach((related, position) =>
      assertProjectDiagnosticDetail(related, `${label}.relatedInformation[${position}]`, false),
    );
  }
}

function assertProjectSnapshot(
  project: ApplicationProjectAnalysis,
  manifest: ApplicationManifestV5,
  recomputedIndex: ApplicationIndex,
): void {
  try {
    validateApplicationProjectAnalysis(project);
  } catch (cause) {
    error("SNAPSHOT_MISMATCH", "project analysis failed strict persistence validation", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (project.format !== "sync-engine.application-project-analysis") {
    error("INVALID_FORMAT", "project has an unsupported analysis format", {
      format: String(project.format),
    });
  }
  if (project.version !== 2) {
    error("UNSUPPORTED_VERSION", "project analysis must be version 2", {
      version: project.version,
    });
  }
  if (
    project.manifestDigest !== manifest.digest ||
    project.provenance.manifestDigest !== manifest.digest ||
    project.provenance.sourceRevision !== project.provenance.manifestSourceRevision
  ) {
    error("SNAPSHOT_MISMATCH", "project revision or manifest digest composition is stale");
  }
  try {
    assertArtifactProvenance(project, "project analysis", manifest);
    assertSameProvenance(recomputedIndex, project.applicationIndex, "project application index");
  } catch (cause) {
    error("SNAPSHOT_MISMATCH", "project provenance does not match the supplied manifest", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!sameCanonical(project.applicationIndex, recomputedIndex)) {
    error("SNAPSHOT_MISMATCH", "project applicationIndex is stale for the supplied manifest");
  }
  if (!sameCanonical(project.manifestDiagnostics, manifest.diagnostics)) {
    error("SNAPSHOT_MISMATCH", "project manifestDiagnostics differ from the supplied manifest");
  }
  if (!Array.isArray(project.diagnostics) || !Array.isArray(project.provenance.files)) {
    error("SNAPSHOT_MISMATCH", "project analysis is incomplete");
  }
  project.diagnostics.forEach((diagnostic, position) =>
    assertProjectDiagnosticDetail(diagnostic, `project.diagnostics[${position}]`, true),
  );
  const files = new Map<string, string>();
  for (const [position, file] of project.provenance.files.entries()) {
    const item = record(file, `project.provenance.files[${position}]`);
    exactKeys(item, ["path", "digest"], `project.provenance.files[${position}]`);
    const path = validRelativePosixPath(item.path, `project.provenance.files[${position}].path`);
    if (files.has(path)) error("SNAPSHOT_MISMATCH", `project repeats file ${path}`);
    if (typeof item.digest !== "string" || !/^[a-f0-9]{64}$/.test(item.digest)) {
      error("SNAPSHOT_MISMATCH", `project file ${path} has a malformed digest`);
    }
    files.set(path, item.digest);
  }
  if (
    project.provenance.sourceDigest !==
    sha256(JSON.stringify(project.provenance.files.map(({ path, digest }) => ({ path, digest }))))
  ) {
    error("SNAPSHOT_MISMATCH", "project sourceDigest is stale for its file records");
  }
  if (project.sourceIndex.typescriptVersion !== project.provenance.typescriptVersion) {
    error("SNAPSHOT_MISMATCH", "project and source index TypeScript versions differ");
  }
  assertSourceIndex(project.sourceIndex, manifest, recomputedIndex);
  for (const document of project.sourceIndex.documents) {
    if (files.get(document.path) !== document.digest) {
      error(
        "SNAPSHOT_MISMATCH",
        `source document ${document.path} differs from project provenance`,
      );
    }
  }
  validateUsage(project.resourceUsage, "project.resourceUsage");
}

class OperationController {
  readonly signal: AbortSignal | undefined;
  readonly maxResultBytes: number;
  private readonly retained: MutableResourceUsage = { ...EMPTY_USAGE };

  constructor(options: ApplicationAnalysisOperationOptions) {
    if (options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
      error("INVALID_ARGUMENT", "signal must be an AbortSignal");
    }
    this.signal = options.signal;
    this.maxResultBytes = boundedInteger(
      options.maxResultBytes,
      DEFAULT_RESULT_BYTES,
      1,
      MAX_RESULT_BYTES,
      "maxResultBytes",
    );
    this.checkpoint();
  }

  checkpoint(): void {
    if (this.signal?.aborted === true) {
      error("ABORTED", "Application analysis operation was aborted", {
        reason: this.signal.reason === undefined ? null : String(this.signal.reason),
      });
    }
  }

  graphNode(count = 1): void {
    this.checkpoint();
    this.retained.graphNodes += count;
  }

  graphEdge(count = 1): void {
    this.checkpoint();
    this.retained.graphEdges += count;
  }

  diagnostic(count = 1): void {
    this.checkpoint();
    this.retained.diagnostics += count;
  }

  source(anchor: SourceAnchor, text: boolean): void {
    this.checkpoint();
    this.retained.sourceAnchors += 1;
    if (text) this.retained.sourceTextBytes += Buffer.byteLength(anchor.text, "utf8");
  }

  sourceDocument(count = 1): void {
    this.checkpoint();
    this.retained.sourceDocuments += count;
  }

  projectFile(bytes: number): void {
    this.checkpoint();
    this.retained.projectFiles += 1;
    this.retained.projectBytes += bytes;
  }

  usage(): AnalysisResourceUsage {
    return { ...this.retained };
  }

  finish<Result extends ApplicationAnalysisResult>(result: Result): Result {
    this.checkpoint();
    validateApplicationAnalysisResult(result);
    const rendered = renderApplicationAnalysisResult(result);
    this.checkpoint();
    const attempted = Buffer.byteLength(rendered, "utf8");
    if (attempted > this.maxResultBytes) {
      error("LIMIT_EXCEEDED", "Canonical analysis result exceeds maxResultBytes", {
        limit: "maxResultBytes",
        maximum: this.maxResultBytes,
        attempted,
      });
    }
    return deepFreeze(result);
  }
}

function operationRequest(
  value: unknown,
  allowed: readonly string[],
  label: string,
): Record<string, unknown> {
  const request = record(value ?? {}, label);
  allowedKeys(request, [...allowed, "signal", "maxResultBytes"], label);
  return request;
}

function operationFailure(cause: unknown): never {
  if (cause instanceof AnalysisError) throw cause;
  if (cause instanceof AnalysisAbortedError) {
    error("ABORTED", cause.message, {
      reason: cause.reason === undefined ? null : String(cause.reason),
    });
  }
  if (cause instanceof AnalysisLimitError) {
    error("LIMIT_EXCEEDED", cause.message, {
      limit: cause.limit,
      maximum: cause.maximum,
      attempted: cause.attempted,
    });
  }
  error("INVALID_ARGUMENT", cause instanceof Error ? cause.message : String(cause));
}

async function runOperation<Result extends ApplicationAnalysisResult>(
  options: ApplicationAnalysisOperationOptions,
  execute: (controller: OperationController) => Result | Promise<Result>,
): Promise<Result> {
  try {
    const controller = new OperationController(options);
    const result = await execute(controller);
    return controller.finish(result);
  } catch (cause) {
    return operationFailure(cause);
  }
}

function resultBase<Kind extends ApplicationAnalysisResultKind>(
  kind: Kind,
  identity: ApplicationAnalysisIdentity,
  provenance: AnalysisProvenance,
  complete: boolean,
  controller: OperationController,
): ApplicationAnalysisResultBase<Kind> {
  return {
    format: "sync-engine.application-analysis-result",
    version: 1,
    kind,
    identity,
    provenance,
    complete,
    resourceUsage: controller.usage(),
  };
}

function leafName(ref: DesignRef): string {
  switch (ref.kind) {
    case "concept":
      return ref.concept;
    case "action":
      return ref.action;
    case "query":
      return ref.query;
    case "reaction":
      return ref.reaction;
    case "view":
      return ref.view;
    case "former":
      return ref.former;
    case "computation":
      return ref.computation;
    case "endpoint":
      return ref.endpoint;
  }
}

function qualifiedName(ref: DesignRef): string {
  switch (ref.kind) {
    case "action":
      return `${ref.concept}.${ref.action}`;
    case "query":
      return `${ref.concept}.${ref.query}`;
    case "endpoint":
      return `${ref.endpoint} ${ref.path}`;
    default:
      return leafName(ref);
  }
}

function parentConcept(ref: DesignRef): string | undefined {
  return ref.kind === "action" || ref.kind === "query" ? ref.concept : undefined;
}

function reactionPortability(
  manifest: ApplicationManifestV5,
  ref: DesignRef,
): ReactionPortability | undefined {
  if (ref.kind !== "reaction") return undefined;
  return manifest.application.reactions.some(({ name }) => name === ref.reaction)
    ? "portable"
    : "unlowered";
}

function manifestDiagnosticRefs(
  manifest: ApplicationManifestV5,
  diagnostic: ApplicationDiagnostic,
): DesignRef[] {
  const { kind, name } = diagnostic.definition;
  if (kind === "reaction") return [{ kind, reaction: name }];
  if (kind === "view") return [{ kind, view: name }];
  if (kind === "former") return [{ kind, former: name }];
  if (kind === "endpoint") {
    return manifest.endpoints
      .filter((endpoint) => endpoint.name === name)
      .map((endpoint) => ({ kind: "endpoint", endpoint: endpoint.name, path: endpoint.path }));
  }
  return [];
}

function diagnosticId(value: Omit<AnalysisDiagnostic, "id">): string {
  return `analysis-diagnostic:${canonicalAnalysisDigest(value)}`;
}

function projectDiagnosticLocations(
  diagnostic: ApplicationProjectDiagnostic,
): ApplicationProjectDiagnosticRelatedInformation[] {
  return [diagnostic, ...(diagnostic.relatedInformation ?? [])];
}

function projectDiagnosticRefs(
  diagnostic: ApplicationProjectDiagnostic,
  sourceIndex: ApplicationSourceIndex | undefined,
): DesignRef[] {
  if (sourceIndex === undefined) return [];
  const refs: DesignRef[] = [];
  for (const location of projectDiagnosticLocations(diagnostic)) {
    if (location.path === undefined || location.startOffset === undefined) continue;
    const start = location.startOffset;
    const end = location.endOffset ?? start;
    const point = end === start;
    for (const entry of sourceIndex.entries) {
      if (
        entry.sources.some((anchor) => {
          if (anchor.range.path !== location.path) return false;
          return point
            ? anchor.range.start.offset <= start && start < anchor.range.end.offset
            : anchor.range.start.offset < end && start < anchor.range.end.offset;
        })
      ) {
        refs.push(entry.ref);
      }
    }
  }
  return sortedUniqueRefs(refs);
}

function unifiedDiagnostics(
  manifest: ApplicationManifestV5,
  project: ApplicationProjectAnalysis | undefined,
  index: ApplicationIndex,
  sourceIndex: ApplicationSourceIndex | undefined,
): AnalysisDiagnostic[] {
  const values: Array<Omit<AnalysisDiagnostic, "id">> = [];
  for (const diagnostic of manifest.diagnostics) {
    const refs = sortedUniqueRefs(manifestDiagnosticRefs(manifest, diagnostic));
    const paths = diagnostic.endpoint === undefined ? [] : [diagnostic.endpoint.path];
    values.push({
      origin: "manifest",
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      refs,
      paths: sortedUniqueStrings(paths),
      raw: { kind: "manifest", diagnostic },
    });
  }
  for (const diagnostic of project?.diagnostics ?? []) {
    values.push({
      origin: "typescript",
      severity: diagnostic.severity,
      code: String(diagnostic.code),
      message: diagnostic.message,
      refs: projectDiagnosticRefs(diagnostic, sourceIndex),
      paths: sortedUniqueStrings(
        projectDiagnosticLocations(diagnostic).flatMap(({ path }) =>
          path === undefined ? [] : [path],
        ),
      ),
      raw: { kind: "typescript", diagnostic },
    });
  }
  for (const issue of index.issues) {
    values.push({
      origin: "index",
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      refs: issue.ref === undefined ? [] : [issue.ref],
      paths: [],
      raw: { kind: "index", issue },
    });
  }
  for (const issue of sourceIndex?.issues ?? []) {
    values.push({
      origin: "source",
      severity: issue.severity,
      code: issue.code,
      message: issue.message,
      refs: issue.ref === undefined ? [] : [issue.ref],
      paths: sortedUniqueStrings(issue.candidates?.map(({ path }) => path) ?? []),
      raw: { kind: "source", issue },
    });
  }
  const unique = new Map<string, AnalysisDiagnostic>();
  for (const value of values) {
    const id = diagnosticId(value);
    unique.set(id, { id, ...value });
  }
  return [...unique.values()].sort((left, right) => ordinal(left.id, right.id));
}

function analysisDiagnostic(
  severity: AnalysisSeverity,
  code: string,
  message: string,
  evidence: Readonly<Record<string, unknown>>,
  refs: readonly DesignRef[] = [],
  paths: readonly string[] = [],
): AnalysisDiagnostic {
  const value: Omit<AnalysisDiagnostic, "id"> = {
    origin: "analysis",
    severity,
    code,
    message,
    refs: sortedUniqueRefs(refs),
    paths: sortedUniqueStrings(paths),
    raw: { kind: "analysis", evidence },
  };
  return { id: diagnosticId(value), ...value };
}

function diagnosticsForRefs(
  diagnostics: readonly AnalysisDiagnostic[],
  refs: Iterable<DesignRef>,
): AnalysisDiagnostic[] {
  const keys = new Set([...refs].map(designRefKey));
  return diagnostics.filter((diagnostic) =>
    diagnostic.refs.some((ref) => keys.has(designRefKey(ref))),
  );
}

function guidanceEntry(
  ruleId: string,
  topic: AnalysisGuidanceTopic,
  title: string,
  message: string,
  documentationPath: string,
  diagnostics: readonly AnalysisDiagnostic[],
  refs: readonly DesignRef[] = diagnostics.flatMap(({ refs: diagnosticRefs }) => diagnosticRefs),
): AnalysisGuidance {
  return {
    id: ruleId,
    ruleId,
    topic,
    title,
    message,
    documentationPath,
    refs: sortedUniqueRefs(refs),
    diagnosticIds: sortedUniqueStrings(diagnostics.map(({ id }) => id)),
  };
}

function analysisGuidance(
  manifest: ApplicationManifestV5,
  project: ApplicationProjectAnalysis | undefined,
  diagnostics: readonly AnalysisDiagnostic[],
): AnalysisGuidance[] {
  const byCode = (codes: readonly string[]) =>
    diagnostics.filter(({ code }) => codes.includes(code));
  const opaque = byCode([
    "OPAQUE_DEFINITION",
    "UNLOWERED_REACTION",
    "OPAQUE_READ_OPERATION",
    "OPAQUE_PATTERN",
  ]);
  const unresolved = byCode([
    "AMBIGUOUS_DESIGN_SOURCE",
    "UNRESOLVED_DESIGN_SOURCE",
    "MISSING_CONCEPT_REGISTRATION",
    "AMBIGUOUS_CONCEPT_REGISTRATION",
    "UNRESOLVED_VOCABULARY_SOURCE",
    "AMBIGUOUS_VOCABULARY_SOURCE",
    "AMBIGUOUS_ASSEMBLY_SOURCE",
    "UNRESOLVED_ASSEMBLY_SOURCE",
    "UNRESOLVED_IMPLEMENTATION_SELECTION",
    "AMBIGUOUS_ENDPOINT_SOURCE",
    "UNRESOLVED_COMPUTATION_SOURCE",
    "SPECIFICATION_UNREADABLE",
  ]);
  const guidance: AnalysisGuidance[] = [
    guidanceEntry(
      "possible-impact-caveat",
      "impact",
      "Possible impact is not semantic proof",
      "Impact edges and traces are deterministic evidence of possible change flow; they do not prove runtime firing or semantic safety.",
      "public-surface.md#impact-navigation-and-change-targets",
      byCode(["TRACE_LIMIT_REACHED", "NAVIGATION_LIMIT_REACHED"]),
    ),
    guidanceEntry(
      "exact-revision-provenance",
      "provenance",
      "Keep analysis bound to its exact snapshot",
      project === undefined
        ? "This analysis is manifest-bound and has no checkout revision or source digest; obtain a V2 project analysis before making source claims."
        : "Use the manifest digest, analysis digest, source revision, and source digest together when comparing or persisting evidence.",
      "public-surface.md#identity-provenance-and-persistence",
      [],
    ),
    guidanceEntry(
      "opaque-definition",
      "definitions",
      "Opaque definitions retain incomplete semantics",
      "Only the known structural shell is available for opaque or unlowered behavior; inspect authored source and do not treat the graph as a semantic proof.",
      "public-surface.md#catalog-search-and-definitions",
      opaque,
    ),
    guidanceEntry(
      "ambiguous-unresolved-source",
      "sources",
      "Source attribution may be incomplete",
      "Ambiguous and unresolved anchors are reported rather than guessed from declaration order; inspect every candidate before relying on source coverage.",
      "public-surface.md#source-queries",
      unresolved,
    ),
    guidanceEntry(
      "source-spec-mismatch",
      "sources",
      "Keep authored source and manifest specifications aligned",
      "Regenerate source-derived evidence and manifests from one exact revision before comparing definitions; mismatch diagnostics identify known drift.",
      "public-surface.md#source-queries",
      byCode(["SPECIFICATION_MISMATCH"]),
    ),
    guidanceEntry(
      "generated-contract-vs-validation",
      "contracts",
      "Generated contracts do not perform runtime validation",
      "Logical input and wire contracts describe generated data shapes. Endpoint validator flags separately report runtime validation wiring.",
      "public-surface.md#logical-and-projected-contracts",
      byCode(["UNRESOLVED_WIRE_LEAF"]),
      manifest.endpoints.map(({ name, path }) => ({ kind: "endpoint", endpoint: name, path })),
    ),
    guidanceEntry(
      "declaration-order-not-priority",
      "ordering",
      "Declaration order is not behavior priority",
      "Stable output ordering exists for comparison only. Do not infer execution priority or conflict resolution from declaration or result order.",
      "public-surface.md#ordering-and-pagination",
      byCode(["ORDER_SENSITIVE_FORMER"]),
      manifest.application.formers.map(({ name }) => ({ kind: "former", former: name })),
    ),
  ];
  return guidance.sort((left, right) => ordinal(left.ruleId, right.ruleId));
}

function sourceEntry(
  sourceIndex: ApplicationSourceIndex | undefined,
  ref: DesignRef,
): ApplicationSourceIndex["entries"][number] | undefined {
  const key = designRefKey(ref);
  return sourceIndex?.entries.find((entry) => designRefKey(entry.ref) === key);
}

function sourceAvailabilityFor(
  sourceIndex: ApplicationSourceIndex | undefined,
  ref: DesignRef,
): SourceAvailability {
  if (sourceIndex === undefined) return "unavailable";
  const key = designRefKey(ref);
  const entry = sourceEntry(sourceIndex, ref);
  if ((entry?.sources.length ?? 0) > 0) return "available";
  const issues = sourceIndex.issues.filter(
    (issue) => issue.ref !== undefined && designRefKey(issue.ref) === key,
  );
  if (
    issues.some(({ code }) =>
      [
        "AMBIGUOUS_DESIGN_SOURCE",
        "AMBIGUOUS_CONCEPT_REGISTRATION",
        "AMBIGUOUS_VOCABULARY_SOURCE",
        "AMBIGUOUS_ASSEMBLY_SOURCE",
        "AMBIGUOUS_ENDPOINT_SOURCE",
      ].includes(code),
    )
  ) {
    return "ambiguous";
  }
  if (
    issues.some(({ code }) =>
      [
        "UNRESOLVED_DESIGN_SOURCE",
        "MISSING_CONCEPT_REGISTRATION",
        "UNRESOLVED_VOCABULARY_SOURCE",
        "UNRESOLVED_ASSEMBLY_SOURCE",
        "UNRESOLVED_IMPLEMENTATION_SELECTION",
        "UNRESOLVED_COMPUTATION_SOURCE",
        "SPECIFICATION_UNREADABLE",
      ].includes(code),
    )
  ) {
    return "unresolved";
  }
  return "not-indexed";
}

function designSummary(
  manifest: ApplicationManifestV5,
  sourceIndex: ApplicationSourceIndex | undefined,
  diagnostics: readonly AnalysisDiagnostic[],
  ref: DesignRef,
): DesignSummary {
  const key = designRefKey(ref);
  const entry = sourceEntry(sourceIndex, ref);
  const related = diagnostics.filter((diagnostic) =>
    diagnostic.refs.some((candidate) => designRefKey(candidate) === key),
  );
  const counts: MutableSeverityCounts = { error: 0, warning: 0, info: 0 };
  for (const diagnostic of related) counts[diagnostic.severity] += 1;
  const parent = parentConcept(ref);
  const portability = reactionPortability(manifest, ref);
  return {
    ref,
    key,
    name: leafName(ref),
    qualifiedName: qualifiedName(ref),
    ...(parent === undefined ? {} : { parentConcept: parent }),
    ...(portability === undefined ? {} : { portability }),
    sourceAvailability: sourceAvailabilityFor(sourceIndex, ref),
    anchorCount: entry?.sources.length ?? 0,
    sourcePaths: sortedUniqueStrings(entry?.sources.map(({ range }) => range.path) ?? []),
    diagnostics: counts,
  };
}

function specificationForConcept(
  manifest: ApplicationManifestV5,
  conceptName: string,
): ConceptSpecificationIR | undefined {
  return manifest.concepts.find(({ name }) => name === conceptName)?.specification;
}

function definitionFor(manifest: ApplicationManifestV5, ref: DesignRef): DesignDefinition {
  switch (ref.kind) {
    case "concept": {
      const concept = manifest.concepts.find(({ name }) => name === ref.concept)!;
      const implementation = manifest.conceptImplementations.find(
        ({ concept: name }) => name === ref.concept,
      );
      return {
        kind: "concept",
        concept,
        ...(implementation === undefined ? {} : { implementation }),
      };
    }
    case "action": {
      const concept = manifest.concepts.find(({ name }) => name === ref.concept)!;
      const action = concept.actions.find(({ name }) => name === ref.action)!;
      const specification = specificationForConcept(manifest, ref.concept)?.actions.find(
        ({ name }) => name === ref.action,
      );
      return {
        kind: "action",
        concept: ref.concept,
        action,
        ...(specification === undefined ? {} : { specification }),
      };
    }
    case "query": {
      const concept = manifest.concepts.find(({ name }) => name === ref.concept)!;
      const query = concept.queries.find(({ name }) => name === ref.query)!;
      const specification = specificationForConcept(manifest, ref.concept)?.queries.find(
        ({ name }) => name === ref.query,
      );
      return {
        kind: "query",
        concept: ref.concept,
        query,
        ...(specification === undefined ? {} : { specification }),
      };
    }
    case "reaction": {
      const portable = manifest.application.reactions.find(({ name }) => name === ref.reaction);
      if (portable !== undefined) {
        return {
          kind: "reaction",
          portability: "portable",
          reaction: portable,
          rendered: renderReaction(portable),
        };
      }
      return {
        kind: "reaction",
        portability: "unlowered",
        reaction: manifest.application.unlowered.find(({ name }) => name === ref.reaction)!,
      };
    }
    case "view":
      return {
        kind: "view",
        view: manifest.application.views.find(({ name }) => name === ref.view)!,
      };
    case "former":
      return {
        kind: "former",
        former: manifest.application.formers.find(({ name }) => name === ref.former)!,
      };
    case "computation":
      return {
        kind: "computation",
        computation: manifest.computations.find(({ name }) => name === ref.computation)!,
      };
    case "endpoint": {
      const endpoint = manifest.endpoints.find(
        ({ name, path }) => name === ref.endpoint && path === ref.path,
      )!;
      return {
        kind: "endpoint",
        endpoint,
        inputContract: manifest.inputContracts[ref.path] ?? endpoint.input,
        wire: {
          endpoints: manifest.wire.endpoints.filter(({ path }) => path === ref.path),
          appWide: manifest.wire.appWide,
        },
      };
    }
  }
}

function sourceQueryFromUnknown(value: unknown): SourceQuery {
  const query = record(value, "query");
  const kind = enumValue(query.kind, ["ref", "cursor", "range", "file"] as const, "query.kind");
  switch (kind) {
    case "ref":
      exactKeys(query, ["kind", "ref"], "query");
      return { kind, ref: designRefFromUnknown(query.ref, "query.ref") };
    case "cursor":
      exactKeys(query, ["kind", "path", "offset"], "query");
      return {
        kind,
        path: validRelativePosixPath(query.path, "query.path"),
        offset: boundedInteger(query.offset, 0, 0, Number.MAX_SAFE_INTEGER, "query.offset"),
      };
    case "range": {
      exactKeys(query, ["kind", "path", "start", "end"], "query");
      const start = boundedInteger(query.start, 0, 0, Number.MAX_SAFE_INTEGER, "query.start");
      const end = boundedInteger(query.end, 0, 0, Number.MAX_SAFE_INTEGER, "query.end");
      if (end < start) error("INVALID_ARGUMENT", "query.end must not precede query.start");
      return { kind, path: validRelativePosixPath(query.path, "query.path"), start, end };
    }
    case "file":
      exactKeys(query, ["kind", "path"], "query");
      return { kind, path: validRelativePosixPath(query.path, "query.path") };
  }
}

function rankedSourceMatches(
  sourceIndex: ApplicationSourceIndex,
  query: SourceQuery,
  roles: ReadonlySet<SourceRole> | undefined,
  resolutions: ReadonlySet<SourceResolution> | undefined,
  content: SourceContent,
  mode: SourceMatchMode,
  controller: OperationController,
): SourceMatch[] {
  const documents = new Map(sourceIndex.documents.map((document) => [document.path, document]));
  const result = queryApplicationSources(sourceIndex, query as ApplicationSourceQuery, {
    ...(roles === undefined ? {} : { roles: [...roles] }),
    ...(resolutions === undefined ? {} : { resolutions: [...resolutions] }),
    match: mode,
  });
  return result.matches.map(({ ref, anchor, specificity, rank }) => {
    controller.checkpoint();
    controller.source(anchor, content === "text");
    const metadata: SourceMatchMetadata = {
      path: anchor.range.path,
      range: anchor.range,
      digest: anchor.digest,
      bytes: Buffer.byteLength(anchor.text, "utf8"),
      ...(documents.get(anchor.range.path) === undefined
        ? {}
        : { document: documents.get(anchor.range.path)! }),
      ...(anchor.focusRange === undefined ? {} : { focusRange: anchor.focusRange }),
      ...(anchor.excerpt === undefined ? {} : { excerpt: anchor.excerpt }),
    };
    return {
      ref,
      role: anchor.role,
      resolution: anchor.resolution,
      specificity,
      rank,
      metadata,
      ...(content === "text" ? { text: anchor.text } : {}),
    };
  });
}

function relevantSourceDiagnostics(
  diagnostics: readonly AnalysisDiagnostic[],
  query: SourceQuery,
  matches: readonly SourceMatch[],
): AnalysisDiagnostic[] {
  const keys = new Set(matches.map(({ ref }) => designRefKey(ref)));
  if (query.kind === "ref") keys.add(designRefKey(query.ref as DesignRef));
  const path = query.kind === "ref" ? undefined : query.path;
  return diagnostics.filter(
    (diagnostic) =>
      diagnostic.origin === "source" &&
      (diagnostic.refs.some((ref) => keys.has(designRefKey(ref))) ||
        (path !== undefined && diagnostic.paths.includes(path))),
  );
}

interface SearchFacts {
  readonly identity: string;
  readonly contract: string;
  readonly rendered: string;
  readonly "source-path": string;
  readonly "source-text": string;
}

function searchFacts(
  manifest: ApplicationManifestV5,
  sourceIndex: ApplicationSourceIndex | undefined,
  ref: DesignRef,
  controller: OperationController,
): SearchFacts {
  const entry = sourceEntry(sourceIndex, ref);
  const identity = [designRefKey(ref), qualifiedName(ref), leafName(ref), parentConcept(ref) ?? ""]
    .filter((value) => value !== "")
    .join(" | ");
  let rendered = "";
  if (ref.kind === "reaction") {
    const reaction = manifest.application.reactions.find(({ name }) => name === ref.reaction);
    if (reaction !== undefined) rendered = renderReaction(reaction);
  } else if (ref.kind === "endpoint") {
    const contract = manifest.inputContracts[ref.path];
    const wire = {
      endpoints: manifest.wire.endpoints.filter(({ path }) => path === ref.path),
      appWide: manifest.wire.appWide,
    };
    rendered = `${renderInputContracts(contract === undefined ? {} : { [ref.path]: contract })}\n${renderWireTypes(wire)}`;
  }
  for (const _anchor of entry?.sources ?? []) controller.checkpoint();
  return {
    identity,
    contract: canonicalAnalysisJson(definitionFor(manifest, ref)),
    rendered,
    "source-path": sortedUniqueStrings(entry?.sources.map(({ range }) => range.path) ?? []).join(
      "\n",
    ),
    "source-text": entry?.sources.map(({ text }) => text).join("\n") ?? "",
  };
}

function includesTokens(value: string, tokens: readonly string[]): boolean {
  const lower = value.toLocaleLowerCase();
  return tokens.every((token) => lower.includes(token));
}

function snippet(
  value: string,
  tokens: readonly string[],
): Pick<SearchHit, "snippet" | "truncatedStart" | "truncatedEnd"> {
  if (value.length <= 160) {
    return { snippet: value, truncatedStart: false, truncatedEnd: false };
  }
  const lower = value.toLocaleLowerCase();
  const first = Math.max(
    0,
    ...tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0),
  );
  let start = Math.max(0, first - 40);
  let end = Math.min(value.length, start + 160);
  if (end === value.length) start = Math.max(0, end - 160);
  end = Math.min(value.length, start + 160);
  return {
    snippet: value.slice(start, end),
    truncatedStart: start > 0,
    truncatedEnd: end < value.length,
  };
}

function searchHit(
  manifest: ApplicationManifestV5,
  sourceIndex: ApplicationSourceIndex | undefined,
  ref: DesignRef,
  query: string,
  tokens: readonly string[],
  fields: readonly SearchField[],
  controller: OperationController,
): SearchHit | undefined {
  const facts = searchFacts(manifest, sourceIndex, ref, controller);
  const selected = fields.map((field) => [field, facts[field]] as const);
  if (!includesTokens(selected.map(([, value]) => value).join("\n"), tokens)) return undefined;
  const key = designRefKey(ref);
  const qualified = qualifiedName(ref);
  const leaf = leafName(ref);
  const normalizedQuery = query.toLocaleLowerCase();
  const identitySelected = fields.includes("identity");
  const pathsSelected = fields.includes("source-path");
  let rank = 6;
  if (
    identitySelected &&
    (key.toLocaleLowerCase() === normalizedQuery ||
      qualified.toLocaleLowerCase() === normalizedQuery)
  ) {
    rank = 0;
  } else if (identitySelected && leaf.toLocaleLowerCase() === normalizedQuery) {
    rank = 1;
  } else if (
    identitySelected &&
    [key, qualified, leaf].some((value) => value.toLocaleLowerCase().startsWith(normalizedQuery))
  ) {
    rank = 2;
  } else if (
    identitySelected &&
    tokens.every((token) =>
      facts.identity
        .toLocaleLowerCase()
        .split(/[^a-z0-9_#/:.-]+/u)
        .some((word) => word.startsWith(token)),
    )
  ) {
    rank = 3;
  } else if (
    (identitySelected || pathsSelected) &&
    includesTokens(
      `${identitySelected ? facts.identity : ""}\n${pathsSelected ? facts["source-path"] : ""}`,
      tokens,
    )
  ) {
    rank = 4;
  } else if (
    (fields.includes("contract") && includesTokens(facts.contract, tokens)) ||
    (fields.includes("rendered") && includesTokens(facts.rendered, tokens))
  ) {
    rank = 5;
  }
  const fieldPriority: readonly SearchField[] = [
    "identity",
    "source-path",
    "contract",
    "rendered",
    "source-text",
  ];
  const matchedField =
    fieldPriority.find((field) => fields.includes(field) && includesTokens(facts[field], tokens)) ??
    fieldPriority.find(
      (field) => fields.includes(field) && facts[field].toLocaleLowerCase().includes(tokens[0]),
    )!;
  if (matchedField === "source-text") {
    for (const anchor of sourceEntry(sourceIndex, ref)?.sources ?? [])
      controller.source(anchor, true);
  }
  return {
    ref,
    key,
    qualifiedName: qualified,
    rank,
    matchedField,
    ...snippet(facts[matchedField], tokens),
  };
}

function edgeKey(edge: ImpactEdge): string {
  return JSON.stringify([
    designRefKey(edge.from),
    designRefKey(edge.to),
    edge.relation,
    edge.certainty,
  ]);
}

function edgeFilters(request: Record<string, unknown>): {
  readonly relations?: ReadonlySet<ImpactRelation>;
  readonly certainties?: ReadonlySet<ImpactCertainty>;
} {
  return {
    relations: enumSet(request.relations, IMPACT_RELATIONS, "relations"),
    certainties: enumSet(request.certainties, IMPACT_CERTAINTIES, "certainties"),
  };
}

function filteredIndex(
  index: ApplicationIndex,
  filters: {
    readonly relations?: ReadonlySet<ImpactRelation>;
    readonly certainties?: ReadonlySet<ImpactCertainty>;
  },
  controller: OperationController,
): ApplicationIndex {
  const edges = index.edges.filter((edge) => {
    controller.checkpoint();
    return (
      (filters.relations === undefined || filters.relations.has(edge.relation)) &&
      (filters.certainties === undefined || filters.certainties.has(edge.certainty))
    );
  });
  return { ...index, edges };
}

function traceIssueDiagnostic(issue: AnalysisIssue): AnalysisDiagnostic {
  return analysisDiagnostic(
    issue.severity,
    issue.code,
    issue.message,
    { issue },
    issue.ref === undefined ? [] : [issue.ref],
  );
}

function certaintyRank(certainty: ImpactCertainty): number {
  return IMPACT_CERTAINTIES.indexOf(certainty);
}

function leastCertain(values: Iterable<ImpactCertainty>): ImpactCertainty {
  let selected: ImpactCertainty = "structural";
  for (const value of values) {
    if (certaintyRank(value) > certaintyRank(selected)) selected = value;
  }
  return selected;
}

interface FacadeState {
  readonly manifest: ApplicationManifestV5;
  readonly project?: ApplicationProjectAnalysis;
  readonly index: ApplicationIndex;
  readonly sourceIndex?: ApplicationSourceIndex;
  readonly identity: ApplicationAnalysisIdentity;
  readonly provenance: AnalysisProvenance;
  readonly refs: ReadonlyMap<string, DesignRef>;
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly guidance: readonly AnalysisGuidance[];
  readonly summaries: readonly DesignSummary[];
}

function knownRef(state: FacadeState, value: unknown, label: string): DesignRef {
  const requested = designRefFromUnknown(value, label);
  const known = state.refs.get(designRefKey(requested));
  if (known === undefined) {
    error(
      "NOT_FOUND",
      `Design reference ${designRefKey(requested)} is not in the manifest inventory`,
      {
        ref: requested,
      },
    );
  }
  return known;
}

function knownRefs(
  state: FacadeState,
  value: unknown,
  label: string,
  maximum = Number.MAX_SAFE_INTEGER,
): DesignRef[] {
  if (!Array.isArray(value)) error("INVALID_ARGUMENT", `${label} must be an array`, { label });
  if (value.length > maximum) {
    error("LIMIT_EXCEEDED", `${label} exceeds its hard maximum`, {
      limit: label,
      maximum,
      attempted: value.length,
    });
  }
  return sortedUniqueRefs(
    value.map((ref, position) => knownRef(state, ref, `${label}[${position}]`)),
  );
}

function catalogOperation(
  state: FacadeState,
  requestValue: CatalogRequest | undefined,
): Promise<CatalogResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(supplied, ["filters", "page"], "catalog request");
    const filterValue = request.filters === undefined ? {} : record(request.filters, "filters");
    allowedKeys(
      filterValue,
      ["kinds", "concepts", "portability", "sourceAvailability", "diagnosticSeverities"],
      "filters",
    );
    const kinds = enumSet(filterValue.kinds, DESIGN_KINDS, "filters.kinds");
    const concepts = stringSet(filterValue.concepts, "filters.concepts");
    const portability = enumSet(
      filterValue.portability,
      ["portable", "unlowered"] as const,
      "filters.portability",
    );
    const availability = enumSet(
      filterValue.sourceAvailability,
      ["available", "ambiguous", "unresolved", "not-indexed", "unavailable"] as const,
      "filters.sourceAvailability",
    );
    const severities = enumSet(
      filterValue.diagnosticSeverities,
      SEVERITIES,
      "filters.diagnosticSeverities",
    );
    const filtered = state.summaries.filter((summary) => {
      controller.checkpoint();
      return (
        (kinds === undefined || kinds.has(summary.ref.kind)) &&
        (concepts === undefined ||
          (summary.ref.kind === "concept" && concepts.has(summary.ref.concept)) ||
          (summary.parentConcept !== undefined && concepts.has(summary.parentConcept))) &&
        (portability === undefined ||
          (summary.portability !== undefined && portability.has(summary.portability))) &&
        (availability === undefined || availability.has(summary.sourceAvailability)) &&
        (severities === undefined ||
          [...severities].some((severity) => summary.diagnostics[severity] > 0))
      );
    });
    const page = pageOf(filtered, pageRequest(request.page));
    controller.graphNode(page.items.length);
    return {
      ...resultBase("catalog", state.identity, state.provenance, true, controller),
      ...page,
    };
  });
}

function searchOperation(state: FacadeState, requestValue: SearchRequest): Promise<SearchResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(requestValue, ["query", "fields", "page"], "search request");
    if (typeof request.query !== "string") error("INVALID_ARGUMENT", "query must be a string");
    const query = request.query.trim();
    if (query.length === 0 || query.length > 256) {
      error("INVALID_ARGUMENT", "query must contain from 1 to 256 UTF-16 code units", {
        length: query.length,
      });
    }
    const requestedFields = enumSet(request.fields, SEARCH_FIELDS, "fields");
    const fields =
      requestedFields === undefined
        ? [...DEFAULT_SEARCH_FIELDS]
        : SEARCH_FIELDS.filter((field) => requestedFields.has(field));
    if (fields.length === 0)
      error("INVALID_ARGUMENT", "fields must select at least one search field");
    if (fields.includes("source-text") && state.sourceIndex === undefined) {
      error("CAPABILITY_UNAVAILABLE", "source-text search requires a V2 project source snapshot", {
        capability: "source-text",
      });
    }
    const tokens = query.toLocaleLowerCase().split(/\s+/u);
    const hits: SearchHit[] = [];
    for (const ref of state.index.inventory) {
      controller.checkpoint();
      const hit = searchHit(
        state.manifest,
        state.sourceIndex,
        ref,
        query,
        tokens,
        fields,
        controller,
      );
      if (hit !== undefined) hits.push(hit);
    }
    hits.sort((left, right) => left.rank - right.rank || ordinal(left.key, right.key));
    const page = pageOf(hits, pageRequest(request.page));
    controller.graphNode(page.items.length);
    return {
      ...resultBase("search", state.identity, state.provenance, true, controller),
      query,
      fields,
      ...page,
    };
  });
}

function describeOperation(
  state: FacadeState,
  requestValue: DescribeRequest,
): Promise<DescriptionResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(requestValue, ["ref", "detail"], "describe request");
    const ref = knownRef(state, request.ref, "ref");
    const detail =
      request.detail === undefined
        ? "definition"
        : enumValue(request.detail, ["summary", "definition", "full"] as const, "detail");
    if (detail === "full" && state.sourceIndex === undefined) {
      error("CAPABILITY_UNAVAILABLE", "full descriptions require a V2 project source snapshot", {
        capability: "source-text",
      });
    }
    const summary = state.summaries.find(({ key }) => key === designRefKey(ref))!;
    controller.graphNode();
    if (detail === "summary") {
      return {
        ...resultBase("description", state.identity, state.provenance, true, controller),
        ref,
        detail,
        summary,
      };
    }
    const definition = definitionFor(state.manifest, ref);
    if (detail === "definition") {
      return {
        ...resultBase("description", state.identity, state.provenance, true, controller),
        ref,
        detail,
        summary,
        definition,
      };
    }
    const sources = rankedSourceMatches(
      state.sourceIndex!,
      { kind: "ref", ref },
      undefined,
      undefined,
      "text",
      "all",
      controller,
    );
    const diagnostics = diagnosticsForRefs(state.diagnostics, [ref]);
    controller.diagnostic(diagnostics.length);
    return {
      ...resultBase("description", state.identity, state.provenance, true, controller),
      ref,
      detail,
      summary,
      definition,
      sources,
      diagnostics,
    };
  });
}

function sourcesOperation(
  state: FacadeState,
  requestValue: SourcesRequest,
): Promise<SourcesResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(
      requestValue,
      ["query", "roles", "resolutions", "content", "match", "page"],
      "sources request",
    );
    if (state.sourceIndex === undefined) {
      error("CAPABILITY_UNAVAILABLE", "source queries require a V2 project source snapshot", {
        capability: "sources",
      });
    }
    let query = sourceQueryFromUnknown(request.query);
    if (query.kind === "ref") query = { kind: "ref", ref: knownRef(state, query.ref, "query.ref") };
    const roles = enumSet(request.roles, SOURCE_ROLES, "roles");
    const resolutions = enumSet(request.resolutions, SOURCE_RESOLUTIONS, "resolutions");
    const content =
      request.content === undefined
        ? "metadata"
        : enumValue(request.content, ["metadata", "text"] as const, "content");
    const match =
      request.match === undefined
        ? "all"
        : enumValue(request.match, ["all", "best"] as const, "match");
    const matches = rankedSourceMatches(
      state.sourceIndex,
      query,
      roles,
      resolutions,
      content,
      match,
      controller,
    );
    const page = pageOf(matches, pageRequest(request.page));
    const documents = new Set(page.items.map(({ metadata }) => metadata.path));
    controller.sourceDocument(documents.size);
    const issues = relevantSourceDiagnostics(state.diagnostics, query, matches);
    controller.diagnostic(issues.length);
    return {
      ...resultBase("sources", state.identity, state.provenance, issues.length === 0, controller),
      query,
      content,
      match,
      issues,
      ...page,
    };
  });
}

function diagnosticsOperation(
  state: FacadeState,
  requestValue: DiagnosticsRequest | undefined,
): Promise<DiagnosticsResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(supplied, ["filters", "page"], "diagnostics request");
    const filter = request.filters === undefined ? {} : record(request.filters, "filters");
    allowedKeys(filter, ["origins", "severities", "codes", "refs", "pathPrefixes"], "filters");
    const origins = enumSet(filter.origins, DIAGNOSTIC_ORIGINS, "filters.origins");
    const severities = enumSet(filter.severities, SEVERITIES, "filters.severities");
    const codes = stringSet(filter.codes, "filters.codes");
    const refs =
      filter.refs === undefined ? undefined : knownRefs(state, filter.refs, "filters.refs");
    const refKeys = refs === undefined ? undefined : new Set(refs.map(designRefKey));
    let pathPrefixes: ReadonlySet<string> | undefined;
    if (filter.pathPrefixes !== undefined) {
      if (!Array.isArray(filter.pathPrefixes)) {
        error("INVALID_ARGUMENT", "filters.pathPrefixes must be an array");
      }
      pathPrefixes = new Set(
        filter.pathPrefixes.map((path, position) =>
          validRelativePosixPrefix(path, `filters.pathPrefixes[${position}]`),
        ),
      );
    }
    const filtered = state.diagnostics.filter((diagnostic) => {
      controller.checkpoint();
      return (
        (origins === undefined || origins.has(diagnostic.origin)) &&
        (severities === undefined || severities.has(diagnostic.severity)) &&
        (codes === undefined || codes.has(diagnostic.code)) &&
        (refKeys === undefined || diagnostic.refs.some((ref) => refKeys.has(designRefKey(ref)))) &&
        (pathPrefixes === undefined ||
          diagnostic.paths.some((path) =>
            [...pathPrefixes!].some((prefix) => path.startsWith(prefix)),
          ))
      );
    });
    const page = pageOf(filtered, pageRequest(request.page));
    controller.diagnostic(page.items.length);
    return {
      ...resultBase("diagnostics", state.identity, state.provenance, true, controller),
      ...page,
    };
  });
}

function guidanceOperation(
  state: FacadeState,
  requestValue: GuidanceRequest | undefined,
): Promise<GuidanceResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(
      supplied,
      ["filters", "selection", "page"],
      "guidance request",
    );
    const filter = request.filters === undefined ? {} : record(request.filters, "filters");
    allowedKeys(filter, ["topics", "refs", "diagnosticIds"], "filters");
    const topics = enumSet(filter.topics, GUIDANCE_TOPICS, "filters.topics");
    const refs =
      filter.refs === undefined ? undefined : knownRefs(state, filter.refs, "filters.refs");
    const refKeys = refs === undefined ? undefined : new Set(refs.map(designRefKey));
    const diagnosticIds = stringSet(filter.diagnosticIds, "filters.diagnosticIds");
    const filtered = state.guidance.filter((entry) => {
      controller.checkpoint();
      return (
        (topics === undefined || topics.has(entry.topic)) &&
        (refKeys === undefined || entry.refs.some((ref) => refKeys.has(designRefKey(ref)))) &&
        (diagnosticIds === undefined || entry.diagnosticIds.some((id) => diagnosticIds.has(id)))
      );
    });
    const page = pageOf(filtered, pageRequest(request.page));
    let canonicalGuidance: CanonicalGuidanceLink | null = null;
    if (request.selection !== undefined) {
      controller.checkpoint();
      validateGuidanceSelection(request.selection);
      const selection = request.selection;
      if (
        selection.producer.analysis.version !== state.identity.analyzerVersion ||
        selection.producer.coreVersion !== state.identity.coreVersion
      ) {
        error("SNAPSHOT_MISMATCH", "canonical guidance belongs to another producer version", {
          analyzerVersion: state.identity.analyzerVersion,
          coreVersion: state.identity.coreVersion,
          guidanceAnalyzerVersion: selection.producer.analysis.version,
          guidanceCoreVersion: selection.producer.coreVersion,
        });
      }
      canonicalGuidance = {
        selectionDigest: selection.digest,
        resourceDigest: selection.resourceDigest,
        producer: structuredClone(selection.producer),
        source: structuredClone(selection.source),
        entries: selection.entries.map(({ id, path, anchor, digest }) => ({
          id,
          path,
          anchor,
          digest,
        })),
        complete: selection.complete,
      };
    }
    return {
      ...resultBase("guidance", state.identity, state.provenance, true, controller),
      canonicalGuidance,
      ...page,
    };
  });
}

function impactOperation(state: FacadeState, requestValue: ImpactRequest): Promise<ImpactResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(
      requestValue,
      ["seeds", "detail", "relations", "certainties", "maxDepth", "maxNodes"],
      "impact request",
    );
    const seeds = knownRefs(state, request.seeds, "seeds", 100);
    if (seeds.length === 0) error("INVALID_ARGUMENT", "impact requires at least one seed");
    const detail =
      request.detail === undefined
        ? "trace"
        : enumValue(request.detail, ["trace", "context"] as const, "detail");
    const maxDepth = boundedInteger(request.maxDepth, 12, 0, 12, "maxDepth");
    const maxNodes = boundedInteger(request.maxNodes, 500, 1, 1_000, "maxNodes");
    const selectedIndex = filteredIndex(state.index, edgeFilters(request), controller);
    const trace = traceApplicationImpact(selectedIndex, seeds, {
      signal: controller.signal,
      maxDepth,
      maxNodes,
    });
    controller.graphNode(trace.affected.length);
    controller.graphEdge(new Set(trace.affected.flatMap(({ path }) => path.map(edgeKey))).size);
    const reached = trace.affected.map(({ ref }) => ref);
    const diagnostics = [
      ...diagnosticsForRefs(state.diagnostics, reached),
      ...trace.issues.map(traceIssueDiagnostic),
    ];
    const uniqueDiagnostics = [
      ...new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic])).values(),
    ].sort((left, right) => ordinal(left.id, right.id));
    controller.diagnostic(uniqueDiagnostics.length);
    const context =
      detail === "context"
        ? contextForImpact(state.manifest, selectedIndex, trace, state.sourceIndex, {
            signal: controller.signal,
          })
        : undefined;
    return {
      ...resultBase("impact", state.identity, state.provenance, trace.complete, controller),
      trace,
      ...(context === undefined ? {} : { context }),
      diagnostics: uniqueDiagnostics,
    };
  });
}

function navigationOperation(
  state: FacadeState,
  requestValue: NavigateRequest,
): Promise<NavigationResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(
      requestValue,
      ["ref", "direction", "relations", "certainties", "maxDepth", "maxNodes", "maxEdges"],
      "navigate request",
    );
    const ref = knownRef(state, request.ref, "ref");
    const direction =
      request.direction === undefined
        ? "both"
        : enumValue(request.direction, ["incoming", "outgoing", "both"] as const, "direction");
    const maxDepth = boundedInteger(request.maxDepth, 1, 0, 12, "maxDepth");
    const maxNodes = boundedInteger(request.maxNodes, 100, 1, 1_000, "maxNodes");
    const maxEdges = boundedInteger(request.maxEdges, 250, 0, 5_000, "maxEdges");
    const selectedIndex = filteredIndex(state.index, edgeFilters(request), controller);
    const incoming = new Map<string, ImpactEdge[]>();
    const outgoing = new Map<string, ImpactEdge[]>();
    for (const edge of selectedIndex.edges) {
      controller.checkpoint();
      const from = designRefKey(edge.from);
      const to = designRefKey(edge.to);
      outgoing.set(from, [...(outgoing.get(from) ?? []), edge]);
      incoming.set(to, [...(incoming.get(to) ?? []), edge]);
    }
    for (const edges of [...incoming.values(), ...outgoing.values()]) {
      edges.sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));
    }
    const distances = new Map<string, NavigationNode>([[designRefKey(ref), { ref, distance: 0 }]]);
    const queue: NavigationNode[] = [{ ref, distance: 0 }];
    const retainedEdges = new Map<string, ImpactEdge>();
    let limited = false;
    for (let position = 0; position < queue.length; position += 1) {
      controller.checkpoint();
      const current = queue[position];
      if (current.distance >= maxDepth) continue;
      const key = designRefKey(current.ref);
      const candidates = [
        ...(direction === "incoming" || direction === "both" ? (incoming.get(key) ?? []) : []),
        ...(direction === "outgoing" || direction === "both" ? (outgoing.get(key) ?? []) : []),
      ].sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));
      for (const edge of candidates) {
        controller.checkpoint();
        const neighbor = designRefKey(edge.from) === key ? edge.to : edge.from;
        const neighborKey = designRefKey(neighbor);
        if (!distances.has(neighborKey) && distances.size >= maxNodes) {
          limited = true;
          continue;
        }
        const keyForEdge = edgeKey(edge);
        if (!retainedEdges.has(keyForEdge) && retainedEdges.size >= maxEdges) {
          limited = true;
          continue;
        }
        retainedEdges.set(keyForEdge, edge);
        if (!distances.has(neighborKey)) {
          const node = { ref: neighbor, distance: current.distance + 1 };
          distances.set(neighborKey, node);
          queue.push(node);
        }
      }
    }
    const diagnostics = limited
      ? [
          analysisDiagnostic(
            "warning",
            "NAVIGATION_LIMIT_REACHED",
            `Navigation stopped at maxNodes ${maxNodes} or maxEdges ${maxEdges}.`,
            { maxDepth, maxNodes, maxEdges },
            [ref],
          ),
        ]
      : [];
    const nodes = [...distances.values()].sort((left, right) =>
      ordinal(designRefKey(left.ref), designRefKey(right.ref)),
    );
    const edges = [...retainedEdges.values()].sort((left, right) =>
      ordinal(edgeKey(left), edgeKey(right)),
    );
    controller.graphNode(nodes.length);
    controller.graphEdge(edges.length);
    controller.diagnostic(diagnostics.length);
    return {
      ...resultBase("navigation", state.identity, state.provenance, !limited, controller),
      ref,
      direction,
      nodes,
      edges,
      diagnostics,
    };
  });
}

function targetOperation(
  state: FacadeState,
  requestValue: ChangeTargetRequest,
): Promise<ChangeTargetResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(
      requestValue,
      ["refs", "source", "seeds", "relations", "certainties", "maxDepth", "maxNodes"],
      "target request",
    );
    const explicit = request.refs === undefined ? [] : knownRefs(state, request.refs, "refs", 100);
    const extras = request.seeds === undefined ? [] : knownRefs(state, request.seeds, "seeds", 100);
    let sourceQuery: Extract<SourceQuery, { kind: "cursor" | "range" }> | undefined;
    let sourceMatches: SourceMatch[] = [];
    if (request.source !== undefined) {
      const parsed = sourceQueryFromUnknown(request.source);
      if (parsed.kind !== "cursor" && parsed.kind !== "range") {
        error("INVALID_ARGUMENT", "target source must be a cursor or range query");
      }
      sourceQuery = parsed;
      if (state.sourceIndex === undefined) {
        error(
          "CAPABILITY_UNAVAILABLE",
          "source-selected targets require a V2 project source snapshot",
          {
            capability: "sources",
          },
        );
      }
      sourceMatches = rankedSourceMatches(
        state.sourceIndex,
        sourceQuery,
        undefined,
        undefined,
        "metadata",
        "all",
        controller,
      );
    }
    const sourceRefs = sourceMatches.map(({ ref }) => ref);
    const seeds = sortedUniqueRefs([...explicit, ...sourceRefs, ...extras]);
    if (seeds.length === 0) {
      error("NOT_FOUND", "target request resolved no design seeds", {
        source: sourceQuery ?? null,
      });
    }
    if (seeds.length > 100) {
      error("LIMIT_EXCEEDED", "target resolved more than 100 design seeds", {
        limit: "seeds",
        maximum: 100,
        attempted: seeds.length,
      });
    }
    const maxDepth = boundedInteger(request.maxDepth, 12, 0, 12, "maxDepth");
    const maxNodes = boundedInteger(request.maxNodes, 500, 1, 1_000, "maxNodes");
    const selectedIndex = filteredIndex(state.index, edgeFilters(request), controller);
    const impact = traceApplicationImpact(selectedIndex, seeds, {
      signal: controller.signal,
      maxDepth,
      maxNodes,
    });
    const context = contextForImpact(state.manifest, selectedIndex, impact, state.sourceIndex, {
      signal: controller.signal,
    });
    const certaintyByRef = new Map<string, ImpactCertainty>();
    for (const entry of impact.affected) {
      certaintyByRef.set(
        designRefKey(entry.ref),
        leastCertain(entry.path.map(({ certainty }) => certainty)),
      );
    }
    const overallCertainty = leastCertain(
      impact.affected.flatMap(({ path }) => path.map(({ certainty }) => certainty)),
    );
    interface FileAccumulator {
      readonly document: IndexedSourceDocument;
      readonly roles: Set<"seed" | "affected" | "support">;
      readonly refs: Map<string, DesignRef>;
      readonly certainties: ImpactCertainty[];
    }
    const files = new Map<string, FileAccumulator>();
    const documents = new Map(
      state.sourceIndex?.documents.map((document) => [document.path, document]),
    );
    for (const selection of context.selection) {
      controller.checkpoint();
      const entry = sourceEntry(state.sourceIndex, selection.ref);
      for (const anchor of entry?.sources ?? []) {
        const document = documents.get(anchor.range.path);
        if (document === undefined) continue;
        const accumulator: FileAccumulator = files.get(document.path) ?? {
          document,
          roles: new Set<"seed" | "affected" | "support">(),
          refs: new Map<string, DesignRef>(),
          certainties: [] as ImpactCertainty[],
        };
        for (const role of selection.roles) accumulator.roles.add(role);
        accumulator.refs.set(designRefKey(selection.ref), selection.ref);
        accumulator.certainties.push(
          certaintyByRef.get(designRefKey(selection.ref)) ?? overallCertainty,
        );
        files.set(document.path, accumulator);
      }
    }
    const roleOrder = ["seed", "affected", "support"] as const;
    const targetFiles: ChangeTargetFile[] = [...files.values()]
      .map((file) => ({
        path: file.document.path,
        roles: roleOrder.filter((role) => file.roles.has(role)),
        leastCertainty: leastCertain(file.certainties),
        refs: [...file.refs.entries()]
          .sort(([left], [right]) => ordinal(left, right))
          .map(([, ref]) => ref),
        document: file.document,
      }))
      .sort((left, right) => ordinal(left.path, right.path));
    const selectedRefs = context.selection.map(({ ref }) => ref);
    const diagnosticValues = [
      ...diagnosticsForRefs(state.diagnostics, selectedRefs),
      ...impact.issues.map(traceIssueDiagnostic),
      ...(sourceQuery === undefined
        ? []
        : relevantSourceDiagnostics(state.diagnostics, sourceQuery, sourceMatches)),
    ];
    const diagnostics = [
      ...new Map(diagnosticValues.map((diagnostic) => [diagnostic.id, diagnostic])).values(),
    ].sort((left, right) => ordinal(left.id, right.id));
    const selectedKeys = new Set(selectedRefs.map(designRefKey));
    const guidance = state.guidance.filter(
      (entry) =>
        entry.topic === "impact" ||
        entry.topic === "provenance" ||
        entry.refs.some((ref) => selectedKeys.has(designRefKey(ref))),
    );
    controller.graphNode(impact.affected.length);
    controller.graphEdge(new Set(impact.affected.flatMap(({ path }) => path.map(edgeKey))).size);
    controller.sourceDocument(targetFiles.length);
    controller.diagnostic(diagnostics.length);
    return {
      ...resultBase("change-target", state.identity, state.provenance, impact.complete, controller),
      seeds,
      impact,
      context,
      sourceAvailability: state.sourceIndex === undefined ? "unavailable" : "available",
      files: targetFiles,
      diagnostics,
      guidance,
    };
  });
}

function projectionEvidence(value: unknown): PlannedWireProjection[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) error("INVALID_ARGUMENT", "projections must be an array");
  const clone = detached(value, "projections") as unknown[];
  return clone.map((projection, position) => {
    const item = record(projection, `projections[${position}]`);
    const keys = ["name", "wire", "provenance", ...(item.render === undefined ? [] : ["render"])];
    exactKeys(item, keys, `projections[${position}]`);
    nonEmptyString(item.name, `projections[${position}].name`);
    const provenance = record(item.provenance, `projections[${position}].provenance`);
    exactKeys(provenance, ["name", "version"], `projections[${position}].provenance`);
    nonEmptyString(provenance.name, `projections[${position}].provenance.name`);
    nonEmptyString(provenance.version, `projections[${position}].provenance.version`);
    const wire = record(item.wire, `projections[${position}].wire`);
    exactKeys(wire, ["endpoints", "appWide"], `projections[${position}].wire`);
    if (!Array.isArray(wire.endpoints) || !Array.isArray(wire.appWide)) {
      error("INVALID_ARGUMENT", `projections[${position}].wire is malformed`);
    }
    if (item.render !== undefined) {
      const render = record(item.render, `projections[${position}].render`);
      allowedKeys(render, ["appWideErrorName"], `projections[${position}].render`);
      if (render.appWideErrorName !== undefined) {
        nonEmptyString(render.appWideErrorName, `projections[${position}].render.appWideErrorName`);
      }
    }
    return projection as PlannedWireProjection;
  });
}

function contractsOperation(
  state: FacadeState,
  requestValue: ContractsRequest | undefined,
): Promise<ContractsResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(
      supplied,
      ["filters", "detail", "projections", "page"],
      "contracts request",
    );
    const detail =
      request.detail === undefined
        ? "data"
        : enumValue(request.detail, ["summary", "data", "rendered"] as const, "detail");
    const filter = request.filters === undefined ? {} : record(request.filters, "filters");
    allowedKeys(filter, ["endpoints", "paths"], "filters");
    const endpointNames = stringSet(filter.endpoints, "filters.endpoints");
    const paths = stringSet(filter.paths, "filters.paths");
    if (endpointNames !== undefined) {
      const known = new Set(state.manifest.endpoints.map(({ name }) => name));
      const unknown = [...endpointNames].filter((name) => !known.has(name));
      if (unknown.length > 0)
        error("NOT_FOUND", "contract endpoint filter is unknown", { endpoints: unknown });
    }
    if (paths !== undefined) {
      const known = new Set(state.manifest.endpoints.map(({ path }) => path));
      const unknown = [...paths].filter((path) => !known.has(path));
      if (unknown.length > 0)
        error("NOT_FOUND", "contract path filter is unknown", { paths: unknown });
    }
    const endpoints = state.manifest.endpoints
      .filter(
        (endpoint) =>
          (endpointNames === undefined || endpointNames.has(endpoint.name)) &&
          (paths === undefined || paths.has(endpoint.path)),
      )
      .sort((left, right) => ordinal(`${left.path}\0${left.name}`, `${right.path}\0${right.name}`));
    const declarations: ContractDeclaration[] = endpoints.map((endpoint) => ({
      endpoint,
      ...(detail === "summary"
        ? {}
        : {
            inputContract: state.manifest.inputContracts[endpoint.path] ?? endpoint.input,
            wireEndpoints: state.manifest.wire.endpoints.filter(
              ({ path }) => path === endpoint.path,
            ),
          }),
    }));
    const page = pageOf(declarations, pageRequest(request.page));
    const selectedPaths = new Set(page.items.map(({ endpoint }) => endpoint.path));
    const selectedInputContracts = Object.fromEntries(
      Object.entries(state.manifest.inputContracts).filter(([path]) => selectedPaths.has(path)),
    );
    const logicalWire = {
      endpoints: state.manifest.wire.endpoints.filter(({ path }) => selectedPaths.has(path)),
      appWide: state.manifest.wire.appWide,
    };
    const projections = projectionEvidence(request.projections);
    const rendered: ContractRenderings | undefined =
      detail === "rendered"
        ? {
            inputContracts: renderInputContracts(selectedInputContracts),
            logicalWire: renderWireTypes(logicalWire),
            projections: projections
              .map((projection) => ({
                name: projection.name,
                rendered: renderWireTypes(projection.wire, projection.render),
              }))
              .sort((left, right) => ordinal(left.name, right.name)),
          }
        : undefined;
    const guidance = state.guidance.filter(({ topic }) => topic === "contracts");
    controller.graphNode(page.items.length);
    return {
      ...resultBase("contracts", state.identity, state.provenance, true, controller),
      detail,
      appWide: state.manifest.wire.appWide,
      projectionEvidence: request.projections === undefined ? "none" : "caller-supplied",
      projections,
      ...(rendered === undefined ? {} : { rendered }),
      guidance,
      ...page,
    };
  });
}

function provenanceOperation(
  state: FacadeState,
  requestValue: ProvenanceRequest | undefined,
): Promise<ProvenanceResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(supplied, ["page"], "provenance request");
    const files = state.project?.provenance.files ?? [];
    const page = pageOf(files, pageRequest(request.page));
    for (const _file of page.items) controller.projectFile(0);
    const provenance = state.project?.provenance;
    const facts: ApplicationAnalysisProvenanceFacts = {
      analyzer: state.provenance.analyzer,
      manifest: state.provenance.manifest,
      ...(provenance === undefined
        ? {}
        : {
            project: {
              sourceRevision: provenance.sourceRevision,
              manifestSourceRevision: provenance.manifestSourceRevision,
              sourceDigest: provenance.sourceDigest,
              tsconfigPath: provenance.tsconfigPath,
              typescriptVersion: provenance.typescriptVersion,
              projectReferences: provenance.projectReferences,
            },
          }),
    };
    return {
      ...resultBase("provenance", state.identity, state.provenance, true, controller),
      facts,
      ...page,
    };
  });
}

function contractEvidenceFor(manifest: ApplicationManifestV5, ref: DesignRef): unknown {
  switch (ref.kind) {
    case "concept": {
      const concept = manifest.concepts.find(({ name }) => name === ref.concept)!;
      return {
        purpose: concept.purpose,
        principle: concept.principle,
        specification: concept.specification,
      };
    }
    case "action": {
      const definition = definitionFor(manifest, ref);
      return definition.kind === "action"
        ? { action: definition.action, specification: definition.specification }
        : undefined;
    }
    case "query": {
      const definition = definitionFor(manifest, ref);
      return definition.kind === "query"
        ? { query: definition.query, specification: definition.specification }
        : undefined;
    }
    case "view": {
      const view = manifest.application.views.find(({ name }) => name === ref.view)!;
      return { ins: view.ins, outs: view.outs, promise: view.promise, holds: view.holds };
    }
    case "former": {
      const former = manifest.application.formers.find(({ name }) => name === ref.former)!;
      return { ins: former.ins, promise: former.promise };
    }
    case "computation":
      return manifest.computations.find(({ name }) => name === ref.computation)!;
    case "endpoint": {
      const endpoint = manifest.endpoints.find(
        ({ name, path }) => name === ref.endpoint && path === ref.path,
      )!;
      return {
        endpoint,
        inputContract: manifest.inputContracts[ref.path],
        wire: manifest.wire.endpoints.filter(({ path }) => path === ref.path),
        appWide: manifest.wire.appWide,
      };
    }
    case "reaction":
      return undefined;
  }
}

function sourceEvidenceFor(
  sourceIndex: ApplicationSourceIndex | undefined,
  ref: DesignRef,
): unknown {
  if (sourceIndex === undefined) return null;
  return (
    sourceEntry(sourceIndex, ref)?.sources.map((anchor) => ({
      role: anchor.role,
      resolution: anchor.resolution,
      range: anchor.range,
      digest: anchor.digest,
    })) ?? []
  );
}

function diagnosticEvidenceFor(
  diagnostics: readonly AnalysisDiagnostic[],
  ref: DesignRef,
): readonly string[] {
  const key = designRefKey(ref);
  return diagnostics
    .filter((diagnostic) => diagnostic.refs.some((candidate) => designRefKey(candidate) === key))
    .map(({ id }) => id);
}

function designEvidence(
  state: FacadeState,
  ref: DesignRef,
): {
  readonly definition: DesignDefinition;
  readonly contract: unknown;
  readonly source: unknown;
  readonly diagnostics: readonly string[];
  readonly digest: string;
} {
  const definition = definitionFor(state.manifest, ref);
  const contract = contractEvidenceFor(state.manifest, ref);
  const source = sourceEvidenceFor(state.sourceIndex, ref);
  const diagnostics = diagnosticEvidenceFor(state.diagnostics, ref);
  return {
    definition,
    contract,
    source,
    diagnostics,
    digest: canonicalAnalysisDigest({ definition, contract, source, diagnostics }),
  };
}

function comparisonChange(
  beforeValue: unknown | undefined,
  afterValue: unknown | undefined,
): ReviewChangeType | undefined {
  if (beforeValue === undefined) return "added";
  if (afterValue === undefined) return "removed";
  return sameCanonical(beforeValue, afterValue) ? undefined : "modified";
}

interface ContractComparisonRecord {
  readonly kind: ReviewContractChange["kind"];
  readonly key: string;
  readonly value: unknown;
}

function contractComparisonRecords(manifest: ApplicationManifestV5): ContractComparisonRecord[] {
  return [
    ...manifest.endpoints.map((endpoint) => ({
      kind: "endpoint" as const,
      key: designRefKey({ kind: "endpoint", endpoint: endpoint.name, path: endpoint.path }),
      value: endpoint,
    })),
    ...Object.entries(manifest.inputContracts).map(([path, value]) => ({
      kind: "input" as const,
      key: path,
      value,
    })),
    ...manifest.wire.endpoints.map((endpoint) => ({
      kind: "wire-endpoint" as const,
      key: endpoint.path,
      value: endpoint,
    })),
    { kind: "wire-app-wide" as const, key: "appWide", value: manifest.wire.appWide },
  ].sort((left, right) => ordinal(`${left.kind}\0${left.key}`, `${right.kind}\0${right.key}`));
}

function reviewSourceCoverage(before: FacadeState, after: FacadeState): ReviewCoverage["sources"] {
  if (before.sourceIndex !== undefined && after.sourceIndex !== undefined)
    return "before-and-after";
  if (before.sourceIndex !== undefined) return "before-only";
  if (after.sourceIndex !== undefined) return "after-only";
  return "unavailable";
}

function reviewOperation(
  afterState: FacadeState,
  afterAnalysis: ApplicationAnalysis,
  beforeAnalysis: ApplicationAnalysis,
  optionsValue: ReviewChangeOptions | undefined,
): Promise<ReviewResult> {
  const beforeState = analysisStates.get(beforeAnalysis as object);
  if (beforeState === undefined) {
    return Promise.reject(
      new AnalysisError(
        "INVALID_ARGUMENT",
        "before must be an ApplicationAnalysis created by this façade",
      ),
    );
  }
  const supplied = optionsValue === undefined ? {} : optionsValue;
  return runOperation(supplied, async (controller) => {
    const options = operationRequest(
      supplied,
      ["changedPaths", "detail", "maxDepth", "maxNodes", "maxChanges", "target"],
      "reviewChange options",
    );
    const detail =
      options.detail === undefined
        ? "summary"
        : enumValue(options.detail, ["summary", "definitions"] as const, "detail");
    const maxDepth = boundedInteger(options.maxDepth, 3, 0, 12, "maxDepth");
    const maxNodes = boundedInteger(options.maxNodes, 500, 1, 1_000, "maxNodes");
    const maxChanges = boundedInteger(options.maxChanges, 500, 0, 10_000, "maxChanges");
    let declaredPaths: ReadonlySet<string> | undefined;
    if (options.changedPaths !== undefined) {
      if (!Array.isArray(options.changedPaths)) {
        error("INVALID_ARGUMENT", "changedPaths must be an array");
      }
      declaredPaths = new Set(
        options.changedPaths.map((path, position) =>
          validRelativePosixPath(path, `changedPaths[${position}]`),
        ),
      );
    }
    const beforeRefs = new Map(beforeState.index.inventory.map((ref) => [designRefKey(ref), ref]));
    const afterRefs = new Map(afterState.index.inventory.map((ref) => [designRefKey(ref), ref]));
    const refKeys = sortedUniqueStrings([...beforeRefs.keys(), ...afterRefs.keys()]);
    const designChanges: ReviewDesignChange[] = [];
    for (const key of refKeys) {
      controller.checkpoint();
      const beforeRef = beforeRefs.get(key);
      const afterRef = afterRefs.get(key);
      const beforeEvidence =
        beforeRef === undefined ? undefined : designEvidence(beforeState, beforeRef);
      const afterEvidence =
        afterRef === undefined ? undefined : designEvidence(afterState, afterRef);
      const change = comparisonChange(beforeEvidence, afterEvidence);
      if (change === undefined) continue;
      const aspects: ReviewAspect[] = [];
      if (
        beforeEvidence === undefined ||
        afterEvidence === undefined ||
        !sameCanonical(beforeEvidence.definition, afterEvidence.definition)
      ) {
        aspects.push("definition");
      }
      if (
        beforeEvidence === undefined ||
        afterEvidence === undefined ||
        !sameCanonical(beforeEvidence.contract, afterEvidence.contract)
      ) {
        aspects.push("contract");
      }
      if (
        beforeEvidence === undefined ||
        afterEvidence === undefined ||
        !sameCanonical(beforeEvidence.source, afterEvidence.source)
      ) {
        aspects.push("source");
      }
      if (
        beforeEvidence === undefined ||
        afterEvidence === undefined ||
        !sameCanonical(beforeEvidence.diagnostics, afterEvidence.diagnostics)
      ) {
        aspects.push("diagnostics");
      }
      designChanges.push({
        ref: afterRef ?? beforeRef!,
        change,
        aspects,
        ...(beforeEvidence === undefined ? {} : { beforeDigest: beforeEvidence.digest }),
        ...(afterEvidence === undefined ? {} : { afterDigest: afterEvidence.digest }),
        ...(detail !== "definitions" || beforeEvidence === undefined
          ? {}
          : { beforeDefinition: beforeEvidence.definition }),
        ...(detail !== "definitions" || afterEvidence === undefined
          ? {}
          : { afterDefinition: afterEvidence.definition }),
      });
    }
    const beforeFiles = new Map(
      (beforeState.project?.provenance.files ?? []).map((file) => [file.path, file.digest]),
    );
    const afterFiles = new Map(
      (afterState.project?.provenance.files ?? []).map((file) => [file.path, file.digest]),
    );
    const fileChanges: ReviewFileChange[] = [];
    for (const path of sortedUniqueStrings([...beforeFiles.keys(), ...afterFiles.keys()])) {
      const beforeDigest = beforeFiles.get(path);
      const afterDigest = afterFiles.get(path);
      const change = comparisonChange(beforeDigest, afterDigest);
      if (change === undefined) continue;
      fileChanges.push({
        path,
        change,
        ...(beforeDigest === undefined ? {} : { beforeDigest }),
        ...(afterDigest === undefined ? {} : { afterDigest }),
        declaredChanged: declaredPaths?.has(path) ?? false,
      });
    }
    const beforeContracts = new Map(
      contractComparisonRecords(beforeState.manifest).map((entry) => [
        `${entry.kind}\0${entry.key}`,
        entry,
      ]),
    );
    const afterContracts = new Map(
      contractComparisonRecords(afterState.manifest).map((entry) => [
        `${entry.kind}\0${entry.key}`,
        entry,
      ]),
    );
    const contractChanges: ReviewContractChange[] = [];
    for (const key of sortedUniqueStrings([...beforeContracts.keys(), ...afterContracts.keys()])) {
      const beforeRecord = beforeContracts.get(key);
      const afterRecord = afterContracts.get(key);
      const change = comparisonChange(beforeRecord?.value, afterRecord?.value);
      if (change === undefined) continue;
      const recordValue = afterRecord ?? beforeRecord!;
      contractChanges.push({
        kind: recordValue.kind,
        key: recordValue.key,
        change,
        ...(beforeRecord === undefined
          ? {}
          : { beforeDigest: canonicalAnalysisDigest(beforeRecord.value) }),
        ...(afterRecord === undefined
          ? {}
          : { afterDigest: canonicalAnalysisDigest(afterRecord.value) }),
      });
    }
    const beforeDiagnostics = new Map(
      beforeState.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]),
    );
    const afterDiagnostics = new Map(
      afterState.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic]),
    );
    const introducedDiagnostics = [...afterDiagnostics]
      .filter(([id]) => !beforeDiagnostics.has(id))
      .map(([, diagnostic]) => diagnostic)
      .sort((left, right) => ordinal(left.id, right.id));
    const resolvedDiagnostics = [...beforeDiagnostics]
      .filter(([id]) => !afterDiagnostics.has(id))
      .map(([, diagnostic]) => diagnostic)
      .sort((left, right) => ordinal(left.id, right.id));
    const exactChangeCount =
      designChanges.length +
      fileChanges.length +
      contractChanges.length +
      introducedDiagnostics.length +
      resolvedDiagnostics.length;
    if (exactChangeCount > maxChanges) {
      error("LIMIT_EXCEEDED", "Exact review evidence exceeds maxChanges", {
        limit: "maxChanges",
        maximum: maxChanges,
        attempted: exactChangeCount,
      });
    }
    const beforeSeeds = designChanges.flatMap(({ ref }) => {
      const candidate = beforeRefs.get(designRefKey(ref));
      return candidate === undefined ? [] : [candidate];
    });
    const afterSeeds = designChanges.flatMap(({ ref }) => {
      const candidate = afterRefs.get(designRefKey(ref));
      return candidate === undefined ? [] : [candidate];
    });
    const beforeImpact = traceApplicationImpact(beforeState.index, beforeSeeds, {
      signal: controller.signal,
      maxDepth,
      maxNodes,
    });
    const afterImpact = traceApplicationImpact(afterState.index, afterSeeds, {
      signal: controller.signal,
      maxDepth,
      maxNodes,
    });
    let targetDrift: ReviewTargetDrift | undefined;
    if (options.target !== undefined) {
      const target = record(options.target, "target") as unknown as Omit<
        ChangeTargetRequest,
        keyof ApplicationAnalysisOperationOptions
      >;
      const targetOptions = {
        ...target,
        signal: controller.signal,
        maxResultBytes: MAX_RESULT_BYTES,
      } as ChangeTargetRequest;
      const [beforeTarget, afterTarget] = await Promise.all([
        beforeAnalysis.target(targetOptions),
        afterAnalysis.target(targetOptions),
      ]);
      const beforeAffected = new Map(
        beforeTarget.impact.affected.map(({ ref }) => [designRefKey(ref), ref]),
      );
      const afterAffected = new Map(
        afterTarget.impact.affected.map(({ ref }) => [designRefKey(ref), ref]),
      );
      const beforeTargetFiles = new Set(beforeTarget.files.map(({ path }) => path));
      const afterTargetFiles = new Set(afterTarget.files.map(({ path }) => path));
      targetDrift = {
        before: beforeTarget,
        after: afterTarget,
        addedAffected: [...afterAffected]
          .filter(([key]) => !beforeAffected.has(key))
          .map(([, ref]) => ref),
        removedAffected: [...beforeAffected]
          .filter(([key]) => !afterAffected.has(key))
          .map(([, ref]) => ref),
        addedFiles: [...afterTargetFiles]
          .filter((path) => !beforeTargetFiles.has(path))
          .sort(ordinal),
        removedFiles: [...beforeTargetFiles]
          .filter((path) => !afterTargetFiles.has(path))
          .sort(ordinal),
      };
    }
    const observations: string[] = [];
    if (designChanges.length === 0) observations.push("No design inventory definition changed.");
    if (
      fileChanges.length === 0 &&
      reviewSourceCoverage(beforeState, afterState) !== "unavailable"
    ) {
      observations.push("No project file digest changed.");
    }
    if (declaredPaths !== undefined) {
      for (const path of [...declaredPaths].sort(ordinal)) {
        if (!fileChanges.some((change) => change.path === path)) {
          observations.push(
            `Caller-supplied changed path ${path} has no observed file digest change.`,
          );
        }
      }
      for (const change of fileChanges) {
        if (!declaredPaths.has(change.path)) {
          observations.push(
            `Observed file digest change ${change.path} is outside caller-supplied changedPaths.`,
          );
        }
      }
    }
    observations.push(
      "This review is deterministic evidence only; it does not establish semantic safety or authorization.",
    );
    const changedKeys = new Set(designChanges.map(({ ref }) => designRefKey(ref)));
    const changedDiagnosticIds = new Set(
      [...introducedDiagnostics, ...resolvedDiagnostics].map(({ id }) => id),
    );
    const guidance = [
      ...new Map(
        [...beforeState.guidance, ...afterState.guidance]
          .filter(
            (entry) =>
              entry.topic === "impact" ||
              entry.topic === "provenance" ||
              entry.refs.some((ref) => changedKeys.has(designRefKey(ref))) ||
              entry.diagnosticIds.some((id) => changedDiagnosticIds.has(id)),
          )
          .map((entry) => [entry.ruleId, entry]),
      ).values(),
    ].sort((left, right) => ordinal(left.ruleId, right.ruleId));
    const impactComplete = beforeImpact.complete && afterImpact.complete;
    const complete =
      impactComplete &&
      (targetDrift === undefined || (targetDrift.before.complete && targetDrift.after.complete));
    const coverage: ReviewCoverage = {
      definitions: "complete",
      contracts: "complete",
      diagnostics: "complete",
      sources: reviewSourceCoverage(beforeState, afterState),
      files: reviewSourceCoverage(beforeState, afterState),
      changedPaths: declaredPaths === undefined ? "all-observed" : "caller-supplied",
      impact: { maxDepth, maxNodes, complete: impactComplete },
      target: targetDrift === undefined ? "not-requested" : "evaluated",
    };
    controller.graphNode(beforeImpact.affected.length + afterImpact.affected.length);
    controller.graphEdge(
      new Set(
        [...beforeImpact.affected, ...afterImpact.affected].flatMap(({ path }) =>
          path.map(edgeKey),
        ),
      ).size,
    );
    controller.diagnostic(introducedDiagnostics.length + resolvedDiagnostics.length);
    for (const _file of fileChanges) controller.projectFile(0);
    return {
      ...resultBase("review", afterState.identity, afterState.provenance, complete, controller),
      beforeIdentity: beforeState.identity,
      designChanges,
      fileChanges,
      contractChanges,
      introducedDiagnostics,
      resolvedDiagnostics,
      beforeImpact,
      afterImpact,
      ...(targetDrift === undefined ? {} : { targetDrift }),
      observations: observations.sort(ordinal),
      guidance,
      coverage,
    };
  });
}

/** Build a detached, immutable granular query façade over one exact V5 snapshot. */
export function createApplicationAnalysis(
  optionsValue: CreateApplicationAnalysisOptions,
): ApplicationAnalysis {
  const options = record(optionsValue, "createApplicationAnalysis options");
  allowedKeys(options, ["manifest", "project"], "createApplicationAnalysis options");
  const manifestRecord = record(options.manifest, "manifest");
  if (manifestRecord.format !== "sync-engine.application-manifest") {
    error("INVALID_FORMAT", "manifest has an unsupported format", {
      format: String(manifestRecord.format),
    });
  }
  if (manifestRecord.version !== 5) {
    error("UNSUPPORTED_VERSION", "manifest must be version 5", {
      version: manifestRecord.version,
    });
  }
  const manifest = detached(options.manifest, "manifest") as ApplicationManifestV5;
  try {
    validateApplicationManifest(manifest);
  } catch (cause) {
    error("INVALID_FORMAT", "manifest is not a canonical V5 application manifest", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  const recomputedIndex = indexApplication(manifest);
  let project: ApplicationProjectAnalysis | undefined;
  if (options.project !== undefined) {
    const projectRecord = record(options.project, "project");
    if (projectRecord.format !== "sync-engine.application-project-analysis") {
      error("INVALID_FORMAT", "project has an unsupported format", {
        format: String(projectRecord.format),
      });
    }
    if (projectRecord.version !== 2) {
      error("UNSUPPORTED_VERSION", "project analysis must be version 2", {
        version: projectRecord.version,
      });
    }
    project = detached(options.project, "project") as ApplicationProjectAnalysis;
    try {
      assertProjectSnapshot(project, manifest, recomputedIndex);
    } catch (cause) {
      if (cause instanceof AnalysisError) throw cause;
      error("SNAPSHOT_MISMATCH", "project analysis is not an exact V2 snapshot composition", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }
  deepFreeze(manifest);
  deepFreeze(recomputedIndex);
  if (project !== undefined) deepFreeze(project);
  const sourceIndex = project?.sourceIndex;
  const identity = deepFreeze<ApplicationAnalysisIdentity>({
    manifestDigest: manifest.digest,
    analysisDigest:
      project === undefined
        ? canonicalAnalysisDigest(recomputedIndex)
        : applicationProjectAnalysisDigest(project),
    ...(project === undefined
      ? {}
      : {
          sourceRevision: project.provenance.sourceRevision,
          sourceDigest: project.provenance.sourceDigest,
        }),
    analyzerVersion: ANALYSIS_PACKAGE_VERSION,
    coreVersion: manifest.generator.version,
  });
  const diagnostics = deepFreeze(
    unifiedDiagnostics(manifest, project, recomputedIndex, sourceIndex),
  );
  const guidance = deepFreeze(analysisGuidance(manifest, project, diagnostics));
  const summaries = deepFreeze(
    recomputedIndex.inventory.map((ref) => designSummary(manifest, sourceIndex, diagnostics, ref)),
  );
  const state: FacadeState = {
    manifest,
    ...(project === undefined ? {} : { project }),
    index: recomputedIndex,
    ...(sourceIndex === undefined ? {} : { sourceIndex }),
    identity,
    provenance: recomputedIndex.provenance,
    refs: new Map(recomputedIndex.inventory.map((ref) => [designRefKey(ref), ref])),
    diagnostics,
    guidance,
    summaries,
  };
  let analysis!: ApplicationAnalysis;
  const created: ApplicationAnalysis = {
    manifest,
    ...(project === undefined ? {} : { project }),
    index: recomputedIndex,
    ...(sourceIndex === undefined ? {} : { sourceIndex }),
    identity,
    catalog: (request: CatalogRequest | undefined) => catalogOperation(state, request),
    search: (request: SearchRequest) => searchOperation(state, request),
    describe: (request: DescribeRequest) => describeOperation(state, request),
    sources: (request: SourcesRequest) => sourcesOperation(state, request),
    impact: (request: ImpactRequest) => impactOperation(state, request),
    diagnostics: (request: DiagnosticsRequest | undefined) => diagnosticsOperation(state, request),
    guidance: (request: GuidanceRequest | undefined) => guidanceOperation(state, request),
    navigate: (request: NavigateRequest) => navigationOperation(state, request),
    target: (request: ChangeTargetRequest) => targetOperation(state, request),
    contracts: (request: ContractsRequest | undefined) => contractsOperation(state, request),
    provenance: (request: ProvenanceRequest | undefined) => provenanceOperation(state, request),
    reviewChange: (before: ApplicationAnalysis, options: ReviewChangeOptions | undefined) =>
      reviewOperation(state, analysis, before, options),
  };
  analysis = Object.freeze(created);
  analysisStates.set(analysis, state);
  return analysis;
}
