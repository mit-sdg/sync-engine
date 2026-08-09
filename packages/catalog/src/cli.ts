import { relative } from "node:path";
import {
  addEntries,
  diffEntries,
  forgetEntries,
  initializeProject,
  type MutationResult,
} from "./project.ts";
import { loadCatalog } from "./registry.ts";
import type { AddOptions, EntryKind, InitPaths } from "./types.ts";

const usage = `Usage: catalog <command> [arguments]

  catalog init [entry...] [path options] [selection options]
    Initialize catalog.lock and optionally install entries.

  catalog list [concept|computation|recipe|bundle]
    List available catalog entries.

  catalog show <entry>
    Show one entry's dependencies, variants, requirements, and files.

  catalog add <entry...> [--variant concept/id=name] [--file name.ts]
    Copy entries and their dependencies without overwriting source.

  catalog diff [entry...]
    Compare copied source with this catalog package.

  catalog forget <entry...>
    Stop tracking entries without deleting their source.

Path options for init:
  --concepts <directory>       Default: src/concepts
  --computations <directory>   Default: src/computations
  --recipes <directory>        Default: src/composition
  --concept-set <file>         Default: src/concept-set.ts
  --declarations <file>        Default: src/catalog/text.generated.d.ts
  --registrations <file>       Default: src/catalog/registrations.generated.ts
  --composition <file>         Default: src/catalog/composition.generated.ts

Selection options:
  --variant <concept-id>=<variant>  Repeat for multiple concepts.
  --file <name.ts>                  Rename one explicitly added recipe module.`;

const KINDS = new Set<EntryKind>(["bundle", "computation", "concept", "recipe"]);
const HELP = new Set([undefined, "help", "--help", "-h"]);

export interface CatalogIO {
  log(message: string): void;
}

function addOptions(
  args: string[],
  allowPaths: boolean,
): {
  entries: string[];
  add: AddOptions;
  paths: InitPaths;
} {
  const entries: string[] = [];
  const variants = new Map<string, string>();
  const paths: InitPaths = {};
  let recipeFile: string | undefined;
  const pathOptions: Record<string, keyof InitPaths> = {
    "--concepts": "concepts",
    "--computations": "computations",
    "--recipes": "recipes",
    "--concept-set": "conceptSet",
    "--declarations": "declarations",
    "--registrations": "registrations",
    "--composition": "composition",
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--variant") {
      const value = args[++index];
      const match = /^((?:concept)\/[a-z][a-z0-9-]*)=([a-z][a-z0-9-]*)$/.exec(value ?? "");
      if (match === null) throw new Error("--variant requires concept/<id>=<variant>");
      const [, id, variant] = match;
      if (variants.has(id)) throw new Error(`--variant is repeated for ${id}`);
      variants.set(id, variant);
      continue;
    }
    if (argument === "--file") {
      const value = args[++index];
      if (value === undefined || value.startsWith("-")) throw new Error("--file needs a value");
      if (recipeFile !== undefined) throw new Error("--file may appear only once");
      recipeFile = value;
      continue;
    }
    const pathKey = pathOptions[argument ?? ""];
    if (pathKey !== undefined) {
      if (!allowPaths) throw new Error(`${argument} is only valid with catalog init`);
      const value = args[++index];
      if (value === undefined || value.startsWith("-"))
        throw new Error(`${argument} needs a value`);
      if (paths[pathKey] !== undefined) throw new Error(`${argument} may appear only once`);
      paths[pathKey] = value;
      continue;
    }
    if (argument?.startsWith("-")) throw new Error(`Unknown option: ${argument}`);
    if (argument !== undefined) entries.push(argument);
  }
  return { entries, add: { variants, ...(recipeFile === undefined ? {} : { recipeFile }) }, paths };
}

function displayRoot(cwd: string, root: string): string {
  const path = relative(cwd, root);
  return path === "" ? "." : path;
}

function printMutation(result: MutationResult, cwd: string, io: CatalogIO): void {
  if (result.initialized) io.log(`Initialized catalog in ${displayRoot(cwd, result.root)}.`);
  for (const id of result.alreadyInstalled) io.log(`Already tracked: ${id}`);
  if (result.written.length > 0) {
    io.log(`Wrote ${result.written.length} files:`);
    for (const path of result.written) io.log(`  ${path}`);
  }
  for (const warning of result.warnings) io.log(`Warning: ${warning}`);
  if (result.integration.length > 0) {
    io.log("\nIntegrate once:");
    for (const instruction of result.integration) io.log(`  ${instruction}`);
  }
  if (result.checkCommand !== undefined) io.log(`\nNext: ${result.checkCommand}`);
}

async function listEntries(kind: string | undefined, io: CatalogIO): Promise<void> {
  if (kind !== undefined && !KINDS.has(kind as EntryKind)) {
    throw new Error(`catalog list kind must be concept, computation, recipe, or bundle`);
  }
  const catalog = await loadCatalog();
  const entries = [...catalog.values()]
    .filter((entry) => kind === undefined || entry.manifest.kind === kind)
    .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id));
  const width = Math.max(...entries.map((entry) => entry.manifest.id.length), 0);
  for (const { manifest } of entries) {
    io.log(`${manifest.id.padEnd(width)}  ${manifest.summary}`);
  }
}

async function showEntry(id: string, io: CatalogIO): Promise<void> {
  const entry = (await loadCatalog()).get(id);
  if (entry === undefined) throw new Error(`Unknown catalog entry: ${id}`);
  const { manifest } = entry;
  io.log(`${manifest.id}\n${manifest.summary}`);
  io.log(`\nKind: ${manifest.kind}`);
  io.log(`Dependencies: ${(manifest.requires ?? []).join(", ") || "none"}`);
  const packageRequirements = Object.entries(manifest.packages ?? {}).map(
    ([name, range]) => `${name}@${range}`,
  );
  io.log(`Packages: ${packageRequirements.join(", ") || "@mit-sdg/sync-engine peer"}`);
  if (manifest.variants !== undefined) {
    io.log("Variants:");
    for (const [name, variant] of Object.entries(manifest.variants).sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      io.log(`  ${name}: ${variant.summary}`);
    }
  }
  const files = [
    ...(manifest.files ?? []),
    ...Object.values(manifest.variants ?? {}).flatMap((variant) => variant.files),
  ];
  io.log("Files:");
  for (const file of files) io.log(`  ${file.target}`);
}

export async function runCatalog(
  argv: string[],
  cwd = process.cwd(),
  io: CatalogIO = console,
): Promise<void> {
  const [command, ...args] = argv;
  if (HELP.has(command)) {
    if (args.length > 0) throw new Error(usage);
    io.log(usage);
    return;
  }
  if (command === "list") {
    if (args.length > 1 || args[0]?.startsWith("-")) throw new Error(usage);
    await listEntries(args[0], io);
    return;
  }
  if (command === "show") {
    if (args.length !== 1 || args[0].startsWith("-")) throw new Error(usage);
    await showEntry(args[0], io);
    return;
  }
  if (command === "init") {
    const options = addOptions(args, true);
    printMutation(
      await initializeProject(cwd, options.paths, options.entries, options.add),
      cwd,
      io,
    );
    return;
  }
  if (command === "add") {
    const options = addOptions(args, false);
    printMutation(await addEntries(cwd, options.entries, options.add), cwd, io);
    return;
  }
  if (command === "diff") {
    if (args.some((argument) => argument.startsWith("-"))) throw new Error(usage);
    const result = await diffEntries(cwd, args);
    io.log(result.output);
    return;
  }
  if (command === "forget") {
    if (args.length === 0 || args.some((argument) => argument.startsWith("-"))) {
      throw new Error(usage);
    }
    printMutation(await forgetEntries(cwd, args), cwd, io);
    return;
  }
  throw new Error(usage);
}

export { usage };
