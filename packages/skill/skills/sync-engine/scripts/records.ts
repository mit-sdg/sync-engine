import { createHash } from "node:crypto";
import { lstat, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { HarnessId } from "./harness.ts";
import type { EffectiveCapabilityGrant, RoleId, RolePhase } from "./roles.ts";
import {
  type RunArtifacts,
  type WorkUnit,
  canonicalPath,
  requirePathInWorkUnit,
  requireSafeRunLabel,
  requireWorkUnit,
  reserveRunArtifacts,
} from "./work.ts";

export const launchStatuses = ["completed", "failed", "cancelled", "timed-out"] as const;
export const enforcementLevels = ["harness-enforced", "prompt-guided"] as const;
export type LaunchStatus = (typeof launchStatuses)[number];
export type EnforcementLevel = (typeof enforcementLevels)[number];

const harnessValues = ["paseo", "pi", "codex", "claude-code", "antigravity", "cursor"] as const;
export type ExecutionMode = "delegated" | "simulated";
export type ExecutionHarness = HarnessId | "coordinator";
const rolePhaseValues = [
  "designer/decomposition",
  "designer/contracts",
  "critic/decomposition",
  "critic/contracts",
  "critic/verification",
  "concept-worker/implementation",
  "application-worker/implementation",
  "frontend-worker/implementation",
  "evidence-worker/evidence",
] as const;

export class RecordError extends Error {
  override readonly name = "RecordError";
}

export interface RetainedSource {
  readonly inputId: string;
  readonly displayName: string;
  readonly sha256: string;
}

export interface DesignBinding {
  readonly root: string;
  readonly before: string;
  readonly after?: string;
}

export interface LaunchRelationship {
  readonly kind: "continuation" | "replacement";
  readonly recordPath: string;
  readonly targetHarness: HarnessId;
  readonly targetAgentId: string;
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
  readonly design?: DesignBinding;
  readonly relationship?: LaunchRelationship;
}

export interface PreparedLaunchRecord extends LaunchRecordBase {
  readonly state: "prepared";
}

export interface FinalizedLaunchRecord extends LaunchRecordBase {
  readonly state: "finalized";
  readonly response: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly agentId?: string;
  readonly status: LaunchStatus;
  readonly enforcement: EnforcementLevel;
  readonly model?: string;
}

export type LaunchRecord = PreparedLaunchRecord | FinalizedLaunchRecord;

export function normalizeLaunchStatus(status: string): LaunchStatus {
  const value = status.trim().toLowerCase().replaceAll("_", "-");
  if (/^(?:complete|completed|idle|settled|success|succeeded)$/.test(value)) return "completed";
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
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RecordError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
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
  if (!harnessValues.includes(value as HarnessId)) throw new RecordError(`${name} is invalid`);
  return value as HarnessId;
}

function rolePhase(role: unknown, phase: unknown): [RoleId, RolePhase] {
  const id = `${text(role, "Role")}/${text(phase, "Phase")}`;
  if (!rolePhaseValues.includes(id as (typeof rolePhaseValues)[number])) {
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

  if (record["design"] !== undefined) {
    const design = object(record["design"], "Design binding");
    absolutePath(design["root"], "Design root");
    hash(design["before"], "Design before digest");
    if (design["after"] !== undefined) hash(design["after"], "Design after digest");
    const writer = role === "designer" && phase === "contracts";
    if (record["state"] === "prepared" && design["after"] !== undefined) {
      throw new RecordError(`Prepared design binding cannot have an after digest`);
    }
    if (record["state"] === "finalized" && writer !== (design["after"] !== undefined)) {
      throw new RecordError(`Finalized design after digest does not match the role`);
    }
  }
  if (record["relationship"] !== undefined) {
    if (execution === "simulated") {
      throw new RecordError(`Simulated execution cannot claim same-agent continuity`);
    }
    const relationship = object(record["relationship"], "Launch relationship");
    if (relationship["kind"] !== "continuation" && relationship["kind"] !== "replacement") {
      throw new RecordError(`Launch relationship kind is invalid`);
    }
    absolutePath(relationship["recordPath"], "Related record path");
    harness(relationship["targetHarness"], "Related harness");
    text(relationship["targetAgentId"], "Related agent identity");
  }
  if (record["state"] === "finalized") {
    if (execution === "delegated") text(record["agentId"], "Agent identity");
    else if (record["agentId"] !== undefined) {
      throw new RecordError(`Simulated execution cannot claim an agent identity`);
    }
    if (!launchStatuses.includes(record["status"] as LaunchStatus)) {
      throw new RecordError(`Finalized record has an unknown status`);
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
  return resolve(workPath, "../../..", "design");
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

function markdown(value: string | Uint8Array, name: string): Uint8Array {
  const content = bytes(value);
  try {
    if (new TextDecoder("utf-8", { fatal: true }).decode(content).trim() === "") {
      throw new Error("empty");
    }
  } catch {
    throw new RecordError(`${name} must be non-empty readable UTF-8`);
  }
  return content;
}

async function prepareRelationship(
  input: Pick<LaunchRelationship, "kind" | "recordPath"> | undefined,
  unit: WorkUnit,
  role: RoleId,
  selectedHarness: ExecutionHarness,
): Promise<LaunchRelationship | undefined> {
  if (input === undefined) return undefined;
  if (selectedHarness === "coordinator") {
    throw new RecordError(`Simulated execution cannot continue or replace an agent`);
  }
  const target = await loadRecord(input.recordPath);
  if (target.record.state !== "finalized") throw new RecordError(`Related launch is not finalized`);
  if (
    target.record.execution !== "delegated" ||
    target.record.harness === "coordinator" ||
    target.record.agentId === undefined
  ) {
    throw new RecordError(`Related launch is not a delegated agent run`);
  }
  if (target.record.work.path !== unit.path || target.record.role !== role) {
    throw new RecordError(`Related launch belongs to another work unit or role`);
  }
  if (input.kind === "continuation" && selectedHarness !== target.record.harness) {
    throw new RecordError(`Continuation must select the related launch harness`);
  }
  return {
    kind: input.kind,
    recordPath: directWorkPath(target.path, unit.path, "Related record"),
    targetHarness: target.record.harness,
    targetAgentId: target.record.agentId,
  };
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
  if ((await digestDesign(root)).digest !== before) {
    throw new RecordError(`Design changed before launch preparation`);
  }
  return { root, before };
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
  const design = await prepareDesign(options.design, unit);
  const relationship = await prepareRelationship(options.relationship, unit, role, selectedHarness);
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
    await writeFile(artifacts.taskPath, task, { flag: "wx" });
    created.push(artifacts.taskPath);
    await writeFile(artifacts.capabilitiesPath, grantContent, { flag: "wx" });
    created.push(artifacts.capabilitiesPath);
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
      ...(design === undefined ? {} : { design }),
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

export interface FinalizeLaunchOptions {
  readonly recordPath: string;
  readonly agentId: string;
  readonly status: LaunchStatus;
  readonly enforcement: EnforcementLevel;
  readonly model?: string;
}

export async function finalizeLaunch(
  options: FinalizeLaunchOptions,
): Promise<FinalizedLaunchRecord> {
  text(options.agentId, "Agent identity");
  if (!launchStatuses.includes(options.status)) {
    throw new RecordError(`Unknown normalized launch status`);
  }
  if (!enforcementLevels.includes(options.enforcement)) {
    throw new RecordError(`Unknown enforcement level`);
  }
  if (options.model !== undefined) text(options.model, "Model");

  const loaded = await loadRecord(options.recordPath);
  if (loaded.record.state !== "prepared")
    throw new RecordError(`Launch record is already finalized`);
  const prepared = loaded.record;
  if (prepared.execution !== "delegated" || prepared.harness === "coordinator") {
    throw new RecordError(`launch complete requires delegated execution`);
  }
  await Promise.all([
    verifyArtifact(prepared.prompt, prepared.work.path, "Prompt"),
    verifyArtifact(prepared.capabilities, prepared.work.path, "Capability artifact"),
  ]);
  if (sha256(serializeGrant(prepared.grant)) !== prepared.capabilities.sha256) {
    throw new RecordError(`Effective grant changed after preparation`);
  }

  let design = prepared.design;
  if (design !== undefined) {
    const current = (await digestDesign(design.root)).digest;
    if (prepared.role === "designer" && prepared.phase === "contracts") {
      design = { ...design, after: current };
    } else if (current !== design.before) {
      throw new RecordError(`Design changed after preparation`);
    }
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

  const response = await regularFile(prepared.response.path, prepared.work.path, "Response");
  const finalized: FinalizedLaunchRecord = {
    ...prepared,
    state: "finalized",
    response: {
      path: prepared.response.path,
      sha256: sha256(response),
      bytes: response.byteLength,
    },
    agentId: options.agentId,
    status: options.status,
    enforcement: options.enforcement,
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(design === undefined ? {} : { design }),
  };
  await writeFile(loaded.path, `${JSON.stringify(finalized, undefined, 2)}\n`, "utf8");
  return finalized;
}

export interface FinalizeSimulationOptions {
  readonly recordPath: string;
  readonly status: LaunchStatus;
}

export async function finalizeSimulation(
  options: FinalizeSimulationOptions,
): Promise<FinalizedLaunchRecord> {
  if (!launchStatuses.includes(options.status)) {
    throw new RecordError(`Unknown normalized launch status`);
  }
  const loaded = await loadRecord(options.recordPath);
  if (loaded.record.state !== "prepared") {
    throw new RecordError(`Launch record is already finalized`);
  }
  const prepared = loaded.record;
  if (prepared.execution !== "simulated" || prepared.harness !== "coordinator") {
    throw new RecordError(`simulation complete requires simulated execution`);
  }
  await Promise.all([
    verifyArtifact(prepared.prompt, prepared.work.path, "Prompt"),
    verifyArtifact(prepared.capabilities, prepared.work.path, "Capability artifact"),
  ]);
  if (sha256(serializeGrant(prepared.grant)) !== prepared.capabilities.sha256) {
    throw new RecordError(`Effective grant changed after preparation`);
  }

  let design = prepared.design;
  if (design !== undefined) {
    const current = (await digestDesign(design.root)).digest;
    if (prepared.role === "designer" && prepared.phase === "contracts") {
      design = { ...design, after: current };
    } else if (current !== design.before) {
      throw new RecordError(`Design changed after preparation`);
    }
  }
  const response = await regularFile(prepared.response.path, prepared.work.path, "Response");
  const finalized: FinalizedLaunchRecord = {
    ...prepared,
    state: "finalized",
    response: {
      path: prepared.response.path,
      sha256: sha256(response),
      bytes: response.byteLength,
    },
    status: options.status,
    enforcement: "prompt-guided",
    ...(design === undefined ? {} : { design }),
  };
  await writeFile(loaded.path, `${JSON.stringify(finalized, undefined, 2)}\n`, "utf8");
  return finalized;
}

export interface DesignDigest {
  readonly digest: string;
  readonly files: number;
}

interface DesignFile {
  readonly path: string;
  readonly relativePath: string;
}

async function designFiles(root: string, directory: string): Promise<DesignFile[]> {
  const files: DesignFile[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) throw new RecordError(`Design contains a symbolic link: ${path}`);
    if (entry.isDirectory()) files.push(...(await designFiles(root, path)));
    else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push({ path, relativePath: relative(root, path).split(sep).join("/") });
    }
  }
  return files;
}

export async function digestDesign(directory: string): Promise<DesignDigest> {
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
      : (await designFiles(root, root)).sort((left, right) =>
          left.relativePath < right.relativePath
            ? -1
            : left.relativePath > right.relativePath
              ? 1
              : 0,
        );

  const digest = createHash("sha256");
  for (const file of files) {
    const content = await readFile(file.path);
    digest
      .update(file.relativePath)
      .update("\0")
      .update(String(content.byteLength))
      .update("\0")
      .update(content);
  }
  return { digest: digest.digest("hex"), files: files.length };
}
