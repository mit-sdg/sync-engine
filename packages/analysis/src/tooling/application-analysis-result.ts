import { canonicalAnalysisDigest, canonicalAnalysisJson } from "./analysis-provenance.ts";
import { AnalysisError } from "./application-analysis-error.ts";
import type {
  AnalysisDiagnostic,
  AnalysisGuidance,
  ApplicationAnalysisIdentity,
  ApplicationAnalysisResult,
  ApplicationAnalysisResultKind,
  CanonicalGuidanceLink,
  DesignRefInput,
  DesignSummary,
  SourceMatch,
} from "./application-analysis.ts";

const RESULT_FORMAT = "sync-engine.application-analysis-result";
const KINDS: readonly ApplicationAnalysisResultKind[] = [
  "catalog",
  "search",
  "description",
  "sources",
  "impact",
  "diagnostics",
  "guidance",
  "navigation",
  "change-target",
  "contracts",
  "provenance",
  "review",
];
const COMMON_KEYS = [
  "format",
  "version",
  "kind",
  "identity",
  "provenance",
  "complete",
  "resourceUsage",
] as const;
const PAGE_KEYS = ["total", "items", "nextOffset"] as const;
const USAGE_KEYS = [
  "graphNodes",
  "graphEdges",
  "diagnostics",
  "sourceDocuments",
  "sourceAnchors",
  "sourceTextBytes",
  "astNodes",
  "projectFiles",
  "projectBytes",
] as const;

function invalid(message: string, data?: Readonly<Record<string, unknown>>): never {
  throw new AnalysisError("INVALID_FORMAT", message, data);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid(`${path} must be an object`, { path });
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${path} must be an array`, { path });
  return value;
}

function string(value: unknown, path: string, empty = false): string {
  if (typeof value !== "string" || (!empty && value.trim() === "")) {
    invalid(`${path} must be ${empty ? "a string" : "a non-empty string"}`, { path });
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(`${path} must be a boolean`, { path });
  return value;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${path} must be a finite number`, { path });
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  const selected = finite(value, path);
  if (!Number.isSafeInteger(selected) || selected < minimum) {
    invalid(`${path} must be a safe integer greater than or equal to ${minimum}`, { path });
  }
  return selected;
}

function exact(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  if (
    expected.length !== actual.length ||
    expected.some((key, position) => key !== actual[position])
  ) {
    invalid(`${path} has unsupported or missing fields`, { path, expected, actual });
  }
}

function exactWithOptional(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const extra = actual.filter((key) => !required.includes(key) && !optional.includes(key));
  if (missing.length > 0 || extra.length > 0) {
    invalid(`${path} has unsupported or missing fields`, { path, missing, extra });
  }
}

function jsonValue(value: unknown, path: string, seen = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    finite(value, path);
    return;
  }
  if (typeof value !== "object") invalid(`${path} contains a non-JSON value`, { path });
  if (seen.has(value)) invalid(`${path} contains a cycle`, { path });
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    invalid(`${path} contains a non-plain object`, { path });
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, position) => jsonValue(entry, `${path}[${position}]`, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) jsonValue(entry, `${path}.${key}`, seen);
  }
  seen.delete(value);
}

function oneOf<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    invalid(`${path} has an unsupported value`, { path, value: String(value), allowed });
  }
  return value as Value;
}

function designRef(value: unknown, path: string): asserts value is DesignRefInput {
  const ref = object(value, path);
  const kind = oneOf(
    ref.kind,
    [
      "concept",
      "action",
      "query",
      "reaction",
      "view",
      "former",
      "computation",
      "endpoint",
    ] as const,
    `${path}.kind`,
  );
  switch (kind) {
    case "concept":
      exact(ref, ["kind", "concept"], path);
      string(ref.concept, `${path}.concept`);
      return;
    case "action":
      exact(ref, ["kind", "concept", "action"], path);
      string(ref.concept, `${path}.concept`);
      string(ref.action, `${path}.action`);
      return;
    case "query":
      exact(ref, ["kind", "concept", "query"], path);
      string(ref.concept, `${path}.concept`);
      string(ref.query, `${path}.query`);
      return;
    case "reaction":
      exact(ref, ["kind", "reaction"], path);
      string(ref.reaction, `${path}.reaction`);
      return;
    case "view":
      exact(ref, ["kind", "view"], path);
      string(ref.view, `${path}.view`);
      return;
    case "former":
      exact(ref, ["kind", "former"], path);
      string(ref.former, `${path}.former`);
      return;
    case "computation":
      exact(ref, ["kind", "computation"], path);
      string(ref.computation, `${path}.computation`);
      return;
    case "endpoint":
      exact(ref, ["kind", "endpoint", "path"], path);
      string(ref.endpoint, `${path}.endpoint`);
      string(ref.path, `${path}.path`);
  }
}

function identity(value: unknown, path: string): ApplicationAnalysisIdentity {
  const result = object(value, path);
  exactWithOptional(
    result,
    ["manifestDigest", "analysisDigest", "analyzerVersion", "coreVersion"],
    ["sourceRevision", "sourceDigest"],
    path,
  );
  string(result.manifestDigest, `${path}.manifestDigest`);
  string(result.analysisDigest, `${path}.analysisDigest`);
  string(result.analyzerVersion, `${path}.analyzerVersion`);
  string(result.coreVersion, `${path}.coreVersion`);
  if ((result.sourceRevision === undefined) !== (result.sourceDigest === undefined)) {
    invalid(`${path} must carry sourceRevision and sourceDigest together`, { path });
  }
  if (result.sourceRevision !== undefined) string(result.sourceRevision, `${path}.sourceRevision`);
  if (result.sourceDigest !== undefined) string(result.sourceDigest, `${path}.sourceDigest`);
  return result as unknown as ApplicationAnalysisIdentity;
}

function provenance(
  value: unknown,
  expectedIdentity: ApplicationAnalysisIdentity,
  path: string,
): void {
  const result = object(value, path);
  exact(result, ["analyzer", "manifest"], path);
  const analyzer = object(result.analyzer, `${path}.analyzer`);
  exact(analyzer, ["name", "version"], `${path}.analyzer`);
  if (analyzer.name !== "@mit-sdg/sync-engine-analysis") {
    invalid(`${path}.analyzer.name is unsupported`, { path: `${path}.analyzer.name` });
  }
  if (analyzer.version !== expectedIdentity.analyzerVersion) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", "result analyzer identity is inconsistent", {
      identity: expectedIdentity.analyzerVersion,
      provenance: analyzer.version,
    });
  }
  const manifest = object(result.manifest, `${path}.manifest`);
  exact(manifest, ["format", "version", "digest", "generator"], `${path}.manifest`);
  if (manifest.format !== "sync-engine.application-manifest") {
    invalid(`${path}.manifest.format is unsupported`);
  }
  if (manifest.version !== 5) {
    throw new AnalysisError("UNSUPPORTED_VERSION", "result manifest provenance must be version 5", {
      version: manifest.version,
    });
  }
  if (manifest.digest !== expectedIdentity.manifestDigest) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", "result manifest identity is inconsistent", {
      identity: expectedIdentity.manifestDigest,
      provenance: manifest.digest,
    });
  }
  const generator = object(manifest.generator, `${path}.manifest.generator`);
  exact(generator, ["name", "version"], `${path}.manifest.generator`);
  string(generator.name, `${path}.manifest.generator.name`);
  if (generator.version !== expectedIdentity.coreVersion) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", "result core version is inconsistent", {
      identity: expectedIdentity.coreVersion,
      provenance: generator.version,
    });
  }
}

function resourceUsage(value: unknown, path: string): void {
  const usage = object(value, path);
  exact(usage, USAGE_KEYS, path);
  for (const key of USAGE_KEYS) integer(usage[key], `${path}.${key}`);
}

function page(value: Record<string, unknown>, path: string): void {
  const total = integer(value.total, `${path}.total`);
  const items = array(value.items, `${path}.items`);
  if (value.nextOffset !== null) {
    const next = integer(value.nextOffset, `${path}.nextOffset`);
    if (next === 0 || items.length === 0) {
      invalid(`${path}.nextOffset must advance a non-empty page`, {
        path: `${path}.nextOffset`,
      });
    }
    if (next > total) invalid(`${path}.nextOffset exceeds total`, { path: `${path}.nextOffset` });
  }
}

function summary(value: unknown, path: string): asserts value is DesignSummary {
  const item = object(value, path);
  exactWithOptional(
    item,
    [
      "ref",
      "key",
      "name",
      "qualifiedName",
      "sourceAvailability",
      "anchorCount",
      "sourcePaths",
      "diagnostics",
    ],
    ["parentConcept", "portability"],
    path,
  );
  designRef(item.ref, `${path}.ref`);
  string(item.key, `${path}.key`);
  string(item.name, `${path}.name`);
  string(item.qualifiedName, `${path}.qualifiedName`);
  if (item.parentConcept !== undefined) string(item.parentConcept, `${path}.parentConcept`);
  if (item.portability !== undefined) {
    oneOf(item.portability, ["portable", "unlowered"] as const, `${path}.portability`);
  }
  oneOf(
    item.sourceAvailability,
    ["available", "ambiguous", "unresolved", "not-indexed", "unavailable"] as const,
    `${path}.sourceAvailability`,
  );
  integer(item.anchorCount, `${path}.anchorCount`);
  array(item.sourcePaths, `${path}.sourcePaths`).forEach((entry, position) =>
    string(entry, `${path}.sourcePaths[${position}]`),
  );
  const counts = object(item.diagnostics, `${path}.diagnostics`);
  exact(counts, ["error", "warning", "info"], `${path}.diagnostics`);
  for (const severity of ["error", "warning", "info"]) {
    integer(counts[severity], `${path}.diagnostics.${severity}`);
  }
}

function range(value: unknown, path: string): void {
  const sourceRange = object(value, path);
  exact(sourceRange, ["path", "start", "end"], path);
  string(sourceRange.path, `${path}.path`);
  for (const side of ["start", "end"] as const) {
    const position = object(sourceRange[side], `${path}.${side}`);
    exact(position, ["offset", "line", "column"], `${path}.${side}`);
    integer(position.offset, `${path}.${side}.offset`);
    integer(position.line, `${path}.${side}.line`, 1);
    integer(position.column, `${path}.${side}.column`, 1);
  }
}

function sourceMatch(value: unknown, path: string): asserts value is SourceMatch {
  const match = object(value, path);
  exactWithOptional(
    match,
    ["ref", "role", "resolution", "specificity", "rank", "metadata"],
    ["text"],
    path,
  );
  designRef(match.ref, `${path}.ref`);
  oneOf(
    match.role,
    [
      "declaration",
      "canonical-contract",
      "selected-implementation",
      "selection",
      "registration",
      "specification",
    ] as const,
    `${path}.role`,
  );
  oneOf(
    match.resolution,
    [
      "symbol",
      "static-flow",
      "literal-name",
      "name-and-footprint",
      "manifest-location",
      "manifest-provenance",
    ] as const,
    `${path}.resolution`,
  );
  oneOf(
    match.specificity,
    [
      "focus",
      "exact-semantic-range",
      "query-contained-by-anchor",
      "anchor-contained-by-query",
      "partial-overlap",
      "whole-file",
    ] as const,
    `${path}.specificity`,
  );
  integer(match.rank, `${path}.rank`);
  const metadata = object(match.metadata, `${path}.metadata`);
  exactWithOptional(
    metadata,
    ["path", "range", "digest", "bytes"],
    ["document", "focusRange", "excerpt"],
    `${path}.metadata`,
  );
  string(metadata.path, `${path}.metadata.path`);
  range(metadata.range, `${path}.metadata.range`);
  string(metadata.digest, `${path}.metadata.digest`);
  integer(metadata.bytes, `${path}.metadata.bytes`);
  if (metadata.focusRange !== undefined) {
    range(metadata.focusRange, `${path}.metadata.focusRange`);
  }
  if (metadata.excerpt !== undefined) {
    const excerpt = object(metadata.excerpt, `${path}.metadata.excerpt`);
    exact(excerpt, ["range", "text", "complete"], `${path}.metadata.excerpt`);
    range(excerpt.range, `${path}.metadata.excerpt.range`);
    string(excerpt.text, `${path}.metadata.excerpt.text`, true);
    boolean(excerpt.complete, `${path}.metadata.excerpt.complete`);
  }
  if (metadata.document !== undefined) {
    const document = object(metadata.document, `${path}.metadata.document`);
    exact(document, ["path", "digest", "length", "byteLength"], `${path}.metadata.document`);
    string(document.path, `${path}.metadata.document.path`);
    string(document.digest, `${path}.metadata.document.digest`);
    integer(document.length, `${path}.metadata.document.length`);
    integer(document.byteLength, `${path}.metadata.document.byteLength`);
  }
  if (match.text !== undefined) string(match.text, `${path}.text`, true);
}

function sourceQuery(value: unknown, path: string): void {
  const query = object(value, path);
  const kind = oneOf(query.kind, ["ref", "cursor", "range", "file"] as const, `${path}.kind`);
  if (kind === "ref") {
    exact(query, ["kind", "ref"], path);
    designRef(query.ref, `${path}.ref`);
    return;
  }
  if (kind === "file") {
    exact(query, ["kind", "path"], path);
    string(query.path, `${path}.path`);
    return;
  }
  if (kind === "cursor") {
    exact(query, ["kind", "path", "offset"], path);
    string(query.path, `${path}.path`);
    integer(query.offset, `${path}.offset`);
    return;
  }
  exact(query, ["kind", "path", "start", "end"], path);
  string(query.path, `${path}.path`);
  const start = integer(query.start, `${path}.start`);
  const end = integer(query.end, `${path}.end`);
  if (end < start) invalid(`${path}.end precedes start`, { path });
}

function diagnostic(value: unknown, path: string): asserts value is AnalysisDiagnostic {
  const item = object(value, path);
  exact(item, ["id", "origin", "severity", "code", "message", "refs", "paths", "raw"], path);
  string(item.id, `${path}.id`);
  oneOf(
    item.origin,
    ["manifest", "typescript", "index", "source", "analysis"] as const,
    `${path}.origin`,
  );
  oneOf(item.severity, ["error", "warning", "info"] as const, `${path}.severity`);
  string(item.code, `${path}.code`);
  string(item.message, `${path}.message`, true);
  array(item.refs, `${path}.refs`).forEach((ref, position) =>
    designRef(ref, `${path}.refs[${position}]`),
  );
  array(item.paths, `${path}.paths`).forEach((entry, position) =>
    string(entry, `${path}.paths[${position}]`),
  );
  const raw = object(item.raw, `${path}.raw`);
  string(raw.kind, `${path}.raw.kind`);
  jsonValue(raw, `${path}.raw`);
}

function guidance(value: unknown, path: string): asserts value is AnalysisGuidance {
  const item = object(value, path);
  exact(
    item,
    ["id", "ruleId", "topic", "title", "message", "documentationPath", "refs", "diagnosticIds"],
    path,
  );
  for (const key of ["id", "ruleId", "title", "message", "documentationPath"] as const) {
    string(item[key], `${path}.${key}`);
  }
  oneOf(
    item.topic,
    ["impact", "definitions", "sources", "contracts", "ordering", "provenance"] as const,
    `${path}.topic`,
  );
  array(item.refs, `${path}.refs`).forEach((ref, position) =>
    designRef(ref, `${path}.refs[${position}]`),
  );
  array(item.diagnosticIds, `${path}.diagnosticIds`).forEach((id, position) =>
    string(id, `${path}.diagnosticIds[${position}]`),
  );
}

function canonicalGuidance(
  value: unknown,
  identityValue: ApplicationAnalysisIdentity,
  path: string,
): asserts value is CanonicalGuidanceLink | null {
  if (value === null) return;
  const link = object(value, path);
  exact(
    link,
    ["selectionDigest", "resourceDigest", "producer", "source", "entries", "complete"],
    path,
  );
  for (const key of ["selectionDigest", "resourceDigest"] as const) {
    const selected = string(link[key], `${path}.${key}`);
    if (!/^[a-f0-9]{64}$/.test(selected)) invalid(`${path}.${key} must be a SHA-256 digest`);
  }
  const producer = object(link.producer, `${path}.producer`);
  exact(producer, ["analysis", "coreVersion"], `${path}.producer`);
  const analysis = object(producer.analysis, `${path}.producer.analysis`);
  exact(analysis, ["name", "version"], `${path}.producer.analysis`);
  if (
    analysis.name !== "@mit-sdg/sync-engine-analysis" ||
    analysis.version !== identityValue.analyzerVersion ||
    producer.coreVersion !== identityValue.coreVersion
  ) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", `${path} producer identity is inconsistent`);
  }
  const source = object(link.source, `${path}.source`);
  exact(source, ["repository", "revision", "documentsDigest"], `${path}.source`);
  if (source.repository !== "https://github.com/mit-sdg/sync-engine") {
    invalid(`${path}.source.repository is unsupported`);
  }
  const revision = string(source.revision, `${path}.source.revision`);
  const documentsDigest = string(source.documentsDigest, `${path}.source.documentsDigest`);
  if (!/^[a-f0-9]{64}$/.test(documentsDigest)) {
    invalid(`${path}.source.documentsDigest must be a SHA-256 digest`);
  }
  if (!/^[a-f0-9]{40}$/.test(revision) && revision !== `development:${documentsDigest}`) {
    invalid(`${path}.source.revision is not bound to its documents`);
  }
  const ids: string[] = [];
  array(link.entries, `${path}.entries`).forEach((entry, position) => {
    const reference = object(entry, `${path}.entries[${position}]`);
    exact(reference, ["id", "path", "anchor", "digest"], `${path}.entries[${position}]`);
    ids.push(string(reference.id, `${path}.entries[${position}].id`));
    string(reference.path, `${path}.entries[${position}].path`);
    string(reference.anchor, `${path}.entries[${position}].anchor`);
    const entryDigest = string(reference.digest, `${path}.entries[${position}].digest`);
    if (!/^[a-f0-9]{64}$/.test(entryDigest)) {
      invalid(`${path}.entries[${position}].digest must be a SHA-256 digest`);
    }
  });
  const normalized = [...new Set(ids)].sort();
  if (normalized.length !== ids.length || ids.some((id, position) => id !== normalized[position])) {
    invalid(`${path}.entries must have unique IDs in ordinal order`);
  }
  boolean(link.complete, `${path}.complete`);
}

function trace(value: unknown, identityValue: ApplicationAnalysisIdentity, path: string): void {
  const item = object(value, path);
  exact(
    item,
    [
      "format",
      "version",
      "provenance",
      "manifestDigest",
      "seeds",
      "affected",
      "issues",
      "complete",
      "resourceUsage",
    ],
    path,
  );
  if (item.format !== "sync-engine.impact-trace" || item.version !== 2) {
    invalid(`${path} is not a V2 impact trace`, { path });
  }
  if (item.manifestDigest !== identityValue.manifestDigest) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", `${path} belongs to another manifest`);
  }
  provenance(item.provenance, identityValue, `${path}.provenance`);
  array(item.seeds, `${path}.seeds`).forEach((ref, position) =>
    designRef(ref, `${path}.seeds[${position}]`),
  );
  array(item.affected, `${path}.affected`).forEach((entry, position) => {
    const affected = object(entry, `${path}.affected[${position}]`);
    exact(affected, ["ref", "depth", "path"], `${path}.affected[${position}]`);
    designRef(affected.ref, `${path}.affected[${position}].ref`);
    integer(affected.depth, `${path}.affected[${position}].depth`);
    array(affected.path, `${path}.affected[${position}].path`).forEach((edge, edgePosition) => {
      const impactEdge = object(edge, `${path}.affected[${position}].path[${edgePosition}]`);
      exact(
        impactEdge,
        ["from", "to", "relation", "certainty"],
        `${path}.affected[${position}].path[${edgePosition}]`,
      );
      designRef(impactEdge.from, `${path}.affected[${position}].path[${edgePosition}].from`);
      designRef(impactEdge.to, `${path}.affected[${position}].path[${edgePosition}].to`);
      string(impactEdge.relation, `${path}.affected[${position}].path[${edgePosition}].relation`);
      string(impactEdge.certainty, `${path}.affected[${position}].path[${edgePosition}].certainty`);
    });
  });
  array(item.issues, `${path}.issues`).forEach((issue, position) =>
    jsonValue(issue, `${path}.issues[${position}]`),
  );
  boolean(item.complete, `${path}.complete`);
  resourceUsage(item.resourceUsage, `${path}.resourceUsage`);
}

function context(value: unknown, identityValue: ApplicationAnalysisIdentity, path: string): void {
  const item = object(value, path);
  if (item.format !== "sync-engine.impact-context" || item.version !== 2) {
    invalid(`${path} is not a V2 impact context`, { path });
  }
  if (item.manifestDigest !== identityValue.manifestDigest) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", `${path} belongs to another manifest`);
  }
  provenance(item.provenance, identityValue, `${path}.provenance`);
  const complete = boolean(item.complete, `${path}.complete`);
  array(item.selection, `${path}.selection`).forEach((selection, position) => {
    const entry = object(selection, `${path}.selection[${position}]`);
    exact(entry, ["ref", "roles"], `${path}.selection[${position}]`);
    designRef(entry.ref, `${path}.selection[${position}].ref`);
    array(entry.roles, `${path}.selection[${position}].roles`).forEach((role, rolePosition) =>
      oneOf(
        role,
        ["seed", "affected", "support"] as const,
        `${path}.selection[${position}].roles[${rolePosition}]`,
      ),
    );
  });
  trace(item.trace, identityValue, `${path}.trace`);
  if (object(item.trace, `${path}.trace`).complete !== complete) {
    throw new AnalysisError("SNAPSHOT_MISMATCH", `${path} completeness differs from its trace`);
  }
  resourceUsage(item.resourceUsage, `${path}.resourceUsage`);
  jsonValue(item, path);
}

function validateKind(
  value: Record<string, unknown>,
  kind: ApplicationAnalysisResultKind,
  identityValue: ApplicationAnalysisIdentity,
  path: string,
): void {
  const keys = (...specific: string[]) => exact(value, [...COMMON_KEYS, ...specific], path);
  const keysOptional = (required: string[], optional: string[]) =>
    exactWithOptional(value, [...COMMON_KEYS, ...required], optional, path);
  switch (kind) {
    case "catalog":
      keys(...PAGE_KEYS);
      page(value, path);
      array(value.items, `${path}.items`).forEach((item, position) =>
        summary(item, `${path}.items[${position}]`),
      );
      return;
    case "search": {
      keys("query", "fields", ...PAGE_KEYS);
      string(value.query, `${path}.query`);
      const fields = array(value.fields, `${path}.fields`).map((field, position) =>
        oneOf(
          field,
          ["identity", "contract", "rendered", "source-path", "source-text"] as const,
          `${path}.fields[${position}]`,
        ),
      );
      if (fields.length === 0) invalid(`${path}.fields must not be empty`);
      page(value, path);
      array(value.items, `${path}.items`).forEach((hit, position) => {
        const item = object(hit, `${path}.items[${position}]`);
        exact(
          item,
          [
            "ref",
            "key",
            "qualifiedName",
            "rank",
            "matchedField",
            "snippet",
            "truncatedStart",
            "truncatedEnd",
          ],
          `${path}.items[${position}]`,
        );
        designRef(item.ref, `${path}.items[${position}].ref`);
        string(item.key, `${path}.items[${position}].key`);
        string(item.qualifiedName, `${path}.items[${position}].qualifiedName`);
        integer(item.rank, `${path}.items[${position}].rank`);
        const matchedField = oneOf(
          item.matchedField,
          ["identity", "contract", "rendered", "source-path", "source-text"] as const,
          `${path}.items[${position}].matchedField`,
        );
        if (!fields.includes(matchedField)) {
          invalid(`${path}.items[${position}].matchedField was not searched`);
        }
        string(item.snippet, `${path}.items[${position}].snippet`, true);
        boolean(item.truncatedStart, `${path}.items[${position}].truncatedStart`);
        boolean(item.truncatedEnd, `${path}.items[${position}].truncatedEnd`);
      });
      return;
    }
    case "description": {
      const detail = oneOf(
        value.detail,
        ["summary", "definition", "full"] as const,
        `${path}.detail`,
      );
      const required = ["ref", "detail", "summary"];
      if (detail === "definition") required.push("definition");
      if (detail === "full") required.push("definition", "sources", "diagnostics");
      keys(...required);
      designRef(value.ref, `${path}.ref`);
      summary(value.summary, `${path}.summary`);
      if (value.definition !== undefined) {
        const definition = object(value.definition, `${path}.definition`);
        oneOf(
          definition.kind,
          [
            "concept",
            "action",
            "query",
            "reaction",
            "view",
            "former",
            "computation",
            "endpoint",
          ] as const,
          `${path}.definition.kind`,
        );
        jsonValue(definition, `${path}.definition`);
      }
      if (value.sources !== undefined) {
        array(value.sources, `${path}.sources`).forEach((match, position) => {
          sourceMatch(match, `${path}.sources[${position}]`);
          if (!Object.hasOwn(object(match, `${path}.sources[${position}]`), "text")) {
            invalid(`${path}.sources[${position}] omits full source text`);
          }
        });
      }
      if (value.diagnostics !== undefined) {
        array(value.diagnostics, `${path}.diagnostics`).forEach((item, position) =>
          diagnostic(item, `${path}.diagnostics[${position}]`),
        );
      }
      return;
    }
    case "sources": {
      keys("query", "content", "match", "issues", ...PAGE_KEYS);
      sourceQuery(value.query, `${path}.query`);
      const content = oneOf(value.content, ["metadata", "text"] as const, `${path}.content`);
      oneOf(value.match, ["all", "best"] as const, `${path}.match`);
      array(value.issues, `${path}.issues`).forEach((item, position) =>
        diagnostic(item, `${path}.issues[${position}]`),
      );
      page(value, path);
      array(value.items, `${path}.items`).forEach((item, position) => {
        sourceMatch(item, `${path}.items[${position}]`);
        const source = object(item, `${path}.items[${position}]`);
        if (content === "text" && !Object.hasOwn(source, "text")) {
          invalid(`${path}.items[${position}] omits requested source text`);
        }
        if (content === "metadata" && Object.hasOwn(source, "text")) {
          invalid(`${path}.items[${position}] includes unrequested source text`);
        }
      });
      return;
    }
    case "impact":
      keysOptional(["trace", "diagnostics"], ["context"]);
      trace(value.trace, identityValue, `${path}.trace`);
      if (object(value.trace, `${path}.trace`).complete !== value.complete) {
        throw new AnalysisError("SNAPSHOT_MISMATCH", "impact result completeness is inconsistent");
      }
      if (value.context !== undefined) context(value.context, identityValue, `${path}.context`);
      array(value.diagnostics, `${path}.diagnostics`).forEach((item, position) =>
        diagnostic(item, `${path}.diagnostics[${position}]`),
      );
      return;
    case "diagnostics":
      keys(...PAGE_KEYS);
      page(value, path);
      array(value.items, `${path}.items`).forEach((item, position) =>
        diagnostic(item, `${path}.items[${position}]`),
      );
      return;
    case "guidance":
      keys("canonicalGuidance", ...PAGE_KEYS);
      canonicalGuidance(value.canonicalGuidance, identityValue, `${path}.canonicalGuidance`);
      page(value, path);
      array(value.items, `${path}.items`).forEach((item, position) =>
        guidance(item, `${path}.items[${position}]`),
      );
      return;
    case "navigation":
      keys("ref", "direction", "nodes", "edges", "diagnostics");
      designRef(value.ref, `${path}.ref`);
      oneOf(value.direction, ["incoming", "outgoing", "both"] as const, `${path}.direction`);
      array(value.nodes, `${path}.nodes`).forEach((node, position) => {
        const item = object(node, `${path}.nodes[${position}]`);
        exact(item, ["ref", "distance"], `${path}.nodes[${position}]`);
        designRef(item.ref, `${path}.nodes[${position}].ref`);
        integer(item.distance, `${path}.nodes[${position}].distance`);
      });
      array(value.edges, `${path}.edges`).forEach((edge, position) =>
        jsonValue(object(edge, `${path}.edges[${position}]`), `${path}.edges[${position}]`),
      );
      array(value.diagnostics, `${path}.diagnostics`).forEach((item, position) =>
        diagnostic(item, `${path}.diagnostics[${position}]`),
      );
      return;
    case "change-target":
      keys("seeds", "impact", "context", "sourceAvailability", "files", "diagnostics", "guidance");
      array(value.seeds, `${path}.seeds`).forEach((ref, position) =>
        designRef(ref, `${path}.seeds[${position}]`),
      );
      trace(value.impact, identityValue, `${path}.impact`);
      if (object(value.impact, `${path}.impact`).complete !== value.complete) {
        throw new AnalysisError("SNAPSHOT_MISMATCH", "change target completeness is inconsistent");
      }
      context(value.context, identityValue, `${path}.context`);
      oneOf(
        value.sourceAvailability,
        ["available", "unavailable"] as const,
        `${path}.sourceAvailability`,
      );
      array(value.files, `${path}.files`).forEach((file, position) =>
        jsonValue(object(file, `${path}.files[${position}]`), `${path}.files[${position}]`),
      );
      array(value.diagnostics, `${path}.diagnostics`).forEach((item, position) =>
        diagnostic(item, `${path}.diagnostics[${position}]`),
      );
      array(value.guidance, `${path}.guidance`).forEach((item, position) =>
        guidance(item, `${path}.guidance[${position}]`),
      );
      return;
    case "contracts": {
      const detail = oneOf(
        value.detail,
        ["summary", "data", "rendered"] as const,
        `${path}.detail`,
      );
      keys(
        "detail",
        "appWide",
        "projectionEvidence",
        "projections",
        ...(detail === "rendered" ? ["rendered"] : []),
        "guidance",
        ...PAGE_KEYS,
      );
      array(value.appWide, `${path}.appWide`).forEach((entry, position) =>
        string(entry, `${path}.appWide[${position}]`),
      );
      const projectionEvidence = oneOf(
        value.projectionEvidence,
        ["none", "caller-supplied"] as const,
        `${path}.projectionEvidence`,
      );
      const projections = array(value.projections, `${path}.projections`);
      projections.forEach((entry, position) =>
        jsonValue(entry, `${path}.projections[${position}]`),
      );
      if (projectionEvidence === "none" && projections.length > 0) {
        invalid(`${path}.projections conflicts with projectionEvidence`);
      }
      if (value.rendered !== undefined)
        jsonValue(object(value.rendered, `${path}.rendered`), `${path}.rendered`);
      array(value.guidance, `${path}.guidance`).forEach((item, position) =>
        guidance(item, `${path}.guidance[${position}]`),
      );
      page(value, path);
      array(value.items, `${path}.items`).forEach((entry, position) =>
        jsonValue(object(entry, `${path}.items[${position}]`), `${path}.items[${position}]`),
      );
      return;
    }
    case "provenance":
      keys("facts", ...PAGE_KEYS);
      jsonValue(object(value.facts, `${path}.facts`), `${path}.facts`);
      page(value, path);
      array(value.items, `${path}.items`).forEach((entry, position) =>
        jsonValue(object(entry, `${path}.items[${position}]`), `${path}.items[${position}]`),
      );
      return;
    case "review":
      keysOptional(
        [
          "beforeIdentity",
          "designChanges",
          "fileChanges",
          "contractChanges",
          "introducedDiagnostics",
          "resolvedDiagnostics",
          "beforeImpact",
          "afterImpact",
          "observations",
          "guidance",
          "coverage",
        ],
        ["targetDrift"],
      );
      identity(value.beforeIdentity, `${path}.beforeIdentity`);
      for (const key of ["designChanges", "fileChanges", "contractChanges"] as const) {
        array(value[key], `${path}.${key}`).forEach((entry, position) =>
          jsonValue(object(entry, `${path}.${key}[${position}]`), `${path}.${key}[${position}]`),
        );
      }
      array(value.introducedDiagnostics, `${path}.introducedDiagnostics`).forEach(
        (item, position) => diagnostic(item, `${path}.introducedDiagnostics[${position}]`),
      );
      array(value.resolvedDiagnostics, `${path}.resolvedDiagnostics`).forEach((item, position) =>
        diagnostic(item, `${path}.resolvedDiagnostics[${position}]`),
      );
      trace(
        value.beforeImpact,
        identity(value.beforeIdentity, `${path}.beforeIdentity`),
        `${path}.beforeImpact`,
      );
      trace(value.afterImpact, identityValue, `${path}.afterImpact`);
      if (value.targetDrift !== undefined)
        jsonValue(object(value.targetDrift, `${path}.targetDrift`), `${path}.targetDrift`);
      array(value.observations, `${path}.observations`).forEach((entry, position) =>
        string(entry, `${path}.observations[${position}]`),
      );
      array(value.guidance, `${path}.guidance`).forEach((item, position) =>
        guidance(item, `${path}.guidance[${position}]`),
      );
      jsonValue(object(value.coverage, `${path}.coverage`), `${path}.coverage`);
  }
}

function validate(value: unknown, roundTrip: boolean): asserts value is ApplicationAnalysisResult {
  jsonValue(value, "$");
  const result = object(value, "$");
  if (result.format !== RESULT_FORMAT) {
    throw new AnalysisError(
      "INVALID_FORMAT",
      "application analysis result has an unsupported format",
      {
        format: String(result.format),
      },
    );
  }
  if (result.version !== 1) {
    throw new AnalysisError(
      "UNSUPPORTED_VERSION",
      "application analysis result must be version 1",
      {
        version: result.version,
      },
    );
  }
  const kind = oneOf(result.kind, KINDS, "$.kind");
  const identityValue = identity(result.identity, "$.identity");
  provenance(result.provenance, identityValue, "$.provenance");
  boolean(result.complete, "$.complete");
  resourceUsage(result.resourceUsage, "$.resourceUsage");
  validateKind(result, kind, identityValue, "$");
  if (!roundTrip) return;
  const rendered = canonicalAnalysisJson(result);
  const parsed = JSON.parse(rendered) as unknown;
  validate(parsed, false);
  if (canonicalAnalysisJson(parsed) !== rendered) {
    invalid("application analysis result failed its canonical JSON round trip");
  }
  if (canonicalAnalysisDigest(parsed) !== canonicalAnalysisDigest(result)) {
    invalid("application analysis result failed its canonical digest round trip");
  }
}

/** Validate an untrusted persisted granular analysis result. */
export function validateApplicationAnalysisResult(
  value: unknown,
): asserts value is ApplicationAnalysisResult {
  validate(value, true);
}

/** Parse and validate canonical or non-canonical JSON for one granular result. */
export function parseApplicationAnalysisResult(source: string): ApplicationAnalysisResult {
  if (typeof source !== "string") {
    throw new AnalysisError(
      "INVALID_ARGUMENT",
      "application analysis result source must be a string",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw new AnalysisError("INVALID_FORMAT", "Invalid application analysis result JSON", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  validateApplicationAnalysisResult(value);
  return value;
}

/** Render canonical stable JSON for one validated granular result. */
export function renderApplicationAnalysisResult(result: ApplicationAnalysisResult): string {
  validateApplicationAnalysisResult(result);
  return canonicalAnalysisJson(result);
}

/** SHA-256 over canonical stable JSON for one validated granular result. */
export function applicationAnalysisResultDigest(result: ApplicationAnalysisResult): string {
  validateApplicationAnalysisResult(result);
  return canonicalAnalysisDigest(result);
}
