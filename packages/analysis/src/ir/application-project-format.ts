import { createHash } from "node:crypto";
import type { ApplicationDiagnostic } from "@mit-sdg/sync-engine/tooling";
import { ANALYSIS_PACKAGE_NAME } from "../package-version.ts";
import {
  designRefKey,
  type AnalysisIssue,
  type ApplicationIndex,
  type DesignRef,
  type ImpactEdge,
} from "./application-impact.ts";
import { AnalysisError } from "./application-analysis-error.ts";
import type { AnalysisResourceUsage } from "./analysis-foundation.ts";
import type {
  ApplicationProjectAnalysis,
  ApplicationProjectDiagnostic,
  ApplicationProjectDiagnosticRelatedInformation,
} from "./project-data.ts";
import {
  canonicalAnalysisDigest,
  canonicalAnalysisJson,
  freezeAnalysisData,
  type AnalysisProvenance,
} from "./analysis-provenance.ts";
import type {
  ApplicationSourceIndex,
  SourceAnchor,
  SourceIndexIssue,
  SourceRange,
} from "./source-data.ts";

type DataRecord = Record<string, unknown>;

const HASH = /^[a-f0-9]{64}$/;
const MANIFEST_HASH = /^fnv1a64-[a-f0-9]{16}$/;
const SEVERITIES = ["error", "warning", "info"] as const;
const USAGE_KEYS = [
  "graphNodes",
  "graphEdges",
  "diagnostics",
  "sourceDocuments",
  "sourceAnchors",
  "astNodes",
  "projectFiles",
  "projectBytes",
] as const;
const PHASE_RANK = { config: 0, options: 1, global: 2, syntactic: 3, semantic: 4 } as const;
const CATEGORY_SEVERITY = {
  warning: "warning",
  error: "error",
  suggestion: "info",
  message: "info",
} as const;
const SOURCE_ROLES = [
  "declaration",
  "canonical-contract",
  "selected-implementation",
  "selection",
  "registration",
  "specification",
] as const;
const SOURCE_RESOLUTIONS = [
  "symbol",
  "static-flow",
  "literal-name",
  "name-and-footprint",
  "manifest-location",
  "manifest-provenance",
] as const;
const SOURCE_ISSUE_CODES = [
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
] as const;
const INDEX_ISSUE_CODES = [
  "OPAQUE_DEFINITION",
  "UNRESOLVED_ENDPOINT_STAGE",
  "UNKNOWN_REFERENCE",
  "UNKNOWN_SEED",
  "TRACE_LIMIT_REACHED",
] as const;
const IMPACT_RELATIONS = [
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
] as const;
const MANIFEST_DIAGNOSTIC_CODES = [
  "UNLOWERED_REACTION",
  "UNLOWERED_ENDPOINT",
  "OPAQUE_READ_OPERATION",
  "OPAQUE_PATTERN",
  "UNRESOLVED_WIRE_LEAF",
  "ENDPOINT_PATH_OVERLAP",
  "MISSING_ENDPOINT_FALLBACK",
  "ORDER_SENSITIVE_FORMER",
] as const;

function fail(
  message: string,
  path = "$",
  code: "INVALID_FORMAT" | "UNSUPPORTED_VERSION" | "SNAPSHOT_MISMATCH" = "INVALID_FORMAT",
): never {
  throw new AnalysisError(code, message, { path });
}

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function object(value: unknown, path: string): DataRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`, path);
  }
  return value as DataRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`, path);
  return value;
}

function exact(
  value: DataRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const extra = Object.keys(value).filter(
    (key) => !required.includes(key) && !optional.includes(key),
  );
  if (missing.length > 0 || extra.length > 0) {
    fail(`${path} has unsupported or missing fields`, path);
  }
}

function string(value: unknown, path: string, empty = false): string {
  if (typeof value !== "string" || (!empty && value.trim().length === 0)) {
    fail(`${path} must be ${empty ? "a string" : "a non-empty string"}`, path);
  }
  return value;
}

function integer(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    fail(`${path} must be a safe integer greater than or equal to ${minimum}`, path);
  }
  return value as number;
}

function oneOf<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    fail(`${path} has an unsupported value`, path);
  }
  return value as Value;
}

function hash(value: unknown, path: string): string {
  const selected = string(value, path);
  if (!HASH.test(selected)) fail(`${path} must be a lowercase SHA-256 digest`, path);
  return selected;
}

function manifestHash(value: unknown, path: string): string {
  const selected = string(value, path);
  if (!MANIFEST_HASH.test(selected)) fail(`${path} must be a canonical manifest digest`, path);
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
    fail(`${path} must be an explicit relative POSIX path`, path);
  }
  return selected;
}

function jsonValue(value: unknown, path: string, active = new WeakSet<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`, path);
    return;
  }
  if (typeof value !== "object") fail(`${path} contains a non-JSON value`, path);
  if (active.has(value)) fail(`${path} contains a cycle`, path);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    fail(`${path} contains a non-plain object`, path);
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index))
          fail(`${path} contains an array hole`, `${path}[${index}]`);
        jsonValue(value[index], `${path}[${index}]`, active);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
          fail(`${path} has unsupported array fields`, path);
        }
      }
      return;
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") fail(`${path} contains a symbol field`, path);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) {
        fail(`${path}.${key} must be an enumerable data field`, `${path}.${key}`);
      }
      jsonValue(descriptor.value, `${path}.${key}`, active);
    }
  } finally {
    active.delete(value);
  }
}

function orderedUnique<Value>(
  values: readonly Value[],
  key: (value: Value) => string,
  path: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (ordinal(key(values[index - 1]), key(values[index])) >= 0) {
      fail(`${path} must be strictly ordered without duplicates`, `${path}[${index}]`);
    }
  }
}

function same(left: unknown, right: unknown): boolean {
  return canonicalAnalysisJson(left) === canonicalAnalysisJson(right);
}

function provenance(value: unknown, path: string): AnalysisProvenance {
  const result = object(value, path);
  exact(result, ["analyzer", "manifest"], [], path);
  const analyzer = object(result.analyzer, `${path}.analyzer`);
  exact(analyzer, ["name", "version"], [], `${path}.analyzer`);
  if (analyzer.name !== ANALYSIS_PACKAGE_NAME) {
    fail(`${path}.analyzer has an unsupported name`, `${path}.analyzer.name`);
  }
  string(analyzer.version, `${path}.analyzer.version`);
  const manifest = object(result.manifest, `${path}.manifest`);
  exact(manifest, ["format", "version", "digest", "generator"], [], `${path}.manifest`);
  if (manifest.format !== "sync-engine.application-manifest") {
    fail(`${path}.manifest has an unsupported format`, `${path}.manifest.format`);
  }
  if (manifest.version !== 5) {
    fail(`${path}.manifest must be version 5`, `${path}.manifest.version`, "UNSUPPORTED_VERSION");
  }
  manifestHash(manifest.digest, `${path}.manifest.digest`);
  const generator = object(manifest.generator, `${path}.manifest.generator`);
  exact(generator, ["name", "version"], [], `${path}.manifest.generator`);
  if (generator.name !== "@mit-sdg/sync-engine") {
    fail(`${path}.manifest.generator has an unsupported name`, `${path}.manifest.generator.name`);
  }
  string(generator.version, `${path}.manifest.generator.version`);
  return result as unknown as AnalysisProvenance;
}

function resourceUsage(value: unknown, path: string): AnalysisResourceUsage {
  const usage = object(value, path);
  exact(usage, USAGE_KEYS, [], path);
  for (const key of USAGE_KEYS) integer(usage[key], `${path}.${key}`);
  return usage as unknown as AnalysisResourceUsage;
}

function ref(value: unknown, path: string): DesignRef {
  const result = object(value, path);
  const kind = oneOf(
    result.kind,
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
      exact(result, ["kind", "concept"], [], path);
      string(result.concept, `${path}.concept`);
      break;
    case "action":
      exact(result, ["kind", "concept", "action"], [], path);
      string(result.concept, `${path}.concept`);
      string(result.action, `${path}.action`);
      break;
    case "query":
      exact(result, ["kind", "concept", "query"], [], path);
      string(result.concept, `${path}.concept`);
      string(result.query, `${path}.query`);
      break;
    case "reaction":
      exact(result, ["kind", "reaction"], [], path);
      string(result.reaction, `${path}.reaction`);
      break;
    case "view":
      exact(result, ["kind", "view"], [], path);
      string(result.view, `${path}.view`);
      break;
    case "former":
      exact(result, ["kind", "former"], [], path);
      string(result.former, `${path}.former`);
      break;
    case "computation":
      exact(result, ["kind", "computation"], [], path);
      string(result.computation, `${path}.computation`);
      break;
    case "endpoint":
      exact(result, ["kind", "endpoint", "path"], [], path);
      string(result.endpoint, `${path}.endpoint`);
      string(result.path, `${path}.path`);
  }
  return result as unknown as DesignRef;
}

function edgeKey(edge: ImpactEdge): string {
  return JSON.stringify([
    designRefKey(edge.from),
    designRefKey(edge.to),
    edge.relation,
    edge.certainty,
  ]);
}

function issueKey(issue: AnalysisIssue): string {
  return JSON.stringify([
    issue.code,
    issue.severity,
    issue.ref === undefined ? "" : designRefKey(issue.ref),
    issue.message,
    issue.suggestions?.map(designRefKey) ?? [],
  ]);
}

function applicationIndex(
  value: unknown,
  expectedProvenance: AnalysisProvenance,
  manifestDigest: string,
  path: string,
): ApplicationIndex {
  const index = object(value, path);
  exact(
    index,
    [
      "format",
      "version",
      "provenance",
      "manifestDigest",
      "inventory",
      "referencedOnly",
      "nodes",
      "edges",
      "issues",
      "resourceUsage",
    ],
    [],
    path,
  );
  if (index.format !== "sync-engine.application-index")
    fail(`${path} has an unsupported format`, path);
  if (index.version !== 2)
    fail(`${path} must be version 2`, `${path}.version`, "UNSUPPORTED_VERSION");
  const indexProvenance = provenance(index.provenance, `${path}.provenance`);
  if (!same(indexProvenance, expectedProvenance) || index.manifestDigest !== manifestDigest) {
    fail(`${path} provenance does not match the project`, path, "SNAPSHOT_MISMATCH");
  }
  const refs = (key: "inventory" | "referencedOnly" | "nodes"): DesignRef[] => {
    const values = array(index[key], `${path}.${key}`).map((entry, position) =>
      ref(entry, `${path}.${key}[${position}]`),
    );
    orderedUnique(values, designRefKey, `${path}.${key}`);
    return values;
  };
  const inventory = refs("inventory");
  const referencedOnly = refs("referencedOnly");
  const nodes = refs("nodes");
  const inventoryKeys = new Set(inventory.map(designRefKey));
  if (referencedOnly.some((item) => inventoryKeys.has(designRefKey(item)))) {
    fail(
      `${path}.referencedOnly overlaps inventory`,
      `${path}.referencedOnly`,
      "SNAPSHOT_MISMATCH",
    );
  }
  const expectedNodes = [...inventory, ...referencedOnly].sort((left, right) =>
    ordinal(designRefKey(left), designRefKey(right)),
  );
  if (!same(nodes, expectedNodes)) {
    fail(`${path}.nodes is not the exact inventory union`, `${path}.nodes`, "SNAPSHOT_MISMATCH");
  }
  const nodeKeys = new Set(nodes.map(designRefKey));
  const edges = array(index.edges, `${path}.edges`).map((entry, position): ImpactEdge => {
    const edge = object(entry, `${path}.edges[${position}]`);
    exact(edge, ["from", "to", "relation", "certainty"], [], `${path}.edges[${position}]`);
    const from = ref(edge.from, `${path}.edges[${position}].from`);
    const to = ref(edge.to, `${path}.edges[${position}].to`);
    if (!nodeKeys.has(designRefKey(from)) || !nodeKeys.has(designRefKey(to))) {
      fail(`${path}.edges[${position}] references an unknown node`, `${path}.edges[${position}]`);
    }
    const relation = oneOf(edge.relation, IMPACT_RELATIONS, `${path}.edges[${position}].relation`);
    const certainty = oneOf(
      edge.certainty,
      ["structural", "conservative", "opaque"] as const,
      `${path}.edges[${position}].certainty`,
    );
    return { from, to, relation, certainty };
  });
  orderedUnique(edges, edgeKey, `${path}.edges`);
  const issues = array(index.issues, `${path}.issues`).map((entry, position): AnalysisIssue => {
    const issue = object(entry, `${path}.issues[${position}]`);
    exact(
      issue,
      ["code", "severity", "message"],
      ["ref", "suggestions"],
      `${path}.issues[${position}]`,
    );
    const code = oneOf(issue.code, INDEX_ISSUE_CODES, `${path}.issues[${position}].code`);
    const severity = oneOf(issue.severity, SEVERITIES, `${path}.issues[${position}].severity`);
    const message = string(issue.message, `${path}.issues[${position}].message`, true);
    const selectedRef =
      issue.ref === undefined ? undefined : ref(issue.ref, `${path}.issues[${position}].ref`);
    const suggestions =
      issue.suggestions === undefined
        ? undefined
        : array(issue.suggestions, `${path}.issues[${position}].suggestions`).map(
            (suggestion, suggestionPosition) =>
              ref(suggestion, `${path}.issues[${position}].suggestions[${suggestionPosition}]`),
          );
    if (
      suggestions !== undefined &&
      new Set(suggestions.map(designRefKey)).size !== suggestions.length
    ) {
      fail(
        `${path}.issues[${position}].suggestions contains duplicates`,
        `${path}.issues[${position}].suggestions`,
      );
    }
    return {
      code,
      severity,
      message,
      ...(selectedRef === undefined ? {} : { ref: selectedRef }),
      ...(suggestions === undefined ? {} : { suggestions }),
    };
  });
  orderedUnique(issues, issueKey, `${path}.issues`);
  const usage = resourceUsage(index.resourceUsage, `${path}.resourceUsage`);
  if (
    usage.graphNodes !== nodes.length ||
    usage.graphEdges !== edges.length ||
    usage.diagnostics !== issues.length ||
    usage.sourceDocuments !== 0 ||
    usage.sourceAnchors !== 0 ||
    usage.astNodes !== 0 ||
    usage.projectFiles !== 0 ||
    usage.projectBytes !== 0
  ) {
    fail(`${path}.resourceUsage is inconsistent`, `${path}.resourceUsage`, "SNAPSHOT_MISMATCH");
  }
  return index as unknown as ApplicationIndex;
}

function range(value: unknown, path: string): SourceRange {
  const result = object(value, path);
  exact(result, ["path", "start", "end"], [], path);
  relativePath(result.path, `${path}.path`);
  const positions = ["start", "end"] as const;
  for (const side of positions) {
    const position = object(result[side], `${path}.${side}`);
    exact(position, ["offset", "line", "column"], [], `${path}.${side}`);
    integer(position.offset, `${path}.${side}.offset`);
    integer(position.line, `${path}.${side}.line`, 1);
    integer(position.column, `${path}.${side}.column`, 1);
  }
  const selected = result as unknown as SourceRange;
  if (
    selected.end.offset < selected.start.offset ||
    selected.end.line < selected.start.line ||
    (selected.end.line === selected.start.line && selected.end.column < selected.start.column)
  ) {
    fail(`${path} is reversed`, path);
  }
  return selected;
}

function rangeKey(value: SourceRange): string {
  return `${value.path}:${value.start.offset}:${value.end.offset}`;
}

function containsRange(outer: SourceRange, inner: SourceRange): boolean {
  return (
    outer.path === inner.path &&
    outer.start.offset <= inner.start.offset &&
    inner.end.offset <= outer.end.offset
  );
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

function sourceIssueKey(issue: SourceIndexIssue): string {
  return JSON.stringify([
    issue.code,
    issue.severity,
    issue.ref === undefined ? "" : designRefKey(issue.ref),
    issue.role ?? "",
    issue.message,
    issue.candidates?.map(rangeKey) ?? [],
  ]);
}

function sourceIndex(
  value: unknown,
  expectedProvenance: AnalysisProvenance,
  manifestDigest: string,
  index: ApplicationIndex,
  files: ReadonlyMap<string, { readonly digest: string; readonly byteLength: number }>,
  typescriptVersion: string,
  path: string,
): ApplicationSourceIndex {
  const source = object(value, path);
  exact(
    source,
    [
      "format",
      "version",
      "provenance",
      "manifestDigest",
      "typescriptVersion",
      "documents",
      "entries",
      "issues",
      "resourceUsage",
    ],
    [],
    path,
  );
  if (source.format !== "sync-engine.application-source-index")
    fail(`${path} has an unsupported format`, path);
  if (source.version !== 2)
    fail(`${path} must be version 2`, `${path}.version`, "UNSUPPORTED_VERSION");
  const sourceProvenance = provenance(source.provenance, `${path}.provenance`);
  if (!same(sourceProvenance, expectedProvenance) || source.manifestDigest !== manifestDigest) {
    fail(`${path} provenance does not match the project`, path, "SNAPSHOT_MISMATCH");
  }
  if (source.typescriptVersion !== typescriptVersion) {
    fail(
      `${path} TypeScript version differs from project provenance`,
      `${path}.typescriptVersion`,
      "SNAPSHOT_MISMATCH",
    );
  }
  const documents = array(source.documents, `${path}.documents`).map((entry, position) => {
    const document = object(entry, `${path}.documents[${position}]`);
    exact(
      document,
      ["path", "digest", "length", "byteLength"],
      [],
      `${path}.documents[${position}]`,
    );
    const documentPath = relativePath(document.path, `${path}.documents[${position}].path`);
    const documentDigest = hash(document.digest, `${path}.documents[${position}].digest`);
    integer(document.length, `${path}.documents[${position}].length`);
    integer(document.byteLength, `${path}.documents[${position}].byteLength`);
    const projectFile = files.get(documentPath);
    if (
      projectFile === undefined ||
      projectFile.digest !== documentDigest ||
      projectFile.byteLength !== document.byteLength
    ) {
      fail(
        `${path}.documents[${position}] differs from project files`,
        `${path}.documents[${position}]`,
        "SNAPSHOT_MISMATCH",
      );
    }
    return entry as ApplicationSourceIndex["documents"][number];
  });
  orderedUnique(documents, (document) => document.path, `${path}.documents`);
  const documentsByPath = new Map(documents.map((document) => [document.path, document]));
  let anchorCount = 0;
  const entries = array(source.entries, `${path}.entries`).map((entry, position) => {
    const sourceEntry = object(entry, `${path}.entries[${position}]`);
    exact(sourceEntry, ["ref", "sources"], [], `${path}.entries[${position}]`);
    const selectedRef = ref(sourceEntry.ref, `${path}.entries[${position}].ref`);
    const anchors = array(sourceEntry.sources, `${path}.entries[${position}].sources`).map(
      (entryAnchor, anchorPosition): SourceAnchor => {
        const anchor = object(
          entryAnchor,
          `${path}.entries[${position}].sources[${anchorPosition}]`,
        );
        exact(
          anchor,
          ["role", "range", "digest", "resolution"],
          ["focusRange"],
          `${path}.entries[${position}].sources[${anchorPosition}]`,
        );
        const role = oneOf(
          anchor.role,
          SOURCE_ROLES,
          `${path}.entries[${position}].sources[${anchorPosition}].role`,
        );
        const resolution = oneOf(
          anchor.resolution,
          SOURCE_RESOLUTIONS,
          `${path}.entries[${position}].sources[${anchorPosition}].resolution`,
        );
        const anchorRange = range(
          anchor.range,
          `${path}.entries[${position}].sources[${anchorPosition}].range`,
        );
        const anchorDigest = hash(
          anchor.digest,
          `${path}.entries[${position}].sources[${anchorPosition}].digest`,
        );
        const document = documentsByPath.get(anchorRange.path);
        if (document === undefined || anchorRange.end.offset > document.length) {
          fail(
            `source anchor references an unknown or shorter document`,
            `${path}.entries[${position}].sources[${anchorPosition}].range`,
            "SNAPSHOT_MISMATCH",
          );
        }
        const focusRange =
          anchor.focusRange === undefined
            ? undefined
            : range(
                anchor.focusRange,
                `${path}.entries[${position}].sources[${anchorPosition}].focusRange`,
              );
        if (focusRange !== undefined && !containsRange(anchorRange, focusRange)) {
          fail(
            `source focus range escapes its anchor`,
            `${path}.entries[${position}].sources[${anchorPosition}].focusRange`,
            "SNAPSHOT_MISMATCH",
          );
        }
        anchorCount += 1;
        return {
          role,
          range: anchorRange,
          digest: anchorDigest,
          resolution,
          ...(focusRange === undefined ? {} : { focusRange }),
        };
      },
    );
    orderedUnique(anchors, anchorKey, `${path}.entries[${position}].sources`);
    return { ref: selectedRef, sources: anchors };
  });
  const entryKeys = entries.map((entry) => designRefKey(entry.ref));
  if (!same(entryKeys, index.inventory.map(designRefKey))) {
    fail(
      `${path}.entries is not the exact application inventory`,
      `${path}.entries`,
      "SNAPSHOT_MISMATCH",
    );
  }
  const inventoryKeys = new Set(entryKeys);
  const issues = array(source.issues, `${path}.issues`).map((entry, position): SourceIndexIssue => {
    const issue = object(entry, `${path}.issues[${position}]`);
    exact(
      issue,
      ["code", "severity", "message"],
      ["ref", "role", "candidates"],
      `${path}.issues[${position}]`,
    );
    const code = oneOf(issue.code, SOURCE_ISSUE_CODES, `${path}.issues[${position}].code`);
    const severity = oneOf(issue.severity, SEVERITIES, `${path}.issues[${position}].severity`);
    const message = string(issue.message, `${path}.issues[${position}].message`, true);
    const selectedRef =
      issue.ref === undefined ? undefined : ref(issue.ref, `${path}.issues[${position}].ref`);
    if (selectedRef !== undefined && !inventoryKeys.has(designRefKey(selectedRef))) {
      fail(
        `${path}.issues[${position}].ref is not in the application inventory`,
        `${path}.issues[${position}].ref`,
        "SNAPSHOT_MISMATCH",
      );
    }
    const role =
      issue.role === undefined
        ? undefined
        : oneOf(issue.role, SOURCE_ROLES, `${path}.issues[${position}].role`);
    const candidates =
      issue.candidates === undefined
        ? undefined
        : array(issue.candidates, `${path}.issues[${position}].candidates`).map(
            (candidate, candidatePosition) =>
              range(candidate, `${path}.issues[${position}].candidates[${candidatePosition}]`),
          );
    if (candidates !== undefined)
      orderedUnique(candidates, rangeKey, `${path}.issues[${position}].candidates`);
    for (const [candidatePosition, candidate] of (candidates ?? []).entries()) {
      const document = documentsByPath.get(candidate.path);
      if (document === undefined || candidate.end.offset > document.length) {
        fail(
          `${path}.issues[${position}].candidates[${candidatePosition}] references an unknown or shorter document`,
          `${path}.issues[${position}].candidates[${candidatePosition}]`,
          "SNAPSHOT_MISMATCH",
        );
      }
    }
    return {
      code,
      severity,
      message,
      ...(selectedRef === undefined ? {} : { ref: selectedRef }),
      ...(role === undefined ? {} : { role }),
      ...(candidates === undefined ? {} : { candidates }),
    };
  });
  orderedUnique(issues, sourceIssueKey, `${path}.issues`);
  const usage = resourceUsage(source.resourceUsage, `${path}.resourceUsage`);
  if (
    usage.graphNodes !== 0 ||
    usage.graphEdges !== 0 ||
    usage.diagnostics !== issues.length ||
    usage.sourceDocuments !== documents.length ||
    usage.sourceAnchors !== anchorCount ||
    usage.projectFiles !== 0 ||
    usage.projectBytes !== 0
  ) {
    fail(`${path}.resourceUsage is inconsistent`, `${path}.resourceUsage`, "SNAPSHOT_MISMATCH");
  }
  return source as unknown as ApplicationSourceIndex;
}

function detailKey(detail: ApplicationProjectDiagnosticRelatedInformation): string {
  return JSON.stringify([
    detail.path ?? "",
    detail.startOffset ?? -1,
    detail.endOffset ?? -1,
    detail.code,
    detail.severity,
    detail.category,
    detail.source ?? "",
    detail.message,
    detail.line ?? -1,
    detail.column ?? -1,
  ]);
}

function projectDiagnosticKey(diagnostic: ApplicationProjectDiagnostic): string {
  return JSON.stringify([
    PHASE_RANK[diagnostic.phase],
    diagnostic.projectConfigPath ?? "",
    detailKey(diagnostic),
    diagnostic.relatedInformation?.map(detailKey) ?? [],
  ]);
}

function diagnosticDetail(
  value: unknown,
  path: string,
  phase: boolean,
  configs: ReadonlySet<string>,
): ApplicationProjectDiagnosticRelatedInformation | ApplicationProjectDiagnostic {
  const detail = object(value, path);
  exact(
    detail,
    ["severity", "category", "code", "message", ...(phase ? ["phase"] : [])],
    [
      "source",
      "path",
      "startOffset",
      "endOffset",
      "line",
      "column",
      ...(phase ? ["projectConfigPath", "relatedInformation"] : []),
    ],
    path,
  );
  const category = oneOf(
    detail.category,
    ["warning", "error", "suggestion", "message"] as const,
    `${path}.category`,
  );
  const severity = oneOf(detail.severity, SEVERITIES, `${path}.severity`);
  if (severity !== CATEGORY_SEVERITY[category])
    fail(`${path} has inconsistent category and severity`, path, "SNAPSHOT_MISMATCH");
  integer(detail.code, `${path}.code`);
  string(detail.message, `${path}.message`, true);
  if (detail.source !== undefined) string(detail.source, `${path}.source`);
  if (detail.path !== undefined) relativePath(detail.path, `${path}.path`);
  const hasStart = detail.startOffset !== undefined;
  const sourceFields = [detail.endOffset, detail.line, detail.column];
  if (
    hasStart !== sourceFields.every((entry) => entry !== undefined) ||
    (hasStart && detail.path === undefined)
  ) {
    fail(`${path} has incomplete source coordinates`, path);
  }
  if (hasStart) {
    const start = integer(detail.startOffset, `${path}.startOffset`);
    const end = integer(detail.endOffset, `${path}.endOffset`);
    if (end < start) fail(`${path} has a reversed source range`, path);
    integer(detail.line, `${path}.line`, 1);
    integer(detail.column, `${path}.column`, 1);
  }
  if (!phase) return detail as unknown as ApplicationProjectDiagnosticRelatedInformation;
  oneOf(
    detail.phase,
    ["config", "options", "global", "syntactic", "semantic"] as const,
    `${path}.phase`,
  );
  if (detail.projectConfigPath !== undefined) {
    const config = relativePath(detail.projectConfigPath, `${path}.projectConfigPath`);
    if (!configs.has(config))
      fail(
        `${path}.projectConfigPath is unknown`,
        `${path}.projectConfigPath`,
        "SNAPSHOT_MISMATCH",
      );
  }
  if (detail.relatedInformation !== undefined) {
    const related = array(detail.relatedInformation, `${path}.relatedInformation`).map(
      (entry, position) =>
        diagnosticDetail(
          entry,
          `${path}.relatedInformation[${position}]`,
          false,
          configs,
        ) as ApplicationProjectDiagnosticRelatedInformation,
    );
    orderedUnique(related, detailKey, `${path}.relatedInformation`);
  }
  return detail as unknown as ApplicationProjectDiagnostic;
}

function manifestDiagnosticKey(diagnostic: ApplicationDiagnostic): string {
  return JSON.stringify([
    diagnostic.severity,
    diagnostic.code,
    diagnostic.definition.kind,
    diagnostic.definition.name,
    diagnostic.endpoint?.name ?? "",
    diagnostic.endpoint?.path ?? "",
    diagnostic.message,
  ]);
}

function manifestDiagnostic(value: unknown, path: string): ApplicationDiagnostic {
  const diagnostic = object(value, path);
  exact(diagnostic, ["severity", "code", "definition", "message"], ["endpoint"], path);
  oneOf(diagnostic.severity, ["info", "warning", "error"] as const, `${path}.severity`);
  oneOf(diagnostic.code, MANIFEST_DIAGNOSTIC_CODES, `${path}.code`);
  const definition = object(diagnostic.definition, `${path}.definition`);
  exact(definition, ["kind", "name"], [], `${path}.definition`);
  oneOf(
    definition.kind,
    ["application", "endpoint", "reaction", "view", "former"] as const,
    `${path}.definition.kind`,
  );
  string(definition.name, `${path}.definition.name`);
  string(diagnostic.message, `${path}.message`, true);
  if (diagnostic.endpoint !== undefined) {
    const endpoint = object(diagnostic.endpoint, `${path}.endpoint`);
    exact(endpoint, ["name", "path"], [], `${path}.endpoint`);
    string(endpoint.name, `${path}.endpoint.name`);
    string(endpoint.path, `${path}.endpoint.path`);
  }
  return diagnostic as unknown as ApplicationDiagnostic;
}

function validate(value: unknown, roundTrip: boolean): asserts value is ApplicationProjectAnalysis {
  jsonValue(value, "$");
  const project = object(value, "$");
  exact(
    project,
    [
      "format",
      "version",
      "manifestDigest",
      "provenance",
      "diagnostics",
      "manifestDiagnostics",
      "applicationIndex",
      "sourceIndex",
      "resourceUsage",
    ],
    [],
    "$",
  );
  if (project.format !== "sync-engine.application-project-analysis") {
    fail("application project analysis has an unsupported format", "$.format");
  }
  if (project.version !== 2) {
    fail("application project analysis must be version 2", "$.version", "UNSUPPORTED_VERSION");
  }
  const manifestDigest = manifestHash(project.manifestDigest, "$.manifestDigest");
  const projectProvenance = object(project.provenance, "$.provenance");
  exact(
    projectProvenance,
    [
      "analyzer",
      "manifest",
      "sourceRevision",
      "manifestSourceRevision",
      "manifestDigest",
      "sourceDigest",
      "tsconfigPath",
      "typescriptVersion",
      "projectReferences",
      "files",
    ],
    [],
    "$.provenance",
  );
  const baseProvenance = provenance(
    { analyzer: projectProvenance.analyzer, manifest: projectProvenance.manifest },
    "$.provenance",
  );
  const sourceRevision = string(projectProvenance.sourceRevision, "$.provenance.sourceRevision");
  const manifestSourceRevision = string(
    projectProvenance.manifestSourceRevision,
    "$.provenance.manifestSourceRevision",
  );
  if (manifestSourceRevision !== sourceRevision) {
    fail(
      "project source and manifest revisions differ",
      "$.provenance.manifestSourceRevision",
      "SNAPSHOT_MISMATCH",
    );
  }
  if (
    projectProvenance.manifestDigest !== manifestDigest ||
    baseProvenance.manifest.digest !== manifestDigest
  ) {
    fail("project manifest digest fields differ", "$.manifestDigest", "SNAPSHOT_MISMATCH");
  }
  const tsconfigPath = relativePath(projectProvenance.tsconfigPath, "$.provenance.tsconfigPath");
  const typescriptVersion = string(
    projectProvenance.typescriptVersion,
    "$.provenance.typescriptVersion",
  );
  const references = array(
    projectProvenance.projectReferences,
    "$.provenance.projectReferences",
  ).map((entry, position) => relativePath(entry, `$.provenance.projectReferences[${position}]`));
  orderedUnique(references, (entry) => entry, "$.provenance.projectReferences");
  if (references.includes(tsconfigPath)) {
    fail(
      "project references repeat the root config",
      "$.provenance.projectReferences",
      "SNAPSHOT_MISMATCH",
    );
  }
  const files = array(projectProvenance.files, "$.provenance.files").map((entry, position) => {
    const file = object(entry, `$.provenance.files[${position}]`);
    exact(file, ["path", "digest", "byteLength"], [], `$.provenance.files[${position}]`);
    return {
      path: relativePath(file.path, `$.provenance.files[${position}].path`),
      digest: hash(file.digest, `$.provenance.files[${position}].digest`),
      byteLength: integer(file.byteLength, `$.provenance.files[${position}].byteLength`),
    };
  });
  orderedUnique(files, (file) => file.path, "$.provenance.files");
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const config of [tsconfigPath, ...references]) {
    if (!filesByPath.has(config))
      fail(
        `project config ${config} is not digest-bound`,
        "$.provenance.files",
        "SNAPSHOT_MISMATCH",
      );
  }
  const sourceDigest = hash(projectProvenance.sourceDigest, "$.provenance.sourceDigest");
  if (sourceDigest !== sha256(JSON.stringify(files))) {
    fail(
      "project sourceDigest is stale for its file records",
      "$.provenance.sourceDigest",
      "SNAPSHOT_MISMATCH",
    );
  }
  const configs = new Set([tsconfigPath, ...references]);
  const diagnostics = array(project.diagnostics, "$.diagnostics").map(
    (entry, position) =>
      diagnosticDetail(
        entry,
        `$.diagnostics[${position}]`,
        true,
        configs,
      ) as ApplicationProjectDiagnostic,
  );
  orderedUnique(diagnostics, projectDiagnosticKey, "$.diagnostics");
  const manifestDiagnostics = array(project.manifestDiagnostics, "$.manifestDiagnostics").map(
    (entry, position) => manifestDiagnostic(entry, `$.manifestDiagnostics[${position}]`),
  );
  orderedUnique(manifestDiagnostics, manifestDiagnosticKey, "$.manifestDiagnostics");
  const index = applicationIndex(
    project.applicationIndex,
    baseProvenance,
    manifestDigest,
    "$.applicationIndex",
  );
  const source = sourceIndex(
    project.sourceIndex,
    baseProvenance,
    manifestDigest,
    index,
    filesByPath,
    typescriptVersion,
    "$.sourceIndex",
  );
  const usage = resourceUsage(project.resourceUsage, "$.resourceUsage");
  const expectedDiagnostics =
    diagnostics.length + manifestDiagnostics.length + index.issues.length + source.issues.length;
  if (
    usage.graphNodes !== index.resourceUsage.graphNodes ||
    usage.graphEdges !== index.resourceUsage.graphEdges ||
    usage.diagnostics !== expectedDiagnostics ||
    usage.sourceDocuments !== source.resourceUsage.sourceDocuments ||
    usage.sourceAnchors !== source.resourceUsage.sourceAnchors ||
    usage.astNodes !== source.resourceUsage.astNodes ||
    usage.projectFiles !== files.length ||
    usage.projectBytes !== files.reduce((total, file) => total + file.byteLength, 0)
  ) {
    fail("project resourceUsage is inconsistent", "$.resourceUsage", "SNAPSHOT_MISMATCH");
  }
  if (!roundTrip) return;
  const rendered = canonicalAnalysisJson(project);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rendered);
  } catch {
    fail("application project analysis failed its canonical JSON round trip");
  }
  validate(parsed, false);
  if (
    canonicalAnalysisJson(parsed) !== rendered ||
    canonicalAnalysisDigest(parsed) !== canonicalAnalysisDigest(project)
  ) {
    fail("application project analysis failed its canonical persistence round trip");
  }
}

/** Validate durable shape and derivable integrity, not semantic source attribution. */
export function validateApplicationProjectAnalysis(
  value: unknown,
): asserts value is ApplicationProjectAnalysis {
  validate(value, true);
}

/**
 * Parse and synchronously validate one complete supplied JSON string. This API
 * has no streaming or byte limit; hosts must bound untrusted input before use.
 */
export function parseApplicationProjectAnalysis(source: string): ApplicationProjectAnalysis {
  if (typeof source !== "string") {
    throw new AnalysisError(
      "INVALID_ARGUMENT",
      "application project analysis source must be a string",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (cause) {
    throw new AnalysisError("INVALID_FORMAT", "Invalid application project analysis JSON", {
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  validateApplicationProjectAnalysis(value);
  return freezeAnalysisData(value);
}

/** Render canonical stable JSON for one validated project analysis. */
export function renderApplicationProjectAnalysis(analysis: ApplicationProjectAnalysis): string {
  validateApplicationProjectAnalysis(analysis);
  return canonicalAnalysisJson(analysis);
}

/** SHA-256 over the complete canonical validated artifact; trust requires prior possession. */
export function applicationProjectAnalysisDigest(analysis: ApplicationProjectAnalysis): string {
  validateApplicationProjectAnalysis(analysis);
  return canonicalAnalysisDigest(analysis);
}
