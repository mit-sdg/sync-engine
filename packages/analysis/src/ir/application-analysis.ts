import {
  validateApplicationManifest,
  type ApplicationDiagnostic,
  type ApplicationManifestV1,
  type ConceptSpecificationIR,
  type SpecificationActionIR,
  type SpecificationQueryIR,
} from "@mit-sdg/sync-engine/tooling";
import {
  designRefKey,
  indexApplication,
  traceApplicationImpact,
  type AnalysisIssue,
  type ApplicationIndex,
  type DesignRef,
  type ImpactCertainty,
  type ImpactEdge,
  type ImpactRelation,
  type ImpactTrace,
} from "./application-impact.ts";
import {
  AnalysisAbortedError,
  AnalysisLimitError,
  type AnalysisLimits,
  type AnalysisResourceUsage,
  type AnalysisSeverity,
} from "./analysis-foundation.ts";
import {
  AnalysisError,
  type AnalysisErrorCode,
  type AnalysisErrorData,
} from "./application-analysis-error.ts";
import {
  applicationProjectAnalysisDigest,
  validateApplicationProjectAnalysis,
} from "./application-project-format.ts";
import {
  assertArtifactProvenance,
  canonicalAnalysisDigest,
  canonicalAnalysisJson,
  type AnalysisProvenance,
} from "./analysis-provenance.ts";
import type {
  ApplicationProjectAnalysis,
  ApplicationProjectDiagnostic,
  ApplicationProjectDiagnosticRelatedInformation,
} from "./project-data.ts";
import {
  parseApplicationSourceQuery,
  queryApplicationSources,
  type ApplicationSourceIndex,
  type ApplicationSourceQuery,
  type SourceIndexEntry,
  type SourceIndexIssue,
  type SourceQueryMatch,
  type SourceQueryMatchMode,
  type SourceRange,
  type SourceResolution,
  type SourceRole,
} from "./source-data.ts";

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

export type ReactionPortability = "portable" | "unlowered" | "mixed";

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

interface OperationResultBase {
  readonly identity: ApplicationAnalysisIdentity;
  readonly provenance: AnalysisProvenance;
  readonly complete: boolean;
  readonly resourceUsage: AnalysisResourceUsage;
}

export interface CatalogResult extends OperationResultBase, AnalysisPage<DesignSummary> {}

export type SearchField = "identity" | "contract" | "source-path";

export interface SearchRequest extends ApplicationAnalysisOperationOptions {
  /** Trimmed, locale-invariant `toLowerCase()` token-AND query (1-256 UTF-16 code units). */
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

export interface SearchResult extends OperationResultBase, AnalysisPage<SearchHit> {
  readonly query: string;
  readonly fields: readonly SearchField[];
}

export type DescriptionDetail = "summary" | "definition";
export type DesignRefInput = DesignRef | string;

type ConceptInventory = ApplicationManifestV1["concepts"][number];
type ActionInventory = ConceptInventory["actions"][number];
type QueryInventory = ConceptInventory["queries"][number];
type ReactionDefinition = ApplicationManifestV1["application"]["reactions"][number];
type UnloweredDefinition = ApplicationManifestV1["application"]["unlowered"][number];
type ViewDefinition = ApplicationManifestV1["application"]["views"][number];
type FormerDefinition = ApplicationManifestV1["application"]["formers"][number];
type ComputationDefinition = ApplicationManifestV1["computations"][number];
type EndpointDefinition = ApplicationManifestV1["endpoints"][number];
type WireEndpointDefinition = ApplicationManifestV1["wire"]["endpoints"][number];
type AuthoredDeclaration = ApplicationManifestV1["design"]["declarations"][number];

export type DesignDefinition =
  | {
      readonly kind: "concept";
      readonly concept: ConceptInventory;
      /** Shared authored definition and all selected application instances. */
      readonly design?: ApplicationManifestV1["design"]["concepts"][number];
      readonly implementation?: ApplicationManifestV1["conceptImplementations"][number];
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
      readonly identity: string;
      readonly declaration?: AuthoredDeclaration;
      readonly reactions: readonly ReactionDefinition[];
      readonly unlowered: readonly UnloweredDefinition[];
    }
  | {
      readonly kind: "view";
      readonly identity: string;
      readonly declaration?: AuthoredDeclaration;
      readonly runtime: readonly ViewDefinition[];
    }
  | {
      readonly kind: "former";
      readonly identity: string;
      readonly declaration?: AuthoredDeclaration;
      readonly runtime: readonly FormerDefinition[];
    }
  | { readonly kind: "computation"; readonly computation: ComputationDefinition }
  | {
      readonly kind: "endpoint";
      readonly endpoint: EndpointDefinition;
      readonly inputContract: ApplicationManifestV1["inputContracts"][string];
      readonly wire: {
        readonly endpoints: readonly WireEndpointDefinition[];
        readonly appWide: readonly string[];
      };
    };

export interface DescribeRequest extends ApplicationAnalysisOperationOptions {
  readonly ref: DesignRefInput;
  readonly detail?: DescriptionDetail;
}

export interface DescriptionResult extends OperationResultBase {
  readonly ref: DesignRef;
  readonly detail: DescriptionDetail;
  readonly summary: DesignSummary;
  readonly definition?: DesignDefinition;
}

export interface SourcesRequest extends ApplicationAnalysisOperationOptions {
  readonly query: ApplicationSourceQuery;
  readonly roles?: readonly SourceRole[];
  readonly resolutions?: readonly SourceResolution[];
  readonly match?: SourceQueryMatchMode;
  readonly page?: AnalysisPageRequest;
}

export interface SourcesResult extends OperationResultBase, AnalysisPage<SourceQueryMatch> {
  readonly query: ApplicationSourceQuery;
  readonly match: SourceQueryMatchMode;
  readonly issues: readonly AnalysisDiagnostic[];
}

export interface ImpactRequest extends ApplicationAnalysisOperationOptions {
  readonly seeds: readonly DesignRefInput[];
  readonly relations?: readonly ImpactRelation[];
  readonly certainties?: readonly ImpactCertainty[];
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface ImpactResult extends OperationResultBase {
  readonly trace: ImpactTrace;
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

export interface DiagnosticsResult extends OperationResultBase, AnalysisPage<AnalysisDiagnostic> {}

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

export interface NavigationResult extends OperationResultBase {
  readonly ref: DesignRef;
  readonly direction: NavigationDirection;
  readonly nodes: readonly NavigationNode[];
  readonly edges: readonly ImpactEdge[];
  readonly diagnostics: readonly AnalysisDiagnostic[];
}

export interface ContractFilters {
  readonly endpoints?: readonly string[];
  readonly paths?: readonly string[];
}

export interface ContractDeclaration {
  readonly endpoint: EndpointDefinition;
  /** Raw logical input contract from the manifest, falling back to the endpoint declaration. */
  readonly inputContract: ApplicationManifestV1["inputContracts"][string];
  /** Raw logical wire endpoints for this exact path. */
  readonly wireEndpoints: readonly WireEndpointDefinition[];
}

export interface ContractsRequest extends ApplicationAnalysisOperationOptions {
  readonly filters?: ContractFilters;
  readonly page?: AnalysisPageRequest;
}

export interface ContractsResult extends OperationResultBase, AnalysisPage<ContractDeclaration> {
  readonly appWide: readonly string[];
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
    OperationResultBase,
    AnalysisPage<ApplicationProjectAnalysis["provenance"]["files"][number]> {
  readonly facts: ApplicationAnalysisProvenanceFacts;
}

export interface ApplicationAnalysis {
  readonly manifest: Readonly<ApplicationManifestV1>;
  readonly project?: Readonly<ApplicationProjectAnalysis>;
  readonly index: Readonly<ApplicationIndex>;
  readonly sourceIndex?: Readonly<ApplicationSourceIndex>;
  readonly identity: ApplicationAnalysisIdentity;
  readonly catalog: (request?: CatalogRequest) => Promise<CatalogResult>;
  readonly search: (request: SearchRequest) => Promise<SearchResult>;
  readonly describe: (request: DescribeRequest) => Promise<DescriptionResult>;
  readonly sources: (request: SourcesRequest) => Promise<SourcesResult>;
  readonly impact: (request: ImpactRequest) => Promise<ImpactResult>;
  readonly navigate: (request: NavigateRequest) => Promise<NavigationResult>;
  readonly diagnostics: (request?: DiagnosticsRequest) => Promise<DiagnosticsResult>;
  readonly contracts: (request?: ContractsRequest) => Promise<ContractsResult>;
  readonly provenance: (request?: ProvenanceRequest) => Promise<ProvenanceResult>;
}

interface CreateApplicationAnalysisBaseOptions {
  readonly manifest: ApplicationManifestV1;
  /** Limits used only for canonical manifest-index recomputation. */
  readonly limits?: AnalysisLimits;
}

export type CreateApplicationAnalysisOptions = CreateApplicationAnalysisBaseOptions &
  (
    | { readonly project?: undefined; readonly expectedProjectDigest?: never }
    | {
        readonly project: ApplicationProjectAnalysis;
        /** Previously trusted digest from `applicationProjectAnalysisDigest(project)`. */
        readonly expectedProjectDigest: string;
      }
  );

const DEFAULT_RESULT_BYTES = 4 * 1024 * 1024;
const MAX_RESULT_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_LIMIT = 200;
const SHA256 = /^[a-f0-9]{64}$/;
const ANALYSIS_LIMIT_KEYS: readonly (keyof AnalysisLimits)[] = [
  "maxGraphNodes",
  "maxGraphEdges",
  "maxDiagnostics",
  "maxSourceDocuments",
  "maxSourceAnchors",
  "maxStaticResolutionDepth",
  "maxStaticResolutionAlternatives",
  "maxAstCandidates",
  "maxAstNodes",
  "maxProjectFiles",
  "maxProjectFileBytes",
  "maxProjectTotalBytes",
];
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
const SEARCH_FIELDS: readonly SearchField[] = ["identity", "contract", "source-path"];
const DEFAULT_SEARCH_FIELDS: readonly SearchField[] = ["identity", "contract", "source-path"];
const SOURCE_ROLES: readonly SourceRole[] = [
  "declaration",
  "canonical-contract",
  "selected-implementation",
  "selection",
  "registration",
  "specification",
  "design-coverage",
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
const EMPTY_USAGE: AnalysisResourceUsage = {
  graphNodes: 0,
  graphEdges: 0,
  diagnostics: 0,
  sourceDocuments: 0,
  sourceAnchors: 0,
  astNodes: 0,
  projectFiles: 0,
  projectBytes: 0,
};
const AMBIGUOUS_SOURCE_CODES = new Set<SourceIndexIssue["code"]>([
  "AMBIGUOUS_DESIGN_SOURCE",
  "AMBIGUOUS_CONCEPT_REGISTRATION",
  "AMBIGUOUS_CONCEPT_SET_SOURCE",
  "AMBIGUOUS_ASSEMBLY_SOURCE",
  "AMBIGUOUS_ENDPOINT_SOURCE",
]);
const UNRESOLVED_SOURCE_CODES = new Set<SourceIndexIssue["code"]>([
  "UNRESOLVED_DESIGN_SOURCE",
  "MISSING_CONCEPT_REGISTRATION",
  "UNRESOLVED_CONCEPT_SET_SOURCE",
  "UNRESOLVED_ASSEMBLY_SOURCE",
  "UNRESOLVED_IMPLEMENTATION_SELECTION",
  "UNRESOLVED_COMPUTATION_SOURCE",
  "SPECIFICATION_UNREADABLE",
  "DESIGN_SOURCE_UNREADABLE",
]);

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

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(ordinal);
  const selected = [...expected].sort(ordinal);
  if (actual.length !== selected.length || actual.some((key, index) => key !== selected[index])) {
    error("INVALID_ARGUMENT", `${label} has malformed fields`, {
      label,
      expected: selected,
      actual,
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
      value: String(value),
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
  return new Set(value.map((entry) => enumValue(entry, values, `${label}[]`)));
}

function stringSet(value: unknown, label: string): ReadonlySet<string> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) error("INVALID_ARGUMENT", `${label} must be an array`, { label });
  return new Set(value.map((entry) => nonEmptyString(entry, `${label}[]`)));
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
    deepFreeze((object as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function detached<Value>(value: Value, label: string): Value {
  try {
    return structuredClone(value);
  } catch (cause) {
    error("INVALID_ARGUMENT", `${label} must be detached serializable data`, {
      label,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return canonicalAnalysisJson(left) === canonicalAnalysisJson(right);
}

function sameCanonicalMembers(left: readonly unknown[], right: readonly unknown[]): boolean {
  const ordered = (values: readonly unknown[]): string[] =>
    values.map(canonicalAnalysisJson).sort();
  return sameCanonical(ordered(left), ordered(right));
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
    error("INVALID_ARGUMENT", `${label} must be a relative POSIX path prefix`, { label, path });
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

  source(): void {
    this.checkpoint();
    this.retained.sourceAnchors += 1;
  }

  sourceDocument(count = 1): void {
    this.checkpoint();
    this.retained.sourceDocuments += count;
  }

  projectFile(count = 1): void {
    this.checkpoint();
    this.retained.projectFiles += count;
  }

  usage(): AnalysisResourceUsage {
    return { ...this.retained };
  }

  finish<Result>(result: Result): Result {
    this.checkpoint();
    let rendered: string;
    try {
      rendered = canonicalAnalysisJson(result);
    } catch (cause) {
      error("INVALID_FORMAT", "Analysis operation produced non-canonical data", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    const attempted = Buffer.byteLength(rendered!, "utf8");
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

async function runOperation<Result>(
  options: ApplicationAnalysisOperationOptions,
  execute: (controller: OperationController) => Result | Promise<Result>,
): Promise<Result> {
  try {
    const controller = new OperationController(options);
    return controller.finish(await execute(controller));
  } catch (cause) {
    return operationFailure(cause);
  }
}

function resultBase(
  state: FacadeState,
  complete: boolean,
  controller: OperationController,
): OperationResultBase {
  return {
    identity: state.identity,
    provenance: state.provenance,
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
  if (ref.kind === "action") return `${ref.concept}.${ref.action}`;
  if (ref.kind === "query") return `${ref.concept}.${ref.query}`;
  if (ref.kind === "endpoint") return `${ref.endpoint} ${ref.path}`;
  return leafName(ref);
}

function parentConcept(ref: DesignRef): string | undefined {
  return ref.kind === "action" || ref.kind === "query" ? ref.concept : undefined;
}

function diagnosticId(value: Omit<AnalysisDiagnostic, "id">): string {
  return `analysis-diagnostic:${canonicalAnalysisDigest(value)}`;
}

function createDiagnostic(value: Omit<AnalysisDiagnostic, "id">): AnalysisDiagnostic {
  return { id: diagnosticId(value), ...value };
}

function analysisDiagnostic(
  severity: AnalysisSeverity,
  code: string,
  message: string,
  evidence: Readonly<Record<string, unknown>>,
  refs: readonly DesignRef[] = [],
  paths: readonly string[] = [],
): AnalysisDiagnostic {
  return createDiagnostic({
    origin: "analysis",
    severity,
    code,
    message,
    refs: sortedUniqueRefs(refs),
    paths: sortedUniqueStrings(paths),
    raw: { kind: "analysis", evidence },
  });
}

function sourceIssueDiagnostic(issue: SourceIndexIssue): AnalysisDiagnostic {
  return createDiagnostic({
    origin: "source",
    severity: issue.severity,
    code: issue.code,
    message: issue.message,
    refs: issue.ref === undefined ? [] : [issue.ref],
    paths: sortedUniqueStrings(issue.candidates?.map(({ path }) => path) ?? []),
    raw: { kind: "source", issue },
  });
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

function projectDiagnosticLocations(
  diagnostic: ApplicationProjectDiagnostic,
): ApplicationProjectDiagnosticRelatedInformation[] {
  return [diagnostic, ...(diagnostic.relatedInformation ?? [])];
}

function refsForLocations(
  diagnostic: ApplicationProjectDiagnostic,
  anchorsByPath: ReadonlyMap<
    string,
    readonly { readonly ref: DesignRef; readonly range: SourceRange }[]
  >,
): DesignRef[] {
  const refs: DesignRef[] = [];
  for (const location of projectDiagnosticLocations(diagnostic)) {
    if (location.path === undefined || location.startOffset === undefined) continue;
    const start = location.startOffset;
    const end = location.endOffset ?? start;
    const point = start === end;
    for (const anchor of anchorsByPath.get(location.path) ?? []) {
      if (
        point
          ? anchor.range.start.offset <= start && start < anchor.range.end.offset
          : anchor.range.start.offset < end && start < anchor.range.end.offset
      ) {
        refs.push(anchor.ref);
      }
    }
  }
  return sortedUniqueRefs(refs);
}

function unifiedDiagnostics(
  manifest: ApplicationManifestV1,
  project: ApplicationProjectAnalysis | undefined,
  index: ApplicationIndex,
  sourceIndex: ApplicationSourceIndex | undefined,
): AnalysisDiagnostic[] {
  const endpointsByName = new Map<string, DesignRef[]>();
  for (const endpoint of manifest.endpoints) {
    const values = endpointsByName.get(endpoint.name) ?? [];
    values.push({ kind: "endpoint", endpoint: endpoint.name, path: endpoint.path });
    endpointsByName.set(endpoint.name, values);
  }
  const anchorsByPath = new Map<string, { ref: DesignRef; range: SourceRange }[]>();
  for (const entry of sourceIndex?.entries ?? []) {
    for (const anchor of entry.sources) {
      const values = anchorsByPath.get(anchor.range.path) ?? [];
      values.push({ ref: entry.ref, range: anchor.range });
      anchorsByPath.set(anchor.range.path, values);
    }
  }
  for (const values of anchorsByPath.values()) {
    values.sort(
      (left, right) =>
        left.range.start.offset - right.range.start.offset ||
        left.range.end.offset - right.range.end.offset ||
        ordinal(designRefKey(left.ref), designRefKey(right.ref)),
    );
  }

  const diagnostics: AnalysisDiagnostic[] = [];
  for (const diagnostic of manifest.diagnostics) {
    const definition = diagnostic.definition;
    const refs: DesignRef[] =
      definition.kind === "reaction"
        ? [{ kind: "reaction", reaction: definition.name }]
        : definition.kind === "view"
          ? [{ kind: "view", view: definition.name }]
          : definition.kind === "former"
            ? [{ kind: "former", former: definition.name }]
            : definition.kind === "endpoint"
              ? (endpointsByName.get(definition.name) ?? [])
              : [];
    diagnostics.push(
      createDiagnostic({
        origin: "manifest",
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        refs: sortedUniqueRefs(refs),
        paths: diagnostic.endpoint === undefined ? [] : [diagnostic.endpoint.path],
        raw: { kind: "manifest", diagnostic },
      }),
    );
  }
  for (const diagnostic of project?.diagnostics ?? []) {
    diagnostics.push(
      createDiagnostic({
        origin: "typescript",
        severity: diagnostic.severity,
        code: String(diagnostic.code),
        message: diagnostic.message,
        refs: refsForLocations(diagnostic, anchorsByPath),
        paths: sortedUniqueStrings(
          projectDiagnosticLocations(diagnostic).flatMap(({ path }) =>
            path === undefined ? [] : [path],
          ),
        ),
        raw: { kind: "typescript", diagnostic },
      }),
    );
  }
  for (const issue of index.issues) {
    diagnostics.push(
      createDiagnostic({
        origin: "index",
        severity: issue.severity,
        code: issue.code,
        message: issue.message,
        refs: issue.ref === undefined ? [] : [issue.ref],
        paths: [],
        raw: { kind: "index", issue },
      }),
    );
  }
  for (const issue of sourceIndex?.issues ?? []) diagnostics.push(sourceIssueDiagnostic(issue));
  return [...new Map(diagnostics.map((diagnostic) => [diagnostic.id, diagnostic])).values()].sort(
    (left, right) => ordinal(left.id, right.id),
  );
}

interface FacadeState {
  readonly manifest: ApplicationManifestV1;
  readonly project?: ApplicationProjectAnalysis;
  readonly index: ApplicationIndex;
  readonly sourceIndex?: ApplicationSourceIndex;
  readonly identity: ApplicationAnalysisIdentity;
  readonly provenance: AnalysisProvenance;
  readonly refs: ReadonlyMap<string, DesignRef>;
  readonly sourceEntries: ReadonlyMap<string, SourceIndexEntry>;
  readonly sourceIssues: ReadonlyMap<string, readonly SourceIndexIssue[]>;
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly diagnosticsByRef: ReadonlyMap<string, readonly AnalysisDiagnostic[]>;
  readonly summaries: readonly DesignSummary[];
  readonly summariesByRef: ReadonlyMap<string, DesignSummary>;
  readonly concepts: ReadonlyMap<string, ConceptInventory>;
  readonly conceptDesigns: ReadonlyMap<string, ApplicationManifestV1["design"]["concepts"][number]>;
  readonly implementations: ReadonlyMap<
    string,
    ApplicationManifestV1["conceptImplementations"][number]
  >;
  readonly declarations: ReadonlyMap<string, AuthoredDeclaration>;
  readonly reactions: ReadonlyMap<string, readonly ReactionDefinition[]>;
  readonly unlowered: ReadonlyMap<string, readonly UnloweredDefinition[]>;
  readonly views: ReadonlyMap<string, readonly ViewDefinition[]>;
  readonly formers: ReadonlyMap<string, readonly FormerDefinition[]>;
  readonly computations: ReadonlyMap<string, ComputationDefinition>;
  readonly endpoints: ReadonlyMap<string, EndpointDefinition>;
  readonly incoming: ReadonlyMap<string, readonly ImpactEdge[]>;
  readonly outgoing: ReadonlyMap<string, readonly ImpactEdge[]>;
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

function diagnosticsForRefs(state: FacadeState, refs: Iterable<DesignRef>): AnalysisDiagnostic[] {
  const values = new Map<string, AnalysisDiagnostic>();
  for (const ref of refs) {
    for (const diagnostic of state.diagnosticsByRef.get(designRefKey(ref)) ?? []) {
      values.set(diagnostic.id, diagnostic);
    }
  }
  return [...values.values()].sort((left, right) => ordinal(left.id, right.id));
}

function specificationForConcept(
  state: FacadeState,
  conceptName: string,
): ConceptSpecificationIR | undefined {
  return (
    state.conceptDesigns.get(conceptName)?.specification ??
    state.concepts.get(conceptName)?.specification
  );
}

function definitionFor(state: FacadeState, ref: DesignRef): DesignDefinition {
  switch (ref.kind) {
    case "concept": {
      const concept = state.concepts.get(ref.concept)!;
      const design = state.conceptDesigns.get(ref.concept);
      const implementation = state.implementations.get(ref.concept);
      return {
        kind: "concept",
        concept,
        ...(design === undefined ? {} : { design }),
        ...(implementation === undefined ? {} : { implementation }),
      };
    }
    case "action": {
      const action = state.concepts
        .get(ref.concept)!
        .actions.find(({ name }) => name === ref.action)!;
      const specification = specificationForConcept(state, ref.concept)?.actions.find(
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
      const query = state.concepts
        .get(ref.concept)!
        .queries.find(({ name }) => name === ref.query)!;
      const specification = specificationForConcept(state, ref.concept)?.queries.find(
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
      const declaration = state.declarations.get(declarationKey("reaction", ref.reaction));
      return {
        kind: "reaction",
        identity: ref.reaction,
        ...(declaration === undefined ? {} : { declaration }),
        reactions: state.reactions.get(ref.reaction) ?? [],
        unlowered: state.unlowered.get(ref.reaction) ?? [],
      };
    }
    case "view": {
      const declaration = state.declarations.get(declarationKey("view", ref.view));
      return {
        kind: "view",
        identity: ref.view,
        ...(declaration === undefined ? {} : { declaration }),
        runtime: state.views.get(ref.view) ?? [],
      };
    }
    case "former": {
      const declaration = state.declarations.get(declarationKey("former", ref.former));
      return {
        kind: "former",
        identity: ref.former,
        ...(declaration === undefined ? {} : { declaration }),
        runtime: state.formers.get(ref.former) ?? [],
      };
    }
    case "computation":
      return { kind: "computation", computation: state.computations.get(ref.computation)! };
    case "endpoint": {
      const endpoint = state.endpoints.get(designRefKey(ref))!;
      return {
        kind: "endpoint",
        endpoint,
        inputContract: state.manifest.inputContracts[ref.path] ?? endpoint.input,
        wire: {
          endpoints: state.manifest.wire.endpoints.filter(({ path }) => path === ref.path),
          appWide: state.manifest.wire.appWide,
        },
      };
    }
  }
}

function includesTokens(value: string, tokens: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return tokens.every((token) => lower.includes(token));
}

function snippet(
  value: string,
  tokens: readonly string[],
): Pick<SearchHit, "snippet" | "truncatedStart" | "truncatedEnd"> {
  if (value.length <= 160) return { snippet: value, truncatedStart: false, truncatedEnd: false };
  const lower = value.toLowerCase();
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

function contractSearchFact(state: FacadeState, ref: DesignRef): unknown {
  switch (ref.kind) {
    case "concept": {
      const concept = state.concepts.get(ref.concept)!;
      return {
        purpose: concept.purpose,
        principle: concept.principle,
        specification: specificationForConcept(state, ref.concept),
        design: state.conceptDesigns.get(ref.concept),
      };
    }
    case "action":
    case "query":
    case "view":
    case "former":
    case "computation":
    case "endpoint":
      return definitionFor(state, ref);
    case "reaction":
      return definitionFor(state, ref);
  }
}

function searchFact(state: FacadeState, ref: DesignRef, field: SearchField): string {
  const entry = state.sourceEntries.get(designRefKey(ref));
  switch (field) {
    case "identity":
      return [designRefKey(ref), qualifiedName(ref), leafName(ref), parentConcept(ref) ?? ""]
        .filter(Boolean)
        .join(" | ");
    case "contract":
      return canonicalAnalysisJson(contractSearchFact(state, ref));
    case "source-path":
      return sortedUniqueStrings(entry?.sources.map(({ range }) => range.path) ?? []).join("\n");
  }
}

function searchHit(
  state: FacadeState,
  ref: DesignRef,
  query: string,
  tokens: readonly string[],
  fields: readonly SearchField[],
): SearchHit | undefined {
  const facts = new Map(fields.map((field) => [field, searchFact(state, ref, field)]));
  if (!includesTokens([...facts.values()].join("\n"), tokens)) return undefined;
  const key = designRefKey(ref);
  const qualified = qualifiedName(ref);
  const leaf = leafName(ref);
  const normalizedQuery = query.toLowerCase();
  const identity = facts.get("identity");
  const paths = facts.get("source-path");
  let rank = 6;
  if (
    identity !== undefined &&
    (key.toLowerCase() === normalizedQuery || qualified.toLowerCase() === normalizedQuery)
  ) {
    rank = 0;
  } else if (identity !== undefined && leaf.toLowerCase() === normalizedQuery) {
    rank = 1;
  } else if (
    identity !== undefined &&
    [key, qualified, leaf].some((value) => value.toLowerCase().startsWith(normalizedQuery))
  ) {
    rank = 2;
  } else if (
    identity !== undefined &&
    tokens.every((token) =>
      identity
        .toLowerCase()
        .split(/[^a-z0-9_#/:.-]+/u)
        .some((word) => word.startsWith(token)),
    )
  ) {
    rank = 3;
  } else if (includesTokens(`${identity ?? ""}\n${paths ?? ""}`, tokens)) {
    rank = 4;
  } else if (
    facts.get("contract") !== undefined &&
    includesTokens(facts.get("contract")!, tokens)
  ) {
    rank = 5;
  }
  const fieldPriority: readonly SearchField[] = ["identity", "source-path", "contract"];
  const matchedField = fieldPriority.find(
    (field) => facts.get(field) !== undefined && includesTokens(facts.get(field)!, tokens),
  );
  if (matchedField === undefined) return undefined;
  return {
    ref,
    key,
    qualifiedName: qualified,
    rank,
    matchedField,
    ...snippet(facts.get(matchedField)!, tokens),
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

function edgeIncluded(
  edge: ImpactEdge,
  filters: {
    readonly relations?: ReadonlySet<ImpactRelation>;
    readonly certainties?: ReadonlySet<ImpactCertainty>;
  },
): boolean {
  return (
    (filters.relations === undefined || filters.relations.has(edge.relation)) &&
    (filters.certainties === undefined || filters.certainties.has(edge.certainty))
  );
}

function catalogOperation(
  state: FacadeState,
  requestValue: CatalogRequest | undefined,
): Promise<CatalogResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(supplied, ["filters", "page"], "catalog request");
    const filter = request.filters === undefined ? {} : record(request.filters, "filters");
    allowedKeys(
      filter,
      ["kinds", "concepts", "portability", "sourceAvailability", "diagnosticSeverities"],
      "filters",
    );
    const kinds = enumSet(filter.kinds, DESIGN_KINDS, "filters.kinds");
    const concepts = stringSet(filter.concepts, "filters.concepts");
    const portability = enumSet(
      filter.portability,
      ["portable", "unlowered", "mixed"] as const,
      "filters.portability",
    );
    const availability = enumSet(
      filter.sourceAvailability,
      ["available", "ambiguous", "unresolved", "not-indexed", "unavailable"] as const,
      "filters.sourceAvailability",
    );
    const severities = enumSet(
      filter.diagnosticSeverities,
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
    return { ...resultBase(state, true, controller), ...page };
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
    const tokens = query.toLowerCase().split(/\s+/u);
    const hits: SearchHit[] = [];
    for (const ref of state.index.inventory) {
      controller.checkpoint();
      const hit = searchHit(state, ref, query, tokens, fields);
      if (hit !== undefined) hits.push(hit);
    }
    hits.sort((left, right) => left.rank - right.rank || ordinal(left.key, right.key));
    const page = pageOf(hits, pageRequest(request.page));
    controller.graphNode(page.items.length);
    return { ...resultBase(state, true, controller), query, fields, ...page };
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
        : enumValue(request.detail, ["summary", "definition"] as const, "detail");
    controller.graphNode();
    const summary = state.summariesByRef.get(designRefKey(ref))!;
    if (detail === "summary") {
      return { ...resultBase(state, true, controller), ref, detail, summary };
    }
    const definition = definitionFor(state, ref);
    return { ...resultBase(state, true, controller), ref, detail, summary, definition };
  });
}

function sourcesOperation(
  state: FacadeState,
  requestValue: SourcesRequest,
): Promise<SourcesResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(
      requestValue,
      ["query", "roles", "resolutions", "match", "page"],
      "sources request",
    );
    if (state.sourceIndex === undefined) {
      error("CAPABILITY_UNAVAILABLE", "source queries require a project source snapshot", {
        capability: "sources",
      });
    }
    let query: ApplicationSourceQuery;
    try {
      query = parseApplicationSourceQuery(request.query);
    } catch (cause) {
      return operationFailure(cause);
    }
    if (query.kind === "ref") query = { kind: "ref", ref: knownRef(state, query.ref, "query.ref") };
    const roles = enumSet(request.roles, SOURCE_ROLES, "roles");
    const resolutions = enumSet(request.resolutions, SOURCE_RESOLUTIONS, "resolutions");
    const match =
      request.match === undefined
        ? "all"
        : enumValue(request.match, ["all", "best"] as const, "match");
    const result = queryApplicationSources(state.sourceIndex, query, {
      ...(roles === undefined ? {} : { roles: [...roles] }),
      ...(resolutions === undefined ? {} : { resolutions: [...resolutions] }),
      match,
    });
    const page = pageOf(result.matches, pageRequest(request.page));
    const issues = result.issues.map(sourceIssueDiagnostic);
    for (const _item of page.items) controller.source();
    controller.sourceDocument(new Set(page.items.map(({ anchor }) => anchor.range.path)).size);
    controller.diagnostic(issues.length);
    return {
      ...resultBase(state, result.complete, controller),
      query,
      match,
      issues,
      ...page,
    };
  });
}

function impactOperation(state: FacadeState, requestValue: ImpactRequest): Promise<ImpactResult> {
  return runOperation(requestValue, (controller) => {
    const request = operationRequest(
      requestValue,
      ["seeds", "relations", "certainties", "maxDepth", "maxNodes"],
      "impact request",
    );
    const seeds = knownRefs(state, request.seeds, "seeds", 100);
    if (seeds.length === 0) error("INVALID_ARGUMENT", "impact requires at least one seed");
    const maxDepth = boundedInteger(request.maxDepth, 12, 0, 12, "maxDepth");
    const maxNodes = boundedInteger(request.maxNodes, 500, 1, 1_000, "maxNodes");
    const filters = edgeFilters(request);
    const selectedIndex = {
      ...state.index,
      edges: state.index.edges.filter((edge) => edgeIncluded(edge, filters)),
    };
    const trace = traceApplicationImpact(selectedIndex, seeds, {
      signal: controller.signal,
      maxDepth,
      maxNodes,
    });
    const diagnosticValues = [
      ...diagnosticsForRefs(
        state,
        trace.affected.map(({ ref }) => ref),
      ),
      ...trace.issues.map(traceIssueDiagnostic),
    ];
    const diagnostics = [
      ...new Map(diagnosticValues.map((diagnostic) => [diagnostic.id, diagnostic])).values(),
    ].sort((left, right) => ordinal(left.id, right.id));
    controller.graphNode(trace.affected.length);
    controller.graphEdge(new Set(trace.affected.flatMap(({ path }) => path.map(edgeKey))).size);
    controller.diagnostic(diagnostics.length);
    return { ...resultBase(state, trace.complete, controller), trace, diagnostics };
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
    const filters = edgeFilters(request);
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
        ...(direction === "incoming" || direction === "both"
          ? (state.incoming.get(key) ?? [])
          : []),
        ...(direction === "outgoing" || direction === "both"
          ? (state.outgoing.get(key) ?? [])
          : []),
      ]
        .filter((edge) => edgeIncluded(edge, filters))
        .sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));
      for (const edge of candidates) {
        controller.checkpoint();
        const neighbor = designRefKey(edge.from) === key ? edge.to : edge.from;
        const neighborKey = designRefKey(neighbor);
        if (!distances.has(neighborKey) && distances.size >= maxNodes) {
          limited = true;
          continue;
        }
        const selectedEdgeKey = edgeKey(edge);
        if (!retainedEdges.has(selectedEdgeKey) && retainedEdges.size >= maxEdges) {
          limited = true;
          continue;
        }
        retainedEdges.set(selectedEdgeKey, edge);
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
      ...resultBase(state, !limited, controller),
      ref,
      direction,
      nodes,
      edges,
      diagnostics,
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
    return { ...resultBase(state, true, controller), ...page };
  });
}

function contractsOperation(
  state: FacadeState,
  requestValue: ContractsRequest | undefined,
): Promise<ContractsResult> {
  const supplied = requestValue === undefined ? {} : requestValue;
  return runOperation(supplied, (controller) => {
    const request = operationRequest(supplied, ["filters", "page"], "contracts request");
    const filter = request.filters === undefined ? {} : record(request.filters, "filters");
    allowedKeys(filter, ["endpoints", "paths"], "filters");
    const endpointNames = stringSet(filter.endpoints, "filters.endpoints");
    const paths = stringSet(filter.paths, "filters.paths");
    const knownNames = new Set(state.manifest.endpoints.map(({ name }) => name));
    const knownPaths = new Set(state.manifest.endpoints.map(({ path }) => path));
    const unknownNames = [...(endpointNames ?? [])].filter((name) => !knownNames.has(name));
    const unknownPaths = [...(paths ?? [])].filter((path) => !knownPaths.has(path));
    if (unknownNames.length > 0)
      error("NOT_FOUND", "contract endpoint filter is unknown", { endpoints: unknownNames });
    if (unknownPaths.length > 0)
      error("NOT_FOUND", "contract path filter is unknown", { paths: unknownPaths });
    const declarations: ContractDeclaration[] = state.manifest.endpoints
      .filter(
        (endpoint) =>
          (endpointNames === undefined || endpointNames.has(endpoint.name)) &&
          (paths === undefined || paths.has(endpoint.path)),
      )
      .sort((left, right) => ordinal(`${left.path}\0${left.name}`, `${right.path}\0${right.name}`))
      .map((endpoint) => ({
        endpoint,
        inputContract: state.manifest.inputContracts[endpoint.path] ?? endpoint.input,
        wireEndpoints: state.manifest.wire.endpoints.filter(({ path }) => path === endpoint.path),
      }));
    const page = pageOf(declarations, pageRequest(request.page));
    controller.graphNode(page.items.length);
    return {
      ...resultBase(state, true, controller),
      appWide: state.manifest.wire.appWide,
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
    const page = pageOf(state.project?.provenance.files ?? [], pageRequest(request.page));
    controller.projectFile(page.items.length);
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
    return { ...resultBase(state, true, controller), facts, ...page };
  });
}

function mapByName<Value extends { readonly name: string }>(
  values: readonly Value[],
): Map<string, Value> {
  return new Map(values.map((value) => [value.name, value]));
}

function mapByAuthoredIdentity<
  Value extends { readonly name: string; readonly authored?: { readonly identity: string } },
>(values: readonly Value[]): Map<string, readonly Value[]> {
  const grouped = new Map<string, Value[]>();
  for (const value of values) {
    const identity = value.authored?.identity ?? value.name;
    grouped.set(identity, [...(grouped.get(identity) ?? []), value]);
  }
  return new Map(
    [...grouped].map(([identity, runtime]) => [
      identity,
      runtime.sort((left, right) => ordinal(left.name, right.name)),
    ]),
  );
}

function declarationKey(kind: "reaction" | "view" | "former", identity: string): string {
  return `${kind}\0${identity}`;
}

function sourceAvailabilityFor(
  sourceIndex: ApplicationSourceIndex | undefined,
  entry: SourceIndexEntry | undefined,
  issues: readonly SourceIndexIssue[],
): SourceAvailability {
  if (sourceIndex === undefined) return "unavailable";
  if ((entry?.sources.length ?? 0) > 0) return "available";
  if (issues.some(({ code }) => AMBIGUOUS_SOURCE_CODES.has(code))) return "ambiguous";
  if (issues.some(({ code }) => UNRESOLVED_SOURCE_CODES.has(code))) return "unresolved";
  return "not-indexed";
}

function applicationIndexSemantics(index: ApplicationIndex): unknown {
  return {
    format: index.format,
    version: index.version,
    provenance: {
      analyzer: { name: index.provenance.analyzer.name },
      manifest: index.provenance.manifest,
    },
    manifestDigest: index.manifestDigest,
    inventory: index.inventory,
    referencedOnly: index.referencedOnly,
    nodes: index.nodes,
    edges: index.edges,
    issues: index.issues,
    resourceUsage: index.resourceUsage,
  };
}

/**
 * Build a detached, immutable query facade. Project-backed construction
 * requires a previously trusted digest of the complete project artifact.
 */
export function createApplicationAnalysis(
  optionsValue: CreateApplicationAnalysisOptions,
): ApplicationAnalysis {
  const options = record(optionsValue, "createApplicationAnalysis options");
  allowedKeys(
    options,
    ["manifest", "project", "expectedProjectDigest", "limits"],
    "createApplicationAnalysis options",
  );
  const limits =
    options.limits === undefined
      ? undefined
      : (record(options.limits, "limits") as unknown as AnalysisLimits);
  if (limits !== undefined) {
    allowedKeys(limits as unknown as Record<string, unknown>, ANALYSIS_LIMIT_KEYS, "limits");
  }
  if (options.project === undefined && options.expectedProjectDigest !== undefined) {
    error("INVALID_ARGUMENT", "expectedProjectDigest requires a project snapshot");
  }
  let expectedProjectDigest: string | undefined;
  if (options.project !== undefined) {
    expectedProjectDigest = nonEmptyString(options.expectedProjectDigest, "expectedProjectDigest");
    if (!SHA256.test(expectedProjectDigest)) {
      error("INVALID_ARGUMENT", "expectedProjectDigest must be a lowercase SHA-256 digest");
    }
  }
  const manifestRecord = record(options.manifest, "manifest");
  if (manifestRecord.format !== "sync-engine.application-manifest") {
    error("INVALID_FORMAT", "manifest has an unsupported format", {
      format: String(manifestRecord.format),
    });
  }
  if (manifestRecord.version !== 1) {
    error("UNSUPPORTED_VERSION", "manifest must be version 1", { version: manifestRecord.version });
  }
  const manifest = detached(options.manifest, "manifest") as ApplicationManifestV1;
  try {
    validateApplicationManifest(manifest);
  } catch (cause) {
    error("INVALID_FORMAT", "manifest is not a canonical V1 application manifest", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }

  let project: ApplicationProjectAnalysis | undefined;
  let projectDigest: string | undefined;
  if (options.project !== undefined) {
    project = detached(options.project, "project") as ApplicationProjectAnalysis;
    try {
      validateApplicationProjectAnalysis(project);
    } catch (cause) {
      if (cause instanceof AnalysisError) throw cause;
      error("SNAPSHOT_MISMATCH", "project analysis failed strict validation", {
        cause: cause instanceof Error ? cause.message : String(cause),
      });
    }
    projectDigest = applicationProjectAnalysisDigest(project);
    if (projectDigest !== expectedProjectDigest) {
      error("SNAPSHOT_MISMATCH", "project analysis does not match expectedProjectDigest");
    }
    if (
      project.manifestDigest !== manifest.digest ||
      project.provenance.manifestDigest !== manifest.digest ||
      !sameCanonical(project.provenance.manifest.generator, manifest.generator) ||
      !sameCanonicalMembers(project.manifestDiagnostics, manifest.diagnostics)
    ) {
      error("SNAPSHOT_MISMATCH", "project analysis does not match the supplied manifest");
    }
  }

  const index = indexApplication(manifest, limits === undefined ? {} : { limits });
  if (
    project !== undefined &&
    !sameCanonical(
      applicationIndexSemantics(project.applicationIndex),
      applicationIndexSemantics(index),
    )
  ) {
    error(
      "SNAPSHOT_MISMATCH",
      "project application index composition does not match the supplied manifest",
    );
  }
  try {
    assertArtifactProvenance(index, "application index", manifest);
  } catch (cause) {
    error("SNAPSHOT_MISMATCH", "application index does not match the supplied manifest", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  const sourceIndex = project?.sourceIndex;
  const identity: ApplicationAnalysisIdentity = {
    manifestDigest: manifest.digest,
    analysisDigest: projectDigest ?? canonicalAnalysisDigest(index),
    ...(project === undefined
      ? {}
      : {
          sourceRevision: project.provenance.sourceRevision,
          sourceDigest: project.provenance.sourceDigest,
        }),
    analyzerVersion: index.provenance.analyzer.version,
    coreVersion: manifest.generator.version,
  };

  const refs = new Map(index.inventory.map((ref) => [designRefKey(ref), ref]));
  const sourceEntries = new Map(
    sourceIndex?.entries.map((entry) => [designRefKey(entry.ref), entry]) ?? [],
  );
  const sourceIssues = new Map<string, SourceIndexIssue[]>();
  for (const issue of sourceIndex?.issues ?? []) {
    if (issue.ref === undefined) continue;
    const key = designRefKey(issue.ref);
    sourceIssues.set(key, [...(sourceIssues.get(key) ?? []), issue]);
  }
  const diagnostics = unifiedDiagnostics(manifest, project, index, sourceIndex);
  const diagnosticsByRef = new Map<string, AnalysisDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    for (const ref of diagnostic.refs) {
      const key = designRefKey(ref);
      diagnosticsByRef.set(key, [...(diagnosticsByRef.get(key) ?? []), diagnostic]);
    }
  }
  const reactions = mapByAuthoredIdentity(manifest.application.reactions);
  const unlowered = mapByAuthoredIdentity(manifest.application.unlowered);
  const summaries = index.inventory.map((ref): DesignSummary => {
    const key = designRefKey(ref);
    const entry = sourceEntries.get(key);
    const counts: MutableSeverityCounts = { error: 0, warning: 0, info: 0 };
    for (const diagnostic of diagnosticsByRef.get(key) ?? []) counts[diagnostic.severity] += 1;
    const parent = parentConcept(ref);
    const portability: ReactionPortability | undefined =
      ref.kind !== "reaction"
        ? undefined
        : reactions.has(ref.reaction) && unlowered.has(ref.reaction)
          ? "mixed"
          : reactions.has(ref.reaction)
            ? "portable"
            : "unlowered";
    return {
      ref,
      key,
      name: leafName(ref),
      qualifiedName: qualifiedName(ref),
      ...(parent === undefined ? {} : { parentConcept: parent }),
      ...(portability === undefined ? {} : { portability }),
      sourceAvailability: sourceAvailabilityFor(sourceIndex, entry, sourceIssues.get(key) ?? []),
      anchorCount: entry?.sources.length ?? 0,
      sourcePaths: sortedUniqueStrings(entry?.sources.map(({ range }) => range.path) ?? []),
      diagnostics: counts,
    };
  });
  const incoming = new Map<string, ImpactEdge[]>();
  const outgoing = new Map<string, ImpactEdge[]>();
  for (const edge of index.edges) {
    const from = designRefKey(edge.from);
    const to = designRefKey(edge.to);
    outgoing.set(from, [...(outgoing.get(from) ?? []), edge]);
    incoming.set(to, [...(incoming.get(to) ?? []), edge]);
  }
  for (const values of [...incoming.values(), ...outgoing.values()]) {
    values.sort((left, right) => ordinal(edgeKey(left), edgeKey(right)));
  }

  deepFreeze(manifest);
  deepFreeze(index);
  if (project !== undefined) deepFreeze(project);
  deepFreeze(identity);
  deepFreeze(diagnostics);
  deepFreeze(summaries);

  const state: FacadeState = {
    manifest,
    ...(project === undefined ? {} : { project }),
    index,
    ...(sourceIndex === undefined ? {} : { sourceIndex }),
    identity,
    provenance: index.provenance,
    refs,
    sourceEntries,
    sourceIssues,
    diagnostics,
    diagnosticsByRef,
    summaries,
    summariesByRef: new Map(summaries.map((summary) => [summary.key, summary])),
    concepts: mapByName(manifest.concepts),
    conceptDesigns: new Map(
      manifest.design.concepts.flatMap((definition) =>
        definition.instances.map((instance) => [instance.name, definition] as const),
      ),
    ),
    implementations: new Map(
      manifest.conceptImplementations.map((implementation) => [
        implementation.concept,
        implementation,
      ]),
    ),
    declarations: new Map(
      manifest.design.declarations.map((declaration) => [
        declarationKey(declaration.kind, declaration.identity),
        declaration,
      ]),
    ),
    reactions,
    unlowered,
    views: mapByAuthoredIdentity(manifest.application.views),
    formers: mapByAuthoredIdentity(manifest.application.formers),
    computations: mapByName(manifest.computations),
    endpoints: new Map(
      manifest.endpoints.map((endpoint) => [
        designRefKey({ kind: "endpoint", endpoint: endpoint.name, path: endpoint.path }),
        endpoint,
      ]),
    ),
    incoming,
    outgoing,
  };
  return Object.freeze<ApplicationAnalysis>({
    manifest,
    ...(project === undefined ? {} : { project }),
    index,
    ...(sourceIndex === undefined ? {} : { sourceIndex }),
    identity,
    catalog: (request) => catalogOperation(state, request),
    search: (request) => searchOperation(state, request),
    describe: (request) => describeOperation(state, request),
    sources: (request) => sourcesOperation(state, request),
    impact: (request) => impactOperation(state, request),
    navigate: (request) => navigationOperation(state, request),
    diagnostics: (request) => diagnosticsOperation(state, request),
    contracts: (request) => contractsOperation(state, request),
    provenance: (request) => provenanceOperation(state, request),
  });
}
