#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapApplication, conflictChoices, type BootstrapDependencies } from "./bootstrap.ts";
import {
  configurationWithUserOverrides,
  harnessIds,
  prepareHarnessInvocation,
  recommendHarness,
  validateHarnessIdentity,
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
  finalizeSimulation,
  normalizeLaunchStatus,
  prepareLaunch,
  readLaunchRecord,
  replacePreparedHarness,
  type ExecutionHarness,
  type LaunchRecord,
  type PrepareLaunchResult,
} from "./records.ts";
import {
  capabilityRecommendationIssues,
  getRoleSpecification,
  initialCapabilityGrant,
  projectShellAccessLevels,
  roleSpecificationIds,
  roleSpecifications,
  validateCapabilityGrant,
  type EffectiveCapabilityGrant,
  type ReadableAreaGrant,
  type WritableAreaGrant,
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

export function defaultSkillRootForCommand(commandPath: string): string {
  const commandDirectory = dirname(commandPath);
  return basename(commandDirectory) === "dist"
    ? resolve(commandDirectory, "../skills/sync-engine")
    : resolve(commandDirectory, "..");
}

const defaultSkillRoot = defaultSkillRootForCommand(fileURLToPath(import.meta.url));
const defaultTimeoutSeconds = 1800;

function launchTitle(slug: string, role: string): string {
  const name = role
    .split("-")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return `${slug} — ${name}`;
}

type WriteOutput = (text: string) => void;
type Bootstrap = typeof bootstrapApplication;
type DesignCheck = (
  paths: readonly string[],
  cwd: string,
) => Promise<{ readonly exitCode: number; readonly output: string }>;

const runDesignCheck: DesignCheck = (paths, cwd) =>
  new Promise((fulfill, reject) => {
    const child = spawn("bunx", ["--no-install", "sync-engine", "check-design", ...paths], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.once("error", reject);
    child.once("close", (exitCode) => fulfill({ exitCode: exitCode ?? 1, output }));
  });

export interface CommandDependencies {
  readonly cwd?: string;
  readonly skillRoot?: string;
  readonly stdout?: WriteOutput;
  readonly stderr?: WriteOutput;
  readonly bootstrap?: Bootstrap;
  readonly bootstrapDependencies?: BootstrapDependencies;
  readonly designCheck?: DesignCheck;
  readonly environment?: NodeJS.ProcessEnv;
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
  ${commandName} work show <slug>
  ${commandName} work finish <slug>
  ${commandName} grant init --role <role> --phase <phase>
    [--read <area>:<path>]... [--write <area>:<path>]...
    [--shell <level>] [--network] [--generated-output] [--long-running]
  ${commandName} harness recommend
  ${commandName} prompt build --work <slug> --role <role> --phase <phase>
    --task <path> --grant <json-path>
    (--harness <harness> | --simulate <reason>)
    [--input <slot>=<path>]... [--design-root <path>] [--context-limit <bytes>]
    [--timeout <seconds>] [--model <id>] [--reasoning <id>]
  ${commandName} launch adapter <prepared-record> --harness <harness>
  ${commandName} launch complete <prepared-record> --agent-id <id>
    --status <native-status> [--model <id>]
  ${commandName} simulation complete <prepared-record> --status <status>
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
  --harness names the mechanism that creates the role agent, not an outer supervisor.
  Design binding is automatic when a run reads or writes permanent design. --design-root
  may explicitly introduce the same canonical <application>/design binding; continue
  recomputes an existing binding and accepts this option only when the prior record has none. Completion uses the recorded root.
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

Capability grant JSON (every field is required; use grant init for validated defaults):
  {
    "readableAreas": [{"area": "work-unit|design|application", "path": "relative/POSIX"}],
    "writableAreas": [{"area": "current-decomposition|assigned-design|owned-concept|owned-integration|owned-configuration|owned-frontend|owned-test|owned-scenario", "path": "relative/POSIX"}],
    "toolKinds": ["repository-read", "repository-write"],
    "projectShell": "none|project-validation|project-local",
    "network": false,
    "generatedOutput": false,
    "longRunningProcesses": false
  }

  Paths are relative to their semantic area. For example, assigned-design:concepts/Tasking.md
  resolves to design/concepts/Tasking.md; current-decomposition:decomposition.md resolves
  to the work-unit decomposition. Those two write areas are exclusive to their design phases.

Completion:
  Delegated and simulated runs use the same prompt and response artifacts. Copy the role
  result verbatim to Response, then run the printed completion command. A simulated run
  records its reason, coordinator executor, and non-independent status without inventing
  an agent identity. Completed status requires nonempty UTF-8.

Status normalization:
  completed: complete, completed, idle, settled, success, succeeded
  failed: error, failed, failure
  cancelled: canceled, cancelled, stopped
  timed-out: timeout, timed-out, timed_out, "timed out"

Continuation and replacement:
  continue normally keeps the prior role, harness, and exact agent identity. It binds only
  unchanged retained sources known by that agent; unseen or changed sources are inline.
  Each continuation records its current access grant. Same-phase expansion is allowed
  with a warning; record consequential expansion in the work brief.
  Bound design is redigested automatically. --replace prepares a fresh agent, expands
  retained inputs in full, and may select --harness; it remains a replacement.

Warnings:
  Finalize the current run before preparing another. work finish refuses handback while a
  run remains prepared. Continuing with a release mismatch is explicit. Adapters report
  prompt-guided capabilities when the harness does not enforce them.
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

function areaGrant(value: string, kind: "read" | "write"): ReadableAreaGrant | WritableAreaGrant {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new CliError(`--${kind} must have the form <area>:<relative-path>: ${value}`);
  }
  return { area: value.slice(0, separator), path: value.slice(separator + 1) } as
    | ReadableAreaGrant
    | WritableAreaGrant;
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

async function workRecords(unit: WorkUnit): Promise<Array<{ path: string; record: LaunchRecord }>> {
  const names = (await readdir(unit.path)).filter((name) => name.endsWith(".record.json")).sort();
  return Promise.all(
    names.map(async (name) => {
      const path = resolve(unit.path, name);
      return { path, record: await readLaunchRecord(path) };
    }),
  );
}

async function requireNoPreparedRun(unit: WorkUnit): Promise<void> {
  const prepared = (await workRecords(unit)).find(({ record }) => record.state === "prepared");
  if (prepared !== undefined) {
    throw new CliError(
      `Work item ${unit.slug} already has an unfinished prepared run: ${prepared.path}`,
      `Finalize it, change its adapter, or record a terminal failure before preparing another run.`,
    );
  }
}

function pathCovered(path: string, prior: string): boolean {
  return prior === "." || path === prior || path.startsWith(`${prior}/`);
}

function capabilityExpansionIssue(
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
  readonly harness: ExecutionHarness;
  readonly simulationReason?: string;
  readonly priorGrant?: EffectiveCapabilityGrant;
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
  readonly kind: "fresh" | "continuation" | "replacement";
}

async function prepareCommand(
  options: PrepareCommandOptions,
  dependencies: CommandDependencies,
): Promise<void> {
  const unit = await requireWorkUnit(options.cwd, options.slug);
  await requireNoPreparedRun(unit);
  if (options.kind === "fresh" && options.role === "designer" && options.phase === "contracts") {
    const priorDesigner = (await workRecords(unit))
      .filter(
        ({ record }) =>
          record.state === "finalized" &&
          record.execution === "delegated" &&
          record.role === "designer" &&
          record.phase === "decomposition",
      )
      .at(-1);
    if (priorDesigner !== undefined) {
      throw new CliError(
        `A finalized decomposition designer already owns this work item`,
        `Continue ${priorDesigner.path} into contracts; use --replace only when a fresh designer is intentional.`,
      );
    }
  }
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
  const recommendationIssues = capabilityRecommendationIssues(
    built.specification,
    built.effectiveCapabilities,
  );
  const expansionIssue =
    options.priorGrant === undefined
      ? undefined
      : capabilityExpansionIssue(built.effectiveCapabilities, options.priorGrant);
  if (built.specification.id === "critic/contracts") {
    const changed = suppliedInputs
      .filter(({ id }) => id === "changed-contracts")
      .map(({ path }) => path);
    const checked = await (dependencies.designCheck ?? runDesignCheck)(changed, options.cwd);
    if (checked.exitCode !== 0) {
      throw new CliError(
        `Contract syntax validation failed before semantic criticism${checked.output.trim() === "" ? "" : `:\n${checked.output.trimEnd()}`}`,
        `Continue the contract designer with these diagnostics, then rerun the critic preparation.`,
      );
    }
  }
  const inferredDesign =
    built.specification.id === "designer/contracts" ||
    built.effectiveCapabilities.readableAreas.some(({ area }) => area === "design") ||
    built.effectiveCapabilities.writableAreas.some(({ area }) => area === "assigned-design") ||
    suppliedInputs.some(({ path }) => isPathInside(resolve(options.cwd, "design"), path));
  const design =
    options.design ??
    (inferredDesign
      ? {
          root: resolve(options.cwd, "design"),
          digest: (await digestDesign(resolve(options.cwd, "design"))).digest,
        }
      : undefined);
  const launch = await prepareLaunch({
    applicationRoot: options.cwd,
    slug: options.slug,
    role: built.specification.role,
    phase: built.specification.phase,
    execution: options.harness === "coordinator" ? "simulated" : "delegated",
    harness: options.harness,
    ...(options.simulationReason === undefined
      ? {}
      : { simulationReason: options.simulationReason }),
    timeoutSeconds: options.timeoutSeconds,
    task: task.bytes,
    prompt: built.content,
    promptSha256: built.sha256,
    grant: built.effectiveCapabilities,
    retainedSources: built.retainedSources,
    ...(design === undefined ? {} : { design }),
    ...(options.relationship === undefined ? {} : { relationship: options.relationship }),
    ...(dependencies.now === undefined ? {} : { at: dependencies.now() }),
  });
  const { out } = output(dependencies);
  if (recommendationIssues.length > 0) {
    out(
      `Warning: ${built.specification.id} access exceeds role recommendations: ${recommendationIssues.join(", ")}. Record the choice in the work brief when consequential.\n`,
    );
  }
  if (expansionIssue !== undefined) {
    out(
      `Warning: same-phase continuation access expands (${expansionIssue}). Record the choice in the work brief when consequential.\n`,
    );
  }
  if (options.harness === "coordinator") {
    printSimulated(built, launch, dependencies);
    return;
  }
  const invocation = prepareHarnessInvocation({
    harness: options.harness,
    target: options.target,
    promptPath: launch.artifacts.promptPath,
    cwd: options.cwd,
    title: launchTitle(options.slug, built.specification.role),
    effectiveCapabilities: built.effectiveCapabilities,
    timeoutSeconds: options.timeoutSeconds,
    configuration,
  });
  printPrepared(options.kind, built, launch, invocation, dependencies);
}

function printSimulated(
  built: BuiltPrompt,
  launch: PrepareLaunchResult,
  dependencies: CommandDependencies,
): void {
  output(dependencies).out(`Coordinator simulation prepared: ${built.specification.id}
Task: ${launch.artifacts.taskPath}
Capabilities: ${launch.artifacts.capabilitiesPath}
Prompt: ${launch.artifacts.promptPath}
Response: ${launch.artifacts.responsePath}
Record: ${launch.path}
Reason: ${launch.record.simulationReason}
Prompt bytes: ${built.bytes}; sha256 ${built.sha256}
Instruction: Use the prompt file as the complete simulated role assignment. Write the result verbatim to Response, then run ${commandName} simulation complete ${launch.path} --status completed.
`);
}

function launchAction(invocation: PreparedHarnessInvocation<EffectiveCapabilityGrant>): string {
  const instruction = invocation.prompt.agentInstruction ?? invocation.native.instruction;
  if (invocation.harness === "pi") {
    const sessionDirectory = resolve(dirname(invocation.prompt.path), "pi-sessions");
    const target =
      invocation.target.kind === "fresh"
        ? ""
        : ` --session ${JSON.stringify(invocation.target.agentId)}`;
    const title =
      invocation.target.kind === "fresh" ? ` --name ${JSON.stringify(invocation.title.value)}` : "";
    return `cd ${JSON.stringify(invocation.cwd.path)} && pi --mode json -p --session-dir ${JSON.stringify(sessionDirectory)}${target}${title} ${JSON.stringify(instruction)}`;
  }
  if (invocation.harness === "paseo") {
    const target =
      invocation.target.kind === "fresh"
        ? `run --cwd ${JSON.stringify(invocation.cwd.path)} --title ${JSON.stringify(invocation.title.value)} --provider <provider/model>`
        : `send ${JSON.stringify(invocation.target.agentId)}`;
    return `paseo ${target} ${JSON.stringify(instruction)}`;
  }
  return `${invocation.native.mechanism}: ${invocation.native.operation}. ${invocation.native.instruction}`;
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
Launch: ${launchAction(invocation)}
Agent title: ${invocation.title.value}${invocation.title.nativeField === undefined ? "" : `; ${invocation.title.nativeField}`}
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
  out(`Next: Finalize this record before preparing another role.\n`);
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

async function grantInit(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "grant init", [], {
    "--role": "value",
    "--phase": "value",
    "--read": "repeatable",
    "--write": "repeatable",
    "--shell": "value",
    "--network": "flag",
    "--generated-output": "flag",
    "--long-running": "flag",
  });
  const role = required(parsed.options, "--role", "grant init");
  const phase = required(parsed.options, "--phase", "grant init");
  const spec = getRoleSpecification(role, phase);
  const shell = optional(parsed.options, "--shell");
  if (
    shell !== undefined &&
    !projectShellAccessLevels.includes(shell as (typeof projectShellAccessLevels)[number])
  ) {
    throw new CliError(
      `Unknown shell level ${shell}; expected ${projectShellAccessLevels.join(", ")}`,
    );
  }
  const readable = (parsed.options.get("--read") ?? []).map((value) =>
    areaGrant(value, "read"),
  ) as ReadableAreaGrant[];
  const writable = (parsed.options.get("--write") ?? []).map((value) =>
    areaGrant(value, "write"),
  ) as WritableAreaGrant[];
  const grant = initialCapabilityGrant(spec, readable, writable, {
    ...(shell === undefined
      ? {}
      : { projectShell: shell as EffectiveCapabilityGrant["projectShell"] }),
    network: parsed.options.has("--network"),
    generatedOutput: parsed.options.has("--generated-output"),
    longRunningProcesses: parsed.options.has("--long-running"),
  });
  output(dependencies).out(`${JSON.stringify(grant, undefined, 2)}\n`);
}

function harnessRecommend(dependencies: CommandDependencies): void {
  const recommendation = recommendHarness(dependencies.environment ?? process.env);
  const harnessLine =
    recommendation.harness === undefined
      ? "Recommended execution harness: none detected; select the native role-launch mechanism explicitly."
      : `Recommended execution harness: ${recommendation.harness}`;
  const supervisorLine =
    recommendation.outerSupervisor === undefined
      ? "Outer supervisor: none detected"
      : `Outer supervisor: ${recommendation.outerSupervisor} (not the execution harness unless it creates the role agent)`;
  output(dependencies).out(`${harnessLine}\n${supervisorLine}\nReason: ${recommendation.reason}\n`);
}

const promptDefinitions = {
  "--work": "value",
  "--role": "value",
  "--phase": "value",
  "--task": "value",
  "--grant": "value",
  "--harness": "value",
  "--simulate": "value",
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
  const selectedHarness = optional(parsed.options, "--harness");
  const simulationReason = optional(parsed.options, "--simulate");
  if ((selectedHarness === undefined) === (simulationReason === undefined)) {
    throw new CliError(`prompt build requires exactly one of --harness or --simulate`);
  }
  const harnessId: ExecutionHarness =
    simulationReason === undefined ? harness(selectedHarness!) : "coordinator";
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
      ...(simulationReason === undefined ? {} : { simulationReason }),
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

async function launchAdapter(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "launch adapter", ["prepared-record"], {
    "--harness": "value",
  });
  const cwd = commandRoot(dependencies);
  const recordPath = resolve(cwd, parsed.positionals[0]!);
  const previous = await readLaunchRecord(recordPath);
  requireRecordApplication(previous, cwd);
  const next = harness(required(parsed.options, "--harness", "launch adapter"));
  const record = await replacePreparedHarness(recordPath, next);
  const grant = validateCapabilityGrant(
    getRoleSpecification(record.role, record.phase),
    record.grant,
  );
  const invocation = prepareHarnessInvocation({
    harness: next,
    target: completionTarget(record),
    promptPath: record.prompt.path,
    cwd,
    title: launchTitle(record.work.slug, record.role),
    effectiveCapabilities: grant,
    timeoutSeconds: record.timeoutSeconds,
  });
  output(dependencies).out(
    `Prepared launch adapter changed: ${previous.harness} -> ${next}\nRecord: ${recordPath}\nLaunch: ${launchAction(invocation)}\n`,
  );
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
  if (record.execution !== "delegated" || record.harness === "coordinator") {
    throw new CliError(`launch complete requires a delegated run`);
  }
  try {
    validateHarnessIdentity(record.harness, agentId);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  await utf8(record.response.path, "Native response", status === "completed");
  const validatedGrant = validateCapabilityGrant(
    getRoleSpecification(record.role, record.phase),
    record.grant,
  );
  const invocation = prepareHarnessInvocation({
    harness: record.harness,
    target: completionTarget(record),
    promptPath: record.prompt.path,
    cwd,
    title: launchTitle(record.work.slug, record.role),
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
}

async function simulationComplete(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "simulation complete", ["prepared-record"], {
    "--status": "value",
  });
  const cwd = commandRoot(dependencies);
  const status = normalizeLaunchStatus(required(parsed.options, "--status", "simulation complete"));
  const recordPath = resolve(cwd, parsed.positionals[0]!);
  const record = await readLaunchRecord(recordPath);
  requireRecordApplication(record, cwd);
  if (record.state !== "prepared") throw new CliError(`Launch record is already finalized`);
  if (record.execution !== "simulated") {
    throw new CliError(`simulation complete requires a simulated run`);
  }
  await utf8(record.response.path, "Simulated response", status === "completed");
  const finalized = await finalizeSimulation({ recordPath, status });
  output(dependencies).out(`Simulation finalized: ${recordPath}
Response: ${finalized.response.path}
Executor: coordinator; independent: no
Reason: ${finalized.simulationReason}
Status: ${finalized.status}
`);
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
  if (
    prior.execution !== "delegated" ||
    prior.harness === "coordinator" ||
    prior.agentId === undefined
  ) {
    throw new CliError(
      `A simulated run has no agent identity; prepare another simulation or a fresh delegated run`,
    );
  }
  getRoleSpecification(prior.role, phase);
  const priorGrant = validateCapabilityGrant(
    getRoleSpecification(prior.role, prior.phase),
    prior.grant,
  );
  const harnessId = harness(selectedHarness ?? prior.harness);
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
      delivery: replacing ? "replacement" : phase === prior.phase ? "delta" : "continuation",
      relationship: { kind: replacing ? "replacement" : "continuation", recordPath: priorPath },
      kind: replacing ? "replacement" : "continuation",
      ...(design === undefined ? {} : { design }),
      ...(!replacing ? { knownRetained: prior.retainedSources } : {}),
      ...(contextLimit === undefined ? {} : { contextLimitBytes: contextLimit }),
      ...(!replacing && phase === prior.phase ? { priorGrant } : {}),
      timeoutSeconds,
      ...(model === undefined ? {} : { model }),
      ...(reasoning === undefined ? {} : { reasoning }),
    },
    dependencies,
  );
}

async function workShow(args: readonly string[], dependencies: CommandDependencies): Promise<void> {
  const parsed = parseTail(args, "work show", ["slug"], {});
  const unit = await requireWorkUnit(commandRoot(dependencies), parsed.positionals[0]!);
  const brief = await utf8(unit.briefPath, "Work brief");
  const records = await workRecords(unit);
  const prepared = records.filter(({ record }) => record.state === "prepared");
  const lines = records.map(({ path, record }) => {
    const name = basename(path);
    const state = record.state === "prepared" ? "prepared — action required" : record.status;
    const executor =
      record.execution === "simulated"
        ? `coordinator simulation (${record.simulationReason})`
        : record.state === "finalized"
          ? `${record.harness}:${record.agentId}`
          : record.harness;
    return `- ${name.replace(/\.record\.json$/, "")}: ${record.role}/${record.phase}; ${state}; ${executor}`;
  });
  const readiness =
    prepared.length === 0
      ? "Handback readiness: no unfinished runs."
      : `ACTION REQUIRED: ${prepared.length} unfinished run${prepared.length === 1 ? "" : "s"}.\nHandback readiness: blocked until each prepared record is finalized.`;
  output(dependencies).out(`${readiness}\n\nWork unit: ${unit.slug}
Path: ${unit.path}

${brief.text.trimEnd()}

## Runs
${lines.length === 0 ? "None." : lines.join("\n")}
`);
}

async function workFinish(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "work finish", ["slug"], {});
  const unit = await requireWorkUnit(commandRoot(dependencies), parsed.positionals[0]!);
  const prepared = (await workRecords(unit)).filter(({ record }) => record.state === "prepared");
  if (prepared.length > 0) {
    throw new CliError(
      `Work item ${unit.slug} has ${prepared.length} unfinished prepared run${prepared.length === 1 ? "" : "s"}`,
      `Finalize each run, then rerun work finish before handback.`,
    );
  }
  output(dependencies).out(`Work item ${unit.slug} is ready for handback: no unfinished runs.\n`);
}

async function execute(args: readonly string[], dependencies: CommandDependencies): Promise<void> {
  if (args.length === 0 || (args.length === 1 && (args[0] === "--help" || args[0] === "-h"))) {
    output(dependencies).out(helpText());
    return;
  }
  if (args[0] === "work" && args[1] === "start") return workStart(args.slice(2), dependencies);
  if (args[0] === "work" && args[1] === "show") return workShow(args.slice(2), dependencies);
  if (args[0] === "work" && args[1] === "finish") return workFinish(args.slice(2), dependencies);
  if (args[0] === "grant" && args[1] === "init") return grantInit(args.slice(2), dependencies);
  if (args[0] === "harness" && args[1] === "recommend") {
    harnessRecommend(dependencies);
    return;
  }
  if (args[0] === "prompt" && args[1] === "build") return promptBuild(args.slice(2), dependencies);
  if (args[0] === "launch" && args[1] === "adapter")
    return launchAdapter(args.slice(2), dependencies);
  if (args[0] === "launch" && args[1] === "complete")
    return launchComplete(args.slice(2), dependencies);
  if (args[0] === "simulation" && args[1] === "complete")
    return simulationComplete(args.slice(2), dependencies);
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
