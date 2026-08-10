import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import semver from "semver";
import type {
  CatalogLock,
  ConceptIntegration,
  EntryKind,
  LockEntry,
  RecipeIntegration,
} from "./types.ts";
import { assertPortablePath } from "./paths.ts";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ENTRY_ID = /^(?:concept|recipe)\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
const GENERATED_TARGETS = [
  "src/catalog/composition.generated.ts",
  "src/catalog/registrations.generated.ts",
  "src/catalog/text.generated.d.ts",
] as const;

export const EMPTY_LOCK = (): CatalogLock => ({
  schema: 1,
  paths: { concepts: "src/concepts", recipes: "src/composition", generated: "src/catalog" },
  entries: {},
  generated: [],
});

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`${label} has unknown field ${key}`);
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(value).size !== value.length
  )
    throw new Error(`${label} must contain unique nonempty strings`);
  return value as string[];
}

function packageRequirements(value: unknown, label: string): Record<string, string> {
  const requirements = object(value, label);
  for (const [name, range] of Object.entries(requirements))
    if (name.length === 0 || typeof range !== "string" || semver.validRange(range) === null)
      throw new Error(`${label} contains an invalid requirement for ${name}`);
  return requirements as Record<string, string>;
}

function parseIntegration(
  value: unknown,
  kind: EntryKind,
  id: string,
): ConceptIntegration | RecipeIntegration {
  const integration = object(value, `${id} integration`);
  if (kind === "concept") {
    exact(integration, ["kind", "name", "export", "registration"], `${id} integration`);
    if (
      integration.kind !== "concept" ||
      typeof integration.name !== "string" ||
      integration.name.length === 0 ||
      typeof integration.export !== "string" ||
      !IDENTIFIER.test(integration.export) ||
      typeof integration.registration !== "string"
    )
      throw new Error(`invalid concept integration in ${id}`);
    assertPortablePath(integration.registration, `${id} registration`);
    if (!integration.registration.startsWith("src/concepts/"))
      throw new Error(`${id} registration must remain under src/concepts`);
    return integration as unknown as ConceptIntegration;
  }

  exact(integration, ["kind", "module", "test", "members", "routes"], `${id} integration`);
  if (
    integration.kind !== "recipe" ||
    typeof integration.module !== "string" ||
    typeof integration.test !== "string"
  )
    throw new Error(`invalid recipe integration in ${id}`);
  assertPortablePath(integration.module, `${id} module`);
  assertPortablePath(integration.test, `${id} test`);
  if (
    !integration.module.startsWith("src/composition/") ||
    !integration.test.startsWith("src/composition/")
  )
    throw new Error(`${id} integration must remain under src/composition`);
  const members = stringArray(integration.members, `${id} members`);
  if (members.some((member) => !IDENTIFIER.test(member)))
    throw new Error(`${id} members must be TypeScript identifiers`);
  const routes = object(integration.routes, `${id} routes`);
  if (
    Object.keys(routes).sort().join("\0") !== [...members].sort().join("\0") ||
    Object.values(routes).some((route) => typeof route !== "string" || route.length === 0)
  )
    throw new Error(`${id} routes must contain one nonempty route for every member`);
  return {
    kind: "recipe",
    module: integration.module,
    test: integration.test,
    members,
    routes: routes as Record<string, string>,
  };
}

export function parseLock(source: string): CatalogLock {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`catalog.lock is invalid JSON (${String(error)})`);
  }
  const root = object(value, "catalog.lock");
  exact(root, ["schema", "floor", "paths", "entries", "generated"], "catalog.lock");
  if (root.schema !== 1) throw new Error("catalog.lock schema must be 1");
  const paths = object(root.paths, "catalog.lock paths");
  exact(paths, ["concepts", "recipes", "generated"], "catalog.lock paths");
  if (
    paths.concepts !== "src/concepts" ||
    paths.recipes !== "src/composition" ||
    paths.generated !== "src/catalog"
  )
    throw new Error("catalog.lock paths are fixed in schema 1");
  const rawEntries = object(root.entries, "catalog.lock entries");
  if (!Array.isArray(root.generated)) throw new Error("catalog.lock generated must be an array");
  const floor = root.floor;
  if (floor !== undefined && (typeof floor !== "string" || !/^[a-z][a-z0-9-]*$/.test(floor)))
    throw new Error("catalog.lock floor is invalid");

  const entries: Record<string, LockEntry> = {};
  const targets = new Set<string>();
  const conceptNames = new Set<string>();
  const conceptExports = new Set<string>();
  const recipeMembers = new Set<string>();
  let concepts = 0;
  for (const [id, rawEntry] of Object.entries(rawEntries)) {
    const entry = object(rawEntry, `lock entry ${id}`);
    exact(
      entry,
      [
        "kind",
        "catalogVersion",
        "sourceDigest",
        "requires",
        "floor",
        "packages",
        "integration",
        "files",
      ],
      `lock entry ${id}`,
    );
    if (
      (entry.kind !== "concept" && entry.kind !== "recipe") ||
      !ENTRY_ID.test(id) ||
      !id.startsWith(`${entry.kind}/`) ||
      typeof entry.catalogVersion !== "string" ||
      semver.valid(entry.catalogVersion) === null ||
      typeof entry.sourceDigest !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sourceDigest) ||
      !Array.isArray(entry.files)
    )
      throw new Error(`invalid lock entry ${id}`);
    const kind = entry.kind;
    const requires = stringArray(entry.requires, `${id} requires`);
    if (requires.some((required) => !ENTRY_ID.test(required)))
      throw new Error(`${id} contains an invalid requirement id`);
    if (kind === "concept" && requires.length > 0)
      throw new Error(`concept ${id} may not record requirements`);
    const requirements = packageRequirements(entry.packages, `${id} packages`);
    const integration = parseIntegration(entry.integration, kind, id);
    if (kind === "concept") {
      const conceptIntegration = integration as ConceptIntegration;
      concepts++;
      if (typeof floor !== "string" || entry.floor !== floor)
        throw new Error(`concept ${id} must use the locked floor`);
      if (
        conceptNames.has(conceptIntegration.name) ||
        conceptExports.has(conceptIntegration.export)
      )
        throw new Error(`duplicate concept integration in catalog.lock: ${id}`);
      conceptNames.add(conceptIntegration.name);
      conceptExports.add(conceptIntegration.export);
    } else {
      if (entry.floor !== undefined) throw new Error(`recipe ${id} may not record a floor`);
      for (const member of (integration as RecipeIntegration).members) {
        if (recipeMembers.has(member))
          throw new Error(`duplicate recipe member in catalog.lock: ${member}`);
        recipeMembers.add(member);
      }
    }

    const trackedFiles = entry.files.map((rawFile, index) => {
      const tracked = object(rawFile, `${id} file ${index}`);
      exact(tracked, ["source", "target", "hash", "class"], `${id} file ${index}`);
      if (
        typeof tracked.source !== "string" ||
        tracked.source.length === 0 ||
        typeof tracked.target !== "string" ||
        typeof tracked.hash !== "string" ||
        !/^[a-f0-9]{64}$/.test(tracked.hash) ||
        (tracked.class !== "owned" && tracked.class !== "rendered")
      )
        throw new Error(`invalid tracked file in ${id}`);
      assertPortablePath(tracked.target, `${id} target`);
      const prefix = kind === "concept" ? "src/concepts/" : "src/composition/";
      if (!tracked.target.startsWith(prefix))
        throw new Error(`${id} target must remain under ${prefix}`);
      if (targets.has(tracked.target)) throw new Error(`duplicate lock target: ${tracked.target}`);
      targets.add(tracked.target);
      return tracked as unknown as LockEntry["files"][number];
    });
    const integrationTargets =
      kind === "concept"
        ? [{ target: (integration as ConceptIntegration).registration, rendered: true }]
        : [
            { target: (integration as RecipeIntegration).module, rendered: false },
            { target: (integration as RecipeIntegration).test, rendered: false },
          ];
    for (const expected of integrationTargets) {
      const tracked = trackedFiles.find((file) => file.target === expected.target);
      if (tracked === undefined || (expected.rendered && tracked.class !== "rendered"))
        throw new Error(`${id} integration target is not tracked: ${expected.target}`);
    }
    entries[id] = {
      kind,
      catalogVersion: entry.catalogVersion,
      sourceDigest: entry.sourceDigest,
      requires,
      ...(kind === "concept" ? { floor: entry.floor as string } : {}),
      packages: requirements,
      integration,
      files: trackedFiles,
    };
  }
  if (Object.keys(entries).length > 0 && concepts === 0)
    throw new Error("a nonempty catalog.lock must contain a concept");
  if (concepts === 0 && floor !== undefined)
    throw new Error("an empty catalog.lock may not select a floor");
  for (const [id, entry] of Object.entries(entries))
    for (const required of entry.requires)
      if (entries[required] === undefined)
        throw new Error(`${id} requires missing lock entry ${required}`);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new Error(`catalog.lock dependency cycle at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const required of entries[id]?.requires ?? []) visit(required);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of Object.keys(entries)) visit(id);

  const generated = root.generated.map((rawFile, index) => {
    const file = object(rawFile, `generated file ${index}`);
    exact(file, ["target", "hash"], `generated file ${index}`);
    if (typeof file.target === "string") assertPortablePath(file.target, "generated target");
    if (
      typeof file.target !== "string" ||
      !(GENERATED_TARGETS as readonly string[]).includes(file.target) ||
      typeof file.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(file.hash)
    )
      throw new Error("invalid generated file record");
    if (targets.has(file.target)) throw new Error(`duplicate lock target: ${file.target}`);
    targets.add(file.target);
    return { target: file.target, hash: file.hash };
  });
  if (
    Object.keys(entries).length > 0 &&
    (generated.length !== GENERATED_TARGETS.length ||
      GENERATED_TARGETS.some((target) => !generated.some((file) => file.target === target)))
  )
    throw new Error("a nonempty catalog.lock must track every generated file");

  return {
    schema: 1,
    ...(typeof floor === "string" ? { floor } : {}),
    paths: { concepts: "src/concepts", recipes: "src/composition", generated: "src/catalog" },
    entries,
    generated,
  };
}

export async function readLock(root: string): Promise<CatalogLock> {
  const path = `${root}/catalog.lock`;
  return existsSync(path) ? parseLock(await readFile(path, "utf8")) : EMPTY_LOCK();
}

export function serializeLock(lock: CatalogLock): string {
  const sort = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(sort)
      : typeof value === "object" && value !== null
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, sort(item)]),
          )
        : value;
  return `${JSON.stringify(sort(lock), null, 2)}\n`;
}
