import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** The agent status that means a launched role finished; anything else is unsettled. */
export const settledStatus = "idle";

/** Statuses a role never leaves on its own. Waiting past one only burns the deadline. */
export const finishedStatuses: readonly string[] = [settledStatus, "error", "failed", "closed"];

/** A dropped stream and a role's own failure both report `error`; ask before giving up. */
export const resumableStatus = "error";

/** Compiler-owned directory for generated prompts, follow-ups, assignments, and launch records. */
export const workspaceDirectory = ".sync-engine";

export type WorkspaceKind = "prompt" | "followup" | "assignment" | "launch" | "response";

const extensions: Readonly<Record<WorkspaceKind, string>> = {
  prompt: "prompt.md",
  followup: "followup.md",
  assignment: "assignment.md",
  launch: "launch.json",
  response: "response.md",
};

/** What a built prompt was made from, so a launch can record it without rebuilding. */
export interface PromptContext {
  readonly format: "sync-engine.skill.prompt-context";
  readonly version: 1;
  readonly role: string;
  readonly sha256: string;
  readonly briefSha256?: string;
  readonly designDigest?: string;
}

export function promptContextPath(promptPath: string): string {
  return promptPath.replace(/\.md$/, ".json");
}

export async function writePromptContext(
  promptPath: string,
  context: PromptContext,
): Promise<void> {
  await writeFile(
    promptContextPath(promptPath),
    `${JSON.stringify(context, undefined, 2)}\n`,
    "utf8",
  );
}

export async function readPromptContext(promptPath: string): Promise<PromptContext | undefined> {
  try {
    const value = JSON.parse(
      await readFile(promptContextPath(promptPath), "utf8"),
    ) as PromptContext;
    return value.format === "sync-engine.skill.prompt-context" ? value : undefined;
  } catch {
    return undefined;
  }
}

export class WorkspaceError extends Error {
  override readonly name = "WorkspaceError";
}

/**
 * Resolve symbolic links as far as the path exists. Comparing paths textually is not
 * enough: macOS reaches temporary and user directories through `/var` -> `/private/var`,
 * so a caller's path and the process's own working directory can name one directory in
 * two spellings.
 */
export function canonical(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    const parent = dirname(resolved);
    return parent === resolved ? resolved : resolve(canonical(parent), basename(resolved));
  }
}

export function workspaceRoot(applicationRoot: string = process.cwd()): string {
  return canonical(resolve(applicationRoot, workspaceDirectory));
}

export function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

export function requireInsideWorkspace(path: string, applicationRoot?: string): string {
  const resolved = canonical(path);
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

/** The role a compiler-named workspace file belongs to, or undefined if it was not one. */
export function workspaceFileRole(name: string, kind: WorkspaceKind): string | undefined {
  const suffix = extensions[kind].replaceAll(".", "\\.");
  return name.match(
    new RegExp(`^\\d{4}-\\d{2}-\\d{2}T[\\d-]+Z-([a-z-]+?)(?:-\\d+)?\\.${suffix}$`),
  )?.[1];
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
  readonly briefSha256?: string;
  readonly designDigest?: string;
  readonly startedAt: string;
  readonly settledAt: string;
  readonly status: string;
  readonly response?: {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
    readonly contract: "met" | "violated";
  };
  readonly readViolations?: readonly string[];
  readonly rewrites?: readonly Readonly<{ path: string; writes: number }>[];
  /** Present when the harness named its tools without arguments, so paths were unseen. */
  readonly readAudit?: "unavailable";
  readonly resumes?: number;
}

/**
 * Where a role may read: a designer or critic from supplied prompt material alone, an
 * implementation role additionally from the installed package's examples and user docs.
 * No role reads the skill's own sources; the compiler delivers what each one needs.
 *
 * A breach is recorded rather than enforced. The role has already done its work, the same
 * prompt would produce the same reads, and only whoever maintains the prompts can act on
 * it, so handback reports it instead of discarding the delivery.
 */
export function readAudit(role: string, paths: readonly string[], skillRoot?: string): string[] {
  const skill = skillRoot === undefined ? undefined : canonical(skillRoot);
  const offending: string[] = [];
  for (const path of paths) {
    const normalized = path.split(sep).join("/");
    // A harness advertises its skills, so a role may open the entry document without
    // choosing to. What no role may open is the compiler and the prompt sources.
    if (skill !== undefined && inside(skill, canonical(path)) && basename(path) !== "SKILL.md") {
      offending.push(path);
      continue;
    }
    const packaged = normalized.match(/(^|\/)node_modules\/(.*)$/)?.[2];
    if (packaged === undefined) continue;
    if (role === "designer" || role === "critic") {
      offending.push(path);
      continue;
    }
    if (!packaged.startsWith("@mit-sdg/")) continue;
    const withinPackage = packaged.replace(/^@mit-sdg\/[^/]+\//, "");
    if (!withinPackage.startsWith("examples/") && !withinPackage.startsWith("docs/user/")) {
      offending.push(path);
    }
  }
  return [...new Set(offending)];
}

/**
 * What a role must return. A reply that buries its verdict costs the coordinator the
 * context the boundary exists to protect, so check the shape at the boundary.
 */
/** The prompt shows each verdict inside a fence, so a faithful reply may reproduce one. */
function unfenced(text: string): string {
  const fenced = text.match(/^```[a-z]*\n([\s\S]*?)\n?```$/);
  return fenced === null ? text : fenced[1]!.trim();
}

export function responseContract(role: string, response: string): string | undefined {
  const text = unfenced(response.trim());
  if (text === "") return `${role} returned nothing`;
  if (role !== "critic") return undefined;
  if (text === "No material findings.") return undefined;
  if (text.startsWith("- `")) return undefined;
  return `critic must return "No material findings." or begin with its findings, with no preamble`;
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

export function previousRole(role: string): string | undefined {
  return roleAfter[role];
}

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
  designDigest?: string,
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
    if (entry.record.status !== settledStatus) continue;
    if (entry.record.response?.contract === "violated") continue;
    if (
      designDigest !== undefined &&
      entry.record.designDigest !== undefined &&
      entry.record.designDigest !== designDigest
    ) {
      continue;
    }
    if (createHash("sha256").update(content).digest("hex") === entry.record.prompt.sha256) {
      found.push(entry);
    }
  }
  return found;
}

/**
 * A delivery is bound to the design it was built against. A record from another digest
 * stops counting, so reopening design relaunches the roles under it rather than leaving
 * the coordinator to judge whether stale work still holds.
 */
export async function requireCompletedRole(
  role: string,
  applicationRoot?: string,
  designDigest?: string,
): Promise<void> {
  const predecessor = roleAfter[role];
  if (predecessor === undefined) return;
  if ((await verifiedRecords(predecessor, applicationRoot, designDigest)).length > 0) return;
  const stale =
    designDigest === undefined
      ? []
      : (await verifiedRecords(predecessor, applicationRoot)).filter(
          (entry) => entry.record.designDigest !== undefined,
        );
  if (stale.length > 0) {
    throw new WorkspaceError(
      `Role ${role} requires a ${predecessor} launched against design ${designDigest}; the settled one used ${stale[stale.length - 1]!.record.designDigest}. Design reopened after that role ran, so relaunch it`,
    );
  }
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

/**
 * A registry may only register the concept class its module imports. A class declared
 * beside the registration narrows what source agreement sees, so the assembly runs an
 * object the concept tests never construct.
 */
export async function registrationWrappers(applicationRoot?: string): Promise<string[]> {
  const root = resolve(applicationRoot ?? process.cwd(), "src/concepts");
  let entries: string[];
  try {
    entries = (await readdir(root)).filter((name) => name.endsWith(".registry.ts"));
  } catch {
    return [];
  }
  const offending: string[] = [];
  for (const name of entries.sort()) {
    const source = await readFile(resolve(root, name), "utf8");
    const registered = source.match(/class:\s*([A-Za-z_$][\w$]*)/)?.[1];
    if (registered === undefined) continue;
    const declared = new RegExp(`\\bclass\\s+${registered}\\b`).test(source);
    if (declared) offending.push(`src/concepts/${name} registers ${registered} declared beside it`);
  }
  return offending;
}
