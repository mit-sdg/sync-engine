#!/usr/bin/env node

import { spawn } from "node:child_process";
import { lstat, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootstrapApplication, conflictChoices, type BootstrapDependencies } from "./bootstrap.ts";
import {
  configurationWithUserOverrides,
  harnessIds,
  isHarnessId,
  prepareHarnessInvocation,
  recommendHarness,
  validateHarnessIdentity,
  type HarnessId,
  type LaunchTarget,
  type PreparedHarnessInvocation,
} from "./harness.ts";
import {
  buildPrompt,
  promptSourceSha256,
  type BuiltPrompt,
  type PromptContextDelivery,
  type PromptInput,
  type RetainedSource,
} from "./prompt.ts";
import {
  digestDesign,
  finalizeLaunch,
  finalizeSimulation,
  inferRoleResult,
  normalizeLaunchStatus,
  prepareLaunch,
  readLaunchRecord,
  recordPaseoLaunch,
  replacePreparedHarness,
  type ExecutionHarness,
  type LaunchRecord,
  type PrepareLaunchResult,
  type ReviewTarget,
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
  decodeUtf8,
  executionPolicies,
  isPathInside,
  pathCoveredBy,
  plainObject,
  posixRelative,
  readWorkPolicy,
  requireWorkUnit,
  reviewPolicies,
  startWorkUnitFromTemplate,
  walkFiles,
  workUnitPath,
  type ExecutionPolicy,
  type ReviewPolicy,
  type WorkPolicy,
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
// Thirty minutes is the documented observation budget carried with a full role launch.
const defaultTimeoutSeconds = 1_800;
// The rubric expects decomposition.md to remain a compact decision index.
const decompositionWarningBytes = 8_000;

function launchTitle(slug: string, role: string): string {
  const name = role
    .split("-")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
  return `${slug} — ${name}`;
}

function roleInvocation(options: {
  readonly harness: HarnessId;
  readonly target: LaunchTarget;
  readonly promptPath: string;
  readonly cwd: string;
  readonly slug: string;
  readonly role: string;
  readonly effectiveCapabilities: EffectiveCapabilityGrant;
  readonly timeoutSeconds: number;
  readonly configuration?: ReturnType<typeof configurationWithUserOverrides>;
}): PreparedHarnessInvocation<EffectiveCapabilityGrant> {
  return prepareHarnessInvocation({
    harness: options.harness,
    target: options.target,
    promptPath: options.promptPath,
    cwd: options.cwd,
    title: launchTitle(options.slug, options.role),
    effectiveCapabilities: options.effectiveCapabilities,
    timeoutSeconds: options.timeoutSeconds,
    ...(options.configuration === undefined ? {} : { configuration: options.configuration }),
  });
}

type WriteOutput = (text: string) => void;
type Bootstrap = typeof bootstrapApplication;
type DesignCheck = (
  paths: readonly string[],
  cwd: string,
) => Promise<{ readonly exitCode: number; readonly output: string }>;
type PaseoCommand = (
  args: readonly string[],
  cwd: string,
) => Promise<{ readonly exitCode: number; readonly output: string }>;

const runCapturedCommand = (command: string, args: readonly string[], cwd: string) =>
  new Promise<{ readonly exitCode: number; readonly output: string }>((fulfill, reject) => {
    const child = spawn(command, args, {
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

const runDesignCheck: DesignCheck = (paths, cwd) =>
  runCapturedCommand("bunx", ["--no-install", "sync-engine", "check-design", ...paths], cwd);
const runPaseoCommand: PaseoCommand = (args, cwd) => runCapturedCommand("paseo", args, cwd);

export interface CommandDependencies {
  readonly cwd?: string;
  readonly skillRoot?: string;
  readonly stdout?: WriteOutput;
  readonly stderr?: WriteOutput;
  readonly bootstrap?: Bootstrap;
  readonly bootstrapDependencies?: BootstrapDependencies;
  readonly designCheck?: DesignCheck;
  readonly paseoCommand?: PaseoCommand;
  readonly environment?: NodeJS.ProcessEnv;
  readonly now?: () => Date;
}

class CliError extends Error {
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

function helpText(): string {
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
    [--review <required|omitted>] [--execution <delegated|simulated|mixed>]
  ${commandName} work show <slug>
  ${commandName} work finish <slug> [--accept <check>=<reason>]...
  ${commandName} grant init --role <role> --phase <phase>
    [--read <area>:<path>]... [--write <area>:<path>]...
    [--shell <level>] [--network] [--generated-output] [--long-running]
  ${commandName} harness recommend
  ${commandName} prompt build --work <slug> --role <role> --phase <phase>
    --task <path> --grant <json-path>
    (--harness <harness> | --simulate <reason>)
    [--input <slot>=<path>]... [--design-root <path>] [--concepts-only <reason>]
    [--context-limit <bytes>] [--timeout <seconds>] [--model <id>] [--reasoning <id>]
  ${commandName} launch adapter <prepared-record> --harness <harness>
  ${commandName} launch paseo <prepared-record> --provider <id> --model <id>
    [--thinking <id>] [--slice <seconds>]
  ${commandName} launch wait <prepared-record> [--slice <seconds>] [--no-complete]
  ${commandName} launch complete <prepared-record> [--agent-id <id>]
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
  --harness names the mechanism that creates and retains the role agent. A detected
  supervising harness takes precedence over its embedded provider runtime.
  Design binding is automatic when a run reads or writes permanent design. --design-root
  may explicitly introduce the same canonical <application>/design binding; continue
  recomputes an existing binding and accepts this option only when the prior record has none. Completion uses the recorded root.
  --context-limit is a positive byte limit supplied by the selected harness or model.
  --timeout is the observation limit carried in the launch instruction (default 1800); the
  CLI does not enforce it. Paseo launch and wait use 45-second observation slices by default.
  Fresh Paseo launches require --provider and --model; provider, model, and thinking options
  are irrelevant for continuations. Prompt --model and --reasoning carry an explicit user
  selection; otherwise they inherit native settings. --harness on continue is valid only
  together with --replace. Work policy is chosen once at work start: required review binds
  approvals to the current candidate digest, and execution policy limits delegated or simulated runs.

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
  Delegated and simulated runs use the same prompt and response artifacts. Paseo launch wait
  captures the role result verbatim and completes by default; --no-complete leaves manual
  completion. Other harnesses require copying the result and running the printed command. A simulated run
  records its reason, coordinator executor, and non-independent status without inventing
  an agent identity. Completed and blocked statuses require nonempty UTF-8. Completion
  rejects project changes outside the write grant and a response that reports blocked while
  the command claims completed. Work-unit brief, policy, and harness session state are
  coordinator-owned. Critic review completion requires a parsable Verdict. Every completion
  prints a concrete next-step cue.

Status normalization:
  completed: complete, completed, idle, settled, success, succeeded
  blocked: block, blocked
  failed: error, failed, failure
  cancelled: canceled, cancelled, stopped
  timed-out: timeout, timed-out, timed_out, "timed out"

Continuation and replacement:
  continue normally keeps the prior role, harness, and exact agent identity. It binds only
  unchanged retained sources known by that agent; unseen or changed sources are inline.
  Each continuation records its current access grant. A simulation continuation uses the
  same compact retained-context mechanism but records no agent identity. Same-phase
  expansion is allowed with a warning; record consequential expansion in the work brief.
  Bound design is redigested automatically. --replace prepares a fresh agent, expands
  retained inputs in full, and may select --harness; it remains a replacement.

Handback checks (--accept <check>=<reason>): critic-verdict, internal-imports, parallel-router.
  work finish refuses a prepared run.
  work finish refuses an unapproved final design digest when review is required.
  work finish refuses a last critic verdict of Revise or Blocked.
  work finish refuses imports from node_modules or dist paths.
  work finish refuses req.url, Bun.serve(, or pathname routing comparisons without @mit-sdg/sync-engine-http.

Warnings:
  Policy changes after preparation are rejected; release mismatches require explicit choice.
  Harness capabilities may be prompt-guided. Prefer exact excerpts to oversized context.
`;
}

type OptionMode = "value" | "flag" | "repeatable";
type ParsedOptions = ReadonlyMap<string, readonly string[]>;

function parseTail(
  args: readonly string[],
  command: string,
  positionals: readonly string[],
  definitions: Readonly<Record<string, OptionMode>>,
): {
  readonly positionals: readonly string[];
  readonly options: ParsedOptions;
} {
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
  if (!isHarnessId(value)) {
    throw new CliError(`Unknown harness ${value}; expected ${harnessIds.join(", ")}`);
  }
  return value;
}

function areaGrant(value: string, kind: "read" | "write"): ReadableAreaGrant | WritableAreaGrant {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new CliError(`--${kind} must have the form <area>:<relative-path>: ${value}`);
  }
  return {
    area: value.slice(0, separator),
    path: value.slice(separator + 1),
  } as ReadableAreaGrant | WritableAreaGrant;
}

function commandRoot(dependencies: CommandDependencies): string {
  return canonicalPath(dependencies.cwd ?? process.cwd());
}

function output(dependencies: CommandDependencies): {
  out: WriteOutput;
  err: WriteOutput;
} {
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
  const text = decodeUtf8(
    bytes,
    () => new CliError(`${name} is not valid UTF-8: ${path}`),
    nonempty ? () => new CliError(`${name} is empty: ${path}`) : false,
  );
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

type FilePromptInput = Readonly<{
  id: string;
  path: string;
  displayName: string;
}>;

function displayPath(cwd: string, path: string): string {
  return posixRelative(cwd, path) || basename(path);
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

async function hasMarkdownFile(directory: string): Promise<boolean> {
  try {
    return (
      (await walkFiles(directory, (_path, relativePath) => relativePath.endsWith(".md"))).length > 0
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new CliError(`Cannot inspect application contracts: ${String(error)}`);
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

async function requireConsistentPolicy(
  unit: WorkUnit,
  records: readonly { readonly record: LaunchRecord }[],
): Promise<WorkPolicy> {
  const current = await readWorkPolicy(unit);
  const recorded = records
    .map(({ record }) => record.policy)
    .find((policy) => policy !== undefined);
  if (
    recorded !== undefined &&
    (recorded.review !== current.review || recorded.execution !== current.execution)
  ) {
    throw new CliError(`Work policy changed after the first run was prepared`);
  }
  return recorded ?? current;
}

function requireNoPreparedRun(
  unit: WorkUnit,
  records: readonly { readonly path: string; readonly record: LaunchRecord }[],
): void {
  const prepared = records.find(({ record }) => record.state === "prepared");
  if (prepared !== undefined) {
    throw new CliError(
      `Work item ${unit.slug} already has an unfinished prepared run: ${prepared.path}`,
      `Finalize it, change its adapter, or record a terminal failure before preparing another run.`,
    );
  }
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
            existing.area === candidate.area && pathCoveredBy(candidate.path, existing.path, true),
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

function approvedReview(
  records: readonly { readonly record: LaunchRecord }[],
  target: ReviewTarget,
): boolean {
  return records.some(
    ({ record }) =>
      record.state === "finalized" &&
      record.role === "critic" &&
      record.result === "approve" &&
      record.review?.subject === target.subject &&
      record.review.digest === target.digest,
  );
}

async function finalReviewIssue(
  unit: WorkUnit,
  records: readonly { readonly record: LaunchRecord }[],
): Promise<string | undefined> {
  const policy = await requireConsistentPolicy(unit, records);
  if (policy.review === "omitted") return undefined;
  const implementationStarted = records.some(
    ({ record }) => record.state === "finalized" && record.phase === "implementation",
  );
  const designAuthored = records.some(
    ({ record }) =>
      record.state === "finalized" && record.role === "designer" && record.phase === "contracts",
  );
  if (!implementationStarted || !designAuthored) return undefined;
  const digest = (await digestDesign(resolve(unit.applicationRoot, "design"))).digest;
  return approvedReview(records, { subject: "design", digest })
    ? undefined
    : `final design digest ${digest} has no approving critic record`;
}

function requireReviewed(
  target: ReviewTarget,
  writerPhase: "decomposition" | "contracts",
  policy: WorkPolicy,
  records: readonly { readonly record: LaunchRecord }[],
): void {
  if (policy.review === "omitted") return;
  const authored = records.some(
    ({ record }) =>
      record.state === "finalized" && record.role === "designer" && record.phase === writerPhase,
  );
  if (!authored || approvedReview(records, target)) return;
  throw new CliError(
    `${target.subject === "design" ? "Design" : "Decomposition"} changed after its last approving review`,
    `Continue the critic through verification of the current candidate.`,
  );
}

function reviewTargetFor(
  built: BuiltPrompt,
  design: { readonly digest: string } | undefined,
  unit: WorkUnit,
): ReviewTarget | undefined {
  if (built.specification.id === "critic/contracts") {
    return design === undefined ? undefined : { subject: "design", digest: design.digest };
  }
  if (built.specification.id === "critic/decomposition") {
    const candidate = built.sources.find(
      (source) => source.kind === "input" && source.inputId === "candidate-decomposition",
    );
    return candidate === undefined
      ? undefined
      : { subject: "decomposition", digest: candidate.sha256 };
  }
  if (built.specification.id === "critic/verification") {
    const candidate = built.sources.find(
      (source) => source.kind === "input" && source.inputId === "revised-candidate",
    );
    if (
      candidate !== undefined &&
      resolve(candidate.path) === resolve(unit.path, "decomposition.md")
    ) {
      return { subject: "decomposition", digest: candidate.sha256 };
    }
    return design === undefined ? undefined : { subject: "design", digest: design.digest };
  }
  return undefined;
}

function promptSourceReport(built: BuiltPrompt): string {
  const totals = new Map<string, number>();
  for (const source of built.sources) {
    if (source.promptBytes === 0) continue;
    const label = source.inputId ?? source.kind;
    totals.set(label, (totals.get(label) ?? 0) + source.promptBytes);
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label, bytes]) => `${label} ${bytes}`)
    .join(", ");
}

function oversizedSourceWarnings(built: BuiltPrompt): string[] {
  const kitBytes = built.sources
    .filter(({ kind }) => kind === "role-template" || kind === "guidance")
    .reduce((total, source) => total + source.sourceBytes, 0);
  return built.sources
    .filter(
      (source) =>
        source.kind === "input" &&
        ["public-references", "examples", "context"].includes(source.inputId ?? "") &&
        source.sourceBytes > kitBytes,
    )
    .map(
      (source) =>
        `${source.displayName} (${source.sourceBytes} bytes) exceeds the built-in role kit (${kitBytes}); prefer an exact excerpt.`,
    );
}

function reviewTargetReport(record: LaunchRecord): string {
  return record.review === undefined
    ? ""
    : `Review target: ${record.review.subject} ${record.review.digest}\n`;
}

async function validateContractComposition(
  built: BuiltPrompt,
  suppliedInputs: readonly FilePromptInput[],
  cwd: string,
  conceptsOnlyReason: string | undefined,
  dependencies: CommandDependencies,
): Promise<void> {
  if (built.specification.id !== "critic/contracts") return;
  const changed = suppliedInputs
    .filter(({ id }) => id === "changed-contracts")
    .map(({ path }) => path);
  const compositionsRoot = resolve(cwd, "design/compositions");
  const changedComposition = changed.some((path) => isPathInside(compositionsRoot, path));
  if (
    !changedComposition &&
    !(await hasMarkdownFile(compositionsRoot)) &&
    conceptsOnlyReason === undefined
  ) {
    throw new CliError(
      `Application contract is missing: critic/contracts requires a contract under design/compositions/`,
      `Supply the application contract or rerun with --concepts-only <reason>.`,
    );
  }
  const checked = await (dependencies.designCheck ?? runDesignCheck)(changed, cwd);
  if (checked.exitCode !== 0) {
    throw new CliError(
      `Contract syntax validation failed before semantic criticism${checked.output.trim() === "" ? "" : `:\n${checked.output.trimEnd()}`}`,
      `Continue the contract designer with these diagnostics, then rerun the critic preparation.`,
    );
  }
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
    readonly kind: "continuation" | "replacement" | "simulation-continuation";
    readonly recordPath: string;
  };
  readonly design?: { readonly root: string; readonly digest: string };
  readonly knownRetained?: readonly RetainedSource[];
  readonly contextLimitBytes?: number;
  readonly timeoutSeconds: number;
  readonly model?: string;
  readonly reasoning?: string;
  readonly conceptsOnlyReason?: string;
  readonly kind: "fresh" | "continuation" | "replacement";
}

async function printPreparationWarnings(options: {
  readonly built: BuiltPrompt;
  readonly recommendationIssues: readonly string[];
  readonly expansionIssue: string | undefined;
  readonly suppliedInputs: readonly FilePromptInput[];
  readonly unit: WorkUnit;
  readonly review: ReviewTarget | undefined;
  readonly records: readonly { readonly path: string; readonly record: LaunchRecord }[];
  readonly policy: WorkPolicy;
  readonly conceptsOnlyReason: string | undefined;
  readonly kind: PrepareCommandOptions["kind"];
  readonly dependencies: CommandDependencies;
}): Promise<void> {
  const { out } = output(options.dependencies);
  const retainedCritic =
    options.kind === "fresh" && options.built.specification.id === "critic/contracts"
      ? options.records.findLast(
          ({ record }) =>
            record.state === "finalized" &&
            record.role === "critic" &&
            record.phase === "contracts",
        )
      : undefined;
  if (retainedCritic !== undefined) {
    out(
      `Note: a finalized contract critic already exists (${retainedCritic.path}). For a repair, continue it with \`${commandName} continue ${JSON.stringify(retainedCritic.path)} --phase verification ...\` and the finding IDs instead of a fresh full review; a fresh critic is for a changed boundary or materially expanded interactions.\n`,
    );
  }
  if (options.recommendationIssues.length > 0) {
    out(
      `Warning: ${options.built.specification.id} access exceeds role recommendations: ${options.recommendationIssues.join(", ")}. Record the choice in the work brief when consequential.\n`,
    );
  }
  if (options.expansionIssue !== undefined) {
    out(
      `Warning: same-phase continuation access expands (${options.expansionIssue}). Record the choice in the work brief when consequential.\n`,
    );
  }
  for (const warning of oversizedSourceWarnings(options.built)) out(`Warning: ${warning}\n`);
  const decomposition = resolve(options.unit.path, "decomposition.md");
  if (options.suppliedInputs.some(({ path }) => path === decomposition)) {
    const bytes = (await readFile(decomposition)).byteLength;
    if (bytes > decompositionWarningBytes) {
      out(
        `Warning: decomposition.md is ${bytes} bytes; the rubric expects a compact decision index. Ask the designer to cut signatures, storage, and restatement before review.\n`,
      );
    }
  }
  if (
    options.built.specification.role === "critic" &&
    (options.built.specification.phase === "contracts" ||
      options.built.specification.phase === "verification") &&
    options.review?.subject === "design" &&
    options.records.some(
      ({ record }) => record.state === "finalized" && record.phase === "implementation",
    )
  ) {
    out(
      `Note: required review binds only the final design digest before work finish; batch further repairs before verifying unless a worker is blocked on this design.\n`,
    );
  }
  if (options.conceptsOnlyReason !== undefined) {
    out(`Review scope: concepts only (${options.conceptsOnlyReason})\n`);
  }
  if (
    options.built.specification.role === "critic" &&
    options.built.specification.id !== "critic/implementation" &&
    options.policy.review === "required" &&
    options.review === undefined
  ) {
    out(
      `Warning: this critic run binds no review target and will not satisfy the review policy.\n`,
    );
  }
}

async function prepareCommand(
  options: PrepareCommandOptions,
  dependencies: CommandDependencies,
): Promise<void> {
  const unit = await requireWorkUnit(options.cwd, options.slug);
  const existingRecords = await workRecords(unit);
  const policy = await requireConsistentPolicy(unit, existingRecords);
  const simulated = options.harness === "coordinator";
  if (
    (policy.execution === "delegated" && simulated) ||
    (policy.execution === "simulated" && !simulated)
  ) {
    throw new CliError(
      `Work item execution policy is ${policy.execution}`,
      `Use the execution mode selected when the work item was created.`,
    );
  }
  requireNoPreparedRun(unit, existingRecords);
  if (options.kind === "fresh" && options.role === "designer" && options.phase === "contracts") {
    const priorDesigner = existingRecords
      .filter(
        ({ record }) =>
          record.state === "finalized" &&
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
    {
      id: "task",
      displayName: displayPath(options.cwd, taskPath),
      content: task.text,
    },
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
  await validateContractComposition(
    built,
    suppliedInputs,
    options.cwd,
    options.conceptsOnlyReason,
    dependencies,
  );
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
  if (built.specification.id === "designer/contracts") {
    const decompositionPath = resolve(unit.path, "decomposition.md");
    if (await pathExists(decompositionPath)) {
      const decomposition = await utf8(decompositionPath, "Decomposition");
      requireReviewed(
        {
          subject: "decomposition",
          digest: promptSourceSha256(decomposition.text),
        },
        "decomposition",
        policy,
        existingRecords,
      );
    }
  }
  if (
    built.specification.phase === "implementation" &&
    design !== undefined &&
    !existingRecords.some(
      ({ record }) => record.state === "finalized" && record.phase === "implementation",
    )
  ) {
    requireReviewed(
      { subject: "design", digest: design.digest },
      "contracts",
      policy,
      existingRecords,
    );
  }
  const review = reviewTargetFor(built, design, unit);
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
    ...(review === undefined ? {} : { review }),
    ...(options.conceptsOnlyReason === undefined
      ? {}
      : { reviewScope: { conceptsOnly: options.conceptsOnlyReason } }),
    ...(options.relationship === undefined ? {} : { relationship: options.relationship }),
    ...(dependencies.now === undefined ? {} : { at: dependencies.now() }),
  });
  await printPreparationWarnings({
    built,
    recommendationIssues,
    expansionIssue,
    suppliedInputs,
    unit,
    review,
    records: existingRecords,
    policy,
    conceptsOnlyReason: options.conceptsOnlyReason,
    kind: options.kind,
    dependencies,
  });
  if (options.harness === "coordinator") {
    printSimulated(built, launch, dependencies);
    return;
  }
  const invocation = roleInvocation({
    harness: options.harness,
    target: options.target,
    promptPath: launch.artifacts.promptPath,
    cwd: options.cwd,
    slug: options.slug,
    role: built.specification.role,
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
${reviewTargetReport(launch.record)}Reason: ${launch.record.simulationReason}
Prompt bytes: ${built.bytes}; sha256 ${built.sha256}
Prompt sources (bytes): ${promptSourceReport(built)}
Instruction: Execute the prompt directly now, within its exact access grant. Do not role-play, send an assignment, invoke an agent, narrate waiting, inspect broader coordinator context, node_modules, or package dist files. Write the result verbatim to Response, then run ${commandName} simulation complete ${launch.path} --status completed before resuming coordination; use --status blocked instead when the result reports blocked.
`);
}

function launchAction(
  invocation: PreparedHarnessInvocation<EffectiveCapabilityGrant>,
  recordPath?: string,
): string {
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
    if (recordPath === undefined) throw new Error(`Paseo launch action requires a record path`);
    const configuration =
      invocation.target.kind === "fresh"
        ? " --provider <provider> --model <model> [--thinking <id>]"
        : "";
    return `${commandName} launch paseo ${JSON.stringify(recordPath)}${configuration}`;
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
${reviewTargetReport(launch.record)}${design}Prompt bytes: ${built.bytes}; sha256 ${built.sha256}
Prompt sources (bytes): ${promptSourceReport(built)}\n`);
  const target =
    invocation.target.kind === "fresh"
      ? "Target: fresh agent"
      : `Target agent: ${invocation.target.agentId}`;
  out(`Harness: ${invocation.harness}
Launch: ${launchAction(invocation, launch.path)}
Agent title: ${invocation.title.value}${invocation.title.nativeField === undefined ? "" : `; ${invocation.title.nativeField}`}
Prompt delivery: ${invocation.prompt.delivery}; ${invocation.prompt.nativeField}
Working directory: ${invocation.cwd.path}; ${invocation.cwd.behavior}
Timeout: ${launch.record.timeoutSeconds} seconds; observation limit carried in instruction (CLI does not enforce)
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
  out(
    invocation.harness === "paseo"
      ? `Next: Run the Launch command, then repeat the printed launch wait command until this record is finalized.\n`
      : `Next: Finalize this record before preparing another role.\n`,
  );
}

async function workStart(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "work start", ["slug"], {
    "--conflict": "value",
    "--review": "value",
    "--execution": "value",
  });
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
  const review = (optional(parsed.options, "--review") ?? "required") as ReviewPolicy;
  const execution = (optional(parsed.options, "--execution") ?? "mixed") as ExecutionPolicy;
  if (!reviewPolicies.includes(review)) {
    throw new CliError(`Unknown review policy ${review}; expected ${reviewPolicies.join(", ")}`);
  }
  if (!executionPolicies.includes(execution)) {
    throw new CliError(
      `Unknown execution policy ${execution}; expected ${executionPolicies.join(", ")}`,
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
    policy: { review, execution },
  });
  out(`Bootstrap: ${result.outcome}; application ${result.plan.applicationRoot}
Work unit: ${unit.path}
Brief: ${unit.briefPath}
Policy: review ${review}; execution ${execution}\n`);
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
      : `Current supervisor: ${recommendation.outerSupervisor} (use it to create and retain role agents)`;
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
  "--concepts-only": "value",
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
  const conceptsOnlyReason = optional(parsed.options, "--concepts-only");
  if (conceptsOnlyReason !== undefined && (role !== "critic" || phase !== "contracts")) {
    throw new CliError(`--concepts-only is valid only for critic/contracts`);
  }
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
      ...(conceptsOnlyReason === undefined ? {} : { conceptsOnlyReason }),
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
  const invocation = roleInvocation({
    harness: next,
    target: completionTarget(record),
    promptPath: record.prompt.path,
    cwd,
    slug: record.work.slug,
    role: record.role,
    effectiveCapabilities: grant,
    timeoutSeconds: record.timeoutSeconds,
  });
  output(dependencies).out(
    `Prepared launch adapter changed: ${previous.harness} -> ${next}\nRecord: ${recordPath}\nLaunch: ${launchAction(invocation, recordPath)}\n`,
  );
}

async function completionNextStep(
  unit: WorkUnit,
  current: LaunchRecord,
  records: readonly { readonly path: string; readonly record: LaunchRecord }[],
): Promise<string> {
  const policy = await requireConsistentPolicy(unit, records);
  if (current.state !== "finalized") return "Finalize the current record.";
  if (current.status === "blocked" || current.result === "blocked") {
    const response = (await utf8(current.response.path, "Response", false)).text.toLowerCase();
    if (/\b(?:interrupted|restarted|cut off)\b/.test(response)) {
      return "Continue the same agent with the same assignment before doing anything else.";
    }
    if (/\bcontext\b/.test(response)) {
      return "Prepare a new prompt with the exact missing context, then continue the blocked role.";
    }
    if (/\benvironment\b/.test(response)) {
      return "Resolve the environment blocker, then continue the blocked role.";
    }
    return "Route the design blocker to the designer, then continue the blocked role with the resolution.";
  }
  if (current.role === "critic" && current.result === "revise") {
    return "Continue the designer with these findings, then continue this critic for verification.";
  }
  if (
    current.role === "critic" &&
    current.result === "approve" &&
    current.review?.subject === "decomposition"
  ) {
    return "Continue the decomposition designer into contracts with the approved decomposition.";
  }
  if (
    current.role === "critic" &&
    current.result === "approve" &&
    current.review?.subject === "design" &&
    !records.some(({ record }) => record.state === "finalized" && record.phase === "implementation")
  ) {
    return "Prepare the implementation roles against the approved design digest.";
  }
  if (current.phase === "implementation" && current.result === "complete") {
    const issue = await finalReviewIssue(unit, records);
    return issue === undefined
      ? `Validate the application, then run \`${commandName} work finish ${unit.slug}\`.`
      : "Continue the critic for verification of the current design, then retry handback.";
  }
  if (current.role === "designer" && current.result === "complete") {
    return policy.review === "required"
      ? `Prepare a critic for ${current.phase === "decomposition" ? "the decomposition" : "the design"}.`
      : current.phase === "decomposition"
        ? "Continue the designer into contracts."
        : "Prepare the implementation roles.";
  }
  if (current.status !== "completed") {
    return "Resolve the terminal run failure, then continue or replace this role explicitly.";
  }
  return `Inspect work readiness with \`${commandName} work show ${unit.slug}\`.`;
}

function unknownResultWarning(record: LaunchRecord): string | undefined {
  if (record.state !== "finalized" || record.result !== "unknown") return undefined;
  return `Response has no parsable required \`${record.role === "critic" ? "## Verdict" : "## Status"}\`; result recorded as unknown.`;
}

// A 45-second slice fits inside common harness shell timeouts of roughly 60 seconds.
const defaultPaseoSliceSeconds = 45;

async function paseoCall(
  args: readonly string[],
  cwd: string,
  dependencies: CommandDependencies,
  operation: string,
): Promise<string> {
  const result = await (dependencies.paseoCommand ?? runPaseoCommand)(args, cwd);
  if (result.exitCode !== 0) {
    throw new CliError(
      `Paseo ${operation} failed${result.output.trim() === "" ? "" : `: ${result.output.trimEnd()}`}`,
    );
  }
  return result.output;
}

function paseoJson(output: string, operation: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(output) as unknown;
  } catch {
    throw new CliError(`Paseo ${operation} returned invalid JSON`);
  }
  if (!plainObject(value)) throw new CliError(`Paseo ${operation} returned invalid JSON`);
  return value;
}

function paseoAgentId(value: Record<string, unknown>, operation: string): string {
  const agentId = value["agentId"];
  if (typeof agentId !== "string" || agentId.trim() === "") {
    throw new CliError(`Paseo ${operation} did not return an agentId`);
  }
  try {
    return validateHarnessIdentity("paseo", agentId);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
}

async function launchWaitRecord(
  recordPath: string,
  sliceSeconds: number,
  complete: boolean,
  dependencies: CommandDependencies,
): Promise<void> {
  const cwd = commandRoot(dependencies);
  const record = await readLaunchRecord(recordPath);
  requireRecordApplication(record, cwd);
  if (record.state !== "prepared") throw new CliError(`Launch record is already finalized`);
  if (record.harness !== "paseo" || record.execution !== "delegated") {
    throw new CliError(`launch wait requires a prepared delegated Paseo record`);
  }
  if (record.launched === undefined) {
    throw new CliError(`launch wait requires a recorded Paseo agent; run launch paseo first`);
  }
  const waitOutput = await paseoCall(
    ["wait", record.launched.agentId, "--timeout", String(sliceSeconds), "--json"],
    cwd,
    dependencies,
    "wait",
  );
  const wait = paseoJson(waitOutput, "wait");
  const status = typeof wait["status"] === "string" ? wait["status"].toLowerCase() : undefined;
  // `paseo wait --timeout` reports `timeout` when the slice expires on a running agent.
  if (status === "running" || status === "timeout") {
    output(dependencies).out(
      `Status: running\nNext: ${commandName} launch wait ${JSON.stringify(recordPath)} --slice ${sliceSeconds}\n`,
    );
    return;
  }
  if (status !== "idle") {
    throw new CliError(`Paseo wait returned unknown status: ${String(wait["status"])}`);
  }
  const response = await paseoCall(
    ["logs", record.launched.agentId, "--filter", "text", "--tail", "1"],
    cwd,
    dependencies,
    "logs",
  );
  await writeFile(record.response.path, response, "utf8");
  const result = inferRoleResult(Buffer.from(response, "utf8"));
  const completionStatus =
    result === "unknown" ? undefined : result === "blocked" ? "blocked" : "completed";
  const completionCommand = `${commandName} launch complete ${JSON.stringify(recordPath)} --status ${completionStatus ?? "<completed|blocked>"}`;
  output(dependencies).out(
    `Status: idle\nResponse: ${record.response.path}\nRole result: ${result}\n${completionStatus === undefined ? "Manual completion after inspecting Response" : "Complete"}: ${completionCommand}\n`,
  );
  if (complete && completionStatus !== undefined) {
    await launchComplete([recordPath, "--status", completionStatus], dependencies);
  }
}

async function launchPaseo(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "launch paseo", ["prepared-record"], {
    "--provider": "value",
    "--model": "value",
    "--thinking": "value",
    "--slice": "value",
  });
  const cwd = commandRoot(dependencies);
  const recordPath = resolve(cwd, parsed.positionals[0]!);
  const record = await readLaunchRecord(recordPath);
  requireRecordApplication(record, cwd);
  if (record.state !== "prepared") throw new CliError(`Launch record is already finalized`);
  if (record.execution !== "delegated" || record.harness !== "paseo") {
    throw new CliError(`launch paseo requires a prepared delegated Paseo record`);
  }
  if (record.launched !== undefined) {
    throw new CliError(
      `Paseo agent is already recorded for this run`,
      `Run ${commandName} launch wait ${recordPath}.`,
    );
  }
  const sliceSeconds =
    positiveInteger(optional(parsed.options, "--slice"), "--slice") ?? defaultPaseoSliceSeconds;
  const provider = optional(parsed.options, "--provider");
  const model = optional(parsed.options, "--model");
  const thinking = optional(parsed.options, "--thinking");
  const target = completionTarget(record);
  let nativeArgs: string[];
  if (target.kind === "fresh") {
    if (provider === undefined || provider.trim() === "") {
      throw new CliError(`Fresh Paseo launch requires --provider <value>`);
    }
    if (model === undefined || model.trim() === "") {
      throw new CliError(`Fresh Paseo launch requires --model <value>`);
    }
    nativeArgs = [
      "--json",
      "run",
      "-d",
      "--cwd",
      cwd,
      "--title",
      launchTitle(record.work.slug, record.role),
      "--provider",
      provider,
      "--model",
      model,
      ...(thinking === undefined ? [] : ["--thinking", thinking]),
      `Read and follow the complete assignment in this prompt file:\n${record.prompt.path}`,
    ];
  } else {
    if (
      optional(parsed.options, "--provider") !== undefined ||
      optional(parsed.options, "--model") !== undefined ||
      optional(parsed.options, "--thinking") !== undefined
    ) {
      throw new CliError(
        `Provider, model, and thinking options apply only to a fresh Paseo launch`,
      );
    }
    nativeArgs = [
      "--json",
      "send",
      "--no-wait",
      target.agentId,
      `Read and follow the complete assignment in this prompt file:\n${record.prompt.path}`,
    ];
  }
  const launchedOutput = await paseoCall(
    nativeArgs,
    cwd,
    dependencies,
    target.kind === "fresh" ? "run" : "send",
  );
  const launchedId = paseoAgentId(
    paseoJson(launchedOutput, target.kind === "fresh" ? "run" : "send"),
    target.kind === "fresh" ? "run" : "send",
  );
  if (target.kind === "continuation" && launchedId !== target.agentId) {
    throw new CliError(`Paseo send returned a different agentId than the continuation target`);
  }
  await recordPaseoLaunch(recordPath, launchedId, dependencies.now?.() ?? new Date());
  output(dependencies).out(`Paseo launched: ${recordPath}\nAgent: paseo:${launchedId}\n`);
  await launchWaitRecord(recordPath, sliceSeconds, true, dependencies);
}

async function launchWait(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "launch wait", ["prepared-record"], {
    "--slice": "value",
    "--no-complete": "flag",
  });
  const sliceSeconds =
    positiveInteger(optional(parsed.options, "--slice"), "--slice") ?? defaultPaseoSliceSeconds;
  await launchWaitRecord(
    resolve(commandRoot(dependencies), parsed.positionals[0]!),
    sliceSeconds,
    !parsed.options.has("--no-complete"),
    dependencies,
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
  const requestedAgentId = optional(parsed.options, "--agent-id");
  const status = normalizeLaunchStatus(required(parsed.options, "--status", "launch complete"));
  const model = optional(parsed.options, "--model");
  const recordPath = resolve(cwd, parsed.positionals[0]!);
  const record = await readLaunchRecord(recordPath);
  requireRecordApplication(record, cwd);
  if (record.state !== "prepared") throw new CliError(`Launch record is already finalized`);
  if (
    requestedAgentId !== undefined &&
    record.launched !== undefined &&
    requestedAgentId !== record.launched.agentId
  ) {
    throw new CliError(`--agent-id does not match the agent recorded at launch`);
  }
  const agentId = requestedAgentId ?? record.launched?.agentId;
  if (agentId === undefined) {
    throw new CliError(
      `launch complete requires --agent-id <value> when no launched agent is recorded`,
    );
  }
  if (record.execution !== "delegated" || record.harness === "coordinator") {
    throw new CliError(`launch complete requires a delegated run`);
  }
  try {
    validateHarnessIdentity(record.harness, agentId);
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error));
  }
  await utf8(
    record.response.path,
    "Native response",
    status === "completed" || status === "blocked",
  );
  const validatedGrant = validateCapabilityGrant(
    getRoleSpecification(record.role, record.phase),
    record.grant,
  );
  const invocation = roleInvocation({
    harness: record.harness,
    target: completionTarget(record),
    promptPath: record.prompt.path,
    cwd,
    slug: record.work.slug,
    role: record.role,
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
Status: ${finalized.status}; result: ${finalized.result}\n`);
  if (finalized.enforcement === "prompt-guided") {
    out(
      `Warning: ${finalized.harness} capabilities were prompt-guided rather than harness-enforced.\n`,
    );
  }
  const warning = unknownResultWarning(finalized);
  if (warning !== undefined) out(`Warning: ${warning}\n`);
  const unit = await requireWorkUnit(cwd, finalized.work.slug);
  const records = await workRecords(unit);
  out(`Next: ${await completionNextStep(unit, finalized, records)}\n`);
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
  await utf8(
    record.response.path,
    "Simulated response",
    status === "completed" || status === "blocked",
  );
  const finalized = await finalizeSimulation({ recordPath, status });
  const { out } = output(dependencies);
  out(`Simulation finalized: ${recordPath}
Response: ${finalized.response.path}
Executor: coordinator; independent: no
Reason: ${finalized.simulationReason}
Status: ${finalized.status}; result: ${finalized.result}
`);
  const warning = unknownResultWarning(finalized);
  if (warning !== undefined) out(`Warning: ${warning}\n`);
  const unit = await requireWorkUnit(cwd, finalized.work.slug);
  const records = await workRecords(unit);
  out(`Next: ${await completionNextStep(unit, finalized, records)}\n`);
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
  const simulation = prior.execution === "simulated";
  if (simulation && (replacing || selectedHarness !== undefined)) {
    throw new CliError(`A simulation continuation cannot replace an agent or select a harness`);
  }
  if (!simulation && (prior.harness === "coordinator" || prior.agentId === undefined)) {
    throw new CliError(`Delegated continuation requires a recorded agent identity`);
  }
  getRoleSpecification(prior.role, phase);
  const priorGrant = validateCapabilityGrant(
    getRoleSpecification(prior.role, prior.phase),
    prior.grant,
  );
  const harnessId: ExecutionHarness = simulation
    ? "coordinator"
    : harness(selectedHarness ?? prior.harness);
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
      ...(simulation ? { simulationReason: prior.simulationReason } : {}),
      target:
        simulation || replacing
          ? { kind: "fresh" }
          : { kind: "continuation", agentId: prior.agentId! },
      delivery: replacing ? "replacement" : phase === prior.phase ? "delta" : "continuation",
      relationship: {
        kind: simulation ? "simulation-continuation" : replacing ? "replacement" : "continuation",
        recordPath: priorPath,
      },
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

const handbackChecks = ["critic-verdict", "internal-imports", "parallel-router"] as const;
type HandbackCheck = (typeof handbackChecks)[number];
type HandbackAcceptance = Readonly<{ check: HandbackCheck; reason: string; at: string }>;

interface ProductBoundaryChecks {
  readonly internalImports: readonly string[];
  readonly parallelRouters: readonly string[];
}

async function sourceFiles(directory: string): Promise<string[]> {
  try {
    return await walkFiles(
      directory,
      (path) => path.endsWith(".ts") && !/\.(?:test|spec)\.ts$/.test(path),
      {
        enter: (_path, relativePath) =>
          !relativePath.split("/").some((part) => part === "generated" || part === "tests"),
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function productBoundaryChecks(applicationRoot: string): Promise<ProductBoundaryChecks> {
  const files = await sourceFiles(resolve(applicationRoot, "src"));
  const internalImports: string[] = [];
  const parallelRouters: string[] = [];
  for (const path of files) {
    const content = await readFile(path, "utf8");
    const display = posixRelative(applicationRoot, path);
    for (const match of content.matchAll(
      /(?:from\s*|import\s*(?:\(\s*)?|require\s*\()\s*["']([^"']+)["']/g,
    )) {
      const specifier = match[1]!;
      if (
        !specifier.includes("node_modules/") &&
        !specifier.startsWith("dist/") &&
        !specifier.includes("/dist/")
      ) {
        continue;
      }
      const line = content.slice(0, match.index).split("\n").length;
      internalImports.push(`${display}:${line}`);
    }
    // Request routing, not URL parsing: a concept may read `new URL(target).pathname`
    // to validate input without being a router.
    const routesRequests =
      /\breq(?:uest)?\.url\b|\bBun\.serve\s*\(|\bpathname\s*(?:\.match\s*\(|\.startsWith\s*\(|===?\s*["'`])/.test(
        content,
      );
    if (routesRequests && !/["']@mit-sdg\/sync-engine-http(?:[/"'])/.test(content)) {
      parallelRouters.push(display);
    }
  }
  return { internalImports, parallelRouters };
}

function latestCritic(
  records: readonly { readonly path: string; readonly record: LaunchRecord }[],
):
  | { readonly path: string; readonly record: Extract<LaunchRecord, { state: "finalized" }> }
  | undefined {
  return records
    .filter(
      (
        entry,
      ): entry is {
        readonly path: string;
        readonly record: Extract<LaunchRecord, { state: "finalized" }>;
      } => entry.record.state === "finalized" && entry.record.role === "critic",
    )
    .at(-1);
}

async function criticReport(
  records: readonly { readonly path: string; readonly record: LaunchRecord }[],
): Promise<
  | { readonly line: string; readonly unresolved: readonly string[]; readonly blocked: boolean }
  | undefined
> {
  const latest = latestCritic(records);
  if (latest === undefined) return undefined;
  const stem = basename(latest.path).replace(/\.record\.json$/, "");
  const response = await readFile(latest.record.response.path, "utf8");
  const findings =
    /^#{1,4}\s+Findings\s*$([\s\S]*?)(?=^#{1,4}\s+|(?![\s\S]))/im.exec(response)?.[1] ?? "";
  const unresolved = [
    ...new Set(
      findings
        .split("\n")
        .filter((line) => /\b(?:unresolved|regressed)\b/i.test(line))
        .flatMap((line) => line.match(/\b[A-Za-z][A-Za-z0-9]*-\d+\b/g) ?? []),
    ),
  ];
  return {
    line: `Last critic verdict: ${latest.record.result} (${stem})`,
    unresolved,
    blocked: latest.record.result === "revise" || latest.record.result === "blocked",
  };
}

async function readHandback(unit: WorkUnit): Promise<readonly HandbackAcceptance[]> {
  const path = resolve(unit.path, "handback.json");
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as { accepted?: unknown };
    if (!Array.isArray(value.accepted)) throw new Error("accepted must be an array");
    return value.accepted.filter(
      (entry): entry is HandbackAcceptance =>
        typeof entry === "object" &&
        entry !== null &&
        handbackChecks.includes((entry as HandbackAcceptance).check) &&
        typeof (entry as HandbackAcceptance).reason === "string" &&
        typeof (entry as HandbackAcceptance).at === "string",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new CliError(`Handback acceptance is not readable JSON: ${path}`);
  }
}

function parseAcceptances(values: readonly string[], at: Date): HandbackAcceptance[] {
  return values.map((value) => {
    const separator = value.indexOf("=");
    const check = value.slice(0, separator) as HandbackCheck;
    const reason = value.slice(separator + 1).trim();
    if (separator <= 0 || !handbackChecks.includes(check) || reason === "") {
      throw new CliError(
        `--accept must have the form <critic-verdict|internal-imports|parallel-router>=<reason>: ${value}`,
      );
    }
    return { check, reason, at: at.toISOString() };
  });
}

function acceptanceLines(accepted: readonly HandbackAcceptance[]): string {
  return accepted
    .map(({ check, reason }) => `Accepted handback check: ${check} (${reason})`)
    .join("\n");
}

function handbackSummaryLines(
  critic: Awaited<ReturnType<typeof criticReport>>,
  boundaries: ProductBoundaryChecks,
): string[] {
  return [
    critic === undefined ? "Last critic verdict: none" : critic.line,
    ...(critic?.unresolved.length
      ? [`Unresolved critic findings: ${critic.unresolved.join(", ")}`]
      : []),
    `Internal imports: ${boundaries.internalImports.length === 0 ? "clear" : boundaries.internalImports.join(", ")}`,
    `Parallel router: ${boundaries.parallelRouters.length === 0 ? "clear" : boundaries.parallelRouters.join(", ")}`,
  ];
}

async function workShow(args: readonly string[], dependencies: CommandDependencies): Promise<void> {
  const parsed = parseTail(args, "work show", ["slug"], {});
  const unit = await requireWorkUnit(commandRoot(dependencies), parsed.positionals[0]!);
  const brief = await utf8(unit.briefPath, "Work brief");
  const records = await workRecords(unit);
  const policy = await requireConsistentPolicy(unit, records);
  const prepared = records.filter(({ record }) => record.state === "prepared");
  const reviewIssue = await finalReviewIssue(unit, records);
  const critic = await criticReport(records);
  const boundaries = await productBoundaryChecks(unit.applicationRoot);
  const accepted = await readHandback(unit);
  const acceptedChecks = new Set(accepted.map(({ check }) => check));
  const handbackIssues = [
    ...(critic?.blocked && !acceptedChecks.has("critic-verdict") ? ["critic-verdict"] : []),
    ...(boundaries.internalImports.length > 0 && !acceptedChecks.has("internal-imports")
      ? ["internal-imports"]
      : []),
    ...(boundaries.parallelRouters.length > 0 && !acceptedChecks.has("parallel-router")
      ? ["parallel-router"]
      : []),
  ];
  const lines = records.map(({ path, record }) => {
    const name = basename(path);
    const state =
      record.state === "prepared" && record.launched !== undefined
        ? `launched — awaiting ${record.harness}:${record.launched.agentId}`
        : record.state === "prepared"
          ? "prepared — action required"
          : record.status;
    const executor =
      record.execution === "simulated"
        ? `coordinator simulation (${record.simulationReason})`
        : record.state === "finalized"
          ? `${record.harness}:${record.agentId}`
          : record.launched === undefined
            ? record.harness
            : undefined;
    const result = record.state === "finalized" ? `; result ${record.result}` : "";
    return `- ${name.replace(/\.record\.json$/, "")}: ${record.role}/${record.phase}; ${state}${result}${executor === undefined ? "" : `; ${executor}`}`;
  });
  const launched = prepared.filter(({ record }) => record.launched !== undefined);
  const readiness =
    prepared.length > 0
      ? launched.length === prepared.length
        ? `Run launch wait: ${prepared.length} launched run${prepared.length === 1 ? "" : "s"} still awaiting completion.\nHandback readiness: blocked until each prepared record is finalized.`
        : `ACTION REQUIRED: ${prepared.length} unfinished run${prepared.length === 1 ? "" : "s"}.\nHandback readiness: blocked until each prepared record is finalized.`
      : reviewIssue !== undefined
        ? `ACTION REQUIRED: ${reviewIssue}.\nHandback readiness: blocked until critic verification approves the final design.`
        : handbackIssues.length > 0
          ? `ACTION REQUIRED: handback checks require resolution or acceptance: ${handbackIssues.join(", ")}.\nHandback readiness: blocked by handback checks.`
          : "Handback readiness: no unfinished runs; review policy and handback checks are satisfied.";
  const summary = handbackSummaryLines(critic, boundaries).join("\n");
  const acceptedLines = acceptanceLines(accepted);
  output(dependencies)
    .out(`${readiness}\n${summary}${acceptedLines === "" ? "" : `\n${acceptedLines}`}\n\nWork unit: ${unit.slug}
Path: ${unit.path}
Policy: review ${policy.review}; execution ${policy.execution}

${brief.text.trimEnd()}

## Runs
${lines.length === 0 ? "None." : lines.join("\n")}
`);
}

async function workFinish(
  args: readonly string[],
  dependencies: CommandDependencies,
): Promise<void> {
  const parsed = parseTail(args, "work finish", ["slug"], { "--accept": "repeatable" });
  const unit = await requireWorkUnit(commandRoot(dependencies), parsed.positionals[0]!);
  const records = await workRecords(unit);
  await requireConsistentPolicy(unit, records);
  const prepared = records.filter(({ record }) => record.state === "prepared");
  if (prepared.length > 0) {
    throw new CliError(
      `Work item ${unit.slug} has ${prepared.length} unfinished prepared run${prepared.length === 1 ? "" : "s"}`,
      `Finalize each run, then rerun work finish before handback.`,
    );
  }
  const reviewIssue = await finalReviewIssue(unit, records);
  if (reviewIssue !== undefined) {
    throw new CliError(
      `Work item ${unit.slug} cannot finish: ${reviewIssue}`,
      `Continue the critic through verification of the current design, then rerun work finish.`,
    );
  }
  const supplied = parseAcceptances(
    parsed.options.get("--accept") ?? [],
    dependencies.now?.() ?? new Date(),
  );
  const critic = await criticReport(records);
  const boundaries = await productBoundaryChecks(unit.applicationRoot);
  const issues: Array<{ readonly check: HandbackCheck; readonly detail: string }> = [];
  if (critic?.blocked) {
    issues.push({
      check: "critic-verdict",
      detail: `${critic.line}${critic.unresolved.length === 0 ? "" : `\nUnresolved critic findings: ${critic.unresolved.join(", ")}`}`,
    });
  }
  if (boundaries.internalImports.length > 0) {
    issues.push({ check: "internal-imports", detail: boundaries.internalImports.join(", ") });
  }
  if (boundaries.parallelRouters.length > 0) {
    issues.push({ check: "parallel-router", detail: boundaries.parallelRouters.join(", ") });
  }
  const failingChecks = new Set(issues.map(({ check }) => check));
  const applicableSupplied = supplied.filter(({ check }) => failingChecks.has(check));
  const existing = await readHandback(unit);
  const accepted = new Map(existing.map((entry) => [entry.check, entry]));
  for (const entry of applicableSupplied) accepted.set(entry.check, entry);
  const unaccepted = issues.filter(({ check }) => !accepted.has(check));
  if (unaccepted.length > 0) {
    throw new CliError(
      `Work item ${unit.slug} cannot finish:\n${unaccepted
        .map(({ check, detail }) => `${check}\n${detail}`)
        .join("\n")}`,
      unaccepted
        .map(({ check }) => `Resolve ${check} or rerun with --accept ${check}=<reason>.`)
        .join(" "),
    );
  }
  if (applicableSupplied.length > 0) {
    await writeFile(
      resolve(unit.path, "handback.json"),
      `${JSON.stringify({ accepted: [...accepted.values()] }, undefined, 2)}\n`,
      "utf8",
    );
  }
  const acceptedOutput = acceptanceLines([...accepted.values()]);
  const summary = handbackSummaryLines(critic, boundaries).join("\n");
  output(dependencies).out(
    `Work item ${unit.slug} is ready for handback: no unfinished runs; review policy and handback checks are satisfied.\n${summary}${acceptedOutput === "" ? "" : `\n${acceptedOutput}`}\n`,
  );
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
  if (args[0] === "launch" && args[1] === "paseo") return launchPaseo(args.slice(2), dependencies);
  if (args[0] === "launch" && args[1] === "wait") return launchWait(args.slice(2), dependencies);
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
