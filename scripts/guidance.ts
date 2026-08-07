import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  GUIDANCE_AUTHORITY_VALUES,
  GUIDANCE_DOCUMENT_PATH_VALUES,
  GUIDANCE_STAGE_VALUES,
  GUIDANCE_TOPIC_VALUES,
  computeGuidanceResourceDigest,
  guidanceDocumentsDigest,
  guidanceSha256,
  renderGuidanceResource,
  validateGuidanceResource,
  type GuidanceAuthority,
  type GuidanceDocumentRecord,
  type GuidanceEntry,
  type GuidanceResource,
  type GuidanceStage,
  type GuidanceTopic,
} from "../packages/analysis/src/guidance/guidance.ts";

export const GUIDANCE_DOCUMENT_PATHS = GUIDANCE_DOCUMENT_PATH_VALUES;

export interface GuidanceGitState {
  readonly available: boolean;
  readonly head?: string;
  readonly dirty?: boolean;
}

export interface GuidanceIdentity {
  readonly analysisVersion: string;
  readonly coreVersion: string;
  readonly revision: string;
}

interface Marker {
  readonly id: string;
  readonly anchor: string;
  readonly authority: GuidanceAuthority;
  readonly topics: readonly GuidanceTopic[];
  readonly stages: readonly GuidanceStage[];
}

interface Line {
  readonly text: string;
  readonly raw: string;
  readonly number: number;
}

interface Heading {
  readonly line: number;
  readonly level: number;
  readonly title: string;
  readonly anchor: string;
  readonly markerLine?: number;
}

const repository = "https://github.com/mit-sdg/sync-engine" as const;
const markerPrefix = "<!-- sync-engine-guidance: ";
const markerPattern = /^<!-- sync-engine-guidance: (\{.*\}) -->$/;
const markerKeys = ["id", "anchor", "authority", "topics", "stages"];

function ordinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(path: string, line: number | undefined, message: string): never {
  throw new TypeError(`${path}${line === undefined ? "" : `:${line}`}: ${message}`);
}

function linesOf(source: string): Line[] {
  if (source.includes("\r")) throw new TypeError("guidance documents must use LF line endings");
  const raw = source.match(/[^\n]*(?:\n|$)/g) ?? [];
  if (raw.at(-1) === "") raw.pop();
  return raw.map((line, index) => ({
    text: line.endsWith("\n") ? line.slice(0, -1) : line,
    raw: line,
    number: index + 1,
  }));
}

function headingAnchor(title: string, duplicates: Map<string, number>): string {
  const base = title
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/`/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\p{Mark}\s_-]/gu, "")
    .replace(/ /g, "-");
  const seen = duplicates.get(base) ?? 0;
  duplicates.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen}`;
}

function parseHeadings(lines: readonly Line[]): Heading[] {
  const headings: Heading[] = [];
  const duplicates = new Map<string, number>();
  let fence: string | undefined;
  for (const line of lines) {
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line.text)?.[1];
    if (fenceMarker !== undefined) {
      if (fence === undefined) fence = fenceMarker;
      else if (fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.text);
    if (match === null) continue;
    const title = match[2]!;
    headings.push({
      line: line.number,
      level: match[1]!.length,
      title,
      anchor: headingAnchor(title, duplicates),
    });
  }
  return headings;
}

function markerArray<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
  line: number,
  field: string,
): Value[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(path, line, `marker ${field} must be a non-empty array`);
  }
  const entries = value.map((entry) => {
    if (typeof entry !== "string" || !allowed.includes(entry as Value)) {
      fail(path, line, `marker ${field} contains an unknown value ${String(entry)}`);
    }
    return entry as Value;
  });
  const normalized = [...new Set(entries)].sort(ordinal);
  if (
    normalized.length !== entries.length ||
    entries.some((entry, index) => entry !== normalized[index])
  ) {
    fail(path, line, `marker ${field} must be unique and ordinally sorted`);
  }
  return entries;
}

function parseMarker(payload: string, path: string, line: number): Marker {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch (cause) {
    fail(
      path,
      line,
      `marker JSON is invalid (${cause instanceof Error ? cause.message : String(cause)})`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(path, line, "marker JSON must be an object");
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length !== markerKeys.length || keys.some((key, index) => key !== markerKeys[index])) {
    fail(path, line, `marker fields must be exactly ${markerKeys.join(", ")} in that order`);
  }
  if (JSON.stringify(record) !== payload) {
    fail(path, line, "marker JSON must use the exact compact canonical spelling");
  }
  if (typeof record.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id)) {
    fail(path, line, "marker id must be lowercase kebab-case");
  }
  if (typeof record.anchor !== "string" || record.anchor === "") {
    fail(path, line, "marker anchor must be non-empty");
  }
  if (
    typeof record.authority !== "string" ||
    !GUIDANCE_AUTHORITY_VALUES.includes(record.authority as GuidanceAuthority)
  ) {
    fail(path, line, `marker authority must be one of ${GUIDANCE_AUTHORITY_VALUES.join(", ")}`);
  }
  return {
    id: record.id,
    anchor: record.anchor,
    authority: record.authority as GuidanceAuthority,
    topics: markerArray(record.topics, GUIDANCE_TOPIC_VALUES, path, line, "topics"),
    stages: markerArray(record.stages, GUIDANCE_STAGE_VALUES, path, line, "stages"),
  };
}

function entriesFor(path: string, bytes: Uint8Array): GuidanceEntry[] {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (cause) {
    fail(path, undefined, `document is not exact UTF-8 (${String(cause)})`);
  }
  const lines = linesOf(source);
  const headings = parseHeadings(lines);
  const headingByLine = new Map(headings.map((heading) => [heading.line, heading]));
  const markers = new Map<number, Marker>();
  let fence: string | undefined;
  for (const line of lines) {
    const fenceMarker = /^\s*(`{3,}|~{3,})/.exec(line.text)?.[1];
    if (fenceMarker !== undefined) {
      if (fence === undefined) fence = fenceMarker;
      else if (fenceMarker[0] === fence[0] && fenceMarker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined || !line.text.includes("sync-engine-guidance")) continue;
    const match = markerPattern.exec(line.text);
    if (match === null) fail(path, line.number, "malformed guidance marker comment");
    const separator = lines[line.number];
    const heading = headingByLine.get(line.number + 2);
    if (
      separator?.text !== "" ||
      heading === undefined ||
      (heading.level !== 2 && heading.level !== 3)
    ) {
      fail(path, line.number, "guidance marker must precede an H2 or H3 by exactly one blank line");
    }
    const marker = parseMarker(match[1]!, path, line.number);
    if (marker.anchor !== heading.anchor) {
      fail(
        path,
        line.number,
        `marker anchor ${marker.anchor} does not match heading anchor ${heading.anchor}`,
      );
    }
    markers.set(line.number, marker);
    (heading as { markerLine?: number }).markerLine = line.number;
  }

  const entries: GuidanceEntry[] = [];
  for (const [markerLine, marker] of markers) {
    const heading = headingByLine.get(markerLine + 2)!;
    const following = headings.find(
      (candidate) => candidate.line > heading.line && candidate.level <= heading.level,
    );
    let boundary = following?.markerLine ?? following?.line ?? lines.length + 1;
    while (boundary > heading.line && lines[boundary - 2]?.text.trim() === "") boundary -= 1;
    if (boundary <= heading.line) fail(path, markerLine, "marked section has no content");
    const selectedLines = lines.slice(heading.line - 1, boundary - 1);
    const content = selectedLines.map(({ raw }) => raw).join("");
    if (content.includes(markerPrefix)) {
      fail(path, markerLine, "marked section contains a nested guidance marker");
    }
    entries.push({
      id: marker.id,
      title: heading.title,
      path,
      anchor: heading.anchor,
      startLine: heading.line,
      endLine: boundary - 1,
      authority: marker.authority,
      topics: marker.topics,
      stages: marker.stages,
      content,
      digest: guidanceSha256(content),
    });
  }
  return entries;
}

function bytesOf(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? new TextEncoder().encode(value) : value;
}

export function guidanceResourceFromDocuments(
  sources: ReadonlyMap<string, string | Uint8Array>,
  identity: GuidanceIdentity,
): GuidanceResource {
  const actualPaths = [...sources.keys()].sort(ordinal);
  if (
    actualPaths.length !== GUIDANCE_DOCUMENT_PATHS.length ||
    actualPaths.some((path, index) => path !== GUIDANCE_DOCUMENT_PATHS[index])
  ) {
    throw new TypeError(
      `guidance document catalog must be exactly ${GUIDANCE_DOCUMENT_PATHS.join(", ")}`,
    );
  }
  const documents: GuidanceDocumentRecord[] = GUIDANCE_DOCUMENT_PATHS.map((path) => ({
    path,
    digest: guidanceSha256(bytesOf(sources.get(path)!)),
  }));
  const entries = GUIDANCE_DOCUMENT_PATHS.flatMap((path) =>
    entriesFor(path, bytesOf(sources.get(path)!)),
  ).sort((left, right) => ordinal(left.id, right.id));
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) throw new TypeError(`duplicate guidance id ${entry.id}`);
    ids.add(entry.id);
  }
  const documentsDigest = guidanceDocumentsDigest(documents);
  const unsigned: Omit<GuidanceResource, "digest"> = {
    format: "sync-engine.guidance-resource",
    version: 1,
    producer: {
      analysis: {
        name: "@mit-sdg/sync-engine-analysis",
        version: identity.analysisVersion,
      },
      coreVersion: identity.coreVersion,
    },
    source: { repository, revision: identity.revision, documentsDigest },
    documents,
    entries,
  };
  const resource: GuidanceResource = {
    ...unsigned,
    digest: computeGuidanceResourceDigest(unsigned),
  };
  validateGuidanceResource(resource);
  return resource;
}

export function resolveGuidanceSourceRevision(options: {
  readonly documentsDigest: string;
  readonly explicitRevision?: string;
  readonly git: GuidanceGitState;
}): string {
  const { documentsDigest, explicitRevision, git } = options;
  if (!/^[a-f0-9]{64}$/.test(documentsDigest)) {
    throw new TypeError("documentsDigest must be a lowercase SHA-256 digest");
  }
  if (explicitRevision !== undefined) {
    if (!/^[a-f0-9]{40}$/i.test(explicitRevision)) {
      throw new TypeError("SYNC_ENGINE_SOURCE_REVISION must be an exact 40-hex revision");
    }
    const normalized = explicitRevision.toLowerCase();
    if (git.available && git.head?.toLowerCase() !== normalized) {
      throw new TypeError("SYNC_ENGINE_SOURCE_REVISION must equal git HEAD");
    }
    return normalized;
  }
  if (git.available && git.dirty === false) {
    if (git.head === undefined || !/^[a-f0-9]{40}$/i.test(git.head)) {
      throw new TypeError("a clean Git checkout must have an exact 40-hex HEAD");
    }
    return git.head.toLowerCase();
  }
  return `development:${documentsDigest}`;
}

export function inspectGuidanceGitState(root: string): GuidanceGitState {
  let head: string;
  try {
    head = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return { available: false };
  }
  let status: string;
  try {
    status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=normal"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (cause) {
    throw new Error(`Git HEAD was available but worktree status failed: ${String(cause)}`);
  }
  return { available: true, head, dirty: status !== "" };
}

export async function readGuidanceDocuments(root: string): Promise<Map<string, Uint8Array>> {
  return new Map(
    await Promise.all(
      GUIDANCE_DOCUMENT_PATHS.map(
        async (path) => [path, await readFile(resolve(root, path))] as const,
      ),
    ),
  );
}

interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly peerDependencies?: Readonly<Record<string, string>>;
}

export async function generateGuidanceResource(root: string): Promise<GuidanceResource> {
  const documents = await readGuidanceDocuments(root);
  const records = GUIDANCE_DOCUMENT_PATHS.map((path) => ({
    path,
    digest: guidanceSha256(documents.get(path)!),
  }));
  const documentsDigest = guidanceDocumentsDigest(records);
  const analysis = JSON.parse(
    await readFile(resolve(root, "packages/analysis/package.json"), "utf8"),
  ) as PackageManifest;
  const core = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as PackageManifest;
  if (
    analysis.name !== "@mit-sdg/sync-engine-analysis" ||
    core.name !== "@mit-sdg/sync-engine" ||
    analysis.version !== core.version ||
    analysis.peerDependencies?.[core.name] !== core.version
  ) {
    throw new TypeError(
      "guidance producer manifests must have exact matching analysis and core versions",
    );
  }
  const revision = resolveGuidanceSourceRevision({
    documentsDigest,
    explicitRevision: process.env.SYNC_ENGINE_SOURCE_REVISION,
    git: inspectGuidanceGitState(root),
  });
  return guidanceResourceFromDocuments(documents, {
    analysisVersion: analysis.version,
    coreVersion: core.version,
    revision,
  });
}

export async function writeGuidanceResource(
  root: string,
  destination = resolve(root, "packages/analysis/src/guidance/guidance-resource.json"),
): Promise<GuidanceResource> {
  const resource = await generateGuidanceResource(root);
  await writeFile(destination, renderGuidanceResource(resource));
  return resource;
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, "..");
  const check = process.argv[2] === "--check";
  if (!check && process.argv.length > 2) throw new Error("usage: guidance.ts [--check]");
  const resource = check ? await generateGuidanceResource(root) : await writeGuidanceResource(root);
  console.log(
    `guidance ${check ? "check" : "generation"} passed for ${resource.documents.length} documents and ${resource.entries.length} entries at ${resource.source.revision}`,
  );
}
