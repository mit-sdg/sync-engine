import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CatalogRegistry } from "./registry.ts";
import type { EntryManifest } from "./types.ts";

const USAGE = `Usage: sync-engine-catalog <command> [arguments]

  sync-engine-catalog list [concept|recipe]
  sync-engine-catalog show <entry> [--raw]
  sync-engine-catalog source <entry> <selector> [--raw]
  sync-engine-catalog help`;

function rawArgument(args: readonly string[], count: number): { values: string[]; raw: boolean } {
  const raw = args.at(-1) === "--raw";
  const values = raw ? args.slice(0, -1) : [...args];
  if (values.length !== count || values.some((value) => value.startsWith("-")))
    throw new Error(USAGE);
  return { values, raw };
}

function entryFrom(registry: CatalogRegistry, id: string): EntryManifest {
  const entry = registry.entries.get(id);
  if (entry === undefined) throw new Error(`unknown catalog entry: ${id}`);
  return entry;
}

async function printAsset(
  entry: EntryManifest,
  role: string,
  file: string,
  raw: boolean,
): Promise<void> {
  const contents = await readFile(resolve(entry.directory, file), "utf8");
  if (raw) process.stdout.write(contents);
  else {
    console.log(`Entry: ${entry.id}`);
    console.log(`Asset: ${role}`);
    console.log(`File: ${file}`);
    console.log("---");
    process.stdout.write(contents);
  }
}

export async function runCatalog(args: readonly string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    if (rest.length > 0) throw new Error(USAGE);
    console.log(USAGE);
    return;
  }
  const registry = await CatalogRegistry.load();
  if (command === "list") {
    if (rest.length > 1 || (rest[0] !== undefined && rest[0] !== "concept" && rest[0] !== "recipe"))
      throw new Error(USAGE);
    for (const entry of registry.entries.values())
      if (rest[0] === undefined || entry.kind === rest[0])
        console.log(`${entry.id}\t${entry.kind}\t${entry.summary}`);
    return;
  }
  if (command === "show") {
    const { values, raw } = rawArgument(rest, 1);
    const entry = entryFrom(registry, values[0] ?? "");
    if (!raw) {
      console.log(`${entry.id}\t${entry.kind}\t${entry.summary}`);
      if (entry.kind === "recipe") console.log(`Requires: ${entry.requires.join(", ") || "none"}`);
      console.log("Sources:");
      for (const source of CatalogRegistry.sources(entry)) console.log(`  ${source.selector}`);
      console.log("");
    }
    await printAsset(entry, "design", entry.design, raw);
    return;
  }
  if (command === "source") {
    const { values, raw } = rawArgument(rest, 2);
    const entry = entryFrom(registry, values[0] ?? "");
    const selector = values[1] ?? "";
    const source = CatalogRegistry.sources(entry).find(
      (candidate) => candidate.selector === selector,
    );
    if (source === undefined)
      throw new Error(`unknown source selector for ${entry.id}: ${selector}`);
    await printAsset(entry, `source (${selector})`, source.path, raw);
    return;
  }
  throw new Error(USAGE);
}
