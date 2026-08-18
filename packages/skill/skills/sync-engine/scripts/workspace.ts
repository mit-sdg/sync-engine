import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Compiler-owned directory for generated prompts, follow-ups, assignments, and launch records. */
export const workspaceDirectory = ".sync-engine";

export type WorkspaceKind = "prompt" | "followup" | "assignment" | "launch";

const extensions: Readonly<Record<WorkspaceKind, string>> = {
  prompt: "prompt.md",
  followup: "followup.md",
  assignment: "assignment.md",
  launch: "launch.json",
};

export class WorkspaceError extends Error {
  override readonly name = "WorkspaceError";
}

export function workspaceRoot(applicationRoot: string = process.cwd()): string {
  return resolve(applicationRoot, workspaceDirectory);
}

export function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

export function requireInsideWorkspace(path: string, applicationRoot?: string): string {
  const resolved = resolve(path);
  const root = workspaceRoot(applicationRoot);
  if (!inside(root, resolved) || resolved === root) {
    throw new WorkspaceError(
      `Generated workflow files belong in ${workspaceDirectory}/; ${path} is outside it`,
    );
  }
  return resolved;
}

/** Seconds-resolution UTC stamp that sorts chronologically and is safe on every filesystem. */
export function stamp(at: Date = new Date()): string {
  return `${at.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
}

export async function reserveWorkspacePath(
  kind: WorkspaceKind,
  label: string,
  applicationRoot?: string,
  at?: Date,
): Promise<string> {
  const root = workspaceRoot(applicationRoot);
  await mkdir(root, { recursive: true });
  const base = `${stamp(at)}-${label}`;
  const extension = extensions[kind];
  for (let attempt = 0; ; attempt += 1) {
    const name = attempt === 0 ? `${base}.${extension}` : `${base}-${attempt + 1}.${extension}`;
    const candidate = resolve(root, name);
    if (!existsSync(candidate)) return candidate;
  }
}

export interface LaunchRecord {
  readonly format: "sync-engine.skill.launch-record";
  readonly version: 1;
  readonly role: string;
  readonly agentId: string;
  readonly parentAgentId?: string;
  readonly provider: string;
  readonly model: string;
  readonly thinking?: string;
  readonly cwd: string;
  readonly prompt: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly startedAt: string;
  readonly settledAt: string;
  readonly status: string;
}

export function isLaunchRecord(value: unknown): value is LaunchRecord {
  const record = value as LaunchRecord | undefined;
  return (
    typeof record === "object" &&
    record !== null &&
    record.format === "sync-engine.skill.launch-record" &&
    record.version === 1 &&
    typeof record.role === "string" &&
    typeof record.agentId === "string" &&
    typeof record.provider === "string" &&
    typeof record.model === "string" &&
    typeof record.prompt?.sha256 === "string" &&
    typeof record.prompt.path === "string"
  );
}

export async function writeLaunchRecord(path: string, record: LaunchRecord): Promise<void> {
  await writeFile(path, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
}

/** The role that must already have run and settled before each later role is built. */
export const roleAfter: Readonly<Record<string, string>> = {
  critic: "designer",
  "concept-worker": "critic",
  "application-worker": "concept-worker",
  "frontend-worker": "application-worker",
  "evidence-worker": "application-worker",
};

export const requiredRoles = [
  "designer",
  "critic",
  "concept-worker",
  "application-worker",
  "evidence-worker",
] as const;

/** A record counts only when its prompt file still exists and still hashes to the record. */
export async function verifiedRecords(
  role: string,
  applicationRoot?: string,
): Promise<Array<{ path: string; record: LaunchRecord }>> {
  const found: Array<{ path: string; record: LaunchRecord }> = [];
  for (const entry of await readLaunchRecords(applicationRoot)) {
    if (entry.record.role !== role) continue;
    let content: string;
    try {
      content = await readFile(entry.record.prompt.path, "utf8");
    } catch {
      continue;
    }
    if (createHash("sha256").update(content).digest("hex") === entry.record.prompt.sha256) {
      found.push(entry);
    }
  }
  return found;
}

export async function requireCompletedRole(role: string, applicationRoot?: string): Promise<void> {
  const predecessor = roleAfter[role];
  if (predecessor === undefined) return;
  if ((await verifiedRecords(predecessor, applicationRoot)).length > 0) return;
  throw new WorkspaceError(
    `Role ${role} requires a settled ${predecessor} launch in ${workspaceDirectory}/; launch that role first`,
  );
}

/** Every readable launch record in the workspace, oldest file name first. */
export async function readLaunchRecords(
  applicationRoot?: string,
): Promise<Array<{ path: string; record: LaunchRecord }>> {
  const root = workspaceRoot(applicationRoot);
  if (!existsSync(root)) return [];
  const found: Array<{ path: string; record: LaunchRecord }> = [];
  for (const name of (await readdir(root)).sort()) {
    if (!name.endsWith(`.${extensions.launch}`)) continue;
    const path = resolve(root, name);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, "utf8"));
    } catch {
      throw new WorkspaceError(`Launch record is not readable JSON: ${path}`);
    }
    if (!isLaunchRecord(value)) throw new WorkspaceError(`Launch record is malformed: ${path}`);
    found.push({ path, record: value });
  }
  return found;
}
