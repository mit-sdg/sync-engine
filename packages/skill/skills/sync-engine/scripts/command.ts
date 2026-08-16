#!/usr/bin/env node

import { existsSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBriefFile } from "./brief.ts";
import { digestDesign, requireDesignDigest } from "./design.ts";
import { buildPrompt, type PromptInput } from "./prompt.ts";

interface PackageManifest {
  readonly name?: string;
  readonly version?: string;
  readonly bin?: string | Readonly<Record<string, string>>;
  readonly skill?: string;
  readonly toolchain?: Readonly<Record<string, string>>;
  readonly packages?: Readonly<Record<string, string>>;
}

interface SkillRelease {
  readonly skill: string;
  readonly toolchain: Readonly<{ bun: string; node: string; typescript: string }>;
  readonly packages: Readonly<Record<string, string>>;
}

const commandDirectory = dirname(fileURLToPath(import.meta.url));
const sourceSkillRoot = resolve(commandDirectory, "..");
const skillRoot = existsSync(resolve(sourceSkillRoot, "release.json"))
  ? sourceSkillRoot
  : resolve(commandDirectory, "../skills/sync-engine");
const packageExecutables = {
  "@mit-sdg/sync-engine": "sync-engine",
  "@mit-sdg/sync-engine-catalog": "sync-engine-catalog",
  "@mit-sdg/sync-engine-analysis": "sync-engine-analysis",
} as const;
const packageNames = Object.keys(packageExecutables) as Array<keyof typeof packageExecutables>;

function parent(path: string): string | undefined {
  const next = parse(path).dir;
  return next === path ? undefined : next;
}

async function manifestAt(path: string): Promise<PackageManifest | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function resolveManifest(
  packageName: string,
  starts: readonly string[],
): Promise<{ path: string; manifest: PackageManifest }> {
  for (const start of starts) {
    const applicationRoot = resolve(start);
    for (let directory: string | undefined = applicationRoot; directory !== undefined;) {
      if (directory === applicationRoot) {
        const localPath = resolve(directory, "package.json");
        const local = await manifestAt(localPath);
        if (local?.name === packageName) return { path: localPath, manifest: local };
      }

      const dependencyPath = resolve(directory, "node_modules", packageName, "package.json");
      const dependency = await manifestAt(dependencyPath);
      if (dependency !== undefined) return { path: dependencyPath, manifest: dependency };
      directory = parent(directory);
    }
  }
  throw new Error(`Cannot resolve installed package ${packageName}`);
}

async function readSkillRelease(): Promise<SkillRelease> {
  const path = resolve(skillRoot, "release.json");
  const value = await manifestAt(path);
  if (
    typeof value?.skill !== "string" ||
    typeof value.toolchain?.bun !== "string" ||
    typeof value.toolchain.node !== "string" ||
    typeof value.toolchain.typescript !== "string" ||
    typeof value.packages !== "object" ||
    value.packages === null ||
    Array.isArray(value.packages)
  ) {
    throw new Error(`Cannot read sync-engine skill release from ${path}`);
  }
  for (const packageName of packageNames) {
    if (value.packages[packageName] !== value.skill) {
      throw new Error(
        `Skill release ${value.skill} must require ${packageName} at that exact version; found ${value.packages[packageName] ?? "no version"}`,
      );
    }
  }
  return value as SkillRelease;
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

function requireExecutable(
  packageName: keyof typeof packageExecutables,
  path: string,
  manifest: PackageManifest,
): void {
  const executable = packageExecutables[packageName];
  const bins = typeof manifest.bin === "string" ? { [executable]: manifest.bin } : manifest.bin;
  const target = bins?.[executable];
  if (typeof target !== "string" || target.length === 0) {
    throw new Error(`Installed ${packageName} does not expose required executable ${executable}`);
  }
  const packageRoot = dirname(path);
  const executablePath = resolve(packageRoot, target);
  if (
    !inside(packageRoot, executablePath) ||
    !existsSync(executablePath) ||
    !statSync(executablePath).isFile()
  ) {
    throw new Error(
      `Installed ${packageName} executable ${executable} has missing or escaping target ${target}`,
    );
  }
}

async function validateReleaseSet(release: SkillRelease, applicationRoot: string): Promise<string> {
  const resolved: Array<{ name: keyof typeof packageExecutables; version: string }> = [];
  for (const packageName of packageNames) {
    const found = await resolveManifest(packageName, [applicationRoot]);
    if (found.manifest.version === undefined) {
      throw new Error(`Installed package has no version: ${found.path}`);
    }
    requireExecutable(packageName, found.path, found.manifest);
    resolved.push({ name: packageName, version: found.manifest.version });
  }

  const mismatched = resolved.filter(({ name, version }) => version !== release.packages[name]);
  if (mismatched.length > 0) {
    const versions = resolved.map(({ name, version }) => `${name}@${version}`).join(", ");
    throw new Error(
      `Installed sync-engine release does not match skill ${release.skill}: ${versions}`,
    );
  }
  return release.skill;
}

function usage(): string {
  return `Usage:
  sync-engine-skill release check [<application-directory>]
  sync-engine-skill brief check <brief.md>
  sync-engine-skill design digest <design-directory>
  sync-engine-skill follow-up check <file> --design-root <directory> --design-digest <sha256>
  sync-engine-skill prompt build --role <role> --input <slot>=<path>... --output <path>
  sync-engine-skill prompt build --role <role> --input <slot>=<path>... --stdout

Prompt options:
  --design-root <directory>       Required for implementation and evidence roles
  --design-digest <sha256>        Closed reviewed design digest for that directory
  --max-bytes <positive integer>  Override the role's default byte budget
`;
}

function takeValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

interface PromptArguments {
  readonly role: string;
  readonly inputs: readonly PromptInput[];
  readonly output?: string;
  readonly stdout: boolean;
  readonly maxBytes?: number;
  readonly designRoot?: string;
  readonly designDigest?: string;
}

function parsePromptArguments(args: readonly string[]): PromptArguments {
  let role: string | undefined;
  let output: string | undefined;
  let stdout = false;
  let maxBytes: number | undefined;
  let designRoot: string | undefined;
  let designDigest: string | undefined;
  const inputs: PromptInput[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--role") {
      role = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--input") {
      const value = takeValue(args, index, argument);
      index += 1;
      const separator = value.indexOf("=");
      if (separator <= 0 || separator === value.length - 1) {
        throw new Error(`--input must have the form <slot>=<path>`);
      }
      inputs.push({ slot: value.slice(0, separator), path: value.slice(separator + 1) });
    } else if (argument === "--output") {
      output = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--stdout") {
      stdout = true;
    } else if (argument === "--design-root") {
      designRoot = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--design-digest") {
      designDigest = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--max-bytes") {
      const value = takeValue(args, index, argument);
      index += 1;
      maxBytes = Number(value);
      if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
        throw new Error(`--max-bytes must be a positive integer`);
      }
    } else {
      throw new Error(`Unknown prompt option: ${argument}`);
    }
  }

  if (role === undefined) throw new Error(`prompt build requires --role`);
  if ((output === undefined) === !stdout) {
    throw new Error(`prompt build requires exactly one of --output or --stdout`);
  }
  return { role, inputs, output, stdout, maxBytes, designRoot, designDigest };
}

async function run(args: readonly string[]): Promise<void> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    process.stdout.write(usage());
    return;
  }

  const release = await readSkillRelease();
  if (args[0] === "release" && args[1] === "check" && args.length <= 3) {
    const applicationRoot = resolve(args[2] ?? process.cwd());
    const version = await validateReleaseSet(release, applicationRoot);
    process.stdout.write(`Installed sync-engine release matches skill ${version}.\n`);
    return;
  }

  if (args[0] === "brief" && args[1] === "check" && args.length === 3) {
    const result = await checkBriefFile(args[2]!);
    process.stdout.write(
      `Brief valid: ${result.bytes} bytes, ${result.decisions} decisions, open decisions ${result.openDecisions ? "present" : "none"}; release ${release.skill}.\n`,
    );
    return;
  }

  if (args[0] === "design" && args[1] === "digest" && args.length === 3) {
    const result = await digestDesign(args[2]!);
    process.stdout.write(`Design digest: ${result.digest}; ${result.files} Markdown files.\n`);
    return;
  }

  if (args[0] === "follow-up" && args[1] === "check" && args.length === 7) {
    if (args[3] !== "--design-root" || args[5] !== "--design-digest") {
      throw new Error(`follow-up check requires --design-root then --design-digest`);
    }
    const content = await readFile(args[2]!, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > 4 * 1024) throw new Error(`Follow-up is ${bytes} bytes; maximum is 4096`);
    await requireDesignDigest(args[4]!, args[6]!);
    process.stdout.write(`Follow-up valid: ${bytes} bytes; design ${args[6]}.\n`);
    return;
  }

  if (args[0] === "prompt" && args[1] === "build") {
    const options = parsePromptArguments(args.slice(2));
    const result = await buildPrompt({
      role: options.role,
      inputs: options.inputs,
      promptRoot: resolve(skillRoot, "prompts"),
      maxBytes: options.maxBytes,
      designRoot: options.designRoot,
      expectedDesignDigest: options.designDigest,
    });
    if (options.stdout) process.stdout.write(result.content);
    else await writeFile(resolve(options.output!), result.content, "utf8");

    const report = [
      `Prompt built: role ${result.role}; ${result.bytes} bytes; budget ${result.budget}${result.budgetOverridden ? " (override)" : ""}; sha256 ${result.sha256}; release ${release.skill}.`,
      ...result.sources.map(
        (source) =>
          `  ${source.kind} ${source.displayName}: ${source.bytes} bytes (${source.path})`,
      ),
    ].join("\n");
    (options.stdout ? process.stderr : process.stdout).write(`${report}\n`);
    return;
  }

  throw new Error(`Unknown command\n${usage()}`);
}

try {
  await run(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`sync-engine-skill: ${message}\n`);
  process.exitCode = 1;
}
