import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import type { EntryManifest, FileDeclaration, FloorManifest } from "./types.ts";
import { assertPortablePath } from "./paths.ts";
import { renderFloor } from "./transforms.ts";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ENTRY_ID = /^(?:concept|recipe)\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;

function entriesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = resolve(here, "../entries");
  return existsSync(source) ? source : resolve(here, "entries");
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}`);
}
function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0))
    throw new Error(`${label} must be an array of nonempty strings`);
  return value as string[];
}
function stringRecord(value: unknown, label: string): Record<string, string> {
  if (value === undefined) return {};
  const found = record(value, label);
  if (
    Object.entries(found).some(
      ([name, item]) => name.length === 0 || typeof item !== "string" || item.length === 0,
    )
  )
    throw new Error(`${label} contains an invalid value`);
  return found as Record<string, string>;
}
function packages(value: unknown, label: string): Record<string, string> {
  const found = stringRecord(value, label);
  for (const [name, range] of Object.entries(found))
    if (semver.validRange(range) === null)
      throw new Error(`${label} contains an invalid requirement for ${name}: ${range}`);
  return found;
}
function file(value: unknown, label: string): FileDeclaration {
  const found = record(value, label);
  exact(found, ["source", "target", "render"], label);
  if (
    typeof found.source !== "string" ||
    typeof found.target !== "string" ||
    (found.render !== undefined && found.render !== "floor")
  )
    throw new Error(`${label} is invalid`);
  try {
    assertPortablePath(found.source, `${label} source`);
  } catch {
    throw new Error(`${label} source must be a portable local file name`);
  }
  if (found.source.includes("/"))
    throw new Error(`${label} source must be a portable local file name`);
  return found as unknown as FileDeclaration;
}
function files(value: unknown, label: string): FileDeclaration[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((item, index) => file(item, `${label}[${index}]`));
}
function installedTarget(target: string): string {
  return target
    .replace(/^\$concepts\//, "src/concepts/")
    .replace(/^\$recipes\//, "src/composition/");
}
function validateTarget(target: string, kind: string): void {
  const token = kind === "concept" ? "$concepts/" : "$recipes/";
  if (!target.startsWith(token)) throw new Error(`${target} must remain under ${token}`);
  assertPortablePath(installedTarget(target), "catalog target");
}
function moduleSpecifiers(source: string): string[] {
  return [
    ...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?["']([^"']+)["']/g),
    ...source.matchAll(/\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1] ?? "");
}
function uniqueFiles(declarations: readonly FileDeclaration[], label: string): void {
  const sources = new Set<string>();
  const targets = new Set<string>();
  for (const declaration of declarations) {
    if (sources.has(declaration.source))
      throw new Error(`${label} repeats source ${declaration.source}`);
    if (targets.has(declaration.target))
      throw new Error(`${label} repeats target ${declaration.target}`);
    sources.add(declaration.source);
    targets.add(declaration.target);
  }
}
async function parseManifest(path: string): Promise<EntryManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot parse entry manifest ${path} (${String(error)})`);
  }
  const root = record(value, path);
  exact(
    root,
    [
      "schema",
      "id",
      "kind",
      "summary",
      "requires",
      "packages",
      "files",
      "concept",
      "recipe",
      "defaultFloor",
      "floors",
    ],
    path,
  );
  if (
    root.schema !== 1 ||
    (root.kind !== "concept" && root.kind !== "recipe") ||
    typeof root.id !== "string" ||
    !ENTRY_ID.test(root.id) ||
    !root.id.startsWith(`${root.kind}/`) ||
    typeof root.summary !== "string" ||
    root.summary.length === 0
  )
    throw new Error(`invalid manifest identity in ${path}`);
  const kind = root.kind;
  const commonFiles = files(root.files, `${root.id}.files`);
  uniqueFiles(commonFiles, `${root.id}.files`);
  const requires = root.requires === undefined ? [] : strings(root.requires, `${root.id}.requires`);
  if (
    new Set(requires).size !== requires.length ||
    requires.some((required) => !ENTRY_ID.test(required))
  )
    throw new Error(`${root.id}.requires must contain unique entry ids`);
  const result: EntryManifest = {
    schema: 1,
    id: root.id,
    kind,
    summary: root.summary,
    requires,
    packages: packages(root.packages, `${root.id}.packages`),
    files: commonFiles,
    directory: dirname(path),
  };
  if (kind === "concept") {
    if (root.recipe !== undefined || root.requires !== undefined)
      throw new Error(`${root.id}: concepts may not declare recipe or requires`);
    const concept = record(root.concept, `${root.id}.concept`);
    exact(concept, ["name", "export", "registration"], `${root.id}.concept`);
    if (
      typeof concept.name !== "string" ||
      concept.name.length === 0 ||
      typeof concept.export !== "string" ||
      !IDENTIFIER.test(concept.export) ||
      typeof concept.registration !== "string" ||
      concept.registration.length === 0
    )
      throw new Error(`${root.id}: invalid concept metadata`);
    const floorValues = record(root.floors, `${root.id}.floors`);
    const floors: Record<string, FloorManifest> = {};
    for (const [name, raw] of Object.entries(floorValues)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`${root.id}: invalid floor ${name}`);
      const found = record(raw, `${root.id}.floors.${name}`);
      exact(found, ["summary", "packages", "files"], `${root.id}.floors.${name}`);
      if (typeof found.summary !== "string")
        throw new Error(`${root.id}: floor ${name} needs a summary`);
      const floorFiles = files(found.files, `${root.id}.${name}.files`);
      uniqueFiles([...commonFiles, ...floorFiles], `${root.id} selected ${name} files`);
      floors[name] = {
        summary: found.summary,
        packages: packages(found.packages, `${root.id}.${name}.packages`),
        files: floorFiles,
      };
    }
    if (typeof root.defaultFloor !== "string" || floors[root.defaultFloor] === undefined)
      throw new Error(`${root.id}: defaultFloor must name a floor`);
    result.concept = concept as unknown as EntryManifest["concept"];
    result.floors = floors;
    result.defaultFloor = root.defaultFloor;
    const rendered = commonFiles.filter((item) => item.render === "floor");
    const registration = commonFiles.find((item) => item.target === concept.registration);
    if (
      registration === undefined ||
      registration.render !== "floor" ||
      rendered.length !== 1 ||
      Object.values(floors).some((floor) => floor.files.some((item) => item.render !== undefined))
    )
      throw new Error(`${root.id}: concept.registration must be the only rendered file`);
    const registrySource = await readFile(resolve(dirname(path), registration.source), "utf8");
    for (const floor of Object.keys(floors))
      renderFloor(registrySource, floor, Object.keys(floors));
  } else {
    if (root.concept !== undefined || root.defaultFloor !== undefined || root.floors !== undefined)
      throw new Error(`${root.id}: recipes may not declare concept floors`);
    const recipe = record(root.recipe, `${root.id}.recipe`);
    exact(recipe, ["module", "test", "members", "routes"], `${root.id}.recipe`);
    const members = strings(recipe.members, `${root.id}.recipe.members`);
    const routes = stringRecord(recipe.routes, `${root.id}.recipe.routes`);
    if (
      members.some((member) => !IDENTIFIER.test(member)) ||
      new Set(members).size !== members.length ||
      typeof recipe.module !== "string" ||
      typeof recipe.test !== "string" ||
      Object.keys(routes).sort().join() !== [...members].sort().join()
    )
      throw new Error(
        `${root.id}: recipe members must be unique identifiers and routes must have exactly those keys`,
      );
    result.recipe = { module: recipe.module, test: recipe.test, members, routes };
    const moduleDeclaration = commonFiles.find((item) => item.target === recipe.module);
    const testDeclaration = commonFiles.find((item) => item.target === recipe.test);
    if (moduleDeclaration === undefined || testDeclaration === undefined)
      throw new Error(`${root.id}: recipe.module and recipe.test must name declared files`);
    if (commonFiles.some((item) => item.render !== undefined))
      throw new Error(`${root.id}: recipe files may not use floor rendering`);
    const moduleSource = await readFile(resolve(dirname(path), moduleDeclaration.source), "utf8");
    for (const member of members) {
      const route = routes[member] ?? "";
      const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (
        !new RegExp(
          `export\\s+const\\s+${member}\\s*=\\s*endpoint\\(\\s*["']${escaped}["']`,
          "s",
        ).test(moduleSource)
      )
        throw new Error(`${root.id}: route metadata for ${member} does not match its endpoint`);
    }
  }
  const commonPackages = new Set(Object.keys(result.packages));
  const checkImports = (
    declaration: FileDeclaration,
    source: string,
    declaredPackages: ReadonlySet<string>,
  ): void => {
    for (const specifier of moduleSpecifiers(source)) {
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      if (specifier === "@catalog/concepts" && kind === "recipe") continue;
      const name = specifier.startsWith("@")
        ? specifier.split("/").slice(0, 2).join("/")
        : (specifier.split("/", 1)[0] ?? "");
      if (!declaredPackages.has(name))
        throw new Error(`${result.id}: ${declaration.source} imports undeclared package ${name}`);
    }
  };
  for (const declaration of result.files) {
    validateTarget(declaration.target, kind);
    let source: string;
    try {
      source = await readFile(resolve(result.directory, declaration.source), "utf8");
    } catch {
      throw new Error(`${result.id}: declared source does not exist: ${declaration.source}`);
    }
    if (declaration.render === "floor") {
      for (const [name, floor] of Object.entries(result.floors ?? {}))
        checkImports(
          declaration,
          renderFloor(source, name, Object.keys(result.floors ?? {})),
          new Set([...commonPackages, ...Object.keys(floor.packages ?? {})]),
        );
    } else checkImports(declaration, source, commonPackages);
  }
  for (const floor of Object.values(result.floors ?? {}))
    for (const declaration of floor.files) {
      validateTarget(declaration.target, kind);
      let source: string;
      try {
        source = await readFile(resolve(result.directory, declaration.source), "utf8");
      } catch {
        throw new Error(`${result.id}: declared source does not exist: ${declaration.source}`);
      }
      checkImports(
        declaration,
        source,
        new Set([...commonPackages, ...Object.keys(floor.packages ?? {})]),
      );
    }

  const selections =
    kind === "concept"
      ? Object.entries(result.floors ?? {}).map(([floor, value]) => ({
          floor,
          declarations: [...result.files, ...value.files],
        }))
      : [{ floor: undefined, declarations: result.files }];
  for (const selection of selections) {
    const targets = new Set(selection.declarations.map(({ target }) => installedTarget(target)));
    for (const declaration of selection.declarations) {
      let source = await readFile(resolve(result.directory, declaration.source), "utf8");
      if (declaration.render === "floor")
        source = renderFloor(source, selection.floor ?? "", Object.keys(result.floors ?? {}));
      const from = posix.dirname(installedTarget(declaration.target));
      for (const specifier of moduleSpecifiers(source)) {
        if (!specifier.startsWith(".")) continue;
        const imported = posix.normalize(posix.join(from, specifier));
        if (!targets.has(imported))
          throw new Error(
            `${result.id}: ${declaration.source} imports an unselected file at ${imported}`,
          );
      }
    }
  }
  return result;
}

export class CatalogRegistry {
  readonly entries: ReadonlyMap<string, EntryManifest>;
  private constructor(entries: Map<string, EntryManifest>) {
    this.entries = entries;
  }
  static async load(): Promise<CatalogRegistry> {
    const root = entriesRoot();
    const index: unknown = JSON.parse(await readFile(resolve(root, "index.json"), "utf8"));
    const paths = strings(index, "entries/index.json");
    const entries = new Map<string, EntryManifest>();
    for (const item of paths) {
      try {
        assertPortablePath(item, "entry index path");
      } catch {
        throw new Error(`invalid entry index path: ${item}`);
      }
      if (!item.endsWith("/manifest.json")) throw new Error(`invalid entry index path: ${item}`);
      const entry = await parseManifest(resolve(root, item));
      if (entries.has(entry.id)) throw new Error(`duplicate entry id: ${entry.id}`);
      entries.set(entry.id, entry);
    }
    const conceptNames = new Set<string>(),
      conceptExports = new Set<string>(),
      recipeMembers = new Set<string>();
    for (const entry of entries.values()) {
      if (entry.concept !== undefined) {
        if (conceptNames.has(entry.concept.name) || conceptExports.has(entry.concept.export))
          throw new Error(`duplicate concept name or export: ${entry.id}`);
        conceptNames.add(entry.concept.name);
        conceptExports.add(entry.concept.export);
      }
      for (const member of entry.recipe?.members ?? []) {
        if (recipeMembers.has(member)) throw new Error(`duplicate recipe member: ${member}`);
        recipeMembers.add(member);
      }
      for (const required of entry.requires)
        if (!entries.has(required))
          throw new Error(`${entry.id} requires unknown entry ${required}`);
    }
    const visiting = new Set<string>(),
      visited = new Set<string>();
    const visit = (id: string): void => {
      if (visiting.has(id)) throw new Error(`entry dependency cycle at ${id}`);
      if (visited.has(id)) return;
      visiting.add(id);
      for (const dep of entries.get(id)?.requires ?? []) visit(dep);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of entries.keys()) visit(id);
    return new CatalogRegistry(entries);
  }
  resolve(ids: readonly string[]): EntryManifest[] {
    const result: EntryManifest[] = [],
      seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      const entry = this.entries.get(id);
      if (entry === undefined) throw new Error(`unknown catalog entry: ${id}`);
      for (const required of entry.requires) visit(required);
      seen.add(id);
      result.push(entry);
    };
    for (const id of ids) visit(id);
    return result;
  }
}
