import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CatalogEntry,
  CatalogFile,
  ConceptVariant,
  EntryKind,
  EntryManifest,
} from "./types.ts";

const ENTRY_ID = /^(?:computation|concept|recipe)\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const NAME = /^[A-Za-z][A-Za-z0-9]*$/;
const TARGET = /^\$(?:concepts|computations|recipes)\/.+$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const KINDS = new Set<EntryKind>(["computation", "concept", "recipe"]);

function entriesDirectory(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const besideDist = join(here, "entries");
  return existsSync(besideDist) ? besideDist : resolve(here, "../entries");
}

export async function catalogVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") throw new Error("catalog package has no version");
  return manifest.version;
}

export async function supportedCoreVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { peerDependencies?: Record<string, unknown> };
  const range = manifest.peerDependencies?.["@mit-sdg/sync-engine"];
  if (typeof range !== "string") throw new Error("catalog package has no sync-engine peer range");
  return range;
}

function stringArray(value: unknown, owner: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${owner} must be an array of strings`);
  }
  return [...value];
}

function record(value: unknown, owner: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${owner} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknown(
  found: Record<string, unknown>,
  allowed: readonly string[],
  owner: string,
): void {
  const unknown = Object.keys(found).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new Error(`${owner} has unknown fields: ${unknown.join(", ")}`);
}

function files(value: unknown, owner: string): CatalogFile[] {
  if (!Array.isArray(value)) throw new Error(`${owner} must be an array`);
  return value.map((item, index) => {
    const found = record(item, `${owner}[${index}]`);
    rejectUnknown(found, ["source", "target"], `${owner}[${index}]`);
    if (
      typeof found.source !== "string" ||
      typeof found.target !== "string" ||
      !TARGET.test(found.target)
    ) {
      throw new Error(`${owner}[${index}] must name a source and supported target`);
    }
    if (
      found.source === "" ||
      posix.isAbsolute(found.source) ||
      posix.normalize(found.source) === "." ||
      posix.normalize(found.source).startsWith("../") ||
      found.source.includes("\\")
    ) {
      throw new Error(`${owner}[${index}].source must remain inside its entry`);
    }
    return { source: found.source, target: found.target };
  });
}

function packages(value: unknown, owner: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const found = record(value, owner);
  for (const [name, range] of Object.entries(found)) {
    if (
      !PACKAGE_NAME.test(name) ||
      typeof range !== "string" ||
      range === "" ||
      /[\r\n]/.test(range)
    ) {
      throw new Error(`${owner}.${name} must be a non-empty package range`);
    }
  }
  return found as Record<string, string>;
}

function parseManifest(value: unknown, path: string): EntryManifest {
  const found = record(value, path);
  rejectUnknown(
    found,
    [
      "schema",
      "id",
      "kind",
      "summary",
      "requires",
      "packages",
      "files",
      "variants",
      "concept",
      "computation",
      "recipe",
    ],
    path,
  );
  if (found.schema !== 1) throw new Error(`${path}: schema must be 1`);
  if (typeof found.id !== "string" || !ENTRY_ID.test(found.id)) {
    throw new Error(`${path}: id must be a supported lowercase catalog ID`);
  }
  if (typeof found.kind !== "string" || !KINDS.has(found.kind as EntryKind)) {
    throw new Error(`${path}: kind is not supported`);
  }
  if (!found.id.startsWith(`${found.kind}/`)) {
    throw new Error(`${path}: id kind does not match ${found.kind}`);
  }
  if (typeof found.summary !== "string" || found.summary.trim() === "") {
    throw new Error(`${path}: summary must be non-empty`);
  }

  const manifest: EntryManifest = {
    schema: 1,
    id: found.id,
    kind: found.kind as EntryKind,
    summary: found.summary,
  };
  if (found.requires !== undefined)
    manifest.requires = stringArray(found.requires, `${path}.requires`);
  manifest.packages = packages(found.packages, `${path}.packages`);
  if (found.files !== undefined) manifest.files = files(found.files, `${path}.files`);

  if (found.variants !== undefined) {
    if (manifest.kind !== "concept") throw new Error(`${path}: only concepts may declare variants`);
    const parsed: Record<string, ConceptVariant> = {};
    for (const [name, variantValue] of Object.entries(record(found.variants, `${path}.variants`))) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${path}: invalid variant ${name}`);
      const variant = record(variantValue, `${path}.variants.${name}`);
      rejectUnknown(variant, ["summary", "files", "packages"], `${path}.variants.${name}`);
      if (typeof variant.summary !== "string" || variant.summary.trim() === "") {
        throw new Error(`${path}.variants.${name}.summary must be non-empty`);
      }
      parsed[name] = {
        summary: variant.summary,
        files: files(variant.files, `${path}.variants.${name}.files`),
        packages: packages(variant.packages, `${path}.variants.${name}.packages`),
      };
    }
    if (Object.keys(parsed).length === 0) throw new Error(`${path}: variants must not be empty`);
    manifest.variants = parsed;
  }

  if (found.concept !== undefined) {
    if (manifest.kind !== "concept") throw new Error(`${path}: concept metadata has wrong kind`);
    const concept = record(found.concept, `${path}.concept`);
    rejectUnknown(concept, ["name", "registration", "export"], `${path}.concept`);
    if (
      typeof concept.name !== "string" ||
      !NAME.test(concept.name) ||
      typeof concept.registration !== "string" ||
      typeof concept.export !== "string" ||
      !NAME.test(concept.export)
    ) {
      throw new Error(`${path}: concept metadata is invalid`);
    }
    manifest.concept = {
      name: concept.name,
      registration: concept.registration,
      export: concept.export,
    };
  }

  if (found.computation !== undefined) {
    if (manifest.kind !== "computation") {
      throw new Error(`${path}: computation metadata has wrong kind`);
    }
    const computation = record(found.computation, `${path}.computation`);
    rejectUnknown(computation, ["module", "exports"], `${path}.computation`);
    if (typeof computation.module !== "string") {
      throw new Error(`${path}: computation module is invalid`);
    }
    const exported = stringArray(computation.exports, `${path}.computation.exports`);
    if (exported.length === 0 || exported.some((name) => !NAME.test(name))) {
      throw new Error(`${path}: computation exports are invalid`);
    }
    manifest.computation = { module: computation.module, exports: exported };
  }

  if (found.recipe !== undefined) {
    if (manifest.kind !== "recipe") throw new Error(`${path}: recipe metadata has wrong kind`);
    const recipe = record(found.recipe, `${path}.recipe`);
    rejectUnknown(recipe, ["module", "test", "members"], `${path}.recipe`);
    if (typeof recipe.module !== "string") throw new Error(`${path}: recipe module is invalid`);
    if (recipe.test !== undefined && typeof recipe.test !== "string") {
      throw new Error(`${path}: recipe test is invalid`);
    }
    const members = stringArray(recipe.members, `${path}.recipe.members`);
    if (members.length === 0 || members.some((name) => !NAME.test(name))) {
      throw new Error(`${path}: recipe members are invalid`);
    }
    manifest.recipe = {
      module: recipe.module,
      ...(recipe.test === undefined ? {} : { test: recipe.test }),
      members,
    };
  }

  if (
    manifest.kind === "concept" &&
    (manifest.concept === undefined || manifest.variants === undefined)
  ) {
    throw new Error(`${path}: a concept needs metadata and variants`);
  }
  if (manifest.kind === "computation" && manifest.computation === undefined) {
    throw new Error(`${path}: a computation needs integration metadata`);
  }
  if (manifest.kind === "recipe" && manifest.recipe === undefined) {
    throw new Error(`${path}: a recipe needs integration metadata`);
  }
  return manifest;
}

export async function loadCatalog(root = entriesDirectory()): Promise<Map<string, CatalogEntry>> {
  const indexPath = join(root, "index.json");
  const index = JSON.parse(await readFile(indexPath, "utf8")) as unknown;
  const paths = stringArray(index, "catalog index");
  const entries = new Map<string, CatalogEntry>();
  for (const relativePath of paths) {
    const manifestPath = resolve(root, relativePath);
    const relative = posix.relative(root.replaceAll("\\", "/"), manifestPath.replaceAll("\\", "/"));
    if (relative.startsWith("../") || !relative.endsWith("/manifest.json")) {
      throw new Error(`catalog index path is invalid: ${relativePath}`);
    }
    const manifest = parseManifest(JSON.parse(await readFile(manifestPath, "utf8")), relativePath);
    if (entries.has(manifest.id)) throw new Error(`catalog entry ID is duplicated: ${manifest.id}`);
    entries.set(manifest.id, { directory: dirname(manifestPath), manifest });
  }
  for (const entry of entries.values()) {
    const requires = entry.manifest.requires ?? [];
    if (new Set(requires).size !== requires.length) {
      throw new Error(`${entry.manifest.id} repeats a dependency`);
    }
    for (const dependency of entry.manifest.requires ?? []) {
      if (!entries.has(dependency)) {
        throw new Error(`${entry.manifest.id} requires missing entry ${dependency}`);
      }
    }
    const common = entry.manifest.files ?? [];
    const selections =
      entry.manifest.variants === undefined
        ? [common]
        : Object.values(entry.manifest.variants).map((variant) => [...common, ...variant.files]);
    for (const selection of selections) {
      const targets = selection.map(({ target }) => target);
      if (new Set(targets).size !== targets.length) {
        throw new Error(`${entry.manifest.id} has duplicate copied targets`);
      }
      for (const file of selection) await readFile(resolve(entry.directory, file.source));
    }
    const targetRoot = `$${entry.manifest.kind}s/`;
    if (
      selections.some((selection) => selection.some(({ target }) => !target.startsWith(targetRoot)))
    ) {
      throw new Error(`${entry.manifest.id} may copy files only below ${targetRoot}`);
    }
    if (
      entry.manifest.concept !== undefined &&
      !common.some(({ target }) => target === entry.manifest.concept?.registration)
    ) {
      throw new Error(`${entry.manifest.id} does not copy its registration module`);
    }
    if (
      entry.manifest.computation !== undefined &&
      !common.some(({ target }) => target === entry.manifest.computation?.module)
    ) {
      throw new Error(`${entry.manifest.id} does not copy its computation module`);
    }
    if (entry.manifest.recipe !== undefined) {
      if (!common.some(({ target }) => target === entry.manifest.recipe?.module)) {
        throw new Error(`${entry.manifest.id} does not copy its recipe module`);
      }
      if (new Set(entry.manifest.recipe.members).size !== entry.manifest.recipe.members.length) {
        throw new Error(`${entry.manifest.id} repeats a composition member`);
      }
      if (
        entry.manifest.recipe.test !== undefined &&
        !common.some(({ target }) => target === entry.manifest.recipe?.test)
      ) {
        throw new Error(`${entry.manifest.id} does not copy its recipe test`);
      }
    }
  }

  const conceptNames = new Map<string, string>();
  for (const entry of entries.values()) {
    const name = entry.manifest.concept?.name;
    if (name === undefined) continue;
    const previous = conceptNames.get(name);
    if (previous !== undefined)
      throw new Error(`${entry.manifest.id} and ${previous} both own ${name}`);
    conceptNames.set(name, entry.manifest.id);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`catalog dependency cycle reaches ${id}`);
    visiting.add(id);
    for (const dependency of entries.get(id)?.manifest.requires ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of entries.keys()) visit(id);
  return entries;
}

export function entryFiles(entry: CatalogEntry, variant?: string): CatalogFile[] {
  const base = entry.manifest.files ?? [];
  if (entry.manifest.kind !== "concept") return [...base];
  if (variant === undefined)
    throw new Error(`${entry.manifest.id} needs an implementation variant`);
  const selected = entry.manifest.variants?.[variant];
  if (selected === undefined) throw new Error(`${entry.manifest.id} has no variant ${variant}`);
  return [...base, ...selected.files];
}

export async function sourceDigest(entry: CatalogEntry, variant?: string): Promise<string> {
  const hash = createHash("sha256");
  const manifest = entry.manifest;
  hash.update(
    JSON.stringify({
      id: manifest.id,
      kind: manifest.kind,
      requires: manifest.requires ?? [],
      packages: manifest.packages ?? {},
      variantPackages: variant === undefined ? {} : (manifest.variants?.[variant]?.packages ?? {}),
      concept: manifest.concept,
      computation: manifest.computation,
      recipe: manifest.recipe,
    }),
  );
  hash.update(`\0${variant ?? ""}\0`);
  for (const file of entryFiles(entry, variant).sort((left, right) =>
    left.source.localeCompare(right.source),
  )) {
    hash.update(file.source);
    hash.update("\0");
    hash.update(file.target);
    hash.update("\0");
    hash.update(await readFile(resolve(entry.directory, file.source)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
