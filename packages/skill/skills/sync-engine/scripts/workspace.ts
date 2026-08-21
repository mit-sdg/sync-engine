import { existsSync, realpathSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  contractCleanViolation,
  isCleanContractResponse,
  mapResponseAccepted,
  mapResponseViolation,
  type ReviewExpectation,
} from "./review.ts";

/** Paseo's status for a role that finished and can receive a follow-up. */
export const settledStatus = "idle";

/** Native harness records use one portable terminal status instead of a harness spelling. */
export const portableSettledStatus = "settled";

export function isSettledStatus(status: string): boolean {
  return status === settledStatus || status === portableSettledStatus;
}

/** Statuses a role never leaves on its own. Waiting past one only burns the deadline. */
export const finishedStatuses: readonly string[] = [settledStatus, "error", "failed", "closed"];

/** A dropped stream and a role's own failure both report `error`; ask before giving up. */
export const resumableStatus = "error";

/** Compiler-owned directory for generated prompts, follow-ups, assignments, and launch records. */
export const workspaceDirectory = ".sync-engine";

export type WorkspaceKind = "prompt" | "followup" | "assignment" | "ticket" | "launch" | "response";

const extensions: Readonly<Record<WorkspaceKind, string>> = {
  prompt: "prompt.md",
  followup: "followup.md",
  assignment: "assignment.md",
  ticket: "ticket.json",
  launch: "launch.json",
  response: "response.md",
};

/** What a built prompt was made from, so a launch can record it without rebuilding. */
export interface PromptContext {
  readonly format: "sync-engine.skill.prompt-context";
  readonly version: 1;
  readonly role: string;
  readonly mode?: "map" | "contract";
  readonly toolPolicy?:
    | "prompt-read-only"
    | "decomposition-write-only"
    | "design-and-syntax-only"
    | "assignment-only";
  readonly sha256: string;
  readonly briefSha256?: string;
  readonly designDigest?: string;
  /** Critic prompts bind the exact review sequence and expected response coverage. */
  readonly reviewPass?: number;
  readonly mapRows?: readonly string[];
  readonly placementIds?: readonly string[];
  readonly obligationIds?: readonly string[];
  /** A direct human instruction may waive a review judgment, never an integrity check. */
  readonly userOverride?: true;
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

export type LaunchAttestation = "harness" | "coordinator";

export interface LaunchRecord {
  readonly format: "sync-engine.skill.launch-record";
  readonly version: 1;
  readonly role: string;
  readonly mode?: "map" | "contract";
  readonly toolPolicy?: string;
  readonly agentId: string;
  readonly parentAgentId?: string;
  /** Absent only on records written before harness identity became explicit. */
  readonly harness?: string;
  /** Harness means machine-observed; coordinator means the native delegation was recorded. */
  readonly attestation?: LaunchAttestation;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly cwd: string;
  readonly prompt: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly briefSha256?: string;
  readonly designDigest?: string;
  readonly reviewPass?: number;
  readonly mapRows?: readonly string[];
  readonly placementIds?: readonly string[];
  readonly obligationIds?: readonly string[];
  readonly userOverride?: true;
  readonly startedAt: string;
  readonly settledAt: string;
  readonly status: string;
  /** Present on coordinator-mediated native launches and bound to this record by hash. */
  readonly launchTicket?: { readonly path: string; readonly sha256: string };
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

export function responseContract(
  role: string,
  response: string,
  mode?: "map" | "contract",
  expectation: ReviewExpectation = {},
): string | undefined {
  const text = unfenced(response.trim());
  if (text === "") return `${role} returned nothing`;
  if (role === "designer") {
    if (mode === "map" && text.startsWith("Changed: design/decomposition.md\nQuestions: ")) {
      return undefined;
    }
    if (
      mode === "contract" &&
      text.startsWith("Changed:\n") &&
      text.includes("\nCheck: ") &&
      text.includes("\nBlocker: ")
    ) {
      return undefined;
    }
    return `designer must return the exact ${mode ?? "current"} phase envelope`;
  }
  if (role.endsWith("-worker")) {
    if (
      text.startsWith("Changed:\n") &&
      text.includes("\nChecks:\n") &&
      text.includes("\nBlocker: ") &&
      text.includes("\nBudget: ")
    ) {
      return undefined;
    }
    return `${role} must return its Changed, Checks, Blocker, and Budget envelope`;
  }
  if (role !== "critic") return undefined;
  if (mode === "map") return mapResponseViolation(text, expectation);
  if (isCleanContractResponse(text)) {
    return contractCleanViolation(text, expectation.obligationIds);
  }
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  if (
    lines.every(
      (line) =>
        line.startsWith("- `BLOCKER` — `") || line.startsWith("- `MATERIAL-NONBLOCKER` — `"),
    )
  ) {
    return undefined;
  }
  return `contract critic must return its CHECK/VERDICT clean envelope or begin with a classified finding, with no preamble`;
}

export function isLaunchRecord(value: unknown): value is LaunchRecord {
  const record = value as LaunchRecord | undefined;
  return (
    typeof record === "object" &&
    record !== null &&
    record.format === "sync-engine.skill.launch-record" &&
    record.version === 1 &&
    typeof record.role === "string" &&
    (record.mode === undefined || record.mode === "map" || record.mode === "contract") &&
    (record.toolPolicy === undefined || typeof record.toolPolicy === "string") &&
    typeof record.agentId === "string" &&
    (record.harness === undefined || typeof record.harness === "string") &&
    (record.attestation === undefined ||
      record.attestation === "harness" ||
      record.attestation === "coordinator") &&
    (record.provider === undefined || typeof record.provider === "string") &&
    (record.model === undefined || typeof record.model === "string") &&
    typeof record.prompt?.sha256 === "string" &&
    typeof record.prompt.path === "string"
  );
}

export async function writeLaunchRecord(path: string, record: LaunchRecord): Promise<void> {
  await writeFile(path, `${JSON.stringify(record, undefined, 2)}\n`, "utf8");
}

export interface RolePhase {
  readonly role: string;
  readonly mode?: "map" | "contract";
}

/** The exact independently recorded phase that must precede a prompt or launch. */
export function previousPhase(role: string, mode?: "map" | "contract"): RolePhase | undefined {
  if (role === "designer" && mode === "contract") return { role: "critic", mode: "map" };
  if (role === "critic" && mode === "map") return { role: "designer", mode: "map" };
  if (role === "critic") return { role: "designer", mode: "contract" };
  if (role === "concept-worker") return { role: "critic", mode: "contract" };
  if (role === "application-worker") return { role: "concept-worker" };
  if (role === "frontend-worker" || role === "evidence-worker") {
    return { role: "application-worker" };
  }
  return undefined;
}

export const requiredPhases: readonly RolePhase[] = [
  { role: "designer", mode: "map" },
  { role: "critic", mode: "map" },
  { role: "designer", mode: "contract" },
  { role: "critic", mode: "contract" },
  { role: "concept-worker" },
  { role: "application-worker" },
  { role: "evidence-worker" },
];

/** A record counts only when its prompt file still exists and still hashes to the record. */
export async function verifiedRecords(
  role: string,
  applicationRoot?: string,
  designDigest?: string,
  mode?: "map" | "contract",
): Promise<Array<{ path: string; record: LaunchRecord }>> {
  const found: Array<{ path: string; record: LaunchRecord }> = [];
  for (const entry of await readLaunchRecords(applicationRoot)) {
    if (entry.record.role !== role || (mode !== undefined && entry.record.mode !== mode)) continue;
    let content: string;
    try {
      content = await readFile(entry.record.prompt.path, "utf8");
    } catch {
      continue;
    }
    if (!isSettledStatus(entry.record.status)) continue;
    if (entry.record.response?.contract === "violated") continue;
    if (entry.record.response !== undefined) {
      try {
        const response = await readFile(entry.record.response.path, "utf8");
        if (createHash("sha256").update(response).digest("hex") !== entry.record.response.sha256) {
          continue;
        }
      } catch {
        continue;
      }
    }
    if (entry.record.launchTicket !== undefined) {
      try {
        const ticket = await readFile(entry.record.launchTicket.path, "utf8");
        if (
          createHash("sha256").update(ticket).digest("hex") !== entry.record.launchTicket.sha256
        ) {
          continue;
        }
      } catch {
        continue;
      }
    }
    if (designDigest !== undefined && entry.record.designDigest !== designDigest) continue;
    if (createHash("sha256").update(content).digest("hex") === entry.record.prompt.sha256) {
      found.push(entry);
    }
  }
  return found;
}

/** Review sequences are bounded by the brief, even when contract repair changes the digest. */
export async function reviewRecords(
  mode: "map" | "contract",
  briefSha256: string,
  applicationRoot?: string,
): Promise<Array<{ path: string; record: LaunchRecord }>> {
  return (await verifiedRecords("critic", applicationRoot, undefined, mode)).filter(
    (entry) => entry.record.briefSha256 === briefSha256,
  );
}

export async function nextReviewPass(
  mode: "map" | "contract",
  briefSha256: string,
  applicationRoot?: string,
  userOverride = false,
): Promise<number> {
  const count = (await reviewRecords(mode, briefSha256, applicationRoot)).length;
  if (count >= 2 && !userOverride) {
    throw new WorkspaceError(
      `${mode === "map" ? "Map" : "Contract"} review reached its default ceiling of two settled passes; a direct human instruction may continue with --user-override`,
    );
  }
  return count + 1;
}

/** Reject stale or concurrently prepared critic prompts; user override only lifts the ceiling. */
export async function requireReviewPass(
  mode: "map" | "contract",
  briefSha256: string,
  pass: number,
  applicationRoot?: string,
  userOverride = false,
): Promise<void> {
  const expected = await nextReviewPass(mode, briefSha256, applicationRoot, userOverride);
  if (pass !== expected) {
    throw new WorkspaceError(
      `${mode === "map" ? "Map" : "Contract"} critic prompt is for pass ${pass}, but the next allowed pass is ${expected}`,
    );
  }
}

export async function capturedResponse(record: LaunchRecord): Promise<string | undefined> {
  if (record.response === undefined) return undefined;
  try {
    return unfenced((await readFile(record.response.path, "utf8")).trim());
  } catch {
    return undefined;
  }
}

async function acceptedCriticPhase(
  records: readonly { readonly record: LaunchRecord }[],
  mode: "map" | "contract",
): Promise<boolean> {
  const latest = records[records.length - 1];
  if (latest === undefined) return false;
  const response = await capturedResponse(latest.record);
  if (response === undefined) return false;
  if (mode === "map") return mapResponseAccepted(response);
  if (isCleanContractResponse(response)) {
    return contractCleanViolation(response, latest.record.obligationIds) === undefined;
  }
  return (
    records.length >= 2 &&
    !response.includes("- `BLOCKER` —") &&
    response
      .split("\n")
      .filter((line) => line.trim() !== "")
      .every((line) => line.startsWith("- `MATERIAL-NONBLOCKER` —"))
  );
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
  mode?: "map" | "contract",
  userOverride = false,
): Promise<void> {
  const predecessor = previousPhase(role, mode);
  if (predecessor === undefined || userOverride) return;
  const requiredDigest = predecessor.role === "designer" ? undefined : designDigest;
  const completed = await verifiedRecords(
    predecessor.role,
    applicationRoot,
    requiredDigest,
    predecessor.mode,
  );
  if (completed.length > 0) {
    const reviewRecords =
      predecessor.role === "critic" && predecessor.mode === "contract"
        ? (await verifiedRecords("critic", applicationRoot, undefined, "contract")).filter(
            (entry) =>
              entry.record.briefSha256 === completed[completed.length - 1]!.record.briefSha256,
          )
        : completed;
    if (
      predecessor.role === "critic" &&
      predecessor.mode !== undefined &&
      ((predecessor.mode === "contract" &&
        reviewRecords[reviewRecords.length - 1]?.record.designDigest !== requiredDigest) ||
        !(await acceptedCriticPhase(reviewRecords, predecessor.mode)))
    ) {
      throw new WorkspaceError(
        predecessor.mode === "map"
          ? `Designer contract phase requires accepted concept rows and need placements with no authority or obligation blockers`
          : `Implementation requires a clean contract review or a second pass containing only MATERIAL-NONBLOCKER findings`,
      );
    }
    return;
  }
  const stale =
    requiredDigest === undefined
      ? []
      : (
          await verifiedRecords(predecessor.role, applicationRoot, undefined, predecessor.mode)
        ).filter((entry) => entry.record.designDigest !== undefined);
  const phase = `${predecessor.role}${predecessor.mode === undefined ? "" : ` ${predecessor.mode}`}`;
  if (stale.length > 0) {
    throw new WorkspaceError(
      `Role ${role} requires a ${phase} launch against design ${requiredDigest}; the settled one used ${stale[stale.length - 1]!.record.designDigest}. Design reopened after that role ran, so relaunch it`,
    );
  }
  throw new WorkspaceError(
    `Role ${role}${mode === undefined ? "" : ` ${mode}`} requires a settled ${phase} launch in ${workspaceDirectory}/; launch that phase first`,
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
