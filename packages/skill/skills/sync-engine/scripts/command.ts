#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assignmentTemplate, checkAssignmentFile } from "./assignment.ts";
import { checkBriefFile } from "./brief.ts";
import { designScope, digestDesign, requireDesignDigest } from "./design.ts";
import {
  buildPrompt,
  promptRoles,
  type PromptInput,
  type PromptMode,
  type PromptRole,
} from "./prompt.ts";
import { agentExists, harness, launchRole } from "./launch.ts";
import {
  completeNativeLaunch,
  nativeHarnesses,
  prepareNativeLaunch,
  type NativeHarness,
} from "./native-launch.ts";
import {
  isSettledStatus,
  previousPhase,
  readPromptContext,
  requireCompletedRole,
  workspaceFileRole,
  requireInsideWorkspace,
  requiredPhases,
  reserveWorkspacePath,
  registrationWrappers,
  verifiedRecords,
  workspaceDirectory,
  writePromptContext,
} from "./workspace.ts";

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
const setupFiles = ["package.json", "tsconfig.json", "generated.config.ts"] as const;
/** Reported commands name the skill root the way SKILL.md and the references write it. */
const compiler = 'bun "<skill-root>/scripts/command.ts"';

function reference(name: string): string {
  return resolve(skillRoot, "references", name);
}

/** Report the exact syntax of the commands this one leads to, choosing no stage. */
function next(stream: NodeJS.WritableStream, steps: readonly string[]): void {
  for (const step of steps) stream.write(`Next: ${step}\n`);
}

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

async function requireBriefSetup(release: SkillRelease, applicationRoot: string): Promise<void> {
  let releaseFailure: string | undefined;
  try {
    await validateReleaseSet(release, applicationRoot);
  } catch (error) {
    releaseFailure = error instanceof Error ? error.message : String(error);
  }

  const missing = setupFiles.filter((path) => !existsSync(resolve(applicationRoot, path)));
  if (releaseFailure === undefined && missing.length === 0) return;

  const reasons = [
    ...(releaseFailure === undefined ? [] : [`release check failed: ${releaseFailure}`]),
    ...(missing.length === 0 ? [] : [`missing setup files: ${missing.join(", ")}`]),
  ].join("; ");
  throw new Error(
    `Brief init requires completed sync-engine setup in ${applicationRoot} (${reasons}). Install the exact packages from release.json, run this command's \`release check .\`, then run \`bunx --no-install sync-engine setup\` and retry.`,
  );
}

function usage(): string {
  return `Usage:
  sync-engine-skill release check [<application-directory>]
  sync-engine-skill brief init <brief.md>
  sync-engine-skill brief check <brief.md>
  sync-engine-skill design digest <design-directory> [--role <role>]
  sync-engine-skill follow-up new --role <role>
  sync-engine-skill follow-up check <file> --design-root <directory> --design-digest <sha256>
  sync-engine-skill prompt build --role <role> --input <slot>=<path>...
  sync-engine-skill assignment new --role <role> --design-digest <sha256>
  sync-engine-skill assignment check <file>
  sync-engine-skill launch --role <role> --prompt <path> [--timeout <seconds>]
    [--continue-agent <id>] for a later phase of the same role
    [--model <model>] only when the user names one for Paseo roles
    [--thinking <id>]
  sync-engine-skill launch prepare --harness <harness> --role <role> --prompt <path>
    [--continue-agent <id>]
  sync-engine-skill launch complete --ticket <path> --agent-id <id>
    [--provider <provider>] [--model <model>] [--thinking <setting>]
  sync-engine-skill handback check --design-root <directory> --design-digest <sha256>
    [--brief <path>]

Roles:
  designer, critic, concept-worker, application-worker, frontend-worker, evidence-worker

Native harnesses:
  codex, claude-code, antigravity

Prompt options:
  --mode <map|contract>           Designer and critic prompt phase
  --design-root <directory>       Required for implementation and evidence roles
  --design-digest <sha256>        Closed reviewed design digest for that directory
  --max-bytes <positive integer>  Override the role's default byte budget
  --stdout                        Print prompt bytes instead of writing the prompt file

Generated prompts, follow-ups, assignments, and launch records belong in
${workspaceDirectory}/ under the application root; the compiler owns those paths.
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
  readonly stdout: boolean;
  readonly maxBytes?: number;
  readonly mode?: PromptMode;
  readonly designRoot?: string;
  readonly designDigest?: string;
}

function parsePromptArguments(args: readonly string[]): PromptArguments {
  let role: string | undefined;
  let stdout = false;
  let maxBytes: number | undefined;
  let mode: PromptMode | undefined;
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
    } else if (argument === "--stdout") {
      stdout = true;
    } else if (argument === "--mode") {
      const value = takeValue(args, index, argument);
      index += 1;
      if (value !== "map" && value !== "contract") {
        throw new Error(`--mode must be map or contract`);
      }
      mode = value;
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
  if ((role === "designer" || role === "critic") && mode === undefined) {
    throw new Error(`prompt build for ${role} requires --mode map or contract`);
  }
  for (const input of inputs) {
    if (input.slot === "assignment") requireInsideWorkspace(input.path);
  }
  return { role, inputs, stdout, maxBytes, mode, designRoot, designDigest };
}

async function reviewedContractDigest(options: PromptArguments): Promise<string | undefined> {
  if (options.role !== "critic" || options.mode !== "contract") return options.designDigest;
  const map = options.inputs.find(
    (input) => input.slot === "candidate" && basename(input.path) === "decomposition.md",
  );
  if (map === undefined) {
    throw new Error(`Contract critic requires design/decomposition.md as a candidate`);
  }
  const designRoot = dirname(resolve(map.path));
  const candidateInputs = options.inputs.filter((candidate) => candidate.slot === "candidate");
  const candidatePaths = new Set<string>();
  for (const input of candidateInputs) {
    const candidate = resolve(input.path);
    const within = relative(designRoot, candidate);
    if (within.startsWith("..") || isAbsolute(within)) {
      throw new Error(`Contract critic candidates must all belong to ${designRoot}`);
    }
    candidatePaths.add(candidate);
  }
  const digest = await digestDesign(designRoot);
  if (candidatePaths.size !== digest.files || candidateInputs.length !== digest.files) {
    throw new Error(
      `Contract critic requires every authored design Markdown file exactly once; received ${candidatePaths.size} of ${digest.files}`,
    );
  }
  return digest.digest;
}

async function launchPromptContext(prompt: string, role: string) {
  const promptPath = requireInsideWorkspace(prompt);
  const context = await readPromptContext(promptPath);
  if (context === undefined) {
    throw new Error(`Launch requires a prompt written by prompt build: ${prompt}`);
  }
  if (context.role !== role) {
    throw new Error(`Prompt belongs to role ${context.role}, not requested role ${role}`);
  }
  return context;
}

async function requireContinuation(
  role: string,
  mode: PromptMode | undefined,
  agentId: string | undefined,
  briefSha256?: string,
): Promise<void> {
  const needsContinuation = role === "designer" && mode === "contract";
  if (!needsContinuation && agentId !== undefined) {
    throw new Error(`--continue-agent is only valid for the designer contract phase`);
  }
  if (!needsContinuation) return;
  if (agentId === undefined) {
    throw new Error(`Designer contract launch requires --continue-agent <map-designer-id>`);
  }
  const originals = await verifiedRecords("designer", undefined, undefined, "map");
  if (
    !originals.some(
      (entry) =>
        entry.record.agentId === agentId &&
        (briefSha256 === undefined || entry.record.briefSha256 === briefSha256),
    )
  ) {
    throw new Error(`Agent ${agentId} has no settled designer map record`);
  }
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
    next(process.stdout, [
      setupFiles.every((file) => existsSync(resolve(applicationRoot, file)))
        ? `${compiler} brief init design/brief.md`
        : `bunx --no-install sync-engine setup`,
    ]);
    return;
  }

  if (args[0] === "brief" && args[1] === "init" && args.length === 3) {
    const path = resolve(args[2]!);
    if (existsSync(path)) throw new Error(`Brief already exists: ${args[2]}`);
    await requireBriefSetup(release, process.cwd());
    await mkdir(dirname(path), { recursive: true });
    const template = await readFile(
      resolve(skillRoot, "prompts/templates/product-brief.md"),
      "utf8",
    );
    await writeFile(path, template, { encoding: "utf8", flag: "wx" });
    process.stdout.write("Brief template initialized. Fill placeholders.\n");
    next(process.stdout, [`${compiler} brief check ${args[2]}`]);
    return;
  }

  if (args[0] === "brief" && args[1] === "check" && args.length === 3) {
    const result = await checkBriefFile(args[2]!);
    process.stdout.write(
      `Brief valid: ${result.bytes} bytes, ${result.decisions} decisions, open decisions ${result.openDecisions ? "present" : "none"}; release ${release.skill}.\n`,
    );
    next(process.stdout, [
      `read ${reference("design-and-criticism.md")}`,
      `${compiler} prompt build --role designer --mode map --input brief=${args[2]}`,
    ]);
    return;
  }

  if (args[0] === "design" && args[1] === "digest" && (args.length === 3 || args.length === 5)) {
    const scoped = args[3] === "--role" ? designScope(args[4] ?? "") : "all";
    const result = await digestDesign(args[2]!, scoped);
    process.stdout.write(`Design digest: ${result.digest}; ${result.files} Markdown files.\n`);
    next(process.stdout, [
      `read ${reference("implementation.md")}`,
      `every downstream build and follow-up adds --design-root ${args[2]} --design-digest ${result.digest}`,
    ]);
    return;
  }

  if (args[0] === "follow-up" && args[1] === "new" && args.length === 4) {
    if (args[2] !== "--role") throw new Error(`follow-up new requires --role`);
    const role = args[3]!;
    if (!promptRoles.includes(role as PromptRole))
      throw new Error(`Unknown role: ${role}; roles are ${promptRoles.join(", ")}`);
    const path = await reserveWorkspacePath("followup", role);
    await writeFile(path, "", "utf8");
    process.stdout.write(`Follow-up started: ${path}\n`);
    next(process.stdout, [
      `write only the new diagnostic, affected paths, and affected command into ${path}`,
      `${compiler} follow-up check ${path} --design-root <design-root> --design-digest <sha256>`,
    ]);
    return;
  }

  if (args[0] === "follow-up" && args[1] === "check" && args.length === 7) {
    if (args[3] !== "--design-root" || args[5] !== "--design-digest") {
      throw new Error(`follow-up check requires --design-root then --design-digest`);
    }
    const followUpPath = requireInsideWorkspace(args[2]!);
    const followUpName = basename(followUpPath);
    const followUpRole = workspaceFileRole(followUpName, "followup");
    if (followUpRole === undefined || !promptRoles.includes(followUpRole as PromptRole)) {
      throw new Error(
        `Follow-up file names its role: expected ${workspaceDirectory}/<stamp>-<role>.followup.md, found ${followUpName}; start it with follow-up new`,
      );
    }
    const content = await readFile(followUpPath, "utf8");
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > 4 * 1024) throw new Error(`Follow-up is ${bytes} bytes; maximum is 4096`);
    await requireDesignDigest(args[4]!, args[6]!);
    process.stdout.write(`Follow-up valid: ${bytes} bytes; design ${args[6]}.\n`);
    next(process.stdout, [`deliver ${args[2]} to the original role as a file`]);
    return;
  }

  if (args[0] === "prompt" && args[1] === "build") {
    const options = parsePromptArguments(args.slice(2));
    const reviewedDigest = await reviewedContractDigest(options);
    const predecessor = previousPhase(options.role, options.mode);
    const predecessorDigest =
      options.designRoot === undefined || predecessor === undefined
        ? reviewedDigest
        : (await digestDesign(options.designRoot, designScope(predecessor.role))).digest;
    await requireCompletedRole(options.role, undefined, predecessorDigest, options.mode);
    for (const input of options.inputs) {
      if (input.slot === "assignment") await checkAssignmentFile(resolve(input.path));
    }
    const result = await buildPrompt({
      role: options.role,
      ...(options.mode === undefined ? {} : { mode: options.mode }),
      inputs: options.inputs,
      promptRoot: resolve(skillRoot, "prompts"),
      maxBytes: options.maxBytes,
      designRoot: options.designRoot,
      expectedDesignDigest: options.designDigest,
    });
    const promptPath = options.stdout
      ? undefined
      : await reserveWorkspacePath("prompt", result.role);
    if (promptPath === undefined) process.stdout.write(result.content);
    else {
      await writeFile(promptPath, result.content, "utf8");
      const brief = options.inputs.find((input) => input.slot === "brief");
      await writePromptContext(promptPath, {
        format: "sync-engine.skill.prompt-context",
        version: 1,
        role: result.role,
        ...(result.mode === undefined ? {} : { mode: result.mode }),
        toolPolicy: result.toolPolicy,
        sha256: result.sha256,
        ...(brief === undefined
          ? {}
          : {
              briefSha256: createHash("sha256")
                .update(await readFile(resolve(brief.path), "utf8"))
                .digest("hex"),
            }),
        ...(reviewedDigest === undefined ? {} : { designDigest: reviewedDigest }),
      });
    }

    const report = [
      `Prompt built: role ${result.role}${result.mode === undefined ? "" : `; mode ${result.mode}`}; tools ${result.toolPolicy}; ${result.bytes} bytes; budget ${result.budget}${result.budgetOverridden ? " (override)" : ""}; sha256 ${result.sha256}; release ${release.skill}.`,
      ...result.sources.map(
        (source) =>
          `  ${source.kind} ${source.displayName}: ${source.bytes} bytes (${source.path})`,
      ),
    ].join("\n");
    const stream = options.stdout ? process.stderr : process.stdout;
    stream.write(`${report}\n`);
    const delivered = promptPath ?? "the built prompt";
    const recipient =
      result.role === "designer" && result.mode === "contract"
        ? "the original designer as a phase file"
        : `a fresh ${result.role} as a file`;
    next(stream, [
      `deliver ${delivered} to ${recipient}`,
      ...(options.designRoot === undefined
        ? []
        : [
            `${compiler} follow-up check <file> --design-root ${options.designRoot} --design-digest ${options.designDigest}`,
          ]),
    ]);
    return;
  }

  if (args[0] === "assignment" && args[1] === "new" && args.length === 6) {
    if (args[2] !== "--role" || args[4] !== "--design-digest") {
      throw new Error(`assignment new requires --role then --design-digest`);
    }
    const role = args[3]!;
    if (!promptRoles.includes(role as PromptRole))
      throw new Error(`Unknown role: ${role}; roles are ${promptRoles.join(", ")}`);
    const path = await reserveWorkspacePath("assignment", role);
    await writeFile(path, assignmentTemplate(role, args[5]!), "utf8");
    process.stdout.write(`Assignment started: ${path}\n`);
    next(process.stdout, [
      `fill it, then ${compiler} assignment check ${path}`,
      `${compiler} prompt build --role ${role} --input assignment=${path} ...`,
    ]);
    return;
  }

  if (args[0] === "assignment" && args[1] === "check" && args.length === 3) {
    const checked = await checkAssignmentFile(resolve(args[2]!));
    process.stdout.write(
      `Assignment valid: role ${checked.role}; ${checked.bytes} bytes; ${checked.writePaths.length} listed paths.\n`,
    );
    return;
  }

  if (args[0] === "launch" && args[1] === "prepare") {
    let role: string | undefined;
    let prompt: string | undefined;
    let nativeHarness: string | undefined;
    let continuationAgentId: string | undefined;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--role") role = takeValue(args, index, argument);
      else if (argument === "--prompt") prompt = takeValue(args, index, argument);
      else if (argument === "--harness") nativeHarness = takeValue(args, index, argument);
      else if (argument === "--continue-agent") {
        continuationAgentId = takeValue(args, index, argument);
      } else throw new Error(`Unknown launch prepare option: ${argument}`);
      index += 1;
    }
    if (role === undefined || prompt === undefined || nativeHarness === undefined) {
      throw new Error(`launch prepare requires --harness, --role, and --prompt`);
    }
    if (!promptRoles.includes(role as PromptRole)) {
      throw new Error(`Unknown role: ${role}; roles are ${promptRoles.join(", ")}`);
    }
    if (!nativeHarnesses.includes(nativeHarness as NativeHarness)) {
      throw new Error(
        `Unknown native harness: ${nativeHarness}; harnesses are ${nativeHarnesses.join(", ")}`,
      );
    }
    const context = await launchPromptContext(prompt, role);
    await requireCompletedRole(role, undefined, context.designDigest, context.mode);
    await requireContinuation(role, context.mode, continuationAgentId, context.briefSha256);
    const prepared = await prepareNativeLaunch({
      role,
      harness: nativeHarness as NativeHarness,
      promptPath: prompt,
      applicationRoot: process.cwd(),
      ...(continuationAgentId === undefined ? {} : { continuationAgentId }),
    });
    process.stdout.write(
      `Native launch prepared: role ${role}; harness ${nativeHarness}; ticket ${prepared.ticketPath}; response ${prepared.responsePath}.\n`,
    );
    next(process.stdout, [
      `read ${reference(`harnesses/${nativeHarness}.md`)}`,
      `apply native tool policy ${prepared.ticket.toolPolicy ?? "assignment-only"}`,
      prepared.ticket.continuationAgentId === undefined
        ? `launch one fresh native ${role} with only: Read ${prepared.ticket.prompt.path} as your complete assignment and follow it; return exactly what it requests`
        : `send ${prepared.ticket.prompt.path} to native agent ${prepared.ticket.continuationAgentId} as its next complete phase and wait`,
      `copy that agent's final response verbatim into ${prepared.responsePath}`,
      `${compiler} launch complete --ticket ${prepared.ticketPath} --agent-id <native-agent-id>`,
    ]);
    return;
  }

  if (args[0] === "launch" && args[1] === "complete") {
    let ticket: string | undefined;
    let agentId: string | undefined;
    let provider: string | undefined;
    let model: string | undefined;
    let thinking: string | undefined;
    for (let index = 2; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--ticket") ticket = takeValue(args, index, argument);
      else if (argument === "--agent-id") agentId = takeValue(args, index, argument);
      else if (argument === "--provider") provider = takeValue(args, index, argument);
      else if (argument === "--model") model = takeValue(args, index, argument);
      else if (argument === "--thinking") thinking = takeValue(args, index, argument);
      else throw new Error(`Unknown launch complete option: ${argument}`);
      index += 1;
    }
    if (ticket === undefined || agentId === undefined) {
      throw new Error(`launch complete requires --ticket and --agent-id`);
    }
    const completed = await completeNativeLaunch({
      ticketPath: ticket,
      agentId,
      applicationRoot: process.cwd(),
      ...(provider === undefined ? {} : { provider }),
      ...(model === undefined ? {} : { model }),
      ...(thinking === undefined ? {} : { thinking }),
    });
    const configuration =
      completed.record.model === undefined
        ? "native model inheritance recorded but not machine-attested"
        : `${completed.record.provider ?? "provider unreported"} ${completed.record.model}${completed.record.thinking === undefined ? "" : ` at ${completed.record.thinking}`}`;
    process.stdout.write(
      `Completed ${completed.record.role} through ${completed.record.harness}: agent ${completed.record.agentId}; ${configuration}; tools ${completed.record.toolPolicy ?? "unreported"}; record ${completed.recordPath}.\n`,
    );
    next(process.stdout, ["read the agent's return, then continue the workflow stage"]);
    return;
  }

  if (args[0] === "launch") {
    let role: string | undefined;
    let prompt: string | undefined;
    let timeoutSeconds = 1800;
    let thinking: string | undefined;
    let model: string | undefined;
    let continuationAgentId: string | undefined;
    for (let index = 1; index < args.length; index += 1) {
      const argument = args[index]!;
      if (argument === "--role") role = takeValue(args, index, argument);
      else if (argument === "--prompt") prompt = takeValue(args, index, argument);
      else if (argument === "--thinking") thinking = takeValue(args, index, argument);
      else if (argument === "--model") model = takeValue(args, index, argument);
      else if (argument === "--continue-agent") {
        continuationAgentId = takeValue(args, index, argument);
      } else if (argument === "--timeout") {
        timeoutSeconds = Number(takeValue(args, index, argument));
        if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0) {
          throw new Error(`--timeout must be a positive whole number of seconds`);
        }
      } else {
        throw new Error(`Unknown launch option: ${argument}`);
      }
      index += 1;
    }
    if (role === undefined || prompt === undefined) {
      throw new Error(`launch requires --role and --prompt`);
    }
    if (!promptRoles.includes(role as PromptRole))
      throw new Error(`Unknown role: ${role}; roles are ${promptRoles.join(", ")}`);
    const context = await launchPromptContext(prompt, role);
    await requireCompletedRole(role, undefined, context.designDigest, context.mode);
    await requireContinuation(role, context.mode, continuationAgentId, context.briefSha256);
    const launched = await launchRole({
      role,
      promptPath: prompt,
      applicationRoot: process.cwd(),
      timeoutSeconds,
      ...(thinking === undefined ? {} : { thinking }),
      ...(model === undefined ? {} : { model }),
      ...(continuationAgentId === undefined ? {} : { continueAgentId: continuationAgentId }),
    });
    const attested = `${launched.record.provider} ${launched.record.model}${launched.record.thinking === undefined ? "" : ` at ${launched.record.thinking}`}`;
    process.stdout.write(
      `Launched ${role} through ${harness}: agent ${launched.record.agentId}; ${attested}; tools ${launched.record.toolPolicy ?? "unreported"}; settled ${launched.record.status}; response ${launched.record.response?.path ?? "unavailable"}; record ${launched.recordPath}.\n`,
    );
    next(process.stdout, ["read the agent's return, then continue the workflow stage"]);
    return;
  }

  if (args[0] === "handback" && args[1] === "check" && (args.length === 6 || args.length === 8)) {
    if (args[2] !== "--design-root" || args[4] !== "--design-digest") {
      throw new Error(`handback check requires --design-root then --design-digest`);
    }
    if (args.length === 8 && args[6] !== "--brief") {
      throw new Error(`handback check accepts only --brief after the design digest`);
    }
    await requireDesignDigest(args[3]!, args[5]!);
    const scopedDigests = new Map<string, string>();
    for (const phase of requiredPhases) {
      if (!scopedDigests.has(phase.role)) {
        scopedDigests.set(
          phase.role,
          (await digestDesign(args[3]!, designScope(phase.role))).digest,
        );
      }
    }
    const briefSha256 =
      args.length === 8
        ? createHash("sha256")
            .update(await readFile(resolve(args[7]!), "utf8"))
            .digest("hex")
        : undefined;
    const drifted: string[] = [];
    const strayed: string[] = [];
    const churned: string[] = [];
    const missing: string[] = [];
    const unknown: string[] = [];
    const unsettled: string[] = [];
    const coordinatorAttested: string[] = [];
    const wrapped = await registrationWrappers();
    const lines: string[] = [];
    for (const phase of requiredPhases) {
      const label = `${phase.role}${phase.mode === undefined ? "" : ` ${phase.mode}`}`;
      const records = await verifiedRecords(phase.role, undefined, undefined, phase.mode);
      if (records.length === 0) {
        missing.push(label);
        continue;
      }
      const latest = records[records.length - 1]!;
      for (const entry of [latest]) {
        const recordHarness = entry.record.harness ?? harness;
        const attestation = entry.record.attestation ?? "harness";
        const known =
          attestation === "harness" && recordHarness === harness
            ? agentExists(entry.record.agentId)
            : true;
        if (attestation === "harness" && recordHarness === harness && !known) {
          unknown.push(`${label} ${entry.record.agentId}`);
        }
        if (attestation === "coordinator") {
          coordinatorAttested.push(`${label} ${entry.record.agentId} through ${recordHarness}`);
        }
        if (!isSettledStatus(entry.record.status)) {
          unsettled.push(`${label} ${entry.record.agentId} (${entry.record.status})`);
        }
        for (const path of entry.record.readViolations ?? []) {
          strayed.push(`${label} read ${path}`);
        }
        for (const churn of entry.record.rewrites ?? []) {
          churned.push(`${label} wrote ${churn.path} ${churn.writes} times`);
        }
        if (
          entry.record.designDigest !== undefined &&
          entry.record.designDigest !== scopedDigests.get(phase.role)
        ) {
          drifted.push(`${label} ran against design ${entry.record.designDigest.slice(0, 12)}`);
        }
        if (
          briefSha256 !== undefined &&
          entry.record.briefSha256 !== undefined &&
          entry.record.briefSha256 !== briefSha256
        ) {
          drifted.push(`${label} ran against an earlier brief`);
        }
        const configuration =
          entry.record.model === undefined
            ? "native model inheritance unverified"
            : `${entry.record.provider ?? "provider unreported"} ${entry.record.model}`;
        lines.push(
          attestation === "harness"
            ? `  ${label}: agent ${entry.record.agentId} ${known ? "known" : "UNKNOWN"} to ${recordHarness}; ${configuration}; settled ${entry.record.status}`
            : `  ${label}: agent ${entry.record.agentId} coordinator-attested through ${recordHarness}; ${configuration}; settled ${entry.record.status}`,
        );
      }
    }
    const mapDesignerRecords = await verifiedRecords("designer", undefined, undefined, "map");
    const contractDesignerRecords = await verifiedRecords(
      "designer",
      undefined,
      undefined,
      "contract",
    );
    const mapDesignerIds = new Set(
      mapDesignerRecords.slice(-1).map((entry) => entry.record.agentId),
    );
    const contractDesignerIds = new Set(
      contractDesignerRecords.slice(-1).map((entry) => entry.record.agentId),
    );
    const continuedDesigner = [...contractDesignerIds].some((id) => mapDesignerIds.has(id));
    process.stdout.write(`Handback check for design ${args[5]}:\n${lines.join("\n")}\n`);
    const failures = [
      ...(missing.length === 0 ? [] : [`no settled launch for: ${missing.join(", ")}`]),
      ...(unknown.length === 0 ? [] : [`${harness} does not know: ${unknown.join(", ")}`]),
      ...(unsettled.length === 0 ? [] : [`never settled: ${unsettled.join(", ")}`]),
      ...(mapDesignerIds.size === 0 || contractDesignerIds.size === 0 || continuedDesigner
        ? []
        : [`designer contract phase used a different agent from the map phase`]),
      ...(drifted.length === 0 ? [] : [`stale inputs: ${drifted.join(", ")}`]),
      ...(wrapped.length === 0
        ? []
        : [`registered a class beside its registry: ${wrapped.join(", ")}`]),
    ];
    if (failures.length > 0) throw new Error(failures.join("; "));
    if (coordinatorAttested.length > 0) {
      process.stdout.write(
        `Native launches recorded by the coordinator; this compiler cannot query those harness sessions:\n  ${coordinatorAttested.join("\n  ")}\n`,
      );
    }
    if (strayed.length > 0) {
      process.stdout.write(`Read outside the role boundary:\n  ${strayed.join("\n  ")}\n`);
    }
    if (churned.length > 0) {
      process.stdout.write(
        `Rewritten repeatedly, so a fact was missing:\n  ${churned.join("\n  ")}\n`,
      );
    }
    process.stdout.write(`Every required role phase has a settled launch record.\n`);
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
