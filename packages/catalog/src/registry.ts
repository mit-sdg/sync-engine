import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogSource, EntryManifest, ImplementationManifest } from "./types.ts";
import { exact, object as record, stringArray } from "./decode.ts";

const ENTRY_ID = /^(?:concept|recipe)\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/;
const LOCAL_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const IMPLEMENTATION = /^[a-z][a-z0-9-]*$/;

function entriesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = resolve(here, "../entries");
  return existsSync(source) ? source : resolve(here, "entries");
}

function localFile(value: unknown, label: string): string {
  if (typeof value !== "string" || !LOCAL_FILE.test(value))
    throw new Error(`${label} must be a local file name`);
  return value;
}

function sources(value: unknown, label: string): string[] {
  const found = stringArray(value, label);
  for (const [index, source] of found.entries()) localFile(source, `${label}[${index}]`);
  if (new Set(found).size !== found.length) throw new Error(`${label} repeats a source`);
  return found;
}

async function parseManifest(path: string): Promise<EntryManifest> {
  const root = record(JSON.parse(await readFile(path, "utf8")), path);
  exact(
    root,
    ["schema", "id", "kind", "summary", "design", "sources", "requires", "implementations"],
    path,
  );
  if (
    root.schema !== 2 ||
    (root.kind !== "concept" && root.kind !== "recipe") ||
    typeof root.id !== "string" ||
    !ENTRY_ID.test(root.id) ||
    !root.id.startsWith(`${root.kind}/`) ||
    typeof root.summary !== "string" ||
    root.summary.length === 0
  )
    throw new Error(`invalid manifest identity in ${path}`);

  const directory = dirname(path);
  const design = localFile(root.design, `${root.id}.design`);
  const commonSources = sources(root.sources, `${root.id}.sources`);
  let entry: EntryManifest;
  if (root.kind === "recipe") {
    if (root.implementations !== undefined)
      throw new Error(`${root.id}: recipe cannot declare implementations`);
    const requires = stringArray(root.requires, `${root.id}.requires`);
    if (new Set(requires).size !== requires.length || requires.some((id) => !ENTRY_ID.test(id)))
      throw new Error(`${root.id}.requires must contain unique entry ids`);
    entry = {
      schema: 2,
      id: root.id,
      kind: "recipe",
      summary: root.summary,
      design,
      sources: commonSources,
      requires,
      directory,
    };
  } else {
    if (root.requires !== undefined) throw new Error(`${root.id}: concept cannot declare requires`);
    const raw = record(root.implementations, `${root.id}.implementations`);
    const implementations: Record<string, ImplementationManifest> = {};
    for (const [name, value] of Object.entries(raw)) {
      if (!IMPLEMENTATION.test(name)) throw new Error(`${root.id}: invalid implementation ${name}`);
      const implementation = record(value, `${root.id}.implementations.${name}`);
      exact(implementation, ["summary", "sources"], `${root.id}.implementations.${name}`);
      if (typeof implementation.summary !== "string" || implementation.summary.length === 0)
        throw new Error(`${root.id}: implementation ${name} needs a summary`);
      implementations[name] = {
        summary: implementation.summary,
        sources: sources(implementation.sources, `${root.id}.implementations.${name}.sources`),
      };
    }
    if (Object.keys(implementations).length === 0)
      throw new Error(`${root.id}: concept needs an implementation`);
    entry = {
      schema: 2,
      id: root.id,
      kind: "concept",
      summary: root.summary,
      design,
      sources: commonSources,
      implementations,
      directory,
    };
  }

  const selected = CatalogRegistry.sources(entry);
  if (new Set(selected.map(({ selector }) => selector)).size !== selected.length)
    throw new Error(`${entry.id} repeats a source selector`);
  const declared = new Set([design, ...selected.map(({ path: source }) => source)]);
  for (const source of declared) {
    try {
      await readFile(resolve(directory, source));
    } catch {
      throw new Error(`${entry.id}: declared source does not exist: ${source}`);
    }
  }
  return entry;
}

export class CatalogRegistry {
  readonly entries: ReadonlyMap<string, EntryManifest>;
  private constructor(entries: Map<string, EntryManifest>) {
    this.entries = entries;
  }

  static sources(entry: EntryManifest): CatalogSource[] {
    const common = entry.sources.map((path) => ({ selector: path, path }));
    if (entry.kind === "recipe") return common;
    return [
      ...common,
      ...Object.entries(entry.implementations).flatMap(([implementation, value]) =>
        value.sources.map((path) => ({ selector: `${implementation}/${path}`, path })),
      ),
    ];
  }

  static async load(root = entriesRoot()): Promise<CatalogRegistry> {
    const index = stringArray(
      JSON.parse(await readFile(resolve(root, "index.json"), "utf8")),
      "entries/index.json",
    );
    const entries = new Map<string, EntryManifest>();
    for (const item of index) {
      if (!/^(?:concept|recipe)\/[a-z][a-z0-9-]*\/manifest\.json$/.test(item))
        throw new Error(`invalid entry index path: ${item}`);
      const entry = await parseManifest(resolve(root, item));
      if (entries.has(entry.id)) throw new Error(`duplicate entry id: ${entry.id}`);
      entries.set(entry.id, entry);
    }
    for (const entry of entries.values())
      if (entry.kind === "recipe")
        for (const required of entry.requires)
          if (!entries.has(required))
            throw new Error(`${entry.id} requires unknown entry ${required}`);
    return new CatalogRegistry(entries);
  }
}
