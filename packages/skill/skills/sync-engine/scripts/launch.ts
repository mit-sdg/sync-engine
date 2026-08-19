import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  canonical,
  type LaunchRecord,
  finishedStatuses,
  requireInsideWorkspace,
  resumableStatus,
  readPromptContext,
  readAudit,
  reserveWorkspacePath,
  responseContract,
  settledStatus,
  writeLaunchRecord,
} from "./workspace.ts";

/** The single harness this skill drives today; other harnesses get their own module. */
export const harness = "paseo";

/** How many times a role that ended in error is asked to continue before the launch fails. */
const maxResumes = 2;

/** Grace before treating a reported error as the role's own, rather than a passing fault. */
const gracePauseMilliseconds = 30_000;

const resumeRequest =
  "Your last turn ended in a harness or provider error, not a workflow decision. Your " +
  "assignment is unchanged: continue it from where it stopped, do not restart it, and do " +
  "not ask for confirmation.";

const standby =
  "Wait for a file-delivered assignment. Do not inspect files, modify files, or begin work.";

export class LaunchError extends Error {
  override readonly name = "LaunchError";
}

interface InspectedAgent {
  readonly Id: string;
  readonly Provider: string;
  readonly Model: string;
  readonly Thinking?: string;
  readonly Status: string;
  readonly Cwd: string;
  readonly ParentAgentId?: string | null;
}

interface ModelOption {
  readonly id: string;
  readonly defaultThinkingOptionId?: string | null;
  readonly thinkingOptionIds?: readonly string[];
}

function paseo(args: readonly string[], timeoutSeconds?: number): string {
  try {
    return execFileSync("paseo", [...args], {
      encoding: "utf8",
      timeout: timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { stderr?: string; status?: number };
    if (failure.code === "ENOENT") {
      throw new LaunchError(`This skill launches roles through ${harness}; its CLI is not on PATH`);
    }
    const detail = (failure.stderr ?? failure.message ?? "").trim();
    throw new LaunchError(`paseo ${args[0]} failed: ${detail}`);
  }
}

function parse<T>(output: string, what: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new LaunchError(`Cannot read ${what} as JSON from paseo`);
  }
}

function inspectAgent(id: string): InspectedAgent {
  const agent = parse<InspectedAgent>(paseo(["inspect", id, "--json"]), `agent ${id}`);
  if (typeof agent.Id !== "string" || typeof agent.Provider !== "string") {
    throw new LaunchError(`paseo inspect ${id} returned no agent identity`);
  }
  return agent;
}

/**
 * A role reasons like its coordinator: the user chose that setting for this work, and a
 * role reasoning less well than the agent delegating to it is the wrong default. An
 * explicit request wins, and a model advertising no options gets none.
 */
function childThinking(
  provider: string,
  model: string,
  coordinatorThinking: string | undefined,
  requested: string | undefined,
): string | undefined {
  const models = parse<readonly ModelOption[]>(
    paseo(["provider", "models", provider, "--json"]),
    `models for ${provider}`,
  );
  const found = models.find((option) => option.id === model);
  if (found === undefined) {
    throw new LaunchError(`Provider ${provider} does not advertise model ${model}`);
  }
  const advertised = found.thinkingOptionIds ?? [];
  if (advertised.length === 0) {
    if (requested !== undefined) {
      throw new LaunchError(`Model ${model} advertises no reasoning options`);
    }
    return undefined;
  }
  if (requested !== undefined) {
    if (!advertised.includes(requested)) {
      throw new LaunchError(
        `Model ${model} does not advertise reasoning ${requested}; it offers ${advertised.join(", ")}`,
      );
    }
    return requested;
  }
  if (coordinatorThinking !== undefined && advertised.includes(coordinatorThinking)) {
    return coordinatorThinking;
  }
  return found.defaultThinkingOptionId ?? undefined;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resume) => setTimeout(resume, milliseconds));
}

/**
 * `paseo wait` returns on any transition to not-running, including an agent that merely
 * stopped to ask permission, so one wait is not proof the role finished. Wait again until
 * the agent reaches a status it never leaves or the caller's deadline passes.
 */
async function waitUntilSettled(agentId: string, timeoutSeconds: number): Promise<InspectedAgent> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let agent = inspectAgent(agentId);
  while (!finishedStatuses.includes(agent.Status)) {
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining <= 0) return agent;
    paseo(["wait", agentId, "--timeout", String(remaining)], remaining + 30);
    agent = inspectAgent(agentId);
    if (finishedStatuses.includes(agent.Status)) break;
    await pause(2000);
  }
  return agent;
}

export interface LaunchOptions {
  readonly role: string;
  readonly promptPath: string;
  readonly applicationRoot: string;
  readonly timeoutSeconds: number;
  readonly thinking?: string;
  readonly coordinatorId?: string;
}

export interface LaunchResult {
  readonly recordPath: string;
  readonly record: LaunchRecord;
}

/** The role's last message, read from the harness: nothing is asked of the agent. */
/**
 * Paths the role opened, as the harness reports them; the agent is not asked. A harness
 * that names its tools without their arguments cannot be audited, and reporting that as no
 * violation would attest what was never seen.
 */
function readPaths(agentId: string): { readonly observed: boolean; readonly paths: string[] } {
  let output: string;
  try {
    output = paseo(["logs", agentId, "--filter", "tools"]);
  } catch {
    return { observed: false, paths: [] };
  }
  const paths = [...output.matchAll(/^\[(?:Read|Write|Edit)\]\s+(\S+)/gm)]
    .map((match) => match[1]!)
    .filter((candidate) => candidate.includes("/"));
  if (paths.length > 0) return { observed: true, paths };
  return { observed: !/^\[(?:Read|Write|Edit)\]/m.test(output), paths: [] };
}

function finalResponse(agentId: string): string {
  try {
    return paseo(["logs", agentId, "--filter", "text", "--tail", "1"]);
  } catch {
    return "";
  }
}

/**
 * Launch one fresh role agent, deliver its prompt as a file, wait for it, and record what
 * the harness attests. The record — not the coordinator's account — is the evidence that
 * the role ran.
 */
export async function launchRole(options: LaunchOptions): Promise<LaunchResult> {
  const promptPath = requireInsideWorkspace(options.promptPath, options.applicationRoot);
  const content = await readFile(promptPath, "utf8");
  const sha256 = createHash("sha256").update(content).digest("hex");

  const coordinatorId = options.coordinatorId ?? process.env["PASEO_AGENT_ID"];
  if (coordinatorId === undefined || coordinatorId === "") {
    throw new LaunchError(
      `PASEO_AGENT_ID is unset; run the workflow inside a ${harness} agent so roles inherit its provider and model`,
    );
  }
  const coordinator = inspectAgent(coordinatorId);
  const applicationRoot = canonical(options.applicationRoot);
  const thinking = childThinking(
    coordinator.Provider,
    coordinator.Model,
    coordinator.Thinking,
    options.thinking,
  );

  const placement =
    canonical(coordinator.Cwd) === applicationRoot
      ? ["--cwd", applicationRoot]
      : [
          "--workspace",
          parse<{ workspaceId: string }>(
            paseo([
              "workspace",
              "create",
              "--isolation",
              "local",
              "--path",
              applicationRoot,
              "--json",
            ]),
            "workspace",
          ).workspaceId,
        ];

  const startedAt = new Date().toISOString();
  const started = parse<{ agentId: string }>(
    paseo([
      "run",
      "--provider",
      coordinator.Provider,
      "--model",
      coordinator.Model,
      ...(thinking === undefined ? [] : ["--thinking", thinking]),
      ...placement,
      "--background",
      "--json",
      "--title",
      options.role,
      standby,
    ]),
    "launched agent",
  );
  if (typeof started.agentId !== "string") throw new LaunchError(`paseo run returned no agent id`);

  const child = inspectAgent(started.agentId);
  const mismatches = [
    ...(child.Provider === coordinator.Provider ? [] : [`provider ${child.Provider}`]),
    ...(child.Model === coordinator.Model ? [] : [`model ${child.Model}`]),
    ...(thinking === undefined || child.Thinking === thinking
      ? []
      : [`thinking ${child.Thinking}`]),
    ...(canonical(child.Cwd) === applicationRoot ? [] : [`working directory ${child.Cwd}`]),
  ];
  if (mismatches.length > 0) {
    paseo(["stop", started.agentId]);
    throw new LaunchError(
      `Launched ${options.role} does not match the coordinator: ${mismatches.join(", ")}`,
    );
  }

  paseo(["send", started.agentId, "--prompt-file", promptPath, "--no-wait"]);
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let settled = await waitUntilSettled(started.agentId, options.timeoutSeconds);
  let resumes = 0;
  while (settled.Status === resumableStatus && resumes < maxResumes) {
    if (Date.now() >= deadline) break;
    // A reported error can clear itself; look again before speaking to the role.
    await pause(gracePauseMilliseconds);
    settled = inspectAgent(started.agentId);
    if (settled.Status !== resumableStatus) continue;
    const remaining = Math.ceil((deadline - Date.now()) / 1000);
    if (remaining <= 0) break;
    resumes += 1;
    paseo(["send", started.agentId, resumeRequest, "--no-wait"]);
    settled = await waitUntilSettled(started.agentId, remaining);
  }

  const response = finalResponse(started.agentId);
  const responsePath = await reserveWorkspacePath(
    "response",
    options.role,
    options.applicationRoot,
  );
  await writeFile(responsePath, response, "utf8");
  const violation = responseContract(options.role, response);
  const opened = readPaths(started.agentId);
  const readViolations = readAudit(options.role, opened.paths);

  const context = await readPromptContext(promptPath);
  const record: LaunchRecord = {
    format: "sync-engine.skill.launch-record",
    version: 1,
    role: options.role,
    agentId: started.agentId,
    ...(typeof child.ParentAgentId === "string" ? { parentAgentId: child.ParentAgentId } : {}),
    provider: child.Provider,
    model: child.Model,
    ...(thinking === undefined ? {} : { thinking }),
    cwd: applicationRoot,
    prompt: { path: promptPath, sha256, bytes: Buffer.byteLength(content, "utf8") },
    ...(context?.briefSha256 === undefined ? {} : { briefSha256: context.briefSha256 }),
    ...(context?.designDigest === undefined ? {} : { designDigest: context.designDigest }),
    startedAt,
    settledAt: new Date().toISOString(),
    status: settled.Status,
    ...(resumes === 0 ? {} : { resumes }),
    response: {
      path: responsePath,
      sha256: createHash("sha256").update(response).digest("hex"),
      bytes: Buffer.byteLength(response, "utf8"),
      contract: violation === undefined ? "met" : "violated",
    },
    ...(readViolations.length === 0 ? {} : { readViolations }),
    ...(opened.observed ? {} : { readAudit: "unavailable" as const }),
  };
  const recordPath = await reserveWorkspacePath("launch", options.role, options.applicationRoot);
  await writeLaunchRecord(recordPath, record);
  if (settled.Status !== settledStatus) {
    throw new LaunchError(
      `Launched ${options.role} ended ${settled.Status}, not ${settledStatus}, after ${resumes} resume attempts; the record does not count this role as run`,
    );
  }
  if (readViolations.length > 0) {
    throw new LaunchError(
      `Launched ${options.role} read outside its boundary: ${readViolations.join(", ")}. The record does not count this role as run.`,
    );
  }
  if (violation !== undefined) {
    throw new LaunchError(
      `Launched ${options.role} did not return what its prompt requires: ${violation}. Its reply is at ${responsePath}; the record does not count this role as run.`,
    );
  }
  return { recordPath, record };
}

/** Whether the harness still knows this agent, which a hand-written record cannot fake. */
export function agentExists(agentId: string): boolean {
  try {
    return inspectAgent(agentId).Id === agentId;
  } catch {
    return false;
  }
}
