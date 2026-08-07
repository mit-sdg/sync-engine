import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  ANALYSIS_CORE_VERSION,
  ANALYSIS_PACKAGE_NAME,
  ANALYSIS_PACKAGE_VERSION,
} from "../package-version.ts";

export const GUIDANCE_STAGE_VALUES = [
  "design",
  "implementation",
  "verification",
  "review",
  "repair",
  "operation",
] as const;
export const GUIDANCE_AUTHORITY_VALUES = ["criteria", "procedure", "reference"] as const;
export const GUIDANCE_TOPIC_VALUES = [
  "application-model",
  "concept-design",
  "concept-boundaries",
  "state-ownership",
  "actions-queries",
  "concept-specification",
  "composition",
  "reactions",
  "reads",
  "boundaries",
  "runtime-semantics",
  "failure-recovery",
  "security",
  "generated-artifacts",
  "verification",
  "operations",
  "release-compatibility",
] as const;
export const GUIDANCE_DOCUMENT_PATH_VALUES = [
  "docs/user/design.md",
  "docs/user/guide/authoring.md",
  "docs/user/guide/persistence-recovery.md",
  "docs/user/guide/read-construction.md",
  "docs/user/guide/reviewing-a-design.md",
  "docs/user/overview.md",
  "docs/user/reference/concept-specification.md",
  "docs/user/reference/operations.md",
  "docs/user/reference/public-api.md",
  "docs/user/reference/semantics.md",
] as const;

export type GuidanceStage = (typeof GUIDANCE_STAGE_VALUES)[number];
export type GuidanceAuthority = (typeof GUIDANCE_AUTHORITY_VALUES)[number];
export type GuidanceTopic = (typeof GUIDANCE_TOPIC_VALUES)[number];

export interface GuidanceProducer {
  readonly analysis: {
    readonly name: "@mit-sdg/sync-engine-analysis";
    readonly version: string;
  };
  readonly coreVersion: string;
}

export interface GuidanceSource {
  readonly repository: "https://github.com/mit-sdg/sync-engine";
  readonly revision: string;
  readonly documentsDigest: string;
}

export interface GuidanceDocumentRecord {
  readonly path: string;
  readonly digest: string;
}

export interface GuidanceEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly anchor: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly authority: GuidanceAuthority;
  readonly topics: readonly GuidanceTopic[];
  readonly stages: readonly GuidanceStage[];
  readonly content: string;
  readonly digest: string;
}

export interface GuidanceResourceV1 {
  readonly format: "sync-engine.guidance-resource";
  readonly version: 1;
  readonly producer: GuidanceProducer;
  readonly source: GuidanceSource;
  readonly documents: readonly GuidanceDocumentRecord[];
  readonly entries: readonly GuidanceEntry[];
  readonly digest: string;
}

export type GuidanceResource = GuidanceResourceV1;

export interface GuidanceFilters {
  readonly ids?: readonly string[];
  readonly topics?: readonly GuidanceTopic[];
  readonly stages?: readonly GuidanceStage[];
  readonly authority?: readonly GuidanceAuthority[];
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly signal?: AbortSignal;
}

export interface NormalizedGuidanceFilters {
  readonly ids: readonly string[];
  readonly topics: readonly GuidanceTopic[];
  readonly stages: readonly GuidanceStage[];
  readonly authority: readonly GuidanceAuthority[];
  readonly maxEntries: number;
  readonly maxBytes: number;
}

export interface GuidanceSelectionV1 {
  readonly format: "sync-engine.guidance-selection";
  readonly version: 1;
  readonly producer: GuidanceProducer;
  readonly source: GuidanceSource;
  readonly resourceDigest: string;
  readonly filters: NormalizedGuidanceFilters;
  readonly entries: readonly GuidanceEntry[];
  readonly complete: boolean;
  readonly digest: string;
}

export type GuidanceSelection = GuidanceSelectionV1;

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const GUIDANCE_REPOSITORY = "https://github.com/mit-sdg/sync-engine";
const DEFAULT_MAX_ENTRIES = 50;
const MAX_MAX_ENTRIES = 1_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_MAX_BYTES = 4 * 1024 * 1024;
const RESOURCE_FORMAT = "sync-engine.guidance-resource";
const SELECTION_FORMAT = "sync-engine.guidance-selection";
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
let loadedResource: GuidanceResource | undefined;

function fail(path: string, message: string): never {
  throw new TypeError(`${path}: ${message}`);
}

function canonicalValue(value: unknown, path = "$", seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(path, "expected a finite number");
    return value;
  }
  if (typeof value !== "object") fail(path, "expected plain JSON data");
  if (seen.has(value)) fail(path, "contains a cycle");
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail(path, "expected a plain object");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, seen));
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort(ordinal)) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry === undefined) fail(`${path}.${key}`, "undefined is not JSON data");
      result[key] = canonicalValue(entry, `${path}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalGuidanceJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function guidanceSha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(path, "expected an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "expected an array");
  return value;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(value).sort(ordinal);
  const expected = [...keys].sort(ordinal);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(path, `expected exactly fields ${expected.join(", ")}`);
  }
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.trim() === "")) {
    fail(path, allowEmpty ? "expected a string" : "expected a non-empty string");
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(path, `expected a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "expected a boolean");
  return value;
}

function oneOf<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    fail(path, `expected one of ${allowed.join(", ")}`);
  }
  return value as Value;
}

function digest(value: unknown, path: string): string {
  const selected = string(value, path);
  if (!DIGEST.test(selected)) fail(path, "expected a lowercase SHA-256 digest");
  return selected;
}

function identifier(value: unknown, path: string): string {
  const selected = string(value, path);
  if (!ID.test(selected)) fail(path, "expected a lowercase kebab-case identifier");
  return selected;
}

function relativePath(value: unknown, path: string): string {
  const selected = string(value, path);
  if (
    selected.startsWith("/") ||
    selected.includes("\\") ||
    selected.endsWith("/") ||
    selected.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    fail(path, "expected an explicit relative POSIX file path");
  }
  return selected;
}

function sortedUnique<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
  requireEntry: boolean,
): Value[] {
  const entries = array(value, path).map((entry, index) =>
    oneOf(entry, allowed, `${path}[${index}]`),
  );
  if (requireEntry && entries.length === 0) fail(path, "expected at least one entry");
  const normalized = [...new Set(entries)].sort(ordinal);
  if (
    normalized.length !== entries.length ||
    entries.some((entry, index) => entry !== normalized[index])
  ) {
    fail(path, "expected unique entries in ordinal order");
  }
  return entries;
}

function sortedUniqueIds(value: unknown, path: string): string[] {
  const entries = array(value, path).map((entry, index) => identifier(entry, `${path}[${index}]`));
  const normalized = [...new Set(entries)].sort(ordinal);
  if (
    normalized.length !== entries.length ||
    entries.some((entry, index) => entry !== normalized[index])
  ) {
    fail(path, "expected unique identifiers in ordinal order");
  }
  return entries;
}

function validateProducer(value: unknown, path: string): GuidanceProducer {
  const producer = object(value, path);
  exact(producer, ["analysis", "coreVersion"], path);
  const analysis = object(producer.analysis, `${path}.analysis`);
  exact(analysis, ["name", "version"], `${path}.analysis`);
  if (analysis.name !== ANALYSIS_PACKAGE_NAME) {
    fail(`${path}.analysis.name`, `expected ${ANALYSIS_PACKAGE_NAME}`);
  }
  if (analysis.version !== ANALYSIS_PACKAGE_VERSION) {
    fail(`${path}.analysis.version`, `expected ${ANALYSIS_PACKAGE_VERSION}`);
  }
  if (producer.coreVersion !== ANALYSIS_CORE_VERSION) {
    fail(`${path}.coreVersion`, `expected ${ANALYSIS_CORE_VERSION}`);
  }
  return producer as unknown as GuidanceProducer;
}

function validateSource(value: unknown, path: string): GuidanceSource {
  const source = object(value, path);
  exact(source, ["repository", "revision", "documentsDigest"], path);
  if (source.repository !== GUIDANCE_REPOSITORY) {
    fail(`${path}.repository`, `expected ${GUIDANCE_REPOSITORY}`);
  }
  const documentsDigest = digest(source.documentsDigest, `${path}.documentsDigest`);
  const revision = string(source.revision, `${path}.revision`);
  if (!/^[a-f0-9]{40}$/.test(revision) && revision !== `development:${documentsDigest}`) {
    fail(
      `${path}.revision`,
      "expected an exact Git revision or the document-bound development identity",
    );
  }
  return source as unknown as GuidanceSource;
}

function validateDocument(value: unknown, path: string): GuidanceDocumentRecord {
  const document = object(value, path);
  exact(document, ["path", "digest"], path);
  relativePath(document.path, `${path}.path`);
  digest(document.digest, `${path}.digest`);
  return document as unknown as GuidanceDocumentRecord;
}

function validateEntry(value: unknown, path: string): GuidanceEntry {
  const entry = object(value, path);
  exact(
    entry,
    [
      "id",
      "title",
      "path",
      "anchor",
      "startLine",
      "endLine",
      "authority",
      "topics",
      "stages",
      "content",
      "digest",
    ],
    path,
  );
  identifier(entry.id, `${path}.id`);
  string(entry.title, `${path}.title`);
  relativePath(entry.path, `${path}.path`);
  const anchor = string(entry.anchor, `${path}.anchor`);
  if (anchor.includes("#") || /\s/.test(anchor)) {
    fail(`${path}.anchor`, "expected a URL fragment without whitespace or #");
  }
  const startLine = integer(entry.startLine, `${path}.startLine`, 1);
  const endLine = integer(entry.endLine, `${path}.endLine`, startLine);
  if (endLine < startLine) fail(`${path}.endLine`, "precedes startLine");
  oneOf(entry.authority, GUIDANCE_AUTHORITY_VALUES, `${path}.authority`);
  sortedUnique(entry.topics, GUIDANCE_TOPIC_VALUES, `${path}.topics`, true);
  sortedUnique(entry.stages, GUIDANCE_STAGE_VALUES, `${path}.stages`, true);
  const content = string(entry.content, `${path}.content`);
  const contentDigest = digest(entry.digest, `${path}.digest`);
  if (guidanceSha256(content) !== contentDigest) fail(`${path}.digest`, "does not match content");
  return entry as unknown as GuidanceEntry;
}

export function guidanceDocumentsDigest(documents: readonly GuidanceDocumentRecord[]): string {
  return guidanceSha256(canonicalGuidanceJson(documents));
}

export function computeGuidanceResourceDigest(
  resource: Omit<GuidanceResource, "digest"> | GuidanceResource,
): string {
  const { digest: _digest, ...unsigned } = resource as GuidanceResource;
  return guidanceSha256(canonicalGuidanceJson(unsigned));
}

export function computeGuidanceSelectionDigest(
  selection: Omit<GuidanceSelection, "digest"> | GuidanceSelection,
): string {
  const { digest: _digest, ...unsigned } = selection as GuidanceSelection;
  return guidanceSha256(canonicalGuidanceJson(unsigned));
}

function assertEntryOrdering(entries: readonly GuidanceEntry[], path: string): void {
  for (let index = 1; index < entries.length; index += 1) {
    if (ordinal(entries[index - 1]!.id, entries[index]!.id) >= 0) {
      fail(path, "expected unique entries in id order");
    }
  }
}

function assertNonOverlapping(entries: readonly GuidanceEntry[], path: string): void {
  const byLocation = [...entries].sort(
    (left, right) =>
      ordinal(left.path, right.path) ||
      left.startLine - right.startLine ||
      ordinal(left.id, right.id),
  );
  for (let index = 1; index < byLocation.length; index += 1) {
    const previous = byLocation[index - 1]!;
    const current = byLocation[index]!;
    if (previous.path === current.path && current.startLine <= previous.endLine) {
      fail(path, `${previous.id} and ${current.id} have overlapping source ranges`);
    }
  }
}

function validateResource(value: unknown): asserts value is GuidanceResource {
  canonicalValue(value);
  const resource = object(value, "$");
  exact(
    resource,
    ["format", "version", "producer", "source", "documents", "entries", "digest"],
    "$",
  );
  if (resource.format !== RESOURCE_FORMAT) fail("$.format", `expected ${RESOURCE_FORMAT}`);
  if (resource.version !== 1) fail("$.version", "expected version 1");
  validateProducer(resource.producer, "$.producer");
  const source = validateSource(resource.source, "$.source");
  const documents = array(resource.documents, "$.documents").map((document, index) =>
    validateDocument(document, `$.documents[${index}]`),
  );
  const documentPaths = documents.map(({ path }) => path);
  const normalizedPaths = [...new Set(documentPaths)].sort(ordinal);
  if (
    normalizedPaths.length !== documentPaths.length ||
    documentPaths.some((documentPath, index) => documentPath !== normalizedPaths[index])
  ) {
    fail("$.documents", "expected unique records in path order");
  }
  if (
    documentPaths.length !== GUIDANCE_DOCUMENT_PATH_VALUES.length ||
    documentPaths.some(
      (documentPath, index) => documentPath !== GUIDANCE_DOCUMENT_PATH_VALUES[index],
    )
  ) {
    fail("$.documents", "does not match the canonical document path catalog");
  }
  if (guidanceDocumentsDigest(documents) !== source.documentsDigest) {
    fail("$.source.documentsDigest", "does not match document records");
  }
  const knownPaths = new Set(documentPaths);
  const entries = array(resource.entries, "$.entries").map((entry, index) =>
    validateEntry(entry, `$.entries[${index}]`),
  );
  assertEntryOrdering(entries, "$.entries");
  assertNonOverlapping(entries, "$.entries");
  for (const entry of entries) {
    if (!knownPaths.has(entry.path)) fail(`$.entries.${entry.id}.path`, "is not in documents");
  }
  for (const topic of GUIDANCE_TOPIC_VALUES) {
    if (!entries.some((entry) => entry.topics.includes(topic))) {
      fail("$.entries", `does not cover guidance topic ${topic}`);
    }
  }
  for (const stage of GUIDANCE_STAGE_VALUES) {
    if (!entries.some((entry) => entry.stages.includes(stage))) {
      fail("$.entries", `does not cover guidance stage ${stage}`);
    }
  }
  const suppliedDigest = digest(resource.digest, "$.digest");
  if (computeGuidanceResourceDigest(resource as unknown as GuidanceResource) !== suppliedDigest) {
    fail("$.digest", "does not match the canonical resource");
  }
}

/** Validate an untrusted V1 canonical guidance resource and all nested digests. */
export function validateGuidanceResource(value: unknown): asserts value is GuidanceResource {
  validateResource(value);
}

/** Parse canonical or non-canonical JSON as a validated V1 guidance resource. */
export function parseGuidanceResource(source: string): GuidanceResource {
  if (typeof source !== "string") fail("source", "expected a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw new TypeError(
      `Invalid guidance resource JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  validateGuidanceResource(parsed);
  return parsed;
}

/** Render canonical stable JSON for a validated V1 guidance resource. */
export function renderGuidanceResource(resource: GuidanceResource): string {
  validateGuidanceResource(resource);
  return canonicalGuidanceJson(resource);
}

/** Recompute and return the validated resource's SHA-256 identity. */
export function guidanceResourceDigest(resource: GuidanceResource): string {
  validateGuidanceResource(resource);
  return computeGuidanceResourceDigest(resource);
}

function deepFreeze<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const selected = value as object;
  if (seen.has(selected)) return value;
  seen.add(selected);
  for (const key of Reflect.ownKeys(selected)) {
    deepFreeze((selected as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

/** Load, validate, recursively freeze, and process-cache the adjacent packaged resource. */
export async function loadGuidanceResource(): Promise<GuidanceResource> {
  if (loadedResource !== undefined) return loadedResource;
  const source = await readFile(new URL("./guidance-resource.json", import.meta.url), "utf8");
  const parsed = parseGuidanceResource(source);
  loadedResource = deepFreeze(parsed);
  return loadedResource;
}

function normalizeStringFilter(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  return [
    ...new Set(array(value, path).map((entry, index) => identifier(entry, `${path}[${index}]`))),
  ].sort(ordinal);
}

function normalizeEnumFilter<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value[] {
  if (value === undefined) return [];
  return [
    ...new Set(
      array(value, path).map((entry, index) => oneOf(entry, allowed, `${path}[${index}]`)),
    ),
  ].sort(ordinal);
}

function boundedFilter(value: unknown, fallback: number, maximum: number, path: string): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || (selected as number) < 0) {
    throw new RangeError(`${path} must be a non-negative safe integer`);
  }
  if ((selected as number) > maximum) {
    throw new RangeError(`${path} exceeds its hard maximum of ${maximum}`);
  }
  return selected as number;
}

function checkpoint(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new DOMException(
      signal.reason === undefined ? "Guidance selection was aborted" : String(signal.reason),
      "AbortError",
    );
  }
}

function normalizeFilters(value: GuidanceFilters | undefined): {
  filters: NormalizedGuidanceFilters;
  signal: AbortSignal | undefined;
} {
  const supplied = value ?? {};
  const filters = object(supplied, "filters");
  const allowed = ["ids", "topics", "stages", "authority", "maxEntries", "maxBytes", "signal"];
  const extra = Object.keys(filters).filter((key) => !allowed.includes(key));
  if (extra.length > 0) fail("filters", `unsupported fields ${extra.sort(ordinal).join(", ")}`);
  if (filters.signal !== undefined && !(filters.signal instanceof AbortSignal)) {
    fail("filters.signal", "expected an AbortSignal");
  }
  return {
    filters: {
      ids: normalizeStringFilter(filters.ids, "filters.ids"),
      topics: normalizeEnumFilter(filters.topics, GUIDANCE_TOPIC_VALUES, "filters.topics"),
      stages: normalizeEnumFilter(filters.stages, GUIDANCE_STAGE_VALUES, "filters.stages"),
      authority: normalizeEnumFilter(
        filters.authority,
        GUIDANCE_AUTHORITY_VALUES,
        "filters.authority",
      ),
      maxEntries: boundedFilter(
        filters.maxEntries,
        DEFAULT_MAX_ENTRIES,
        MAX_MAX_ENTRIES,
        "filters.maxEntries",
      ),
      maxBytes: boundedFilter(
        filters.maxBytes,
        DEFAULT_MAX_BYTES,
        MAX_MAX_BYTES,
        "filters.maxBytes",
      ),
    },
    signal: filters.signal as AbortSignal | undefined,
  };
}

function validateNormalizedFilters(value: unknown, path: string): NormalizedGuidanceFilters {
  const filters = object(value, path);
  exact(filters, ["ids", "topics", "stages", "authority", "maxEntries", "maxBytes"], path);
  sortedUniqueIds(filters.ids, `${path}.ids`);
  sortedUnique(filters.topics, GUIDANCE_TOPIC_VALUES, `${path}.topics`, false);
  sortedUnique(filters.stages, GUIDANCE_STAGE_VALUES, `${path}.stages`, false);
  sortedUnique(filters.authority, GUIDANCE_AUTHORITY_VALUES, `${path}.authority`, false);
  const maxEntries = integer(filters.maxEntries, `${path}.maxEntries`);
  const maxBytes = integer(filters.maxBytes, `${path}.maxBytes`);
  if (maxEntries > MAX_MAX_ENTRIES) fail(`${path}.maxEntries`, "exceeds the hard maximum");
  if (maxBytes > MAX_MAX_BYTES) fail(`${path}.maxBytes`, "exceeds the hard maximum");
  return filters as unknown as NormalizedGuidanceFilters;
}

function entryMatches(entry: GuidanceEntry, filters: NormalizedGuidanceFilters): boolean {
  return (
    (filters.ids.length === 0 || filters.ids.includes(entry.id)) &&
    (filters.topics.length === 0 || entry.topics.some((topic) => filters.topics.includes(topic))) &&
    (filters.stages.length === 0 || entry.stages.some((stage) => filters.stages.includes(stage))) &&
    (filters.authority.length === 0 || filters.authority.includes(entry.authority))
  );
}

function validateSelection(value: unknown): asserts value is GuidanceSelection {
  canonicalValue(value);
  const selection = object(value, "$");
  exact(
    selection,
    [
      "format",
      "version",
      "producer",
      "source",
      "resourceDigest",
      "filters",
      "entries",
      "complete",
      "digest",
    ],
    "$",
  );
  if (selection.format !== SELECTION_FORMAT) fail("$.format", `expected ${SELECTION_FORMAT}`);
  if (selection.version !== 1) fail("$.version", "expected version 1");
  validateProducer(selection.producer, "$.producer");
  validateSource(selection.source, "$.source");
  digest(selection.resourceDigest, "$.resourceDigest");
  const filters = validateNormalizedFilters(selection.filters, "$.filters");
  const entries = array(selection.entries, "$.entries").map((entry, index) =>
    validateEntry(entry, `$.entries[${index}]`),
  );
  assertEntryOrdering(entries, "$.entries");
  assertNonOverlapping(entries, "$.entries");
  if (entries.length > filters.maxEntries) fail("$.entries", "exceeds filters.maxEntries");
  const bytes = entries.reduce(
    (total, entry) => total + Buffer.byteLength(entry.content, "utf8"),
    0,
  );
  if (bytes > filters.maxBytes) fail("$.entries", "exceeds filters.maxBytes");
  if (entries.some((entry) => !entryMatches(entry, filters))) {
    fail("$.entries", "contains an entry outside the normalized filters");
  }
  boolean(selection.complete, "$.complete");
  const suppliedDigest = digest(selection.digest, "$.digest");
  if (
    computeGuidanceSelectionDigest(selection as unknown as GuidanceSelection) !== suppliedDigest
  ) {
    fail("$.digest", "does not match the canonical selection");
  }
}

/** Deterministically select a bounded prefix of entries matching normalized set filters. */
export function selectGuidance(
  resource: GuidanceResource,
  filterValue: GuidanceFilters = {},
): GuidanceSelection {
  validateGuidanceResource(resource);
  const { filters, signal } = normalizeFilters(filterValue);
  checkpoint(signal);
  const knownIds = new Set(resource.entries.map(({ id }) => id));
  const missing = filters.ids.filter((id) => !knownIds.has(id));
  if (missing.length > 0) throw new RangeError(`Unknown guidance ids: ${missing.join(", ")}`);
  const matches = resource.entries.filter((entry) => {
    checkpoint(signal);
    return entryMatches(entry, filters);
  });
  const entries: GuidanceEntry[] = [];
  let bytes = 0;
  for (const entry of matches) {
    checkpoint(signal);
    const entryBytes = Buffer.byteLength(entry.content, "utf8");
    if (entries.length >= filters.maxEntries || bytes + entryBytes > filters.maxBytes) break;
    entries.push(structuredClone(entry));
    bytes += entryBytes;
  }
  const unsigned: Omit<GuidanceSelection, "digest"> = {
    format: SELECTION_FORMAT,
    version: 1,
    producer: structuredClone(resource.producer),
    source: structuredClone(resource.source),
    resourceDigest: resource.digest,
    filters,
    entries,
    complete: entries.length === matches.length,
  };
  const selection: GuidanceSelection = {
    ...unsigned,
    digest: computeGuidanceSelectionDigest(unsigned),
  };
  validateGuidanceSelection(selection);
  return selection;
}

/** Validate an untrusted V1 guidance selection and all nested digests. */
export function validateGuidanceSelection(value: unknown): asserts value is GuidanceSelection {
  validateSelection(value);
}

/** Parse canonical or non-canonical JSON as a validated V1 guidance selection. */
export function parseGuidanceSelection(source: string): GuidanceSelection {
  if (typeof source !== "string") fail("source", "expected a string");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (cause) {
    throw new TypeError(
      `Invalid guidance selection JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  validateGuidanceSelection(parsed);
  return parsed;
}

/** Render canonical stable JSON for a validated V1 guidance selection. */
export function renderGuidanceSelection(selection: GuidanceSelection): string {
  validateGuidanceSelection(selection);
  return canonicalGuidanceJson(selection);
}

/** Recompute and return the validated selection's SHA-256 identity. */
export function guidanceSelectionDigest(selection: GuidanceSelection): string {
  validateGuidanceSelection(selection);
  return computeGuidanceSelectionDigest(selection);
}
