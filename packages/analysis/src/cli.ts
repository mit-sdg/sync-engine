import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseApplicationManifest, type ApplicationManifestV1 } from "@mit-sdg/sync-engine/tooling";
import {
  createApplicationAnalysis,
  designRefKey,
  parseDesignRefKey,
  type ApplicationAnalysis,
  type DesignDefinition,
  type DesignRef,
  type DesignSummary,
} from "./ir/index.ts";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const MAX_MANIFEST_BYTES = 64 * 1024 * 1024;
const MAX_JSON_BYTES = 512 * 1024;
const MAX_MARKDOWN_BYTES = 64 * 1024;
const HELP = new Set(["help", "--help", "-h"]);
const COMMANDS = new Set(["summary", "search", "describe", "sources", "impact", "diagnostics"]);

export const analysisCliUsage = `Usage: sync-engine-analysis <command> [arguments] [options]

  summary                         Inventory counts and diagnostics
  search <terms...>               Find exact design references
  describe <ref>                  Describe one manifest declaration
  sources <ref>                   Find source declarations and ranges
  impact <ref>                    Trace possible manifest impact
  diagnostics                     List manifest and source findings

Options:
  --config <path>                 Manifest-producing config (default: nearest generated.config.ts)
  --root <path>                   Source project root (default: config directory)
  --tsconfig <path>               Project config below root (default: tsconfig.json)
  --design-base <path>            Base for manifest design paths (default: generated)
  --offset <n>                    Zero-based result offset (default: 0)
  --limit <n>                     Result limit, 1-${MAX_LIMIT} (default: ${DEFAULT_LIMIT})
  --json                          Emit bounded JSON instead of compact Markdown

References: concept:Name, action:Concept.name, query:Concept.name,
reaction:Name, view:Name, former:Name, computation:Name, or endpoint:Name:/path.
The canonical JSON tuple printed by this command is also accepted.`;

interface CliOptions {
  readonly command: string;
  readonly positionals: readonly string[];
  readonly configPath: string;
  readonly rootPath: string;
  readonly tsconfigPath: string;
  readonly designBasePath: string;
  readonly offset: number;
  readonly limit: number;
  readonly json: boolean;
}

export interface AnalysisCliDependencies {
  readonly cwd?: string;
  readonly loadManifest?: (configPath: string) => Promise<ApplicationManifestV1>;
  readonly writeOut?: (text: string) => void;
}

function fail(message: string): never {
  throw new Error(`${message}\n\n${analysisCliUsage}`);
}

function integer(
  value: string | undefined,
  option: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value))
    fail(`${option} requires an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${option} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function findUp(start: string, name: string): string | undefined {
  let directory = resolve(start);
  while (true) {
    const candidate = resolve(directory, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

function parseArgs(args: readonly string[], cwd: string): CliOptions | "help" {
  if (args.length === 0 || (args.length === 1 && HELP.has(args[0] ?? ""))) return "help";
  const command = args[0] ?? "";
  if (!COMMANDS.has(command)) fail(`Unknown command: ${command || "(missing)"}`);
  const positionals: string[] = [];
  let explicitConfig: string | undefined;
  let explicitRoot: string | undefined;
  let tsconfigPath = "tsconfig.json";
  let designBasePath = "generated";
  let offset = 0;
  let limit = DEFAULT_LIMIT;
  let json = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (argument === "--json") {
      if (json) fail("--json may be supplied only once");
      json = true;
    } else if (
      ["--config", "--root", "--tsconfig", "--design-base", "--offset", "--limit"].includes(
        argument,
      )
    ) {
      const value = args[++index];
      if (value === undefined || value === "" || value.startsWith("--"))
        fail(`${argument} requires a value`);
      if (argument === "--config") {
        if (explicitConfig !== undefined) fail("--config may be supplied only once");
        explicitConfig = resolve(cwd, value);
      } else if (argument === "--root") {
        if (explicitRoot !== undefined) fail("--root may be supplied only once");
        explicitRoot = resolve(cwd, value);
      } else if (argument === "--tsconfig") tsconfigPath = value;
      else if (argument === "--design-base") designBasePath = value;
      else if (argument === "--offset")
        offset = integer(value, argument, 0, Number.MAX_SAFE_INTEGER);
      else limit = integer(value, argument, 1, MAX_LIMIT);
    } else if (argument.startsWith("-")) fail(`Unknown option: ${argument}`);
    else positionals.push(argument);
  }
  const expected =
    command === "summary" || command === "diagnostics" ? 0 : command === "search" ? -1 : 1;
  if (
    (expected === 0 && positionals.length !== 0) ||
    (expected === 1 && positionals.length !== 1)
  ) {
    fail(
      `${command} ${expected === 0 ? "does not accept arguments" : "requires exactly one reference"}`,
    );
  }
  if (expected === -1 && positionals.length === 0) fail("search requires one or more terms");
  const configPath = explicitConfig ?? findUp(cwd, "generated.config.ts");
  if (configPath === undefined) fail("No generated.config.ts found; supply --config <path>");
  return {
    command,
    positionals,
    configPath,
    rootPath: explicitRoot ?? dirname(configPath),
    tsconfigPath,
    designBasePath,
    offset,
    limit,
    json,
  };
}

function ancestors(start: string): string[] {
  const result: string[] = [];
  let directory = resolve(start);
  while (true) {
    result.push(directory);
    const parent = dirname(directory);
    if (parent === directory) return result;
    directory = parent;
  }
}

interface CoreCommand {
  readonly executable: string;
  readonly leadingArguments: readonly string[];
}

async function packagedCoreCommand(manifestPath: string): Promise<CoreCommand | undefined> {
  if (!existsSync(manifestPath)) return undefined;
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      name?: unknown;
      bin?: unknown;
    };
    if (manifest.name !== "@mit-sdg/sync-engine") return undefined;
    const target =
      typeof manifest.bin === "string"
        ? manifest.bin
        : typeof manifest.bin === "object" &&
            manifest.bin !== null &&
            "sync-engine" in manifest.bin &&
            typeof manifest.bin["sync-engine"] === "string"
          ? manifest.bin["sync-engine"]
          : undefined;
    if (target === undefined) return undefined;
    const entrypoint = resolve(dirname(manifestPath), target);
    // Core is a Bun executable and loads Bun application configuration. Invoke its declared
    // runtime directly instead of inheriting this Node command's process.execPath.
    return existsSync(entrypoint)
      ? { executable: "bun", leadingArguments: [entrypoint] }
      : undefined;
  } catch {
    return undefined;
  }
}

async function coreCommand(cwd: string): Promise<CoreCommand> {
  const sourcePath = await realpath(fileURLToPath(import.meta.url));
  const directories = [...new Set([...ancestors(cwd), ...ancestors(dirname(sourcePath))])];
  for (const directory of directories) {
    for (const manifestPath of [
      resolve(directory, "node_modules", "@mit-sdg", "sync-engine", "package.json"),
      resolve(directory, "package.json"),
    ]) {
      const command = await packagedCoreCommand(manifestPath);
      if (command !== undefined) return command;
    }
  }
  throw new Error(
    "Cannot find the installed sync-engine executable; install the matching core package",
  );
}

async function loadManifestFromCore(configPath: string): Promise<ApplicationManifestV1> {
  const command = await coreCommand(dirname(configPath));
  const source = await new Promise<string>((resolveOutput, reject) => {
    execFile(
      command.executable,
      [...command.leadingArguments, "artifacts", "manifest", "--config", configPath],
      { cwd: dirname(configPath), encoding: "utf8", maxBuffer: MAX_MANIFEST_BYTES },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`Core manifest command failed: ${stderr.trim() || error.message}`));
          return;
        }
        if (stderr.trim() !== "") {
          reject(new Error(`Core manifest command wrote unexpected stderr: ${stderr.trim()}`));
          return;
        }
        resolveOutput(stdout);
      },
    );
  });
  return parseApplicationManifest(source);
}

function parseFriendlyRef(source: string): DesignRef {
  if (source.startsWith("[")) return parseDesignRefKey(source);
  const separator = source.indexOf(":");
  if (separator < 1) fail(`Malformed reference: ${source}`);
  const kind = source.slice(0, separator);
  const name = source.slice(separator + 1);
  if (name.trim() === "") fail(`Malformed reference: ${source}`);
  if (["concept", "reaction", "view", "former", "computation"].includes(kind)) {
    return parseDesignRefKey(JSON.stringify([kind, name]));
  }
  if (kind === "action" || kind === "query") {
    const dot = name.indexOf(".");
    if (dot < 1 || dot === name.length - 1) fail(`Malformed ${kind} reference: ${source}`);
    return parseDesignRefKey(JSON.stringify([kind, name.slice(0, dot), name.slice(dot + 1)]));
  }
  if (kind === "endpoint") {
    const path = name.indexOf(":");
    if (path < 1 || path === name.length - 1) fail(`Malformed endpoint reference: ${source}`);
    return parseDesignRefKey(JSON.stringify([kind, name.slice(0, path), name.slice(path + 1)]));
  }
  fail(`Unknown reference kind: ${kind}`);
}

function displayRef(ref: DesignRef): string {
  switch (ref.kind) {
    case "concept":
      return `concept:${ref.concept}`;
    case "action":
      return `action:${ref.concept}.${ref.action}`;
    case "query":
      return `query:${ref.concept}.${ref.query}`;
    case "reaction":
      return `reaction:${ref.reaction}`;
    case "view":
      return `view:${ref.view}`;
    case "former":
      return `former:${ref.former}`;
    case "computation":
      return `computation:${ref.computation}`;
    case "endpoint":
      return `endpoint:${ref.endpoint}:${ref.path}`;
  }
}

function summaryDto(summary: DesignSummary): Record<string, unknown> {
  return {
    ref: displayRef(summary.ref),
    key: designRefKey(summary.ref),
    name: summary.qualifiedName,
    source: summary.sourceAvailability,
    paths: summary.sourcePaths,
    diagnostics: summary.diagnostics,
    ...(summary.portability === undefined ? {} : { portability: summary.portability }),
  };
}

function conciseDefinition(definition: DesignDefinition | undefined): unknown {
  if (definition === undefined) return undefined;
  switch (definition.kind) {
    case "concept":
      return {
        kind: definition.kind,
        concept: definition.concept,
        design: definition.design,
        implementation: definition.implementation,
      };
    case "action":
      return {
        kind: definition.kind,
        concept: definition.concept,
        action: definition.action,
        specification: definition.specification,
      };
    case "query":
      return {
        kind: definition.kind,
        concept: definition.concept,
        query: definition.query,
        specification: definition.specification,
      };
    case "reaction":
      return {
        kind: definition.kind,
        identity: definition.identity,
        declaration: definition.declaration,
        runtimeEntries: definition.reactions.length,
        unloweredEntries: definition.unlowered.length,
      };
    case "view":
      return {
        kind: definition.kind,
        identity: definition.identity,
        declaration: definition.declaration,
        runtimeEntries: definition.runtime.length,
      };
    case "former":
      return {
        kind: definition.kind,
        identity: definition.identity,
        declaration: definition.declaration,
        runtimeEntries: definition.runtime.length,
      };
    case "computation":
      return definition;
    case "endpoint":
      return definition;
  }
}

function jsonText(value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(text) > MAX_JSON_BYTES)
    throw new Error(
      `Result exceeds the ${MAX_JSON_BYTES}-byte CLI JSON bound; use --limit/--offset`,
    );
  return text;
}

function markdown(title: string, lines: readonly string[]): string {
  return [`# ${title}`, "", ...lines, ""].join("\n");
}

async function manifestCommand(
  options: CliOptions,
  analysis: ApplicationAnalysis,
): Promise<unknown> {
  const page = { offset: options.offset, limit: options.limit };
  if (options.command === "summary") {
    const result = await analysis.catalog({ page: { offset: 0, limit: 100 } });
    const counts: Record<string, number> = {};
    for (const ref of analysis.index.inventory) counts[ref.kind] = (counts[ref.kind] ?? 0) + 1;
    return {
      total: result.total,
      kinds: counts,
      indexIssues: analysis.index.issues.length,
    };
  }
  if (options.command === "search") {
    const result = await analysis.search({ query: options.positionals.join(" "), page });
    return {
      query: result.query,
      total: result.total,
      nextOffset: result.nextOffset,
      items: result.items.map((item) => ({
        ref: displayRef(item.ref),
        key: item.key,
        name: item.qualifiedName,
        field: item.matchedField,
        snippet: item.snippet,
      })),
    };
  }
  const ref = parseFriendlyRef(options.positionals[0] ?? "");
  if (options.command === "describe") {
    const result = await analysis.describe({ ref, detail: "definition" });
    return { ...summaryDto(result.summary), definition: conciseDefinition(result.definition) };
  }
  if (options.command === "impact") {
    const result = await analysis.impact({ seeds: [ref], maxNodes: 1_000 });
    const affected = result.trace.affected;
    return {
      seed: displayRef(ref),
      complete: result.complete,
      total: affected.length,
      nextOffset:
        options.offset + options.limit < affected.length ? options.offset + options.limit : null,
      affected: affected.slice(options.offset, options.offset + options.limit).map((entry) => ({
        ref: displayRef(entry.ref),
        depth: entry.depth,
        via: entry.path.at(-1)?.relation ?? null,
      })),
      diagnostics: result.diagnostics.map(({ severity, code, message }) => ({
        severity,
        code,
        message,
      })),
    };
  }
  throw new Error(`Internal unsupported manifest command: ${options.command}`);
}

function renderDefault(command: string, value: any): string {
  if (command === "summary")
    return markdown("Application summary", [
      `Design elements: ${value.total}`,
      ...Object.entries(value.kinds).map(([kind, count]) => `- ${kind}: ${count}`),
      `Index issues: ${value.indexIssues}`,
    ]);
  if (command === "search")
    return markdown(`Search: ${value.query}`, [
      `Matches: ${value.total}${value.nextOffset === null ? "" : ` (next offset ${value.nextOffset})`}`,
      ...value.items.map(
        (item: any) =>
          `- \`${item.ref}\` — ${item.name} [${item.field}]${item.snippet ? `: ${item.snippet}` : ""}`,
      ),
    ]);
  if (command === "describe")
    return markdown(`Describe ${value.ref}`, [
      `Name: ${value.name}`,
      `Source: ${value.source}${value.paths.length ? ` — ${value.paths.join(", ")}` : ""}`,
      "",
      "```json",
      JSON.stringify(value.definition, null, 2),
      "```",
    ]);
  if (command === "impact")
    return markdown(`Possible impact from ${value.seed}`, [
      `Complete: ${value.complete}; matches: ${value.total}${value.nextOffset === null ? "" : ` (next offset ${value.nextOffset})`}`,
      ...value.affected.map(
        (item: any) =>
          `- depth ${item.depth}: \`${item.ref}\`${item.via ? ` via ${item.via}` : ""}`,
      ),
      ...value.diagnostics.map((item: any) => `- ${item.severity} ${item.code}: ${item.message}`),
    ]);
  if (command === "sources")
    return markdown(`Sources for ${value.ref}`, [
      `Attribution: ${value.availability}; query complete: ${value.complete}`,
      ...value.items.map(
        (item: any) =>
          `- ${item.path}:${item.start.line}:${item.start.column}-${item.end.line}:${item.end.column} — ${item.role}, ${item.resolution}`,
      ),
      ...value.issues.map((item: any) => `- ${item.severity} ${item.code}: ${item.message}`),
    ]);
  return markdown("Diagnostics", [
    `Findings: ${value.total}${value.nextOffset === null ? "" : ` (next offset ${value.nextOffset})`}`,
    ...value.items.map(
      (item: any) =>
        `- ${item.severity} ${item.origin}/${item.code}${item.paths.length ? ` ${item.paths.join(", ")}` : ""}: ${item.message}`,
    ),
  ]);
}

export async function runAnalysisCli(
  args: readonly string[],
  dependencies: AnalysisCliDependencies = {},
): Promise<void> {
  const cwd = dependencies.cwd ?? process.cwd();
  const options = parseArgs(args, cwd);
  const writeOut = dependencies.writeOut ?? ((text: string) => process.stdout.write(text));
  if (options === "help") {
    writeOut(`${analysisCliUsage}\n`);
    return;
  }
  const manifest = await (dependencies.loadManifest ?? loadManifestFromCore)(options.configPath);
  let value: unknown;
  if (options.command === "sources" || options.command === "diagnostics") {
    const { runProjectCliCommand } = await import("./project-cli.ts");
    value = await runProjectCliCommand(options, manifest, parseFriendlyRef);
  } else {
    value = await manifestCommand(options, createApplicationAnalysis({ manifest }));
  }
  const rendered = options.json ? jsonText(value) : renderDefault(options.command, value);
  if (!options.json && Buffer.byteLength(rendered) > MAX_MARKDOWN_BYTES) {
    throw new Error(
      `Result exceeds the ${MAX_MARKDOWN_BYTES}-byte CLI Markdown bound; use --limit/--offset`,
    );
  }
  writeOut(rendered);
}

export type { CliOptions };
