import { createHash } from "node:crypto";
import { designRefKey, type DesignRef } from "./application-impact.ts";
import type { AnalysisProvenance } from "./analysis-provenance.ts";
import type { AnalysisResourceUsage, AnalysisSeverity } from "./analysis-foundation.ts";

export interface SourcePosition {
  /** UTF-16 offset, matching the TypeScript compiler API. */
  readonly offset: number;
  /** One-based line. */
  readonly line: number;
  /** One-based column. */
  readonly column: number;
}

export interface SourceRange {
  /** POSIX path relative to the supplied project root. */
  readonly path: string;
  /** Half-open range start. */
  readonly start: SourcePosition;
  /** Half-open range end. */
  readonly end: SourcePosition;
}

export type SourceRole =
  | "declaration"
  | "canonical-contract"
  | "selected-implementation"
  | "selection"
  | "registration"
  | "specification";

export type SourceResolution =
  | "symbol"
  | "static-flow"
  | "literal-name"
  | "name-and-footprint"
  | "manifest-location"
  | "manifest-provenance";

/** Metadata for one exact source slice associated with a logical design reference. */
export interface SourceAnchor {
  readonly role: SourceRole;
  /** Complete semantic declaration range in the indexed document. */
  readonly range: SourceRange;
  /** SHA-256 of the UTF-8 text identified by `range`. */
  readonly digest: string;
  readonly resolution: SourceResolution;
  /** A name, path, or member token inside the semantic range. */
  readonly focusRange?: SourceRange;
}

export interface SourceIndexEntry {
  readonly ref: DesignRef;
  readonly sources: readonly SourceAnchor[];
}

export type SourceIndexIssueCode =
  | "AMBIGUOUS_DESIGN_SOURCE"
  | "UNRESOLVED_DESIGN_SOURCE"
  | "MISSING_CONCEPT_REGISTRATION"
  | "AMBIGUOUS_CONCEPT_REGISTRATION"
  | "UNRESOLVED_VOCABULARY_SOURCE"
  | "AMBIGUOUS_VOCABULARY_SOURCE"
  | "AMBIGUOUS_ASSEMBLY_SOURCE"
  | "UNRESOLVED_ASSEMBLY_SOURCE"
  | "UNRESOLVED_IMPLEMENTATION_SELECTION"
  | "AMBIGUOUS_ENDPOINT_SOURCE"
  | "UNRESOLVED_COMPUTATION_SOURCE"
  | "SOURCE_OUTSIDE_PROJECT"
  | "SPECIFICATION_UNREADABLE"
  | "SPECIFICATION_MISMATCH";

export interface SourceIndexIssue {
  readonly code: SourceIndexIssueCode;
  readonly severity: AnalysisSeverity;
  readonly message: string;
  readonly ref?: DesignRef;
  readonly role?: SourceRole;
  readonly candidates?: readonly SourceRange[];
}

export interface IndexedSourceDocument {
  /** POSIX path relative to the supplied project root. */
  readonly path: string;
  readonly digest: string;
  /** UTF-16 code-unit length, matching source offsets. */
  readonly length: number;
  /** Exact UTF-8 byte length. */
  readonly byteLength: number;
}

/** Checkout-specific source attribution over one portable application manifest. */
export interface ApplicationSourceIndex {
  readonly format: "sync-engine.application-source-index";
  readonly version: 2;
  readonly provenance: AnalysisProvenance;
  readonly manifestDigest: string;
  readonly typescriptVersion: string;
  readonly documents: readonly IndexedSourceDocument[];
  readonly entries: readonly SourceIndexEntry[];
  readonly issues: readonly SourceIndexIssue[];
  readonly resourceUsage: AnalysisResourceUsage;
}

export type ApplicationSourceQuery =
  | { readonly kind: "ref"; readonly ref: DesignRef }
  | { readonly kind: "cursor"; readonly path: string; readonly offset: number }
  | { readonly kind: "range"; readonly path: string; readonly start: number; readonly end: number }
  | { readonly kind: "file"; readonly path: string };

export type SourceQueryMatchMode = "all" | "best";
export type SourceSpecificity =
  | "focus"
  | "exact-semantic-range"
  | "query-contained-by-anchor"
  | "anchor-contained-by-query"
  | "partial-overlap"
  | "whole-file";

export interface SourceQueryOptions {
  readonly roles?: readonly SourceRole[];
  readonly resolutions?: readonly SourceResolution[];
  readonly match?: SourceQueryMatchMode;
}

export interface SourceQueryMatch {
  readonly ref: DesignRef;
  readonly anchor: SourceAnchor;
  readonly specificity: SourceSpecificity;
  readonly rank: number;
}

export interface SourceQueryResult {
  readonly matches: readonly SourceQueryMatch[];
  readonly complete: boolean;
  readonly issues: readonly SourceIndexIssue[];
}

export type ApplicationSourceReadErrorCode =
  | "ABORTED"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_UNREADABLE"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_CHANGED";

/** Typed failure for exact, digest-verified source document reads. */
export class ApplicationSourceReadError extends Error {
  constructor(
    readonly code: ApplicationSourceReadErrorCode,
    message: string,
    readonly path: string,
  ) {
    super(message);
    this.name = "ApplicationSourceReadError";
  }
}

export interface ReadApplicationSourceDocumentOptions {
  readonly readFile: (
    projectRelativePosixPath: string,
  ) => string | undefined | Promise<string | undefined>;
  /** Exact UTF-8 byte bound. Defaults to 16 MiB. */
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface ApplicationSourceDocumentRead {
  readonly document: IndexedSourceDocument;
  readonly text: string;
  readonly complete: true;
}

interface RankedMatch {
  readonly ref: DesignRef;
  readonly anchor: SourceAnchor;
  readonly specificity: SourceSpecificity;
  readonly quality: readonly [number, number, number];
}

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
const SPECIFICITY_RANK: Record<SourceSpecificity, number> = {
  focus: 0,
  "exact-semantic-range": 1,
  "query-contained-by-anchor": 2,
  "anchor-contained-by-query": 3,
  "partial-overlap": 4,
  "whole-file": 5,
};
const RESOLUTION_RANK: Record<SourceResolution, number> = {
  symbol: 0,
  "static-flow": 1,
  "literal-name": 2,
  "name-and-footprint": 3,
  "manifest-location": 4,
  "manifest-provenance": 5,
};

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function validSourcePath(path: unknown, label: string): asserts path is string {
  if (
    typeof path !== "string" ||
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.endsWith("/") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new TypeError(`${label} must be an explicit relative POSIX file path`);
  }
}

function nonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(ordinal);
  const selected = [...expected].sort(ordinal);
  if (actual.length !== selected.length || actual.some((key, index) => key !== selected[index])) {
    throw new TypeError(`${label} has malformed fields`);
  }
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function normalizedDesignRef(value: unknown, label: string): DesignRef {
  const ref = record(value, label);
  const kind = ref.kind;
  if (
    kind !== "concept" &&
    kind !== "action" &&
    kind !== "query" &&
    kind !== "reaction" &&
    kind !== "view" &&
    kind !== "former" &&
    kind !== "computation" &&
    kind !== "endpoint"
  ) {
    throw new TypeError(`${label}.kind has an unsupported value`);
  }
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

/** Internal canonical parser shared by primitive and facade source queries. */
export function parseApplicationSourceQuery(value: unknown): ApplicationSourceQuery {
  const query = record(value, "query");
  switch (query.kind) {
    case "ref":
      exactKeys(query, ["kind", "ref"], "query");
      return { kind: "ref", ref: normalizedDesignRef(query.ref, "query.ref") };
    case "file":
      exactKeys(query, ["kind", "path"], "query");
      validSourcePath(query.path, "query.path");
      return { kind: "file", path: query.path };
    case "cursor":
      exactKeys(query, ["kind", "path", "offset"], "query");
      validSourcePath(query.path, "query.path");
      nonNegativeInteger(query.offset, "query.offset");
      return { kind: "cursor", path: query.path, offset: query.offset };
    case "range":
      exactKeys(query, ["kind", "path", "start", "end"], "query");
      validSourcePath(query.path, "query.path");
      nonNegativeInteger(query.start, "query.start");
      nonNegativeInteger(query.end, "query.end");
      if (query.end < query.start) throw new TypeError("query.end must not precede query.start");
      return { kind: "range", path: query.path, start: query.start, end: query.end };
    default:
      throw new TypeError("query.kind has an unsupported value");
  }
}

function anchorKey(anchor: SourceAnchor): string {
  return JSON.stringify([
    anchor.role,
    anchor.range.path,
    anchor.range.start.offset,
    anchor.range.end.offset,
    anchor.focusRange?.start.offset ?? -1,
    anchor.focusRange?.end.offset ?? -1,
    anchor.resolution,
  ]);
}

function querySpecificity(
  query: ApplicationSourceQuery,
  anchor: SourceAnchor,
): SourceSpecificity | undefined {
  if (query.kind === "ref") return "whole-file";
  if (anchor.range.path !== query.path) return undefined;
  if (query.kind === "file") return "whole-file";
  const start = query.kind === "cursor" ? query.offset : query.start;
  const end = query.kind === "cursor" ? query.offset : query.end;
  const point = query.kind === "cursor" || start === end;
  const overlaps = (range: SourceRange): boolean =>
    point
      ? range.start.offset <= start && start < range.end.offset
      : range.start.offset < end && start < range.end.offset;
  if (anchor.focusRange !== undefined && overlaps(anchor.focusRange)) return "focus";
  if (!overlaps(anchor.range)) return undefined;
  if (!point && start === anchor.range.start.offset && end === anchor.range.end.offset) {
    return "exact-semantic-range";
  }
  if (
    anchor.range.start.offset <= start &&
    (point ? start < anchor.range.end.offset : end <= anchor.range.end.offset)
  ) {
    return "query-contained-by-anchor";
  }
  if (!point && start <= anchor.range.start.offset && anchor.range.end.offset <= end) {
    return "anchor-contained-by-query";
  }
  return "partial-overlap";
}

function qualityKey(quality: readonly [number, number, number]): string {
  return quality.join(":");
}

/** Query plain source-index data without loading the TypeScript-backed indexer. */
export function queryApplicationSources(
  index: ApplicationSourceIndex,
  query: ApplicationSourceQuery,
  options: SourceQueryOptions = {},
): SourceQueryResult {
  const selectedQuery = parseApplicationSourceQuery(query);
  if (options.match !== undefined && options.match !== "all" && options.match !== "best") {
    throw new TypeError("match must be all or best");
  }
  if (options.roles !== undefined && !Array.isArray(options.roles)) {
    throw new TypeError("roles must be an array");
  }
  if (options.resolutions !== undefined && !Array.isArray(options.resolutions)) {
    throw new TypeError("resolutions must be an array");
  }
  const roles = options.roles === undefined ? undefined : new Set(options.roles);
  const resolutions = options.resolutions === undefined ? undefined : new Set(options.resolutions);
  for (const role of roles ?? []) {
    if (!SOURCE_ROLES.includes(role)) throw new TypeError(`unsupported source role: ${role}`);
  }
  for (const resolution of resolutions ?? []) {
    if (!SOURCE_RESOLUTIONS.includes(resolution)) {
      throw new TypeError(`unsupported source resolution: ${resolution}`);
    }
  }
  const refKey = selectedQuery.kind === "ref" ? designRefKey(selectedQuery.ref) : undefined;
  const ranked: RankedMatch[] = [];
  for (const [position, entry] of index.entries.entries()) {
    const ref = normalizedDesignRef(entry.ref, `index.entries[${position}].ref`);
    if (refKey !== undefined && designRefKey(ref) !== refKey) continue;
    for (const anchor of entry.sources) {
      if (roles !== undefined && !roles.has(anchor.role)) continue;
      if (resolutions !== undefined && !resolutions.has(anchor.resolution)) continue;
      const specificity = querySpecificity(selectedQuery, anchor);
      if (specificity === undefined) continue;
      ranked.push({
        ref,
        anchor,
        specificity,
        quality: [
          SPECIFICITY_RANK[specificity],
          specificity === "query-contained-by-anchor"
            ? anchor.range.end.offset - anchor.range.start.offset
            : 0,
          selectedQuery.kind === "ref" ? 0 : RESOLUTION_RANK[anchor.resolution],
        ],
      });
    }
  }
  ranked.sort((left, right) => {
    for (let index = 0; index < left.quality.length; index += 1) {
      const difference = left.quality[index] - right.quality[index];
      if (difference !== 0) return difference;
    }
    return (
      ordinal(designRefKey(left.ref), designRefKey(right.ref)) ||
      ordinal(anchorKey(left.anchor), anchorKey(right.anchor))
    );
  });
  const rankByQuality = new Map<string, number>();
  for (const match of ranked) {
    const key = qualityKey(match.quality);
    if (!rankByQuality.has(key)) rankByQuality.set(key, rankByQuality.size);
  }
  const matches = ranked.map(({ ref, anchor, specificity, quality }) => ({
    ref,
    anchor,
    specificity,
    rank: rankByQuality.get(qualityKey(quality))!,
  }));
  const selected =
    options.match === "best" && matches.length > 0
      ? matches.filter(({ rank }) => rank === matches[0].rank)
      : matches;
  const matchedRefs = new Set(selected.map(({ ref }) => designRefKey(ref)));
  const issues = index.issues
    .map((issue, position): SourceIndexIssue => {
      const ref =
        issue.ref === undefined
          ? undefined
          : normalizedDesignRef(issue.ref, `index.issues[${position}].ref`);
      return { ...issue, ...(ref === undefined ? {} : { ref }) };
    })
    .filter((issue) => {
      if (selectedQuery.kind === "ref") {
        return issue.ref !== undefined && designRefKey(issue.ref) === refKey;
      }
      if (issue.ref !== undefined && matchedRefs.has(designRefKey(issue.ref))) return true;
      return issue.candidates?.some(({ path }) => path === selectedQuery.path) === true;
    });
  const matchesResult = selected.map((match) => Object.freeze(match));
  return Object.freeze({
    matches: Object.freeze(matchesResult),
    complete: issues.length === 0,
    issues: Object.freeze(issues),
  });
}

/** Return every design reference with a source anchor overlapping one path range. */
export function designRefsForSourceRange(
  sourceIndex: ApplicationSourceIndex,
  query: {
    readonly path: string;
    readonly startOffset?: number;
    readonly endOffset?: number;
  },
): readonly DesignRef[] {
  validSourcePath(query.path, "path");
  if (query.startOffset !== undefined) nonNegativeInteger(query.startOffset, "startOffset");
  if (query.endOffset !== undefined) nonNegativeInteger(query.endOffset, "endOffset");
  if (
    query.startOffset !== undefined &&
    query.endOffset !== undefined &&
    query.endOffset < query.startOffset
  ) {
    throw new TypeError("endOffset must be greater than or equal to startOffset");
  }
  const sourceQuery: ApplicationSourceQuery =
    query.startOffset === undefined && query.endOffset === undefined
      ? { kind: "file", path: query.path }
      : {
          kind: "range",
          path: query.path,
          start: query.startOffset ?? 0,
          end: query.endOffset ?? Number.MAX_SAFE_INTEGER,
        };
  const matches = queryApplicationSources(sourceIndex, sourceQuery).matches;
  return Object.freeze(
    [...new Map(matches.map(({ ref }) => [designRefKey(ref), ref])).entries()]
      .sort(([left], [right]) => ordinal(left, right))
      .map(([, ref]) => ref),
  );
}

/** Read one exact indexed document, rejecting stale, missing, truncated, or oversized text. */
export async function readApplicationSourceDocument(
  index: ApplicationSourceIndex,
  path: string,
  options: ReadApplicationSourceDocumentOptions,
): Promise<ApplicationSourceDocumentRead> {
  validSourcePath(path, "path");
  if (options === null || typeof options !== "object" || typeof options.readFile !== "function") {
    throw new TypeError("readFile must be a function");
  }
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  nonNegativeInteger(maxBytes, "maxBytes");
  const aborted = (): never => {
    throw new ApplicationSourceReadError("ABORTED", "Source document read was aborted", path);
  };
  if (options.signal?.aborted === true) aborted();
  const document = index.documents.find((candidate) => candidate.path === path);
  if (document === undefined) {
    throw new ApplicationSourceReadError(
      "SOURCE_NOT_FOUND",
      `Source document is not indexed: ${path}`,
      path,
    );
  }
  if (document.byteLength > maxBytes) {
    throw new ApplicationSourceReadError(
      "SOURCE_TOO_LARGE",
      `Source document ${path} exceeds the ${maxBytes} byte limit`,
      path,
    );
  }
  let text: string | undefined;
  try {
    text = await options.readFile(path);
  } catch (cause) {
    throw new ApplicationSourceReadError(
      "SOURCE_UNREADABLE",
      `Source document could not be read: ${path}${cause instanceof Error ? ` (${cause.message})` : ""}`,
      path,
    );
  }
  if (options.signal?.aborted === true) aborted();
  if (text === undefined) {
    throw new ApplicationSourceReadError(
      "SOURCE_NOT_FOUND",
      `Source document no longer exists: ${path}`,
      path,
    );
  }
  if (typeof text !== "string") {
    throw new ApplicationSourceReadError(
      "SOURCE_UNREADABLE",
      `Source document reader returned a non-string value: ${path}`,
      path,
    );
  }
  const byteLength = Buffer.byteLength(text, "utf8");
  if (byteLength > maxBytes) {
    throw new ApplicationSourceReadError(
      "SOURCE_TOO_LARGE",
      `Source document ${path} exceeds the ${maxBytes} byte limit`,
      path,
    );
  }
  if (
    sha256(text) !== document.digest ||
    text.length !== document.length ||
    byteLength !== document.byteLength
  ) {
    throw new ApplicationSourceReadError(
      "SOURCE_CHANGED",
      `Source document changed after indexing: ${path}`,
      path,
    );
  }
  return Object.freeze({ document, text, complete: true });
}
