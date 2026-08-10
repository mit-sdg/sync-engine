import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { CatalogRegistry } from "./registry.ts";
import type { CatalogLock, EntryManifest, MaterializedEntry, PlannedFile } from "./types.ts";
import { readLock, serializeLock } from "./lock.ts";
import { readProject, integrationGuidance } from "./project.ts";
import { verifyPackages, installCommand } from "./packages.ts";
import { generatedFiles } from "./generate.ts";
import { assertNoSymlinkTraversal, within } from "./paths.ts";
import { digest, materialize } from "./materialize.ts";
import { applyTransaction } from "./transaction.ts";

let packageVersion: string | undefined;
async function catalogVersion(): Promise<string> {
  packageVersion ??= (
    JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
      version: string;
    }
  ).version;
  return packageVersion;
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
function requirementsFor(
  lock: CatalogLock,
  entries: readonly MaterializedEntry[],
): Record<string, string> {
  const requirements: Record<string, string> = {};
  for (const entry of Object.values(lock.entries)) mergeRequirements(requirements, entry.packages);
  for (const entry of entries) mergeRequirements(requirements, entry.packages);
  return requirements;
}
function entryPlan(
  materialized: MaterializedEntry,
  lock: CatalogLock,
  version: string,
): PlannedFile[] {
  const { entry, files, packages, integration } = materialized;
  const existing = lock.entries[entry.id];
  if (existing !== undefined) {
    const rendered = files.filter((file) => file.class === "rendered");
    const trackedRendered = existing.files.filter((file) => file.class === "rendered");
    if (
      existing.kind !== entry.kind ||
      (entry.kind === "concept" &&
        (existing.kind !== "concept" || existing.floor !== materialized.floor)) ||
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
    lock.entries[entry.id] = {
      ...existing,
      files: existing.files.map((tracked) => {
        const current = rendered.find((file) => file.target === tracked.target);
        return current === undefined ? tracked : { ...tracked, hash: current.hash };
      }),
    };
    return rendered.map((file) => ({ ...file, ownership: "entry", entry: entry.id }));
  }
  lock.entries[entry.id] =
    entry.kind === "concept"
      ? {
          kind: "concept",
          catalogVersion: version,
          sourceDigest: materialized.sourceDigest,
          requires: [],
          floor: materialized.floor!,
          packages,
          integration: integration as Extract<typeof integration, { kind: "concept" }>,
          files: files.map(({ source, target, hash, class: fileClass }) => ({
            source,
            target,
            hash,
            class: fileClass,
          })),
        }
      : {
          kind: "recipe",
          catalogVersion: version,
          sourceDigest: materialized.sourceDigest,
          requires: entry.requires,
          packages,
          integration: integration as Extract<typeof integration, { kind: "recipe" }>,
          files: files.map(({ source, target, hash, class: fileClass }) => ({
            source,
            target,
            hash,
            class: fileClass,
          })),
        };
  return files.map((file) => ({ ...file, ownership: "entry", entry: entry.id }));
}
async function preflightDestination(
  root: string,
  file: PlannedFile,
  lock: CatalogLock,
): Promise<void> {
  const target = within(root, file.target);
  await assertNoSymlinkTraversal(root, target);
  if (!existsSync(target)) return;
  const currentHash = digest(await readFile(target, "utf8"));
  if (file.ownership === "generated") {
    const tracked = lock.generated.find((item) => item.target === file.target);
    if (tracked === undefined || tracked.hash !== currentHash)
      throw new Error(`generated file was edited or is not catalog-owned: ${file.target}`);
  } else {
    const tracked = lock.entries[file.entry]?.files.find((item) => item.target === file.target);
    if (tracked === undefined)
      throw new Error(`destination already exists and is not catalog-owned: ${file.target}`);
    if (file.class === "owned" && (tracked.hash !== currentHash || file.hash !== currentHash))
      throw new Error(
        `copy-owned file is application-owned and will not be rewritten: ${file.target}`,
      );
    if (file.class === "rendered" && tracked.hash !== currentHash)
      throw new Error(`rendered registry was edited; update it manually: ${file.target}`);
  }
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
  for (const entry of entries)
    if (entry.kind === "concept" && entry.floors[floor] === undefined)
      throw new Error(`${entry.id} does not provide floor ${floor}`);
  const materialized = await Promise.all(entries.map((entry) => materialize(entry, floor)));
  const findings = verifyPackages(project.manifest, requirementsFor(lock, materialized));
  if (findings.length > 0)
    return {
      written: [],
      guidance: [
        "Missing or incompatible packages.",
        installCommand(findings),
        `Next: ${options.originalCommand}`,
      ],
      install: installCommand(findings),
    };
  const next = structuredClone(lock);
  next.floor = floor;
  const version = await catalogVersion();
  const planned = materialized.flatMap((entry) => entryPlan(entry, next, version));
  const generated = generatedFiles(next);
  next.generated = Object.entries(generated)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([target, contents]) => ({ target, hash: digest(contents) }));
  planned.push(
    ...Object.entries(generated).map(([target, contents]) => ({
      source: "generated" as const,
      target,
      contents,
      hash: digest(contents),
      class: "generated" as const,
      ownership: "generated" as const,
    })),
  );
  const targets = new Set<string>();
  const changed: PlannedFile[] = [];
  for (const file of planned) {
    if (targets.has(file.target))
      throw new Error(`catalog plan contains duplicate destination: ${file.target}`);
    targets.add(file.target);
    await preflightDestination(root, file, lock);
    const target = within(root, file.target);
    if (!existsSync(target) || digest(await readFile(target, "utf8")) !== file.hash)
      changed.push(file);
  }
  const lockSource = serializeLock(next);
  const lockPath = resolve(root, "catalog.lock");
  const lockChanged = !existsSync(lockPath) || (await readFile(lockPath, "utf8")) !== lockSource;
  if (changed.length > 0 || lockChanged) await applyTransaction(root, changed, lockSource);
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
