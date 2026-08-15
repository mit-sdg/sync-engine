import { createHash } from "node:crypto";
import {
  validateApplicationManifest,
  type ApplicationManifestV1,
} from "@mit-sdg/sync-engine/tooling";
import { ANALYSIS_PACKAGE_NAME, ANALYSIS_PACKAGE_VERSION } from "../package-version.ts";

export interface AnalysisAnalyzerIdentity {
  readonly name: "@mit-sdg/sync-engine-analysis";
  readonly version: string;
}

export interface AnalysisManifestProvenance {
  readonly format: "sync-engine.application-manifest";
  readonly version: 1;
  readonly digest: string;
  readonly generator: Readonly<ApplicationManifestV1["generator"]>;
}

/** Analyzer and exact canonical-manifest identity carried by every persisted result. */
export interface AnalysisProvenance {
  readonly analyzer: AnalysisAnalyzerIdentity;
  readonly manifest: AnalysisManifestProvenance;
}

interface ProvenancedArtifact {
  readonly provenance: AnalysisProvenance;
  readonly manifestDigest: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function analysisProvenance(manifest: ApplicationManifestV1): AnalysisProvenance {
  validateApplicationManifest(manifest);
  return {
    analyzer: {
      name: ANALYSIS_PACKAGE_NAME as "@mit-sdg/sync-engine-analysis",
      version: ANALYSIS_PACKAGE_VERSION,
    },
    manifest: {
      format: manifest.format,
      version: manifest.version,
      digest: manifest.digest,
      generator: { ...manifest.generator },
    },
  };
}

function assertProvenance(value: unknown, label: string): asserts value is AnalysisProvenance {
  const provenance = record(value, `${label}.provenance`);
  const analyzer = record(provenance.analyzer, `${label}.provenance.analyzer`);
  if (
    analyzer.name !== ANALYSIS_PACKAGE_NAME ||
    typeof analyzer.version !== "string" ||
    analyzer.version.trim() === ""
  ) {
    throw new TypeError(`${label} has malformed analyzer provenance`);
  }
  const manifest = record(provenance.manifest, `${label}.provenance.manifest`);
  if (
    manifest.format !== "sync-engine.application-manifest" ||
    manifest.version !== 1 ||
    typeof manifest.digest !== "string" ||
    manifest.digest === ""
  ) {
    throw new TypeError(`${label} has malformed manifest provenance`);
  }
  const generator = record(manifest.generator, `${label}.provenance.manifest.generator`);
  if (
    typeof generator.name !== "string" ||
    generator.name.trim() === "" ||
    typeof generator.version !== "string" ||
    generator.version.trim() === ""
  ) {
    throw new TypeError(`${label} has malformed manifest generator provenance`);
  }
}

export function assertArtifactProvenance(
  value: unknown,
  label: string,
  manifest?: ApplicationManifestV1,
): asserts value is ProvenancedArtifact {
  const artifact = record(value, label);
  assertProvenance(artifact.provenance, label);
  const provenance = artifact.provenance;
  if (artifact.manifestDigest !== provenance.manifest.digest) {
    throw new TypeError(`${label} has mismatched manifest digest fields`);
  }
  if (manifest === undefined) return;
  validateApplicationManifest(manifest);
  if (
    provenance.manifest.format !== manifest.format ||
    provenance.manifest.version !== manifest.version ||
    provenance.manifest.digest !== manifest.digest ||
    provenance.manifest.generator.name !== manifest.generator.name ||
    provenance.manifest.generator.version !== manifest.generator.version
  ) {
    throw new Error(`${label} belongs to a different application manifest`);
  }
}

export function assertSameProvenance(
  left: ProvenancedArtifact,
  right: unknown,
  label: string,
): asserts right is ProvenancedArtifact {
  assertArtifactProvenance(right, label);
  const rightArtifact = right;
  if (
    left.provenance.analyzer.name !== rightArtifact.provenance.analyzer.name ||
    left.provenance.analyzer.version !== rightArtifact.provenance.analyzer.version ||
    left.provenance.manifest.format !== rightArtifact.provenance.manifest.format ||
    left.provenance.manifest.version !== rightArtifact.provenance.manifest.version ||
    left.provenance.manifest.digest !== rightArtifact.provenance.manifest.digest ||
    left.provenance.manifest.generator.name !== rightArtifact.provenance.manifest.generator.name ||
    left.provenance.manifest.generator.version !==
      rightArtifact.provenance.manifest.generator.version
  ) {
    throw new Error(`${label} belongs to a different analysis provenance`);
  }
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalValue(value: unknown, path = "$", seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} contains a non-JSON value`);
  if (seen.has(value)) throw new TypeError(`${path} contains a cycle`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object`);
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => canonicalValue(entry, `${path}[${index}]`, seen));
    }
    const result: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) result[key] = canonicalValue(entry, `${path}.${key}`, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

export function canonicalAnalysisJson(value: unknown): string {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function canonicalAnalysisDigest(value: unknown): string {
  return createHash("sha256").update(canonicalAnalysisJson(value), "utf8").digest("hex");
}

/** Recursively freeze analysis-owned plain data without cloning it. */
export function freezeAnalysisData<Value>(value: Value, seen = new WeakSet<object>()): Value {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return value;
  const object = value as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Reflect.ownKeys(object)) {
    freezeAnalysisData((object as Record<PropertyKey, unknown>)[key], seen);
  }
  return Object.freeze(value);
}
