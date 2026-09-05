import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { isHarnessId, type HarnessId } from "./harness.ts";
import {
  isCanonicalAuthoredDesignPath,
  type EffectiveCapabilityGrant,
  type RoleId,
  roleSpecificationIds,
  type RolePhase,
} from "./roles.ts";
import {
  applicationRootFromWorkPath,
  type RunArtifacts,
  type WorkUnit,
  canonicalPath,
  decodeUtf8,
  decompositionPath,
  pathCoveredBy,
  plainObject,
  posixRelative,
  readWorkPolicy,
  requirePathInWorkUnit,
  requireSafeRunLabel,
  requireWorkUnit,
  reserveRunArtifacts,
  runArtifactSuffixes,
  walkFiles,
  type WorkPolicy,
} from "./work.ts";

const launchStatuses = ["completed", "blocked", "failed", "cancelled", "timed-out"] as const;
const roleResults = ["complete", "blocked", "approve", "revise", "unknown"] as const;
const enforcementLevels = ["harness-enforced", "prompt-guided"] as const;
export type LaunchStatus = (typeof launchStatuses)[number];
type RoleResult = (typeof roleResults)[number];
export type EnforcementLevel = (typeof enforcementLevels)[number];

type ExecutionMode = "delegated" | "simulated";
export type ExecutionHarness = HarnessId | "coordinator";

export class RecordError extends Error {
  override readonly name = "RecordError";
}

export interface RetainedSource {
  readonly inputId: string;
  readonly displayName: string;
  readonly sha256: string;
}

export interface DesignFileDigest {
  readonly path: string;
  readonly sha256: string;
}

export interface DesignBinding {
  readonly root: string;
  readonly before: string;
  readonly beforeFiles?: readonly DesignFileDigest[];
  readonly after?: string;
  readonly afterFiles?: readonly DesignFileDigest[];
}

export type LaunchRelationship =
  | {
      readonly kind: "continuation" | "replacement";
      readonly recordPath: string;
      readonly targetHarness: HarnessId;
      readonly targetAgentId: string;
    }
  | {
      readonly kind: "simulation-continuation";
      readonly recordPath: string;
    };

export interface WorkspaceBinding {
  readonly root: string;
  readonly baseline: { readonly path: string; readonly sha256: string };
}

export interface ReviewTarget {
  readonly subject: "decomposition" | "design";
  readonly digest: string;
}

export interface ReviewScope {
  readonly conceptsOnly: string;
}

export interface LaunchedAgent {
  readonly agentId: string;
  readonly at: string;
}

interface LaunchRecordBase {
  readonly state: "prepared" | "finalized";
  readonly work: { readonly slug: string; readonly path: string };
  readonly role: RoleId;
  readonly phase: RolePhase;
  readonly execution: ExecutionMode;
  readonly independent: boolean;
  readonly harness: ExecutionHarness;
  readonly simulationReason?: string;
  readonly timeoutSeconds: number;
  readonly prompt: { readonly path: string; readonly sha256: string };
  readonly capabilities: { readonly path: string; readonly sha256: string };
  readonly grant: EffectiveCapabilityGrant;
  readonly response: { readonly path: string };
  readonly retainedSources: readonly RetainedSource[];
  readonly policy?: WorkPolicy;
  readonly workspace?: WorkspaceBinding;
  readonly design?: DesignBinding;
  readonly review?: ReviewTarget;
  readonly reviewScope?: ReviewScope;
  readonly relationship?: LaunchRelationship;
  readonly launched?: LaunchedAgent;
}

interface PreparedLaunchRecord extends LaunchRecordBase {
  readonly state: "prepared";
}

export interface FinalizedLaunchRecord extends LaunchRecordBase {
  readonly state: "finalized";
  readonly response: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly agentId?: string;
  readonly status: LaunchStatus;
  readonly result: RoleResult;
  readonly enforcement: EnforcementLevel;
  readonly model?: string;
}

export type LaunchRecord = PreparedLaunchRecord | FinalizedLaunchRecord;

export function normalizeLaunchStatus(status: string): LaunchStatus {
  const value = status.trim().toLowerCase().replaceAll("_", "-");
  if (/^(?:complete|completed|idle|settled|success|succeeded)$/.test(value)) return "completed";
  if (/^(?:block|blocked)$/.test(value)) return "blocked";
  if (/^(?:error|failed|failure)$/.test(value)) return "failed";
  if (/^(?:canceled|cancelled|stopped)$/.test(value)) return "cancelled";
  if (/^(?:timeout|timed-out|timed out)$/.test(value)) return "timed-out";
  throw new RecordError(`Unknown terminal harness status: ${status}`);
}

function bytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(bytes(value)).digest("hex");
}

function serializeGrant(grant: EffectiveCapabilityGrant): string {
  return `${JSON.stringify(grant, undefined, 2)}\n`;
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!plainObject(value)) throw new RecordError(`${name} must be an object`);
  return value;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new RecordError(`${name} must be non-empty text`);
  }
  return value;
}

function absolutePath(value: unknown, name: string): string {
  const path = text(value, name);
  if (!isAbsolute(path)) throw new RecordError(`${name} must be absolute`);
  return path;
}

function hash(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new RecordError(`${name} must be 64 lowercase hexadecimal digits`);
  }
  return value;
}

function harness(value: unknown, name = "Harness"): ExecutionHarness {
  if (value === "coordinator") return value;
  if (!isHarnessId(value)) throw new RecordError(`${name} is invalid`);
  return value;
}

function rolePhase(role: unknown, phase: unknown): [RoleId, RolePhase] {
  const id = `${text(role, "Role")}/${text(phase, "Phase")}`;
  if (!roleSpecificationIds.includes(id as (typeof roleSpecificationIds)[number])) {
    throw new RecordError(`Role and phase combination is invalid: ${id}`);
  }
  return [role as RoleId, phase as RolePhase];
}

function positiveSeconds(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new RecordError(`Timeout must be a positive integer number of seconds`);
  }
  return value as number;
}

function retainedSources(value: unknown): readonly RetainedSource[] {
  if (!Array.isArray(value)) throw new RecordError(`Retained sources must be an array`);
  return value.map((candidate) => {
    const source = object(candidate, "Retained source");
    return {
      inputId: text(source["inputId"], "Retained source input ID"),
      displayName: text(source["displayName"], "Retained source display name"),
      sha256: hash(source["sha256"], "Retained source hash"),
    };
  });
}

function designFileDigests(value: unknown, label: string): readonly DesignFileDigest[] {
  if (!Array.isArray(value)) throw new RecordError(`Design ${label} files must be an array`);
  const seen = new Set<string>();
  return value.map((candidate) => {
    const file = object(candidate, `Design ${label} file`);
    const path = text(file["path"], `Design ${label} file path`);
    if (
      isAbsolute(path) ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new RecordError(`Design ${label} file path must be canonical and relative`);
    }
    if (seen.has(path)) throw new RecordError(`Design ${label} files contain duplicate ${path}`);
    seen.add(path);
    return { path, sha256: hash(file["sha256"], `Design ${label} file hash`) };
  });
}

function decodeRecord(value: unknown): LaunchRecord {
  const record = object(value, "Launch record");
  if (record["state"] !== "prepared" && record["state"] !== "finalized") {
    throw new RecordError(`Launch record state must be prepared or finalized`);
  }
  const work = object(record["work"], "Work binding");
  text(work["slug"], "Work slug");
  absolutePath(work["path"], "Work path");
  const [role, phase] = rolePhase(record["role"], record["phase"]);
  if (record["execution"] !== "delegated" && record["execution"] !== "simulated") {
    throw new RecordError(`Execution must be delegated or simulated`);
  }
  const execution = record["execution"];
  if (record["independent"] !== (execution === "delegated")) {
    throw new RecordError(
      `Independent must be true for delegated execution and false for simulation`,
    );
  }
  const selectedHarness = harness(record["harness"]);
  if (execution === "simulated") {
    if (selectedHarness !== "coordinator") {
      throw new RecordError(`Simulated execution must use the coordinator`);
    }
    text(record["simulationReason"], "Simulation reason");
  } else if (selectedHarness === "coordinator" || record["simulationReason"] !== undefined) {
    throw new RecordError(`Delegated execution must use a harness and no simulation reason`);
  }
  positiveSeconds(record["timeoutSeconds"]);

  for (const [name, value] of [
    ["Prompt", record["prompt"]],
    ["Capability artifact", record["capabilities"]],
  ] as const) {
    const binding = object(value, `${name} binding`);
    absolutePath(binding["path"], `${name} path`);
    hash(binding["sha256"], `${name} hash`);
  }
  object(record["grant"], "Effective grant");
  const response = object(record["response"], "Response binding");
  absolutePath(response["path"], "Response path");
  retainedSources(record["retainedSources"]);
  if (record["policy"] !== undefined) {
    const policy = object(record["policy"], "Work policy");
    if (
      (policy["review"] !== "required" && policy["review"] !== "omitted") ||
      !["delegated", "simulated", "mixed"].includes(String(policy["execution"]))
    ) {
      throw new RecordError(`Recorded work policy is invalid`);
    }
  }

  if (record["workspace"] !== undefined) {
    const workspace = object(record["workspace"], "Workspace binding");
    absolutePath(workspace["root"], "Workspace root");
    const baseline = object(workspace["baseline"], "Workspace baseline");
    absolutePath(baseline["path"], "Workspace baseline path");
    hash(baseline["sha256"], "Workspace baseline hash");
  }
  if (record["review"] !== undefined) {
    const review = object(record["review"], "Review target");
    if (review["subject"] !== "decomposition" && review["subject"] !== "design") {
      throw new RecordError(`Review subject must be decomposition or design`);
    }
    hash(review["digest"], "Review target digest");
  }
  if (record["reviewScope"] !== undefined) {
    const scope = object(record["reviewScope"], "Review scope");
    text(scope["conceptsOnly"], "Concepts-only review reason");
  }
  if (record["launched"] !== undefined) {
    const launched = object(record["launched"], "Launched agent");
    text(launched["agentId"], "Launched agent identity");
    const at = text(launched["at"], "Launched agent timestamp");
    if (Number.isNaN(Date.parse(at))) throw new RecordError(`Launched agent timestamp is invalid`);
    if (execution !== "delegated" || selectedHarness !== "paseo") {
      throw new RecordError(`Launched agent metadata requires delegated Paseo execution`);
    }
  }

  if (record["design"] !== undefined) {
    const design = object(record["design"], "Design binding");
    absolutePath(design["root"], "Design root");
    hash(design["before"], "Design before digest");
    if (design["beforeFiles"] !== undefined) designFileDigests(design["beforeFiles"], "before");
    if (design["after"] !== undefined) hash(design["after"], "Design after digest");
    if (design["afterFiles"] !== undefined) designFileDigests(design["afterFiles"], "after");
    const writer = role === "designer" && phase === "contracts";
    if (
      record["state"] === "prepared" &&
      (design["after"] !== undefined || design["afterFiles"] !== undefined)
    ) {
      throw new RecordError(`Prepared design binding cannot have an after snapshot`);
    }
    if (record["state"] === "finalized" && writer !== (design["after"] !== undefined)) {
      throw new RecordError(`Finalized design after digest does not match the role`);
    }
  }
  if (record["relationship"] !== undefined) {
    const relationship = object(record["relationship"], "Launch relationship");
    absolutePath(relationship["recordPath"], "Related record path");
    if (relationship["kind"] === "simulation-continuation") {
      if (execution !== "simulated") {
        throw new RecordError(`Simulation continuation requires simulated execution`);
      }
      if (
        relationship["targetHarness"] !== undefined ||
        relationship["targetAgentId"] !== undefined
      ) {
        throw new RecordError(`Simulation continuation cannot claim a harness identity`);
      }
    } else {
      if (execution === "simulated") {
        throw new RecordError(`Simulated execution cannot claim agent continuity`);
      }
      if (relationship["kind"] !== "continuation" && relationship["kind"] !== "replacement") {
        throw new RecordError(`Launch relationship kind is invalid`);
      }
      harness(relationship["targetHarness"], "Related harness");
      text(relationship["targetAgentId"], "Related agent identity");
    }
  }
  if (record["state"] === "finalized") {
    if (execution === "delegated") text(record["agentId"], "Agent identity");
    else if (record["agentId"] !== undefined) {
      throw new RecordError(`Simulated execution cannot claim an agent identity`);
    }
    if (!launchStatuses.includes(record["status"] as LaunchStatus)) {
      throw new RecordError(`Finalized record has an unknown status`);
    }
    if (record["result"] === undefined) record["result"] = "unknown";
    if (!roleResults.includes(record["result"] as RoleResult)) {
      throw new RecordError(`Finalized record has an unknown role result`);
    }
    if (!enforcementLevels.includes(record["enforcement"] as EnforcementLevel)) {
      throw new RecordError(`Finalized record has an unknown enforcement level`);
    }
    hash(response["sha256"], "Response hash");
    if (!Number.isSafeInteger(response["bytes"]) || (response["bytes"] as number) < 0) {
      throw new RecordError(`Response bytes must be a non-negative integer`);
    }
    if (record["model"] !== undefined) text(record["model"], "Model");
  }
  return record as unknown as LaunchRecord;
}

function directWorkPath(path: string, workPath: string, name: string): string {
  let canonical: string;
  try {
    canonical = requirePathInWorkUnit(path, workPath);
  } catch (error) {
    throw new RecordError(`${name} escapes the work unit: ${String(error)}`);
  }
  if (canonical !== path || dirname(canonical) !== workPath) {
    throw new RecordError(`${name} must be a canonical file directly in the work unit`);
  }
  return canonical;
}

async function regularFile(path: string, workPath: string, name: string): Promise<Uint8Array> {
  directWorkPath(path, workPath, name);
  const entry = await lstat(path).catch(() => undefined);
  if (entry === undefined || entry.isSymbolicLink() || !entry.isFile()) {
    throw new RecordError(`${name} must be a readable regular file`);
  }
  return readFile(path);
}

interface LoadedRecord {
  readonly path: string;
  readonly record: LaunchRecord;
}

function expectedDesignRoot(workPath: string): string {
  return resolve(applicationRootFromWorkPath(workPath), "design");
}

async function loadRecord(path: string): Promise<LoadedRecord> {
  const entry = await lstat(path).catch(() => undefined);
  if (entry === undefined || entry.isSymbolicLink() || !entry.isFile()) {
    throw new RecordError(`Launch record must be a readable regular file: ${path}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    throw new RecordError(`Launch record is not readable JSON: ${path}: ${String(error)}`);
  }
  const record = decodeRecord(value);
  const workEntry = await lstat(record.work.path).catch(() => undefined);
  const workPath = canonicalPath(record.work.path);
  if (
    workEntry === undefined ||
    workEntry.isSymbolicLink() ||
    !workEntry.isDirectory() ||
    workPath !== record.work.path ||
    basename(workPath) !== record.work.slug
  ) {
    throw new RecordError(`Launch record has an invalid work binding`);
  }
  const recordPath = directWorkPath(path, workPath, "Launch record");
  directWorkPath(record.prompt.path, workPath, "Prompt");
  directWorkPath(record.capabilities.path, workPath, "Capability artifact");
  directWorkPath(record.response.path, workPath, "Response");
  if (record.workspace !== undefined) {
    const expectedRoot = applicationRootFromWorkPath(workPath);
    if (
      record.workspace.root !== expectedRoot ||
      canonicalPath(record.workspace.root) !== expectedRoot
    ) {
      throw new RecordError(`Workspace root is not the canonical application directory`);
    }
    directWorkPath(record.workspace.baseline.path, workPath, "Workspace baseline");
  }
  if (record.relationship !== undefined) {
    directWorkPath(record.relationship.recordPath, workPath, "Related record");
  }
  if (
    record.design !== undefined &&
    (record.design.root !== expectedDesignRoot(workPath) ||
      canonicalPath(record.design.root) !== record.design.root)
  ) {
    throw new RecordError(`Design root is not the canonical application design directory`);
  }
  return { path: recordPath, record };
}

export async function readLaunchRecord(path: string): Promise<LaunchRecord> {
  return (await loadRecord(path)).record;
}

export async function replacePreparedHarness(
  path: string,
  nextHarness: HarnessId,
): Promise<PreparedLaunchRecord> {
  const loaded = await loadRecord(path);
  if (loaded.record.state !== "prepared") {
    throw new RecordError(`Harness replacement requires a prepared record`);
  }
  const prepared = loaded.record;
  if (prepared.execution !== "delegated" || prepared.harness === "coordinator") {
    throw new RecordError(`Harness replacement requires delegated execution`);
  }
  if (prepared.relationship?.kind === "continuation") {
    throw new RecordError(`A same-agent continuation cannot change harness`);
  }
  if (prepared.launched !== undefined) {
    throw new RecordError(`A launched run cannot change harness`);
  }
  const response = await regularFile(prepared.response.path, prepared.work.path, "Response");
  if (response.byteLength !== 0) {
    throw new RecordError(`Harness replacement requires an empty response artifact`);
  }
  return rewriteBaseline(loaded, { ...prepared, harness: nextHarness });
}

export async function recordPaseoLaunch(
  path: string,
  agentId: string,
  at: Date = new Date(),
): Promise<PreparedLaunchRecord> {
  const loaded = await loadRecord(path);
  if (loaded.record.state !== "prepared") {
    throw new RecordError(`Paseo launch requires a prepared record`);
  }
  const prepared = loaded.record;
  if (prepared.execution !== "delegated" || prepared.harness !== "paseo") {
    throw new RecordError(`Paseo launch requires a delegated Paseo record`);
  }
  text(agentId, "Agent identity");
  const timestamp = at.toISOString();
  if (prepared.launched !== undefined) {
    if (prepared.launched.agentId !== agentId) {
      throw new RecordError(`Prepared record already names another launched agent`);
    }
    return prepared;
  }
  if (
    prepared.relationship?.kind === "continuation" &&
    prepared.relationship.targetAgentId !== agentId
  ) {
    throw new RecordError(`Continuation must launch the snapshotted Paseo agent`);
  }
  return rewriteBaseline(loaded, {
    ...prepared,
    launched: { agentId, at: timestamp },
  });
}

function markdown(value: string | Uint8Array, name: string): Uint8Array {
  const content = bytes(value);
  decodeUtf8(content, () => new RecordError(`${name} must be non-empty readable UTF-8`));
  return content;
}

async function prepareRelationship(
  input: Pick<LaunchRelationship, "kind" | "recordPath"> | undefined,
  unit: WorkUnit,
  role: RoleId,
  selectedHarness: ExecutionHarness,
): Promise<LaunchRelationship | undefined> {
  if (input === undefined) return undefined;
  const target = await loadRecord(input.recordPath);
  if (target.record.state !== "finalized") throw new RecordError(`Related launch is not finalized`);
  if (target.record.work.path !== unit.path || target.record.role !== role) {
    throw new RecordError(`Related launch belongs to another work unit or role`);
  }
  const recordPath = directWorkPath(target.path, unit.path, "Related record");
  if (input.kind === "simulation-continuation") {
    if (selectedHarness !== "coordinator" || target.record.execution !== "simulated") {
      throw new RecordError(`Simulation continuation requires a finalized simulation`);
    }
    return { kind: "simulation-continuation", recordPath };
  }
  if (selectedHarness === "coordinator") {
    throw new RecordError(`Simulated execution cannot continue or replace an agent`);
  }
  if (
    target.record.execution !== "delegated" ||
    target.record.harness === "coordinator" ||
    target.record.agentId === undefined
  ) {
    throw new RecordError(`Related launch is not a delegated agent run`);
  }
  if (input.kind === "continuation" && selectedHarness !== target.record.harness) {
    throw new RecordError(`Continuation must select the related launch harness`);
  }
  return {
    kind: input.kind,
    recordPath,
    targetHarness: target.record.harness,
    targetAgentId: target.record.agentId,
  };
}

const workspaceExclusions = new Set([".git", "node_modules", ".cache", ".vite", "coverage"]);
const coordinatorSessionDirectories = new Set(["pi-sessions"]);

function coordinatorOwnedWorkspacePath(path: string, workPath: string): boolean {
  const relativeToWork = posixRelative(workPath, path);
  if (relativeToWork === "brief.md" || relativeToWork === "policy.json") return true;
  const first = relativeToWork.split("/")[0];
  return first !== undefined && coordinatorSessionDirectories.has(first);
}

async function snapshotWorkspace(
  root: string,
  workPath: string,
): Promise<readonly DesignFileDigest[]> {
  const paths = await walkFiles(root, () => true, {
    enter: (path, relativePath) =>
      !(relativePath.includes("/") === false && workspaceExclusions.has(relativePath)) &&
      !coordinatorOwnedWorkspacePath(path, workPath),
  });
  return Promise.all(
    paths
      .filter((path) => !coordinatorOwnedWorkspacePath(path, workPath))
      .map(async (path) => ({
        path: posixRelative(root, path),
        sha256: sha256(await readFile(path)),
      })),
  );
}

function protectedControls(record: {
  readonly role: RoleId;
  readonly phase: RolePhase;
  readonly execution: ExecutionMode;
  readonly harness: ExecutionHarness;
  readonly timeoutSeconds: number;
  readonly promptSha256: string;
  readonly grant: EffectiveCapabilityGrant;
  readonly retainedSources: readonly RetainedSource[];
  readonly policy?: WorkPolicy;
  readonly design?: DesignBinding;
  readonly review?: ReviewTarget;
  readonly reviewScope?: ReviewScope;
  readonly relationship?: LaunchRelationship;
  readonly launched?: LaunchedAgent;
}): string {
  return sha256(JSON.stringify(record));
}

function controlsOf(record: PreparedLaunchRecord): string {
  return protectedControls({
    role: record.role,
    phase: record.phase,
    execution: record.execution,
    harness: record.harness,
    timeoutSeconds: record.timeoutSeconds,
    promptSha256: record.prompt.sha256,
    grant: record.grant,
    retainedSources: record.retainedSources,
    ...(record.policy === undefined ? {} : { policy: record.policy }),
    ...(record.design === undefined ? {} : { design: record.design }),
    ...(record.review === undefined ? {} : { review: record.review }),
    ...(record.reviewScope === undefined ? {} : { reviewScope: record.reviewScope }),
    ...(record.relationship === undefined ? {} : { relationship: record.relationship }),
    ...(record.launched === undefined ? {} : { launched: record.launched }),
  });
}

async function rewriteBaseline(
  loaded: LoadedRecord,
  updated: PreparedLaunchRecord,
): Promise<PreparedLaunchRecord> {
  let record = updated;
  if (record.workspace !== undefined) {
    const content = await regularFile(
      record.workspace.baseline.path,
      record.work.path,
      "Workspace baseline",
    );
    const baseline = object(JSON.parse(new TextDecoder().decode(content)), "Workspace baseline");
    baseline["controlsSha256"] = controlsOf(record);
    const revised = `${JSON.stringify(baseline, undefined, 2)}\n`;
    await writeFile(record.workspace.baseline.path, revised, "utf8");
    record = {
      ...record,
      workspace: {
        ...record.workspace,
        baseline: { ...record.workspace.baseline, sha256: sha256(revised) },
      },
    };
  }
  await writeFile(loaded.path, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
  return record;
}

function workspaceBaseline(files: readonly DesignFileDigest[], controlsSha256: string): string {
  return `${JSON.stringify({ files, controlsSha256 }, undefined, 2)}\n`;
}

async function prepareDesign(
  input: { readonly root: string; readonly digest: string } | undefined,
  unit: WorkUnit,
): Promise<DesignBinding | undefined> {
  if (input === undefined) return undefined;
  const root = canonicalPath(input.root);
  const expected = resolve(unit.applicationRoot, "design");
  if (resolve(input.root) !== root || root !== expected) {
    throw new RecordError(`Design root must be the canonical application design directory`);
  }
  const before = hash(input.digest, "Design digest");
  const snapshot = await snapshotDesign(root);
  if (snapshot.digest !== before) {
    throw new RecordError(`Design changed before launch preparation`);
  }
  return { root, before, beforeFiles: snapshot.fileDigests };
}

export interface PrepareLaunchOptions {
  readonly applicationRoot: string;
  readonly slug: string;
  readonly role: RoleId;
  readonly phase: RolePhase;
  readonly execution?: ExecutionMode;
  readonly harness: ExecutionHarness;
  readonly simulationReason?: string;
  readonly timeoutSeconds: number;
  readonly task: string | Uint8Array;
  readonly prompt: string | Uint8Array;
  readonly promptSha256?: string;
  readonly grant: EffectiveCapabilityGrant;
  readonly retainedSources: readonly RetainedSource[];
  readonly design?: { readonly root: string; readonly digest: string };
  readonly review?: ReviewTarget;
  readonly reviewScope?: ReviewScope;
  readonly relationship?: Pick<LaunchRelationship, "kind" | "recordPath">;
  readonly at?: Date;
}

export interface PrepareLaunchResult {
  readonly path: string;
  readonly record: PreparedLaunchRecord;
  readonly artifacts: RunArtifacts;
}

export async function prepareLaunch(options: PrepareLaunchOptions): Promise<PrepareLaunchResult> {
  const unit = await requireWorkUnit(options.applicationRoot, options.slug);
  const [role, phase] = rolePhase(
    requireSafeRunLabel(options.role, "role"),
    requireSafeRunLabel(options.phase, "phase"),
  );
  const execution = options.execution ?? "delegated";
  const selectedHarness = harness(options.harness);
  if (execution === "simulated") {
    if (selectedHarness !== "coordinator") {
      throw new RecordError(`Simulated execution must use the coordinator`);
    }
    text(options.simulationReason, "Simulation reason");
  } else if (selectedHarness === "coordinator" || options.simulationReason !== undefined) {
    throw new RecordError(`Delegated execution must use a harness and no simulation reason`);
  }
  const timeoutSeconds = positiveSeconds(options.timeoutSeconds);
  const task = markdown(options.task, "Task");
  const prompt = markdown(options.prompt, "Prompt");
  const promptHash = sha256(prompt);
  if (options.promptSha256 !== undefined && options.promptSha256 !== promptHash) {
    throw new RecordError(`Prompt hash changed before preparation`);
  }
  const retained = retainedSources(options.retainedSources);
  const policy = await readWorkPolicy(unit);
  const design = await prepareDesign(options.design, unit);
  const review =
    options.review === undefined
      ? undefined
      : { subject: options.review.subject, digest: hash(options.review.digest, "Review digest") };
  const reviewScope =
    options.reviewScope === undefined
      ? undefined
      : { conceptsOnly: text(options.reviewScope.conceptsOnly, "Concepts-only review reason") };
  const relationship = await prepareRelationship(options.relationship, unit, role, selectedHarness);
  const workspaceFiles = await snapshotWorkspace(unit.applicationRoot, unit.path);
  const artifacts = await reserveRunArtifacts({
    applicationRoot: unit.applicationRoot,
    slug: unit.slug,
    role,
    phase,
    at: options.at,
  });
  const created = [artifacts.responsePath];

  try {
    const grantContent = serializeGrant(options.grant);
    const grant = JSON.parse(grantContent) as EffectiveCapabilityGrant;
    const controlsSha256 = protectedControls({
      role,
      phase,
      execution,
      harness: selectedHarness,
      timeoutSeconds,
      promptSha256: promptHash,
      grant,
      retainedSources: retained,
      policy,
      ...(design === undefined ? {} : { design }),
      ...(review === undefined ? {} : { review }),
      ...(reviewScope === undefined ? {} : { reviewScope }),
      ...(relationship === undefined ? {} : { relationship }),
    });
    const baseline = workspaceBaseline(workspaceFiles, controlsSha256);
    await writeFile(artifacts.taskPath, task, { flag: "wx" });
    created.push(artifacts.taskPath);
    await writeFile(artifacts.capabilitiesPath, grantContent, { flag: "wx" });
    created.push(artifacts.capabilitiesPath);
    await writeFile(artifacts.baselinePath, baseline, { flag: "wx" });
    created.push(artifacts.baselinePath);
    await writeFile(artifacts.promptPath, prompt, { flag: "wx" });
    created.push(artifacts.promptPath);

    const record: PreparedLaunchRecord = {
      state: "prepared",
      work: { slug: unit.slug, path: unit.path },
      role,
      phase,
      execution,
      independent: execution === "delegated",
      harness: selectedHarness,
      ...(options.simulationReason === undefined
        ? {}
        : { simulationReason: options.simulationReason }),
      timeoutSeconds,
      prompt: { path: artifacts.promptPath, sha256: promptHash },
      capabilities: { path: artifacts.capabilitiesPath, sha256: sha256(grantContent) },
      grant,
      response: { path: artifacts.responsePath },
      retainedSources: retained,
      policy,
      workspace: {
        root: unit.applicationRoot,
        baseline: { path: artifacts.baselinePath, sha256: sha256(baseline) },
      },
      ...(design === undefined ? {} : { design }),
      ...(review === undefined ? {} : { review }),
      ...(reviewScope === undefined ? {} : { reviewScope }),
      ...(relationship === undefined ? {} : { relationship }),
    };
    await writeFile(artifacts.recordPath, `${JSON.stringify(record, undefined, 2)}\n`, {
      flag: "wx",
    });
    created.push(artifacts.recordPath);
    return { path: artifacts.recordPath, record, artifacts };
  } catch (error) {
    await Promise.all(created.map((path) => rm(path, { force: true }).catch(() => undefined)));
    if (error instanceof RecordError) throw error;
    throw new RecordError(`Cannot prepare launch: ${String(error)}`);
  }
}

async function verifyArtifact(
  binding: { readonly path: string; readonly sha256: string },
  workPath: string,
  name: string,
): Promise<void> {
  const actual = sha256(await regularFile(binding.path, workPath, name));
  if (actual !== binding.sha256) {
    throw new RecordError(`${name} changed after preparation`);
  }
}

async function requireFreshIdentity(
  prepared: PreparedLaunchRecord,
  currentRecordPath: string,
  agentId: string,
): Promise<void> {
  const recordNames = (await readdir(prepared.work.path))
    .filter((name) => name.endsWith(".record.json"))
    .sort();
  for (const name of recordNames) {
    const path = resolve(prepared.work.path, name);
    if (path === currentRecordPath) continue;
    const candidate = (await loadRecord(path)).record;
    if (
      candidate.state === "finalized" &&
      candidate.execution === "delegated" &&
      candidate.relationship?.kind !== "continuation" &&
      candidate.harness === prepared.harness &&
      candidate.agentId === agentId
    ) {
      const label = prepared.relationship?.kind === "replacement" ? "Replacement" : "Fresh launch";
      throw new RecordError(`${label} must use a new agent identity`);
    }
  }
}

function changedDesignPaths(
  before: readonly DesignFileDigest[],
  after: readonly DesignFileDigest[],
): string[] {
  const previous = new Map(before.map((file) => [file.path, file.sha256]));
  const current = new Map(after.map((file) => [file.path, file.sha256]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((path) => previous.get(path) !== current.get(path))
    .sort();
}

function generatedPath(path: string): boolean {
  const parts = path.split("/");
  return (
    parts.includes("generated") ||
    parts[0] === "dist" ||
    parts.some((part) => part.includes(".generated."))
  );
}

async function completedWorkspace(prepared: PreparedLaunchRecord): Promise<void> {
  if (prepared.workspace === undefined) return;
  const content = await regularFile(
    prepared.workspace.baseline.path,
    prepared.work.path,
    "Workspace baseline",
  );
  if (sha256(content) !== prepared.workspace.baseline.sha256) {
    throw new RecordError(`Workspace baseline changed after preparation`);
  }
  let baseline: unknown;
  try {
    baseline = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(content));
  } catch (error) {
    throw new RecordError(`Workspace baseline is not readable JSON: ${String(error)}`);
  }
  const binding = object(baseline, "Workspace baseline");
  const files = designFileDigests(binding["files"], "workspace");
  const controlsSha256 = hash(binding["controlsSha256"], "Protected launch controls");
  const actualControls = controlsOf(prepared);
  if (actualControls !== controlsSha256) {
    throw new RecordError(`Protected launch controls changed after preparation`);
  }
  const changed = changedDesignPaths(
    files,
    await snapshotWorkspace(prepared.workspace.root, prepared.work.path),
  );
  const writable = prepared.grant.writableAreas.map(({ area, path }) =>
    area === "assigned-design"
      ? `design/${path}`
      : area === "current-decomposition"
        ? posixRelative(prepared.workspace!.root, decompositionPath(prepared.work.path))
        : path,
  );
  const currentStem = prepared.prompt.path.replace(/\.prompt\.md$/, "");
  const currentArtifacts = runArtifactSuffixes.map((suffix) =>
    posixRelative(prepared.workspace!.root, `${currentStem}${suffix}`),
  );
  const outside = changed.filter(
    (path) =>
      !writable.some((granted) => pathCoveredBy(path, granted)) &&
      !currentArtifacts.includes(path) &&
      !(prepared.grant.generatedOutput && generatedPath(path)),
  );
  if (outside.length > 0) {
    throw new RecordError(`Run changed paths outside its write grant: ${outside.join(", ")}`);
  }
}

async function completedDesign(prepared: PreparedLaunchRecord): Promise<DesignBinding | undefined> {
  if (prepared.design === undefined) return undefined;
  const snapshot = await snapshotDesign(prepared.design.root);
  const writer = prepared.role === "designer" && prepared.phase === "contracts";
  if (!writer) {
    if (snapshot.digest !== prepared.design.before) {
      throw new RecordError(`Design changed after preparation`);
    }
    return prepared.design;
  }

  const changed = changedDesignPaths(prepared.design.beforeFiles ?? [], snapshot.fileDigests);
  if (prepared.design.beforeFiles !== undefined) {
    const assigned = prepared.grant.writableAreas
      .filter(({ area }) => area === "assigned-design")
      .map(({ path }) => path);
    const outside = changed.filter((path) => !assigned.includes(path));
    if (outside.length > 0) {
      throw new RecordError(
        `Contract design changed outside its assignment: ${outside.join(", ")}`,
      );
    }
  }
  const noncanonical = changed.filter((path) => !isCanonicalAuthoredDesignPath(path));
  if (noncanonical.length > 0) {
    throw new RecordError(`Contract design used noncanonical paths: ${noncanonical.join(", ")}`);
  }
  return {
    ...prepared.design,
    after: snapshot.digest,
    afterFiles: snapshot.fileDigests,
  };
}

export function inferRoleResult(response: Uint8Array): RoleResult {
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(response);
  } catch {
    return "unknown";
  }
  // A captured transcript may glue a progress sentence onto the final message
  // ("...waiting for it to complete.## Status"); restore the heading's line start.
  content = content.replace(/([^\n#])(#{1,4}\s+(?:Status|Verdict)\b)/g, "$1\n$2");
  const heading = (name: "Status" | "Verdict"): string | undefined => {
    const expression = new RegExp(
      `^#{1,4}\\s+${name}(?:(?:\\s*:\\s*|\\s+(?:-|—)\\s+)([^\\n]*))?\\s*$`,
      "im",
    );
    const match = expression.exec(content);
    if (match === null) return undefined;
    const inline = match[1]?.trim();
    const rest = content.slice(match.index + match[0].length);
    const firstLine = inline || rest.split("\n").find((line) => line.trim() !== "");
    return firstLine
      ?.replaceAll(/[*_`~]/g, "")
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .trim()
      .toLowerCase();
  };
  const status = heading("Status");
  if (status?.startsWith("block")) return "blocked";
  if (status?.startsWith("complete")) return "complete";
  const verdict = heading("Verdict");
  if (verdict?.startsWith("block")) return "blocked";
  if (verdict?.startsWith("approve")) return "approve";
  if (verdict?.startsWith("revise")) return "revise";
  return "unknown";
}

function validateRoleResult(
  prepared: PreparedLaunchRecord,
  status: LaunchStatus,
  result: RoleResult,
): void {
  const critic = prepared.role === "critic";
  const acceptedResult = critic
    ? result === "approve" || result === "revise" || result === "blocked"
    : result === "complete" || result === "blocked";
  if ((status === "completed" || status === "blocked") && !acceptedResult) {
    const expected = critic ? "`Approve`, `Revise`, or `Blocked`" : "`Complete` or `Blocked`";
    throw new RecordError(
      `Response has no parsable required \`${critic ? "## Verdict" : "## Status"}\`; expected ${expected} for ${prepared.role}; fix the response file and rerun completion.`,
    );
  }
  if (status === "completed" && result === "blocked") {
    throw new RecordError(`Response reports a blocked result; finalize with --status blocked`);
  }
  if (status === "blocked" && result !== "blocked") {
    throw new RecordError(`Blocked status requires a response whose Status or Verdict is blocked`);
  }
}

export interface FinalizeLaunchOptions {
  readonly recordPath: string;
  readonly agentId: string;
  readonly status: LaunchStatus;
  readonly enforcement: EnforcementLevel;
  readonly model?: string;
}

interface FinalizeFields {
  readonly agentId?: string;
  readonly enforcement: EnforcementLevel;
  readonly model?: string;
}

async function finalizeRecord(
  options: { readonly recordPath: string; readonly status: LaunchStatus },
  identityChecks: (prepared: PreparedLaunchRecord, loaded: LoadedRecord) => Promise<FinalizeFields>,
): Promise<FinalizedLaunchRecord> {
  const loaded = await loadRecord(options.recordPath);
  if (loaded.record.state !== "prepared") {
    throw new RecordError(`Launch record is already finalized`);
  }
  const prepared = loaded.record;
  const fields = await identityChecks(prepared, loaded);
  await Promise.all([
    verifyArtifact(prepared.prompt, prepared.work.path, "Prompt"),
    verifyArtifact(prepared.capabilities, prepared.work.path, "Capability artifact"),
  ]);
  if (sha256(serializeGrant(prepared.grant)) !== prepared.capabilities.sha256) {
    throw new RecordError(`Effective grant changed after preparation`);
  }
  const design = await completedDesign(prepared);
  await completedWorkspace(prepared);
  const response = await regularFile(prepared.response.path, prepared.work.path, "Response");
  const result = inferRoleResult(response);
  validateRoleResult(prepared, options.status, result);
  const finalized: FinalizedLaunchRecord = {
    ...prepared,
    state: "finalized",
    response: {
      path: prepared.response.path,
      sha256: sha256(response),
      bytes: response.byteLength,
    },
    status: options.status,
    result,
    ...fields,
    ...(design === undefined ? {} : { design }),
  };
  await writeFile(loaded.path, `${JSON.stringify(finalized, undefined, 2)}\n`, "utf8");
  return finalized;
}

export async function finalizeLaunch(
  options: FinalizeLaunchOptions,
): Promise<FinalizedLaunchRecord> {
  text(options.agentId, "Agent identity");
  if (options.model !== undefined) text(options.model, "Model");
  return finalizeRecord(options, async (prepared, loaded) => {
    if (prepared.execution !== "delegated" || prepared.harness === "coordinator") {
      throw new RecordError(`launch complete requires delegated execution`);
    }
    if (prepared.launched !== undefined && options.agentId !== prepared.launched.agentId) {
      throw new RecordError(`Completion agent does not match the agent recorded at launch`);
    }
    if (prepared.relationship?.kind === "continuation") {
      if (
        prepared.harness !== prepared.relationship.targetHarness ||
        options.agentId !== prepared.relationship.targetAgentId
      ) {
        throw new RecordError(`Continuation must use the snapshotted harness and agent`);
      }
    } else {
      if (
        prepared.relationship?.kind === "replacement" &&
        prepared.harness === prepared.relationship.targetHarness &&
        options.agentId === prepared.relationship.targetAgentId
      ) {
        throw new RecordError(`Replacement must use a new agent identity`);
      }
      await requireFreshIdentity(prepared, loaded.path, options.agentId);
    }
    return {
      agentId: options.agentId,
      enforcement: options.enforcement,
      ...(options.model === undefined ? {} : { model: options.model }),
    };
  });
}

interface FinalizeSimulationOptions {
  readonly recordPath: string;
  readonly status: LaunchStatus;
}

export async function finalizeSimulation(
  options: FinalizeSimulationOptions,
): Promise<FinalizedLaunchRecord> {
  return finalizeRecord(options, async (prepared) => {
    if (prepared.execution !== "simulated" || prepared.harness !== "coordinator") {
      throw new RecordError(`simulation complete requires simulated execution`);
    }
    return { enforcement: "prompt-guided" };
  });
}

interface DesignDigest {
  readonly digest: string;
  readonly files: number;
}

interface DesignSnapshot extends DesignDigest {
  readonly fileDigests: readonly DesignFileDigest[];
}

async function snapshotDesign(directory: string): Promise<DesignSnapshot> {
  const root = resolve(directory);
  const entry = await lstat(root).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new RecordError(`Cannot inspect design root: ${root}: ${String(error)}`);
  });
  if (entry?.isSymbolicLink() || (entry !== undefined && !entry.isDirectory())) {
    throw new RecordError(`Design root must be a directory, not a symbolic link: ${root}`);
  }
  const files =
    entry === undefined
      ? []
      : await walkFiles(root, (_path, relativePath) => relativePath.endsWith(".md"), {
          symlink: (path) => {
            throw new RecordError(`Design contains a symbolic link: ${path}`);
          },
        });

  const digest = createHash("sha256");
  const fileDigests: DesignFileDigest[] = [];
  for (const path of files) {
    const relativePath = posixRelative(root, path);
    const content = await readFile(path);
    digest
      .update(relativePath)
      .update("\0")
      .update(String(content.byteLength))
      .update("\0")
      .update(content);
    fileDigests.push({ path: relativePath, sha256: sha256(content) });
  }
  return { digest: digest.digest("hex"), files: files.length, fileDigests };
}

export async function digestDesign(directory: string): Promise<DesignDigest> {
  const { digest, files } = await snapshotDesign(directory);
  return { digest, files };
}
