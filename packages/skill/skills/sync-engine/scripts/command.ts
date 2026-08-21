#!/usr/bin/env node

import { lstat, readFile } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapApplication, conflictChoices, type BootstrapDependencies } from "./bootstrap.ts";
import {
  configurationWithUserOverrides,
  harnessIds,
  prepareHarnessInvocation,
  type HarnessId,
  type LaunchTarget,
  type PreparedHarnessInvocation,
} from "./harness.ts";
import {
  buildPrompt,
  type BuiltPrompt,
  type PromptContextDelivery,
  type PromptInput,
  type RetainedSource,
} from "./prompt.ts";
import {
  digestDesign,
  finalizeLaunch,
  normalizeLaunchStatus,
  prepareLaunch,
  readLaunchRecord,
  type FinalizedLaunchRecord,
  type LaunchRecord,
  type PrepareLaunchResult,
} from "./records.ts";
import {
  getRoleSpecification,
  projectShellAccessLevels,
  roleSpecificationIds,
  roleSpecifications,
  validateCapabilityGrant,
  type EffectiveCapabilityGrant,
} from "./roles.ts";
import {
  canonicalPath,
  isPathInside,
  requireWorkUnit,
  startWorkUnitFromTemplate,
  workUnitPath,
  type WorkUnit,
} from "./work.ts";

const commandName = "sync-engine-skill";
const defaultSkillRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultTimeoutSeconds = 1800;

type WriteOutput = (text: string) => void;
type Bootstrap = typeof bootstrapApplication;

export interface CommandDependencies {
  readonly cwd?: string;
  readonly skillRoot?: string;
  readonly stdout?: WriteOutput;
  readonly stderr?: WriteOutput;
  readonly bootstrap?: Bootstrap;
  readonly bootstrapDependencies?: BootstrapDependencies;
  readonly now?: () => Date;
}

export class CliError extends Error {
  override readonly name = "CliError";
  constructor(
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
  }
}

const cardinality = {
  "exactly-one": "one",
  "zero-or-one": "optional",
  "one-or-more": "one or more",
  "zero-or-more": "repeatable optional",
} as const;

export function helpText(): string {
  const inputs = roleSpecificationIds
    .map((id) => {
      const specification = roleSpecifications[id];
      const slots = specification.inputs
        .filter(({ id: input }) => input !== "task")
        .map(
          (input) =>
            `${input.id} (${cardinality[input.cardinality]}, ${input.delivery === "retained" ? "retained" : "inline"})`,
        )
        .join(", ");
      return `  ${id}: ${slots || "no additional inputs"}`;
    })
    .join("\n");

  return `sync-engine skill CLI — prompt builder and validator

Usage:
  ${commandName} work start <slug>
    [--conflict <align-pinned-release|continue-with-warning|stop-unchanged>]
  ${commandName} prompt build --work <slug> --role <role> --phase <phase>
    --task <path> --grant <json-path> --harness <harness>
    [--input <slot>=<path>]... [--design-root <path>] [--context-limit <bytes>]
    [--timeout <seconds>] [--model <id>] [--reasoning <id>]
  ${commandName} launch complete <prepared-record> --agent-id <id>
    --status <native-status> [--model <id>]
  ${commandName} continue <finalized-record> --phase <phase> --task <path>
    --grant <json-path> [--input <slot>=<path>]... [--replace]
    [--harness <harness>] [--design-root <path>] [--context-limit <bytes>]
    [--timeout <seconds>] [--model <id>] [--reasoning <id>]
  ${commandName} --help

Roles and phases (valid pairs):
  ${roleSpecificationIds.join("\n  ")}

Harnesses:
  ${harnessIds.join(", ")}

Options:
  --design-root must be the canonical <application>/design directory. Prompt build creates
  a binding; continue recomputes an existing binding automatically and accepts this option
  only to introduce one when the prior record has none. Completion uses the recorded root.
  --context-limit is a positive byte limit supplied by the selected harness or model.
  --timeout is the coordinator's native-launch limit in seconds (default 1800); the skill
  CLI reports it but does not wait or poll. --model and --reasoning carry an explicit user
  selection; otherwise they inherit native settings. --harness on continue is valid only
  together with --replace.

Inputs:
  --task and --grant sources must be inside the application. --task supplies the reserved
  task input. --input is repeatable, including for a repeatable slot; use one
  <slot>=<path> argument per file. Brief and decomposition slots require their exact
  work-unit files; every other input must resolve inside the application or skill root.
  Accepted slots are:
${inputs}

Capability grant JSON (every field is required and must be within the role maximum):
  {
    "readableAreas": [{"area": "work-unit|design|application", "path": "relative/POSIX"}],
    "writableAreas": [{"area": "current-decomposition|assigned-design|owned-concept|owned-integration|owned-configuration|owned-frontend|owned-test|owned-scenario", "path": "relative/POSIX"}],
    "toolKinds": ["repository-read", "repository-write"],
    "projectShell": "none|project-validation|project-local",
    "network": false,
    "generatedOutput": false,
    "longRunningProcesses": false
  }

Completion:
  Before launch complete, copy the native response verbatim into the printed Response
  path. The prepared record fixes harness, timeout, and design root. Completed status
  requires nonempty UTF-8; another terminal status permits an empty captured response.

Status normalization:
  completed: complete, completed, idle, settled, success, succeeded
  failed: error, failed, failure
  cancelled: canceled, cancelled, stopped
  timed-out: timeout, timed-out, timed_out, "timed out"

Continuation and replacement:
  continue normally keeps the prior role, harness, and exact agent identity. It binds only
  unchanged retained sources known by that agent; unseen or changed sources are inline.
  Within one phase capabilities must be reused or narrowed; an explicit phase transition
  uses a grant validated against the new phase maximum.
  Bound design is redigested automatically. --replace prepares a fresh agent, expands
  retained inputs in full, and may select --harness; it remains a replacement.

Warnings:
  Continuing with a release mismatch is explicit. Adapters report prompt-guided
  capabilities when the harness does not enforce them. Missing required response
  headings warn after finalization but do not discard useful native output.
`;
}

type OptionMode = "value" | "flag" | "repeatable";
type ParsedOptions = ReadonlyMap<string, readonly string[]>;

function parseTail(
  args: readonly string[],
  command: string,
  positionals: readonly string[],
  definitions: Readonly<Record<string, OptionMode>>,
): { readonly positionals: readonly string[]; readonly options: ParsedOptions } {
  const foundPositionals: string[] = [];
  let index = 0;
  for (const name of positionals) {
    const value = args[index];
    if (value === undefined || value.startsWith("-")) {
      throw new CliError(`${command} requires <${name}> before its options`);
    }
    foundPositionals.push(value);
    index += 1;
  }

  const options = new Map<string, string[]>();
  while (index < args.length) {
    const option = args[index]!;
    if (!option.startsWith("-")) {
      throw new CliError(`Unexpected positional argument for ${command}: ${option}`);
    }
    const mode = definitions[option];
    if (mode === undefined) throw new CliError(`Unknown option for ${command}: ${option}`);
    if (mode !== "repeatable" && options.has(option)) {
      throw new CliError(`Duplicate option for ${command}: ${option}`);
    }
    if (mode === "flag") {
      options.set(option, ["true"]);
      index += 1;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new CliError(`${option} requires a value`);
    }
    options.set(option, [...(options.get(option) ?? []), value]);
    index += 2;
  }
  return { positionals: foundPositionals, options };
}

function required(options: ParsedOptions, option: string, command: string): string {
  const value = options.get(option)?.[0];
  if (value === undefined || value.trim() === "") {
    throw new CliError(`${command} requires ${option} <value>`);
  }
  return value;
}

function optional(options: ParsedOptions, option: string): string | undefined {
  const value = options.get(option)?.[0];
  if (value !== undefined && value.trim() === "") throw new CliError(`${option} cannot be empty`);
  return value;
}

function positiveInteger(value: string | undefined, option: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new CliError(`${option} must be a positive integer`);
  }
  return Number(value);
}

function harness(value: string): HarnessId {
  if (!harnessIds.includes(value as HarnessId)) {
    throw new CliError(`Unknown harness ${value}; expected ${harnessIds.join(", ")}`);
  }
  return value as HarnessId;
}

function commandRoot(dependencies: CommandDependencies): string {
  return canonicalPath(dependencies.cwd ?? process.cwd());
}

function output(dependencies: CommandDependencies): { out: WriteOutput; err: WriteOutput } {
  return {
    out: dependencies.stdout ?? ((text) => process.stdout.write(text)),
    err: dependencies.stderr ?? ((text) => process.stderr.write(text)),
  };
}

async function utf8(path: string, name: string, nonempty = true) {
  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new CliError(`${name} is unreadable: ${path}: ${String(error)}`);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new CliError(`${name} is not valid UTF-8: ${path}`);
  }
  if (nonempty && text.trim() === "") throw new CliError(`${name} is empty: ${path}`);
  return { bytes, text };
}

async function grantAt(path: string): Promise<unknown> {
  const source = await utf8(path, "Capability grant");
  try {
    return JSON.parse(source.text) as unknown;
  } catch {
    throw new CliError(`Capability grant is not valid JSON: ${path}`);
  }
}

type FilePromptInput = Readonly<{ id: string; path: string; displayName: string }>;

function displayPath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join("/") || basename(path);
}

const decompositionInputs = [
  "current-decomposition",
  "candidate-decomposition",
  "accepted-decomposition",
] as const;

function canonicalSource(path: string, roots: readonly string[], name: string): string {
  const canonical = canonicalPath(path);
  if (!roots.some((root) => isPathInside(root, canonical))) {
    throw new CliError(`${name} escapes its allowed roots: ${path} resolves to ${canonical}`);
  }
  return canonical;
}

function promptInputs(
  values: readonly string[],
  cwd: string,
  skillRoot: string,
  unit: WorkUnit,
): FilePromptInput[] {
  return values.map((value) => {
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1) {
      throw new CliError(`--input must have the form <slot>=<path>: ${value}`);
    }
    const id = value.slice(0, separator);
    if (id === "task") throw new CliError(`The task input must be supplied with --task`);
    const supplied = resolve(cwd, value.slice(separator + 1));
    const path = canonicalSource(supplied, [cwd, skillRoot], `Prompt input ${id}`);
    const expected =
      id === "brief"
        ? unit.briefPath
        : decompositionInputs.includes(id as (typeof decompositionInputs)[number])
          ? resolve(unit.path, "decomposition.md")
          : undefined;
    if (expected !== undefined && (supplied !== expected || path !== expected)) {
      throw new CliError(`Prompt input ${id} must be the exact work-unit path ${expected}`);
    }
    return { id, path, displayName: displayPath(cwd, path) };
  });
}

function exactDesignRoot(value: string, cwd: string): string {
  const expected = resolve(cwd, "design");
  const supplied = resolve(cwd, value);
  const canonical = canonicalPath(supplied);
  if (supplied !== expected || canonical !== expected) {
    throw new CliError(`Design root must be the canonical application design path: ${expected}`);
  }
  return expected;
}

function requireRecordApplication(record: LaunchRecord, cwd: string): void {
  const expected = workUnitPath(cwd, record.work.slug);
  if (record.work.path !== expected) {
    throw new CliError(`Launch record belongs to another application: ${record.work.path}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new CliError(`Cannot inspect path ${path}: ${String(error)}`);
  }
}

function pathCovered(path: string, prior: string): boolean {
  return prior === "." || path === prior || path.startsWith(`${prior}/`);
}

/** Return the first capability expansion, or undefined when next reuses or narrows prior. */
export function capabilitySubsetIssue(
  next: EffectiveCapabilityGrant,
  prior: EffectiveCapabilityGrant,
): string | undefined {
  for (const field of ["readableAreas", "writableAreas"] as const) {
    for (const candidate of next[field]) {
      if (
        !prior[field].some(
          (existing) =>
            existing.area === candidate.area && pathCovered(candidate.path, existing.path),
        )
      ) {
        return `${field} expands at ${candidate.area}:${candidate.path}`;
      }
    }
  }
  for (const tool of next.toolKinds) {
    if (!prior.toolKinds.includes(tool)) return `toolKinds expands with ${tool}`;
  }
  if (
    projectShellAccessLevels.indexOf(next.projectShell) >
    projectShellAccessLevels.indexOf(prior.projectShell)
  ) {
    return `projectShell expands from ${prior.projectShell} to ${next.projectShell}`;
  }
  for (const flag of ["network", "generatedOutput", "longRunningProcesses"] as const) {
    if (next[flag] && !prior[flag]) return `${flag} expands from false to true`;
  }
  return undefined;
}

interface PrepareCommandOptions {
  readonly cwd: string;
  readonly skillRoot: string;
  readonly slug: string;
  readonly role: string;
  readonly phase: string;
  readonly taskPath: string;
  readonly grantPath: string;
  readonly inputValues: readonly string[];
  readonly harness: HarnessId;
  readonly target: LaunchTarget;
  readonly delivery: PromptContextDelivery;
  readonly relationship?: {
    readonly kind: "continuation" | "replacement";
    readonly recordPath: string;
  };
  readonly design?: { readonly root: string; readonly digest: string };
  readonly knownRetained?: readonly RetainedSource[];
  readonly contextLimitBytes?: number;
  readonly timeoutSeconds: number;
  readonly model?: string;
  readonly reasoning?: string;
  readonly priorGrant?: EffectiveCapabilityGrant;
  readonly kind: "fresh" | "continuation" | "replacement";
}

async function prepareCommand(
  options: PrepareCommandOptions,
  dependencies: CommandDependencies,
): Promise<void> {
  const unit = await requireWorkUnit(options.cwd, options.slug);
  const skillRoot = canonicalPath(options.skillRoot);
  const taskPath = canonicalSource(options.taskPath, [options.cwd], "Task");
  const grantPath = canonicalSource(options.grantPath, [options.cwd], "Capability grant");
  const task = await utf8(taskPath, "Task");
  const rawGrant = await grantAt(grantPath);
  const configuration = configurationWithUserOverrides({
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.reasoning === undefined ? {} : { reasoning: options.reasoning }),
  });
  const suppliedInputs = promptInputs(options.inputValues, options.cwd, skillRoot, unit);
  for (const input of suppliedInputs) await utf8(input.path, `Prompt input ${input.id}`);
  const inputs: PromptInput[] = [
    { id: "task", displayName: displayPath(options.cwd, taskPath), content: task.text },
    ...suppliedInputs,
  ];
  const built = await buildPrompt({
    role: options.role,
    phase: options.phase,
    workUnit: options.slug,
    applicationRoot: options.cwd,
    promptRoot: resolve(skillRoot, "prompts"),
    inputs,
    grant: rawGrant,
    contextDelivery: options.delivery,
    ...(options.knownRetained === undefined ? {} : { knownRetained: options.knownRetained }),
    ...(options.contextLimitBytes === undefined
      ? {}
      : { contextLimitBytes: options.contextLimitBytes }),
  });
  if (options.priorGrant !== undefined) {
    const issue = capabilitySubsetIssue(built.effectiveCapabilities, options.priorGrant);
    if (issue !== undefined) throw new CliError(`Continuation capability grant ${issue}`);
  }
  const launch = await prepareLaunch({
    applicationRoot: options.cwd,
    slug: options.slug,
    role: built.specification.role,
    phase: built.specification.phase,
    harness: options.harness,
    timeoutSeconds: options.timeoutSeconds,
    task: task.bytes,
    prompt: built.content,
    promptSha256: built.sha256,
    grant: built.effectiveCapabilities,
    retainedSources: built.retainedSources,
    ...(options.design === undefined ? {} : { design: options.design }),
    ...(options.relationship === undefined ? {} : { relationship: options.relationship }),
    ...(dependencies.now === undefined ? {} : { at: dependencies.now() }),
  });
  const invocation = prepareHarnessInvocation({
    harness: options.harness,
    target: options.target,
    promptPath: launch.artifacts.promptPath,
    cwd: options.cwd,
    effectiveCapabilities: built.effectiveCapabilities,
    timeoutSeconds: options.timeoutSeconds,
    configuration,
  });
  printPrepared(options.kind, built, launch, invocation, dependencies);
}

function printPrepared(
  kind: PrepareCommandOptions["kind"],
  built: BuiltPrompt,
  launch: PrepareLaunchResult,
  invocation: PreparedHarnessInvocation<EffectiveCapabilityGrant>,
  dependencies: CommandDependencies,
): void {
  const { out } = output(dependencies);
  const label =
    kind === "fresh"
      ? "Fresh launch prepared"
      : kind === "continuation"
        ? "Same-agent continuation prepared"
        : "Fresh-agent replacement prepared";
  const design =
    launch.record.design === undefined
      ? ""
      : `Design root: ${launch.record.design.root}\nDesign before: ${launch.record.design.before}\n`;
  out(`${label}: ${built.specification.id}
Task: ${launch.artifacts.taskPath}
Capabilities: ${launch.artifacts.capabilitiesPath}
Prompt: ${launch.artifacts.promptPath}
Response: ${launch.artifacts.responsePath}
Record: ${launch.path}
${design}Prompt bytes: ${built.bytes}; sha256 ${built.sha256}\n`);
  const target =
    invocation.target.kind === "fresh"
      ? "Target: fresh agent"
      : `Target agent: ${invocation.target.agentId}`;
  out(`Harness: ${invocation.harness}
Prompt delivery: ${invocation.prompt.delivery}; ${invocation.prompt.nativeField}
Working directory: ${invocation.cwd.path}; ${invocation.cwd.behavior}
Timeout: ${launch.record.timeoutSeconds} seconds; coordinator-managed observation limit; CLI does not observe harness
${target}
Native: ${invocation.native.mechanism}; ${invocation.native.operation}
Instruction: ${invocation.native.instruction}\n`);
  if (invocation.prompt.agentInstruction !== undefined) {
    out(`Agent instruction: ${invocation.prompt.agentInstruction}\n`);
  }
  if (invocation.capabilityEnforcement === "prompt-guided") {
    out(
      `Warning: ${invocation.harness} capabilities are prompt-guided rather than harness-enforced.\n`,
    );
  }
}

async function workStart(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "work start", ["slug"], { "--conflict": "value" });
  const cwd = commandRoot(dependencies);
  const skillRoot = resolve(dependencies.skillRoot ?? defaultSkillRoot);
  const slug = parsed.positionals[0]!;
  const candidate = workUnitPath(cwd, slug);
  if (await pathExists(candidate)) throw new CliError(`Work unit already exists: ${slug}`);
  const briefTemplatePath = resolve(skillRoot, "prompts/brief.md");
  await utf8(briefTemplatePath, "Brief template");
  const conflict = optional(parsed.options, "--conflict");
  if (
    conflict !== undefined &&
    !conflictChoices.includes(conflict as (typeof conflictChoices)[number])
  ) {
    throw new CliError(
      `Unknown conflict choice ${conflict}; expected ${conflictChoices.join(", ")}`,
    );
  }
  const bootstrap = dependencies.bootstrap ?? bootstrapApplication;
  const result = await bootstrap(
    {
      applicationRoot: cwd,
      releaseManifestPath: resolve(skillRoot, "release.json"),
      ...(conflict === undefined
        ? {}
        : { conflictChoice: conflict as (typeof conflictChoices)[number] }),
    },
    dependencies.bootstrapDependencies,
  );
  const { out } = output(dependencies);
  for (const path of result.changedPaths) out(`Bootstrap path: ${path}\n`);
  for (const warning of result.warnings) out(`Warning: ${warning}\n`);
  if (result.outcome === "choice-required") {
    throw new CliError(
      `Bootstrap requires an explicit framework conflict choice`,
      `Rerun with --conflict <${conflictChoices.join("|")}>.`,
    );
  }
  if (result.outcome === "stopped-unchanged") {
    out(`Bootstrap stopped unchanged: ${result.plan.applicationRoot}\n`);
    return;
  }
  if (result.outcome === "failed") {
    throw new CliError(
      `Bootstrap failed: ${result.plan.error ?? "required application setup was not established"}`,
      `Resolve the reported bootstrap problem, then rerun work start.`,
    );
  }
  const unit = await startWorkUnitFromTemplate({
    applicationRoot: cwd,
    slug,
    briefTemplatePath,
  });
  out(`Bootstrap: ${result.outcome}; application ${result.plan.applicationRoot}
Work unit: ${unit.path}
Brief: ${unit.briefPath}\n`);
}

const promptDefinitions = {
  "--work": "value",
  "--role": "value",
  "--phase": "value",
  "--task": "value",
  "--grant": "value",
  "--harness": "value",
  "--input": "repeatable",
  "--design-root": "value",
  "--context-limit": "value",
  "--timeout": "value",
  "--model": "value",
  "--reasoning": "value",
} as const;

async function promptBuild(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "prompt build", [], promptDefinitions);
  const cwd = commandRoot(dependencies);
  const slug = required(parsed.options, "--work", "prompt build");
  const role = required(parsed.options, "--role", "prompt build");
  const phase = required(parsed.options, "--phase", "prompt build");
  const taskPath = resolve(cwd, required(parsed.options, "--task", "prompt build"));
  const grantPath = resolve(cwd, required(parsed.options, "--grant", "prompt build"));
  const harnessId = harness(required(parsed.options, "--harness", "prompt build"));
  getRoleSpecification(role, phase);
  const designOption = optional(parsed.options, "--design-root");
  const designRoot = designOption === undefined ? undefined : exactDesignRoot(designOption, cwd);
  const design =
    designRoot === undefined
      ? undefined
      : { root: designRoot, digest: (await digestDesign(designRoot)).digest };
  const contextLimit = positiveInteger(
    optional(parsed.options, "--context-limit"),
    "--context-limit",
  );
  const timeoutSeconds =
    positiveInteger(optional(parsed.options, "--timeout"), "--timeout") ?? defaultTimeoutSeconds;
  const model = optional(parsed.options, "--model");
  const reasoning = optional(parsed.options, "--reasoning");
  await prepareCommand(
    {
      cwd,
      skillRoot: resolve(dependencies.skillRoot ?? defaultSkillRoot),
      slug,
      role,
      phase,
      taskPath,
      grantPath,
      inputValues: parsed.options.get("--input") ?? [],
      harness: harnessId,
      target: { kind: "fresh" },
      delivery: "fresh",
      kind: "fresh",
      ...(design === undefined ? {} : { design }),
      ...(contextLimit === undefined ? {} : { contextLimitBytes: contextLimit }),
      timeoutSeconds,
      ...(model === undefined ? {} : { model }),
      ...(reasoning === undefined ? {} : { reasoning }),
    },
    dependencies,
  );
}

function completionTarget(record: LaunchRecord): LaunchTarget {
  return record.relationship?.kind === "continuation"
    ? { kind: "continuation", agentId: record.relationship.targetAgentId }
    : { kind: "fresh" };
}

function missingResponseHeadings(record: FinalizedLaunchRecord, response: string): string[] {
  const specification = getRoleSpecification(record.role, record.phase);
  const headings = new Set<string>();
  for (const match of response.matchAll(/^##[ \t]+(.+?)[ \t]*#*[ \t]*$/gm)) {
    headings.add(match[1]!.trim().toLowerCase());
  }
  return specification.returnShape
    .filter(({ required }) => required)
    .map(({ heading }) => heading)
    .filter((heading) => !headings.has(heading.toLowerCase()));
}

async function launchComplete(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "launch complete", ["prepared-record"], {
    "--agent-id": "value",
    "--status": "value",
    "--model": "value",
  });
  const cwd = commandRoot(dependencies);
  const agentId = required(parsed.options, "--agent-id", "launch complete");
  const status = normalizeLaunchStatus(required(parsed.options, "--status", "launch complete"));
  const model = optional(parsed.options, "--model");
  const recordPath = resolve(cwd, parsed.positionals[0]!);
  const record = await readLaunchRecord(recordPath);
  requireRecordApplication(record, cwd);
  if (record.state !== "prepared") throw new CliError(`Launch record is already finalized`);
  const response = await utf8(record.response.path, "Native response", status === "completed");
  const validatedGrant = validateCapabilityGrant(
    getRoleSpecification(record.role, record.phase),
    record.grant,
  );
  const invocation = prepareHarnessInvocation({
    harness: record.harness,
    target: completionTarget(record),
    promptPath: record.prompt.path,
    cwd,
    effectiveCapabilities: validatedGrant,
    timeoutSeconds: record.timeoutSeconds,
  });
  const finalized = await finalizeLaunch({
    recordPath,
    agentId,
    status,
    enforcement: invocation.capabilityEnforcement,
    ...(model === undefined ? {} : { model }),
  });
  const { out } = output(dependencies);
  out(`Launch finalized: ${recordPath}
Response: ${finalized.response.path}
Harness: ${finalized.harness}; agent ${finalized.agentId}
Status: ${finalized.status}\n`);
  if (finalized.enforcement === "prompt-guided") {
    out(
      `Warning: ${finalized.harness} capabilities were prompt-guided rather than harness-enforced.\n`,
    );
  }
  const missing = missingResponseHeadings(finalized, response.text);
  if (missing.length > 0) {
    out(
      `Warning: native response is missing required headings: ${missing.join(", ")}; the captured response was finalized unchanged.\n`,
    );
  }
}

async function continueLaunch(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "continue", ["finalized-record"], {
    "--phase": "value",
    "--task": "value",
    "--grant": "value",
    "--input": "repeatable",
    "--replace": "flag",
    "--harness": "value",
    "--design-root": "value",
    "--context-limit": "value",
    "--timeout": "value",
    "--model": "value",
    "--reasoning": "value",
  });
  const cwd = commandRoot(dependencies);
  const phase = required(parsed.options, "--phase", "continue");
  const taskPath = resolve(cwd, required(parsed.options, "--task", "continue"));
  const grantPath = resolve(cwd, required(parsed.options, "--grant", "continue"));
  const replacing = parsed.options.has("--replace");
  const selectedHarness = optional(parsed.options, "--harness");
  if (!replacing && selectedHarness !== undefined) {
    throw new CliError(`--harness is valid only with --replace`);
  }
  if (selectedHarness !== undefined) harness(selectedHarness);
  const designOption = optional(parsed.options, "--design-root");
  const contextLimit = positiveInteger(
    optional(parsed.options, "--context-limit"),
    "--context-limit",
  );
  const timeoutSeconds =
    positiveInteger(optional(parsed.options, "--timeout"), "--timeout") ?? defaultTimeoutSeconds;
  const model = optional(parsed.options, "--model");
  const reasoning = optional(parsed.options, "--reasoning");
  const priorPath = resolve(cwd, parsed.positionals[0]!);
  const prior = await readLaunchRecord(priorPath);
  requireRecordApplication(prior, cwd);
  if (prior.state !== "finalized") throw new CliError(`continue requires a finalized record`);
  getRoleSpecification(prior.role, phase);
  const harnessId = harness(selectedHarness ?? prior.harness);
  const priorGrant = validateCapabilityGrant(
    getRoleSpecification(prior.role, prior.phase),
    prior.grant,
  );
  if (prior.design !== undefined && designOption !== undefined) {
    throw new CliError(`Continue already has a bound design root; omit --design-root`);
  }
  const designRoot =
    prior.design?.root ??
    (designOption === undefined ? undefined : exactDesignRoot(designOption, cwd));
  const design =
    designRoot === undefined
      ? undefined
      : {
          root: exactDesignRoot(designRoot, cwd),
          digest: (await digestDesign(designRoot)).digest,
        };
  const enforceSubset = !replacing && phase === prior.phase;
  await prepareCommand(
    {
      cwd,
      skillRoot: resolve(dependencies.skillRoot ?? defaultSkillRoot),
      slug: prior.work.slug,
      role: prior.role,
      phase,
      taskPath,
      grantPath,
      inputValues: parsed.options.get("--input") ?? [],
      harness: harnessId,
      target: replacing ? { kind: "fresh" } : { kind: "continuation", agentId: prior.agentId },
      delivery: replacing ? "replacement" : "continuation",
      relationship: { kind: replacing ? "replacement" : "continuation", recordPath: priorPath },
      kind: replacing ? "replacement" : "continuation",
      ...(design === undefined ? {} : { design }),
      ...(!replacing ? { knownRetained: prior.retainedSources } : {}),
      ...(contextLimit === undefined ? {} : { contextLimitBytes: contextLimit }),
      timeoutSeconds,
      ...(model === undefined ? {} : { model }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(enforceSubset ? { priorGrant } : {}),
    },
    dependencies,
  );
}

async function execute(args: readonly string[], dependencies: CommandDependencies): Promise<void> {
  if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) {
    output(dependencies).out(helpText());
    return;
  }
  if (args[0] === "work" && args[1] === "start") return workStart(args.slice(2), dependencies);
  if (args[0] === "prompt" && args[1] === "build") return promptBuild(args.slice(2), dependencies);
  if (args[0] === "launch" && args[1] === "complete")
    return launchComplete(args.slice(2), dependencies);
  if (args[0] === "continue") return continueLaunch(args.slice(1), dependencies);
  throw new CliError(
    `Unknown or incomplete command: ${args.join(" ")}`,
    `Use ${commandName} --help.`,
  );
}

export async function run(
  args: readonly string[] = process.argv.slice(2),
  dependencies: CommandDependencies = {},
): Promise<number> {
  try {
    await execute(args, dependencies);
    return 0;
  } catch (error) {
    const { err } = output(dependencies);
    err(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    if (error instanceof CliError && error.recovery !== undefined) {
      err(`Recovery: ${error.recovery}\n`);
    }
    return 1;
  }
}

if (
  process.argv[1] !== undefined &&
  canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url))
) {
  void run().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
