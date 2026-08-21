import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import {
  canonical,
  type LaunchRecord,
  portableSettledStatus,
  readLaunchRecords,
  readPromptContext,
  requireInsideWorkspace,
  requireReviewPass,
  reserveWorkspacePath,
  responseContract,
  verifiedRecords,
  writeLaunchRecord,
} from "./workspace.ts";

export const nativeHarnesses = ["codex", "claude-code", "antigravity"] as const;
export type NativeHarness = (typeof nativeHarnesses)[number];

export interface LaunchTicket {
  readonly format: "sync-engine.skill.launch-ticket";
  readonly version: 1;
  readonly role: string;
  readonly mode?: "map" | "contract";
  readonly toolPolicy?: string;
  readonly continuationAgentId?: string;
  readonly harness: NativeHarness;
  readonly cwd: string;
  readonly prompt: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly responsePath: string;
  readonly briefSha256?: string;
  readonly designDigest?: string;
  readonly reviewPass?: number;
  readonly mapRows?: readonly string[];
  readonly placementIds?: readonly string[];
  readonly obligationIds?: readonly string[];
  readonly userOverride?: true;
  readonly preparedAt: string;
}

export class NativeLaunchError extends Error {
  override readonly name = "NativeLaunchError";
}

function isLaunchTicket(value: unknown): value is LaunchTicket {
  const ticket = value as LaunchTicket | undefined;
  return (
    typeof ticket === "object" &&
    ticket !== null &&
    ticket.format === "sync-engine.skill.launch-ticket" &&
    ticket.version === 1 &&
    typeof ticket.role === "string" &&
    (ticket.mode === undefined || ticket.mode === "map" || ticket.mode === "contract") &&
    (ticket.toolPolicy === undefined || typeof ticket.toolPolicy === "string") &&
    (ticket.continuationAgentId === undefined ||
      (typeof ticket.continuationAgentId === "string" && ticket.continuationAgentId !== "")) &&
    nativeHarnesses.includes(ticket.harness) &&
    typeof ticket.cwd === "string" &&
    typeof ticket.prompt?.path === "string" &&
    typeof ticket.prompt.sha256 === "string" &&
    typeof ticket.prompt.bytes === "number" &&
    typeof ticket.responsePath === "string" &&
    (ticket.reviewPass === undefined ||
      (Number.isSafeInteger(ticket.reviewPass) && ticket.reviewPass > 0)) &&
    typeof ticket.preparedAt === "string"
  );
}

async function promptBytes(path: string): Promise<{ content: string; sha256: string }> {
  const content = await readFile(path, "utf8");
  return { content, sha256: createHash("sha256").update(content).digest("hex") };
}

export interface PrepareNativeLaunchOptions {
  readonly role: string;
  readonly harness: NativeHarness;
  readonly promptPath: string;
  readonly applicationRoot: string;
  readonly continuationAgentId?: string;
}

export interface PreparedNativeLaunch {
  readonly ticketPath: string;
  readonly responsePath: string;
  readonly ticket: LaunchTicket;
}

/**
 * Bind a compiler-built prompt to one future native delegation. The compiler cannot call
 * another harness's in-session agent tool, so the coordinator performs that one action.
 */
export async function prepareNativeLaunch(
  options: PrepareNativeLaunchOptions,
): Promise<PreparedNativeLaunch> {
  const promptPath = requireInsideWorkspace(options.promptPath, options.applicationRoot);
  const prompt = await promptBytes(promptPath);
  const context = await readPromptContext(promptPath);
  if (context === undefined) {
    throw new NativeLaunchError(
      `Native launch requires a prompt written by prompt build: ${promptPath}`,
    );
  }
  if (context.role !== options.role) {
    throw new NativeLaunchError(
      `Prompt belongs to role ${context.role}, not requested role ${options.role}`,
    );
  }
  if (context.sha256 !== prompt.sha256) {
    throw new NativeLaunchError(`Prompt changed after prompt build: ${promptPath}`);
  }

  const applicationRoot = canonical(options.applicationRoot);
  if (options.role === "critic") {
    if (
      context.mode === undefined ||
      context.briefSha256 === undefined ||
      context.reviewPass === undefined
    ) {
      throw new NativeLaunchError(`Critic prompt has no compiler-bound review pass`);
    }
    await requireReviewPass(
      context.mode,
      context.briefSha256,
      context.reviewPass,
      applicationRoot,
      context.userOverride === true,
    );
  }
  const contractDesigner = options.role === "designer" && context.mode === "contract";
  if (!contractDesigner && options.continuationAgentId !== undefined) {
    throw new NativeLaunchError(`Only the designer contract phase may continue an existing agent`);
  }
  if (
    contractDesigner &&
    options.continuationAgentId === undefined &&
    context.userOverride !== true
  ) {
    throw new NativeLaunchError(`Designer contract launch requires its map designer agent ID`);
  }
  if (options.continuationAgentId !== undefined) {
    const originals = await verifiedRecords("designer", applicationRoot, undefined, "map");
    if (
      !originals.some(
        (entry) =>
          entry.record.agentId === options.continuationAgentId &&
          entry.record.harness === options.harness &&
          entry.record.briefSha256 === context.briefSha256,
      )
    ) {
      throw new NativeLaunchError(
        `Agent ${options.continuationAgentId} has no settled map-designer record for this brief`,
      );
    }
  }
  const responsePath = await reserveWorkspacePath("response", options.role, applicationRoot);
  await writeFile(responsePath, "", { encoding: "utf8", flag: "wx" });
  const ticket: LaunchTicket = {
    format: "sync-engine.skill.launch-ticket",
    version: 1,
    role: options.role,
    ...(context.mode === undefined ? {} : { mode: context.mode }),
    ...(context.toolPolicy === undefined ? {} : { toolPolicy: context.toolPolicy }),
    ...(options.continuationAgentId === undefined
      ? {}
      : { continuationAgentId: options.continuationAgentId }),
    harness: options.harness,
    cwd: applicationRoot,
    prompt: {
      path: promptPath,
      sha256: prompt.sha256,
      bytes: Buffer.byteLength(prompt.content, "utf8"),
    },
    responsePath,
    ...(context.briefSha256 === undefined ? {} : { briefSha256: context.briefSha256 }),
    ...(context.designDigest === undefined ? {} : { designDigest: context.designDigest }),
    ...(context.reviewPass === undefined ? {} : { reviewPass: context.reviewPass }),
    ...(context.mapRows === undefined ? {} : { mapRows: context.mapRows }),
    ...(context.placementIds === undefined ? {} : { placementIds: context.placementIds }),
    ...(context.obligationIds === undefined ? {} : { obligationIds: context.obligationIds }),
    ...(context.userOverride === true ? { userOverride: true } : {}),
    preparedAt: new Date().toISOString(),
  };
  const ticketPath = await reserveWorkspacePath("ticket", options.role, applicationRoot);
  await writeFile(ticketPath, `${JSON.stringify(ticket, undefined, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  return { ticketPath, responsePath, ticket };
}

export interface CompleteNativeLaunchOptions {
  readonly ticketPath: string;
  readonly agentId: string;
  readonly applicationRoot: string;
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
}

export interface CompletedNativeLaunch {
  readonly recordPath: string;
  readonly record: LaunchRecord;
}

/** Validate the native role's captured return and write the launch record exactly once. */
export async function completeNativeLaunch(
  options: CompleteNativeLaunchOptions,
): Promise<CompletedNativeLaunch> {
  const ticketPath = requireInsideWorkspace(options.ticketPath, options.applicationRoot);
  const ticketBytes = await readFile(ticketPath, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(ticketBytes);
  } catch {
    throw new NativeLaunchError(`Launch ticket is not readable JSON: ${ticketPath}`);
  }
  if (!isLaunchTicket(value))
    throw new NativeLaunchError(`Launch ticket is malformed: ${ticketPath}`);
  const ticket = value;
  if (canonical(ticket.cwd) !== canonical(options.applicationRoot)) {
    throw new NativeLaunchError(`Launch ticket belongs to another application: ${ticket.cwd}`);
  }
  if (options.agentId.trim() === "") throw new NativeLaunchError(`--agent-id cannot be empty`);
  if (ticket.continuationAgentId !== undefined && ticket.continuationAgentId !== options.agentId) {
    throw new NativeLaunchError(
      `Continuation ticket requires agent ${ticket.continuationAgentId}, not ${options.agentId}`,
    );
  }

  for (const entry of await readLaunchRecords(options.applicationRoot)) {
    if (entry.record.launchTicket?.path === ticketPath) {
      throw new NativeLaunchError(`Launch ticket was already completed: ${ticketPath}`);
    }
  }

  const promptPath = requireInsideWorkspace(ticket.prompt.path, options.applicationRoot);
  const prompt = await promptBytes(promptPath);
  const context = await readPromptContext(promptPath);
  if (
    prompt.sha256 !== ticket.prompt.sha256 ||
    context?.sha256 !== ticket.prompt.sha256 ||
    context?.role !== ticket.role ||
    context?.mode !== ticket.mode ||
    context?.toolPolicy !== ticket.toolPolicy ||
    context?.briefSha256 !== ticket.briefSha256 ||
    context?.designDigest !== ticket.designDigest ||
    context?.reviewPass !== ticket.reviewPass ||
    context?.userOverride !== ticket.userOverride ||
    JSON.stringify(context?.mapRows) !== JSON.stringify(ticket.mapRows) ||
    JSON.stringify(context?.placementIds) !== JSON.stringify(ticket.placementIds) ||
    JSON.stringify(context?.obligationIds) !== JSON.stringify(ticket.obligationIds) ||
    Buffer.byteLength(prompt.content, "utf8") !== ticket.prompt.bytes
  ) {
    throw new NativeLaunchError(`Prompt or role changed after launch preparation: ${promptPath}`);
  }
  if (ticket.role === "critic") {
    if (
      ticket.mode === undefined ||
      ticket.briefSha256 === undefined ||
      ticket.reviewPass === undefined
    ) {
      throw new NativeLaunchError(`Critic ticket has no compiler-bound review pass`);
    }
    await requireReviewPass(
      ticket.mode,
      ticket.briefSha256,
      ticket.reviewPass,
      options.applicationRoot,
      ticket.userOverride === true,
    );
  }
  const responsePath = requireInsideWorkspace(ticket.responsePath, options.applicationRoot);
  const response = await readFile(responsePath, "utf8");
  if (response.trim() === "") {
    throw new NativeLaunchError(
      `Native agent return is empty; copy its final response verbatim into ${responsePath}`,
    );
  }
  const violation = responseContract(ticket.role, response, ticket.mode, {
    mapRows: ticket.mapRows,
    placementIds: ticket.placementIds,
    obligationIds: ticket.obligationIds,
  });
  const record: LaunchRecord = {
    format: "sync-engine.skill.launch-record",
    version: 1,
    role: ticket.role,
    ...(ticket.mode === undefined ? {} : { mode: ticket.mode }),
    ...(ticket.toolPolicy === undefined ? {} : { toolPolicy: ticket.toolPolicy }),
    agentId: options.agentId,
    harness: ticket.harness,
    attestation: "coordinator",
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    ...(options.model === undefined ? {} : { model: options.model }),
    ...(options.thinking === undefined ? {} : { thinking: options.thinking }),
    cwd: ticket.cwd,
    prompt: ticket.prompt,
    ...(ticket.briefSha256 === undefined ? {} : { briefSha256: ticket.briefSha256 }),
    ...(ticket.designDigest === undefined ? {} : { designDigest: ticket.designDigest }),
    ...(ticket.reviewPass === undefined ? {} : { reviewPass: ticket.reviewPass }),
    ...(ticket.mapRows === undefined ? {} : { mapRows: ticket.mapRows }),
    ...(ticket.placementIds === undefined ? {} : { placementIds: ticket.placementIds }),
    ...(ticket.obligationIds === undefined ? {} : { obligationIds: ticket.obligationIds }),
    ...(ticket.userOverride === true ? { userOverride: true } : {}),
    startedAt: ticket.preparedAt,
    settledAt: new Date().toISOString(),
    status: portableSettledStatus,
    launchTicket: {
      path: ticketPath,
      sha256: createHash("sha256").update(ticketBytes).digest("hex"),
    },
    response: {
      path: responsePath,
      sha256: createHash("sha256").update(response).digest("hex"),
      bytes: Buffer.byteLength(response, "utf8"),
      contract: violation === undefined ? "met" : "violated",
    },
    readAudit: "unavailable",
  };
  const recordPath = await reserveWorkspacePath("launch", ticket.role, options.applicationRoot);
  await writeLaunchRecord(recordPath, record);
  if (violation !== undefined) {
    throw new NativeLaunchError(
      `Native ${ticket.role} did not return what its prompt requires: ${violation}. Its reply is at ${responsePath}; the record does not count this role as run.`,
    );
  }
  return { recordPath, record };
}
