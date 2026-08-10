import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CatalogRegistry } from "./registry.ts";
import type { CatalogLock, EntryIntegration, EntryManifest, PlannedFile } from "./types.ts";
import { readLock, serializeLock } from "./lock.ts";
import { readProject, integrationGuidance } from "./project.ts";
import { verifyPackages, installCommand } from "./packages.ts";
import { transformConceptSpecifier, renderFloor } from "./transforms.ts";
import { generatedFiles } from "./generate.ts";
import { assertNoSymlinkTraversal, within } from "./paths.ts";

let packageVersion: string | undefined;
async function catalogVersion(): Promise<string> {
  packageVersion ??= (
    JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    }
  ).version;
  return packageVersion;
}
export const digest = (source: string): string => createHash("sha256").update(source).digest("hex");
function targetPath(token: string): string {
  return token
    .replace(/^\$concepts\//, "src/concepts/")
    .replace(/^\$recipes\//, "src/composition/");
}
function mergeRequirements(target: Record<string, string>, source: Record<string, string>): void {
  for (const [name, range] of Object.entries(source)) {
    const previous = target[name];
    if (previous !== undefined && previous !== range)
      throw new Error(
        `catalog entries require conflicting ranges for ${name}: ${previous} and ${range}`,
      );
    target[name] = range;
  }
}
function selectFloor(
  entries: readonly EntryManifest[],
  lock: CatalogLock,
  requested?: string,
): string {
  if (requested !== undefined && (requested.length === 0 || requested.includes(",")))
    throw new Error("--floor accepts one nonempty floor name without commas");
  if (lock.floor !== undefined) {
    if (requested !== undefined && requested !== lock.floor)
      throw new Error(`catalog.lock selects floor ${lock.floor}; cannot select ${requested}`);
    return lock.floor;
  }
  const concepts = entries.filter((entry) => entry.kind === "concept");
  if (concepts.length === 0)
    throw new Error("a catalog installation must resolve at least one concept");
  const floor = requested ?? concepts[0]?.defaultFloor;
  if (
    floor === undefined ||
    (requested === undefined && concepts.some((entry) => entry.defaultFloor !== floor))
  )
    throw new Error("resolved concepts do not have one common default floor; pass --floor");
  return floor;
}
function entryIntegration(entry: EntryManifest): EntryIntegration {
  return entry.concept !== undefined
    ? {
        kind: "concept",
        name: entry.concept.name,
        export: entry.concept.export,
        registration: targetPath(entry.concept.registration),
      }
    : {
        kind: "recipe",
        module: targetPath(entry.recipe!.module),
        test: targetPath(entry.recipe!.test),
        members: entry.recipe!.members,
        routes: entry.recipe!.routes,
      };
}
async function selectedFiles(entry: EntryManifest, floor: string): Promise<PlannedFile[]> {
  const declarations = [...entry.files, ...(entry.floors?.[floor]?.files ?? [])];
  const result: PlannedFile[] = [];
  for (const declaration of declarations) {
    const sourcePath = resolve(entry.directory, declaration.source);
    let contents = await readFile(sourcePath, "utf8");
    const target = targetPath(declaration.target);
    contents = transformConceptSpecifier(contents, target);
    if (declaration.render === "floor")
      contents = renderFloor(contents, floor, Object.keys(entry.floors ?? {}));
    result.push({
      source: declaration.source,
      target,
      contents,
      hash: digest(contents),
      class: declaration.render === "floor" ? "rendered" : "owned",
      entry: entry.id,
    });
  }
  return result;
}
async function validateDestination(
  root: string,
  file: PlannedFile,
  lock: CatalogLock,
): Promise<void> {
  const target = within(root, file.target);
  await assertNoSymlinkTraversal(root, target);
  if (!existsSync(target)) return;
  const currentHash = digest(await readFile(target, "utf8"));
  if (file.class === "generated") {
    const tracked = lock.generated.find((item) => item.target === file.target);
    if (tracked === undefined || tracked.hash !== currentHash)
      throw new Error(`generated file was edited or is not catalog-owned: ${file.target}`);
    return;
  }
  const tracked =
    file.entry === undefined
      ? undefined
      : lock.entries[file.entry]?.files.find((item) => item.target === file.target);
  if (tracked === undefined)
    throw new Error(`destination already exists and is not catalog-owned: ${file.target}`);
  if (file.class === "owned") {
    if (tracked.hash !== currentHash || file.hash !== currentHash)
      throw new Error(
        `copy-owned file is application-owned and will not be rewritten: ${file.target}`,
      );
  } else if (tracked.hash !== currentHash)
    throw new Error(`rendered registry was edited; update it manually: ${file.target}`);
}
interface Replacement {
  target: string;
  temporary: string;
  backup?: string;
  installed: boolean;
}

async function commit(
  root: string,
  files: readonly PlannedFile[],
  lockSource: string,
): Promise<void> {
  const transaction = `.catalog-${randomUUID()}`;
  const replacements: Replacement[] = [];
  try {
    for (const file of files) {
      const target = within(root, file.target);
      await mkdir(dirname(target), { recursive: true });
      const temporary = `${target}.${transaction}.tmp`;
      await writeFile(temporary, file.contents);
      replacements.push({ target, temporary, installed: false });
    }
    const lockTarget = resolve(root, "catalog.lock");
    const lockTemporary = `${lockTarget}.${transaction}.tmp`;
    await writeFile(lockTemporary, lockSource);
    replacements.push({ target: lockTarget, temporary: lockTemporary, installed: false });

    for (const replacement of replacements) {
      if (existsSync(replacement.target)) {
        replacement.backup = `${replacement.target}.${transaction}.bak`;
        await rename(replacement.target, replacement.backup);
      }
      await rename(replacement.temporary, replacement.target);
      replacement.installed = true;
    }
  } catch (error) {
    for (const replacement of [...replacements].reverse()) {
      if (replacement.installed) await rm(replacement.target, { force: true }).catch(() => {});
      if (replacement.backup !== undefined && existsSync(replacement.backup))
        await rename(replacement.backup, replacement.target).catch(() => {});
      await rm(replacement.temporary, { force: true }).catch(() => {});
    }
    throw error;
  }

  for (const replacement of replacements)
    if (replacement.backup !== undefined)
      await rm(replacement.backup, { force: true }).catch(() => {});
}

export interface AddResult {
  written: string[];
  guidance: string[];
  install?: string;
}
export async function addEntries(
  registry: CatalogRegistry,
  ids: readonly string[],
  options: { root?: string; floor?: string; originalCommand: string },
): Promise<AddResult> {
  const root = resolve(options.root ?? process.cwd());
  const project = await readProject(root);
  const lock = await readLock(root);
  const entries = registry.resolve(ids);
  const floor = selectFloor(entries, lock, options.floor);
  for (const concept of entries.filter((entry) => entry.kind === "concept"))
    if (concept.floors?.[floor] === undefined)
      throw new Error(`${concept.id} does not provide floor ${floor}`);
  const requirements: Record<string, string> = {};
  for (const entry of Object.values(lock.entries)) mergeRequirements(requirements, entry.packages);
  for (const entry of entries) {
    mergeRequirements(requirements, entry.packages);
    if (entry.kind === "concept")
      mergeRequirements(requirements, entry.floors?.[floor]?.packages ?? {});
  }
  const findings = verifyPackages(project.manifest, requirements);
  if (findings.length > 0)
    return {
      written: [],
      guidance: [
        `Missing or incompatible packages.`,
        installCommand(findings),
        `Next: ${options.originalCommand}`,
      ],
      install: installCommand(findings),
    };

  const next: CatalogLock = structuredClone(lock);
  next.floor = floor;
  const version = await catalogVersion();
  const planned: PlannedFile[] = [];
  for (const entry of entries) {
    const files = await selectedFiles(entry, floor);
    const packages = {
      ...entry.packages,
      ...(entry.kind === "concept" ? (entry.floors?.[floor]?.packages ?? {}) : {}),
    };
    const integration = entryIntegration(entry);
    const existing = next.entries[entry.id];
    if (existing !== undefined) {
      const rendered = files.filter((file) => file.class === "rendered");
      const trackedRendered = existing.files.filter((file) => file.class === "rendered");
      if (
        existing.kind !== entry.kind ||
        (entry.kind === "concept" && existing.floor !== floor) ||
        !isDeepStrictEqual(existing.requires, entry.requires) ||
        !isDeepStrictEqual(existing.packages, packages) ||
        !isDeepStrictEqual(existing.integration, integration) ||
        !isDeepStrictEqual(
          trackedRendered.map(({ source, target }) => ({ source, target })),
          rendered.map(({ source, target }) => ({ source, target })),
        )
      )
        throw new Error(
          `${entry.id} metadata changed since installation; catalog migration is not supported`,
        );
      next.entries[entry.id] = {
        ...existing,
        files: existing.files.map((tracked) => {
          const current = rendered.find((file) => file.target === tracked.target);
          return current === undefined ? tracked : { ...tracked, hash: current.hash };
        }),
      };
      planned.push(...rendered);
      continue;
    }
    const sourceDigest = digest(
      JSON.stringify({
        schema: entry.schema,
        id: entry.id,
        kind: entry.kind,
        summary: entry.summary,
        requires: entry.requires,
        packages,
        files: files.map(({ source, target, class: fileClass }) => ({
          source,
          target,
          class: fileClass,
        })),
        concept: entry.concept,
        recipe: entry.recipe,
        floor: entry.kind === "concept" ? floor : undefined,
      }) + files.map((file) => file.contents).join("\0"),
    );
    next.entries[entry.id] = {
      kind: entry.kind,
      catalogVersion: version,
      sourceDigest,
      requires: entry.requires,
      ...(entry.kind === "concept" ? { floor } : {}),
      packages,
      integration,
      files: files.map(({ source, target, hash, class: fileClass }) => ({
        source,
        target,
        hash,
        class: fileClass as "owned" | "rendered",
      })),
    };
    planned.push(...files);
  }
  const generated = generatedFiles(next);
  next.generated = Object.entries(generated)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([target, contents]) => ({ target, hash: digest(contents) }));
  planned.push(
    ...Object.entries(generated).map(([target, contents]) => ({
      source: "generated",
      target,
      contents,
      hash: digest(contents),
      class: "generated" as const,
    })),
  );
  const targets = new Set<string>();
  const changed: PlannedFile[] = [];
  for (const file of planned) {
    if (targets.has(file.target))
      throw new Error(`catalog plan contains duplicate destination: ${file.target}`);
    targets.add(file.target);
    await validateDestination(root, file, lock);
    const target = within(root, file.target);
    if (!existsSync(target) || digest(await readFile(target, "utf8")) !== file.hash)
      changed.push(file);
  }
  const lockSource = serializeLock(next);
  const lockPath = resolve(root, "catalog.lock");
  const lockChanged = !existsSync(lockPath) || (await readFile(lockPath, "utf8")) !== lockSource;
  if (changed.length > 0 || lockChanged) await commit(root, changed, lockSource);
  const guidance = await integrationGuidance(root, floor);
  return {
    written: [
      ...changed.map((file) => file.target),
      ...(changed.length > 0 || lockChanged ? ["catalog.lock"] : []),
    ],
    guidance: [
      ...project.guidance,
      ...guidance,
      "Next: apply the integration guidance, then run your typecheck and tests.",
    ],
  };
}
