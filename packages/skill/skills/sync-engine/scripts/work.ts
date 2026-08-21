import { realpathSync } from "node:fs";
import { lstat, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const workflowDirectory = ".sync-engine";
export const workDirectory = "work";
export const briefFileName = "brief.md";

const safeName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const maximumNameLength = 80;

export class WorkError extends Error {
  override readonly name = "WorkError";
}

/** Resolve links through the longest existing prefix of a path. */
export function canonicalPath(path: string): string {
  const resolved = resolve(path);
  try {
    return realpathSync(resolved);
  } catch {
    const parent = dirname(resolved);
    return parent === resolved ? resolved : resolve(canonicalPath(parent), basename(resolved));
  }
}

export function isPathInside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function requireSafeName(value: string, kind: string): string {
  if (value.length > maximumNameLength || !safeName.test(value)) {
    throw new WorkError(
      `${kind} must be 1-${maximumNameLength} characters of lowercase kebab case`,
    );
  }
  return value;
}

export function requireSafeSlug(slug: string): string {
  return requireSafeName(slug, "Work slug");
}

export function requireSafeRunLabel(label: string, kind: "role" | "phase"): string {
  return requireSafeName(label, `Run ${kind}`);
}

interface WorkRoots {
  readonly application: string;
  readonly lexical: string;
  readonly canonical: string;
}

function resolveWorkRoots(applicationRoot: string): WorkRoots {
  const application = canonicalPath(applicationRoot);
  const lexical = resolve(application, workflowDirectory, workDirectory);
  const canonical = canonicalPath(lexical);
  if (canonical === application || !isPathInside(application, canonical)) {
    throw new WorkError(`Work root escapes the application: ${lexical} resolves to ${canonical}`);
  }
  return { application, lexical, canonical };
}

/** The canonical .sync-engine/work directory, whether or not it exists yet. */
export function workRoot(applicationRoot: string = process.cwd()): string {
  return resolveWorkRoots(applicationRoot).canonical;
}

/** Resolve a validated slug without creating it. */
export function workUnitPath(applicationRoot: string, slug: string): string {
  requireSafeSlug(slug);
  const root = workRoot(applicationRoot);
  const unit = canonicalPath(resolve(root, slug));
  if (unit === root || !isPathInside(root, unit)) {
    throw new WorkError(`Work unit escapes its work root: ${slug}`);
  }
  return unit;
}

export interface WorkUnit {
  readonly applicationRoot: string;
  readonly root: string;
  readonly slug: string;
  readonly path: string;
  readonly briefPath: string;
}

function describeWorkUnit(applicationRoot: string, slug: string): WorkUnit {
  const application = canonicalPath(applicationRoot);
  const root = workRoot(application);
  const path = workUnitPath(application, slug);
  return {
    applicationRoot: application,
    root,
    slug,
    path,
    briefPath: resolve(path, briefFileName),
  };
}

/** Require a real work-unit directory, not an alias to another unit. */
export async function requireWorkUnit(applicationRoot: string, slug: string): Promise<WorkUnit> {
  const unit = describeWorkUnit(applicationRoot, slug);
  const lexicalPath = resolve(unit.root, slug);
  let entry;
  try {
    entry = await lstat(lexicalPath);
  } catch {
    throw new WorkError(`Work unit does not exist: ${slug}`);
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new WorkError(`Work unit must be a directory, not a symbolic link: ${lexicalPath}`);
  }
  if (canonicalPath(lexicalPath) !== unit.path) {
    throw new WorkError(`Work unit changed while it was being resolved: ${lexicalPath}`);
  }
  return unit;
}

export function requirePathInWorkUnit(path: string, workUnit: string): string {
  const root = canonicalPath(workUnit);
  const candidate = canonicalPath(path);
  if (candidate === root || !isPathInside(root, candidate)) {
    throw new WorkError(`Workflow artifact escapes work unit ${root}: ${path}`);
  }
  return candidate;
}

function templateBytes(template: string | Uint8Array): Uint8Array {
  const bytes =
    typeof template === "string" ? Buffer.from(template, "utf8") : Buffer.from(template);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new WorkError(`Brief template is not readable UTF-8`);
  }
  if (text.trim() === "") throw new WorkError(`Brief template is empty`);
  return bytes;
}

export interface StartWorkUnitOptions {
  readonly applicationRoot: string;
  readonly slug: string;
  /** Template bytes are copied verbatim to brief.md. */
  readonly briefTemplate: string | Uint8Array;
}

/** Create one work unit and its brief. An existing slug is never reused or overwritten. */
export async function startWorkUnit(options: StartWorkUnitOptions): Promise<WorkUnit> {
  requireSafeSlug(options.slug);
  const bytes = templateBytes(options.briefTemplate);
  const before = resolveWorkRoots(options.applicationRoot);

  try {
    await mkdir(before.lexical, { recursive: true });
  } catch (error) {
    throw new WorkError(`Cannot create work root ${before.lexical}: ${String(error)}`);
  }

  const after = resolveWorkRoots(options.applicationRoot);
  if (before.canonical !== after.canonical) {
    throw new WorkError(`Work root changed while it was being created: ${before.lexical}`);
  }

  const unit = describeWorkUnit(options.applicationRoot, options.slug);
  const lexicalUnit = resolve(unit.root, options.slug);
  try {
    await mkdir(lexicalUnit);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST") throw new WorkError(`Work unit already exists: ${options.slug}`);
    throw new WorkError(`Cannot create work unit ${options.slug}: ${String(error)}`);
  }

  try {
    const entry = await lstat(lexicalUnit);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new WorkError(`Created work unit is not a directory: ${lexicalUnit}`);
    }
    const briefPath = requirePathInWorkUnit(resolve(lexicalUnit, briefFileName), lexicalUnit);
    await writeFile(briefPath, bytes, { flag: "wx" });
    return { ...unit, path: canonicalPath(lexicalUnit), briefPath };
  } catch (error) {
    await rm(lexicalUnit, { recursive: true, force: true });
    if (error instanceof WorkError) throw error;
    throw new WorkError(`Cannot create brief for ${options.slug}: ${String(error)}`);
  }
}

export interface StartWorkUnitFromTemplateOptions {
  readonly applicationRoot: string;
  readonly slug: string;
  readonly briefTemplatePath: string;
}

export async function startWorkUnitFromTemplate(
  options: StartWorkUnitFromTemplateOptions,
): Promise<WorkUnit> {
  let template: Uint8Array;
  try {
    template = await readFile(options.briefTemplatePath);
  } catch (error) {
    throw new WorkError(
      `Cannot read brief template ${options.briefTemplatePath}: ${String(error)}`,
    );
  }
  return startWorkUnit({
    applicationRoot: options.applicationRoot,
    slug: options.slug,
    briefTemplate: template,
  });
}

/** Seconds-resolution UTC text that sorts chronologically and is portable in file names. */
export function utcRunTimestamp(at: Date = new Date()): string {
  if (Number.isNaN(at.getTime())) throw new WorkError(`Run timestamp is invalid`);
  return `${at.toISOString().slice(0, 19).replaceAll(":", "-")}Z`;
}

export interface RunArtifacts {
  readonly stem: string;
  readonly taskPath: string;
  readonly capabilitiesPath: string;
  readonly promptPath: string;
  readonly responsePath: string;
  readonly recordPath: string;
}

function artifactPaths(unit: string, stem: string): RunArtifacts {
  return {
    stem,
    taskPath: resolve(unit, `${stem}.task.md`),
    capabilitiesPath: resolve(unit, `${stem}.capabilities.json`),
    promptPath: resolve(unit, `${stem}.prompt.md`),
    responsePath: resolve(unit, `${stem}.response.md`),
    recordPath: resolve(unit, `${stem}.record.json`),
  };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export interface ReserveRunOptions {
  readonly applicationRoot: string;
  readonly slug: string;
  readonly role: string;
  readonly phase: string;
  readonly at?: Date;
}

/**
 * Reserve a complete run stem by atomically creating its initially empty response file.
 * Every caller uses that file as the lock, while any pre-existing sibling artifact also
 * causes the deterministic -2, -3, ... collision suffix.
 */
export async function reserveRunArtifacts(options: ReserveRunOptions): Promise<RunArtifacts> {
  const unit = await requireWorkUnit(options.applicationRoot, options.slug);
  const role = requireSafeRunLabel(options.role, "role");
  const phase = requireSafeRunLabel(options.phase, "phase");
  const base = `${utcRunTimestamp(options.at)}-${role}-${phase}`;

  for (let collision = 1; ; collision += 1) {
    const stem = collision === 1 ? base : `${base}-${collision}`;
    const artifacts = artifactPaths(unit.path, stem);
    const paths = [
      artifacts.taskPath,
      artifacts.capabilitiesPath,
      artifacts.promptPath,
      artifacts.responsePath,
      artifacts.recordPath,
    ];
    if ((await Promise.all(paths.map(pathExists))).some(Boolean)) continue;

    let reservation;
    try {
      reservation = await open(artifacts.responsePath, "wx");
      await reservation.close();
    } catch (error) {
      await reservation?.close().catch(() => undefined);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw new WorkError(`Cannot reserve run ${stem}: ${String(error)}`);
    }

    for (const path of paths) requirePathInWorkUnit(path, unit.path);
    return artifacts;
  }
}
