import { antigravityAdapter } from "./adapters/antigravity.ts";
import { claudeCodeAdapter } from "./adapters/claude-code.ts";
import { codexAdapter } from "./adapters/codex.ts";
import { cursorAdapter } from "./adapters/cursor.ts";
import { paseoAdapter } from "./adapters/paseo.ts";
import { piAdapter } from "./adapters/pi.ts";
import type { EnforcementLevel } from "./records.ts";
import { capabilityCategories, type EffectiveCapabilityGrant } from "./roles.ts";

export const harnessIds = ["paseo", "pi", "codex", "claude-code", "antigravity", "cursor"] as const;
export type HarnessId = (typeof harnessIds)[number];

export function isHarnessId(value: unknown): value is HarnessId {
  return harnessIds.includes(value as HarnessId);
}
export type CapabilitySupport = EnforcementLevel | "unsupported";
export type CapabilitySupportMap = Readonly<
  Record<(typeof capabilityCategories)[number], CapabilitySupport>
>;

/** Current package-owned guides establish prompt guidance, not machine confinement. */
export const promptGuidedCapabilitySupport = Object.freeze(
  Object.fromEntries(capabilityCategories.map((kind) => [kind, "prompt-guided"])),
) as CapabilitySupportMap;

type PromptTransport = {
  readonly mode: "native-prompt-file" | "shell-file-expansion" | "agent-file-instruction";
  readonly field: string;
};

type PromptDelivery = {
  readonly fresh: PromptTransport;
  readonly continuation: PromptTransport;
};

type FreshCwd = {
  readonly mode: "explicit-application-cwd" | "inherit-application-workspace";
  readonly field?: string;
};

type NativeAction = {
  readonly mechanism: string;
  readonly operation: string;
  readonly instruction: string;
};

/** Adapter-authored facts are invocation differences only. */
export interface HarnessAdapterDefinition {
  readonly id: HarnessId;
  readonly identity: {
    readonly kind: "agent-id" | "conversation-id";
    readonly label: string;
    readonly stableContinuation: true;
  };
  readonly promptDelivery: PromptDelivery;
  readonly cwd: FreshCwd;
  readonly configurationInheritance: "native-inheritance" | "coordinator-supplied";
  readonly freshTitleField?: string;
  readonly fresh: NativeAction;
  readonly continuation: NativeAction;
}

export type ConfigurationSelection =
  | { readonly source: "coordinator"; readonly selection: "inherit" }
  | { readonly source: "user"; readonly selection: "override"; readonly value: string };

export interface HarnessConfiguration {
  readonly model: ConfigurationSelection;
  readonly reasoning: ConfigurationSelection;
}

export const inheritedHarnessConfiguration: HarnessConfiguration = Object.freeze({
  model: Object.freeze({ source: "coordinator", selection: "inherit" }),
  reasoning: Object.freeze({ source: "coordinator", selection: "inherit" }),
});

/** Values passed here must come from an explicit conversational user request. */
export function configurationWithUserOverrides(overrides: {
  readonly model?: string;
  readonly reasoning?: string;
}): HarnessConfiguration {
  return {
    model:
      overrides.model === undefined
        ? inheritedHarnessConfiguration.model
        : override(overrides.model),
    reasoning:
      overrides.reasoning === undefined
        ? inheritedHarnessConfiguration.reasoning
        : override(overrides.reasoning),
  };
}

export type LaunchTarget =
  | { readonly kind: "fresh" }
  | { readonly kind: "continuation"; readonly agentId: string };

export interface PrepareHarnessRequest<Capabilities = EffectiveCapabilityGrant> {
  readonly harness: HarnessId;
  readonly target: LaunchTarget;
  readonly promptPath: string;
  readonly cwd: string;
  readonly title: string;
  readonly effectiveCapabilities: Capabilities;
  readonly timeoutSeconds: number;
  readonly configuration?: HarnessConfiguration;
}

export interface PreparedHarnessInvocation<Capabilities = EffectiveCapabilityGrant> {
  readonly harness: HarnessId;
  readonly target: LaunchTarget;
  readonly prompt: {
    readonly path: string;
    readonly delivery: PromptTransport["mode"];
    readonly nativeField: string;
    readonly agentInstruction?: string;
  };
  readonly cwd: {
    readonly path: string;
    readonly behavior: FreshCwd["mode"] | "preserve-agent-workspace";
    readonly nativeField?: string;
  };
  readonly configuration: HarnessConfiguration;
  readonly title: { readonly value: string; readonly nativeField?: string };
  readonly effectiveCapabilities: Capabilities;
  readonly timeoutSeconds: number;
  readonly capabilitySupport: CapabilitySupportMap;
  readonly capabilityEnforcement: EnforcementLevel;
  readonly native: {
    readonly mechanism: string;
    readonly operation: string;
    readonly instruction: string;
  };
}

const definitions = [
  paseoAdapter,
  piAdapter,
  codexAdapter,
  claudeCodeAdapter,
  antigravityAdapter,
  cursorAdapter,
] as const;
const definitionIssues = validateHarnessAdapters(definitions);
if (definitionIssues.length > 0) {
  throw new Error(`Harness adapter conformance failed: ${definitionIssues.join("; ")}`);
}

export const harnessAdapters: readonly HarnessAdapterDefinition[] = definitions;

export function getHarnessAdapter(id: HarnessId): HarnessAdapterDefinition {
  return harnessAdapters.find((adapter) => adapter.id === id)!;
}

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateHarnessIdentity(id: HarnessId, identity: string): string {
  requireText(identity, "agent identity");
  const expected =
    id === "pi" ? uuidV7 : id === "paseo" || id === "antigravity" ? uuidV4 : undefined;
  if (expected !== undefined && !expected.test(identity)) {
    throw new Error(`${identity} is not a valid ${getHarnessAdapter(id).identity.label} for ${id}`);
  }
  return identity;
}

export function recommendHarness(environment: NodeJS.ProcessEnv): {
  readonly harness?: HarnessId;
  readonly outerSupervisor?: "paseo";
  readonly reason: string;
} {
  if (environment["PASEO_AGENT_ID"] !== undefined) {
    return {
      harness: "paseo",
      outerSupervisor: "paseo",
      reason: "detected Paseo-managed coordinator; Paseo retains role ownership and completion",
    };
  }
  if (environment["PI_CODING_AGENT"] === "true" || environment["PI_SESSION_ID"] !== undefined) {
    return {
      harness: "pi",
      reason: "detected native Pi coordinator outside Paseo",
    };
  }
  if (environment["CURSOR_SESSION_ID"] !== undefined) {
    return {
      harness: "cursor",
      reason: "detected native Cursor coordinator",
    };
  }
  return { reason: "no native coordinator harness was detected" };
}

/** Prepare declarative data only; the coordinator performs the native invocation. */
export function prepareHarnessInvocation<Capabilities>(
  request: PrepareHarnessRequest<Capabilities>,
): PreparedHarnessInvocation<Capabilities> {
  const adapter = getHarnessAdapter(request.harness);
  requireText(request.promptPath, "prompt path");
  requireText(request.cwd, "application working directory");
  requireText(request.title, "agent title");
  if (!Number.isSafeInteger(request.timeoutSeconds) || request.timeoutSeconds <= 0) {
    throw new Error("timeoutSeconds must be a positive whole number");
  }
  if (request.target.kind === "continuation") requireText(request.target.agentId, "agent identity");

  const configuration = request.configuration ?? inheritedHarnessConfiguration;
  validateConfiguration(configuration);
  const action = request.target.kind === "fresh" ? adapter.fresh : adapter.continuation;
  const promptTransport =
    request.target.kind === "fresh"
      ? adapter.promptDelivery.fresh
      : adapter.promptDelivery.continuation;
  const capabilityEnforcement = summarizeCapabilitySupport(promptGuidedCapabilitySupport);
  if (capabilityEnforcement === "unsupported") throw new Error("Harness capabilities unsupported");

  const agentInstruction =
    promptTransport.mode === "agent-file-instruction"
      ? `Read and follow the complete assignment in this prompt file:\n${request.promptPath}`
      : undefined;
  const cwdBehavior =
    request.target.kind === "fresh" ? adapter.cwd.mode : "preserve-agent-workspace";

  return {
    harness: adapter.id,
    target: request.target,
    prompt: {
      path: request.promptPath,
      delivery: promptTransport.mode,
      nativeField: promptTransport.field,
      ...(agentInstruction === undefined ? {} : { agentInstruction }),
    },
    cwd: {
      path: request.cwd,
      behavior: cwdBehavior,
      ...(request.target.kind === "fresh" && adapter.cwd.field !== undefined
        ? { nativeField: adapter.cwd.field }
        : {}),
    },
    configuration,
    title: {
      value: request.title,
      ...(request.target.kind === "fresh" && adapter.freshTitleField !== undefined
        ? { nativeField: adapter.freshTitleField }
        : {}),
    },
    effectiveCapabilities: request.effectiveCapabilities,
    timeoutSeconds: request.timeoutSeconds,
    capabilitySupport: promptGuidedCapabilitySupport,
    capabilityEnforcement,
    native: {
      mechanism: action.mechanism,
      operation: action.operation,
      instruction: [
        action.instruction,
        ...(request.target.kind === "fresh" && adapter.freshTitleField !== undefined
          ? [`Set ${adapter.freshTitleField} to ${JSON.stringify(request.title)}.`]
          : []),
        promptTransportInstruction(promptTransport),
        request.target.kind === "fresh"
          ? `Use ${adapter.cwd.mode} at the supplied cwd.`
          : "Preserve the original agent workspace.",
        configurationInstruction(configuration, adapter, request.target),
        request.target.kind === "fresh"
          ? `Capture the new ${adapter.identity.label}.`
          : `Continue the exact ${adapter.identity.label}; never substitute a fresh agent.`,
        request.target.kind === "fresh"
          ? `Observe through the native harness until terminal status or ${request.timeoutSeconds} seconds. If the first attempt fails before any agent identity exists and before the prompt is accepted, retry that exact launch once; otherwise never resend the prompt.`
          : `Observe through the native harness until terminal status or ${request.timeoutSeconds} seconds; harmless status checks are allowed, but never resend the prompt automatically.`,
        promptTransport.mode === "agent-file-instruction"
          ? "Do not inline or rewrite the prompt."
          : "Transmit the generated prompt from its file without reproducing, summarizing, prefixing, or rewriting it in coordinator output.",
      ].join(" "),
    },
  };
}

/** Mixed enforcement is conservatively prompt-guided, never machine-enforced. */
export function summarizeCapabilitySupport(
  support: CapabilitySupportMap,
): EnforcementLevel | "unsupported" {
  const levels = Object.values(support);
  if (levels.includes("unsupported")) return "unsupported";
  return levels.includes("prompt-guided") ? "prompt-guided" : "harness-enforced";
}

/** Static types prove adapter shape; runtime checks prove registry completeness and uniqueness. */
export function validateHarnessAdapters(adapters: readonly HarnessAdapterDefinition[]): string[] {
  const issues: string[] = [];
  const seen = new Set<HarnessId>();
  for (const adapter of adapters) {
    if (seen.has(adapter.id)) issues.push(`${adapter.id}: duplicate id`);
    seen.add(adapter.id);
  }
  for (const id of harnessIds) if (!seen.has(id)) issues.push(`missing adapter ${id}`);
  return issues;
}

function promptTransportInstruction(transport: PromptTransport): string {
  switch (transport.mode) {
    case "native-prompt-file":
      return `Give the generated prompt path to ${transport.field}, which must load that file as the complete native agent message; do not send the path as the message.`;
    case "shell-file-expansion":
      return `Feed the generated prompt file contents directly through ${transport.field} without rendering them into coordinator output; do not send the path as the message.`;
    case "agent-file-instruction":
      return "Give the agent the generated file-reading instruction.";
  }
}

function configurationInstruction(
  configuration: HarnessConfiguration,
  adapter: HarnessAdapterDefinition,
  target: LaunchTarget,
): string {
  return (["model", "reasoning"] as const)
    .map((name) => {
      const selection = configuration[name];
      if (selection.selection === "override") {
        return `Apply user ${name} ${selection.value}, or report unsupported`;
      }
      if (target.kind === "continuation") return `preserve the agent's ${name}`;
      return adapter.configurationInheritance === "native-inheritance"
        ? `inherit coordinator ${name}`
        : `use coordinator-supplied ${name} without provider lookup`;
    })
    .join("; ");
}

function override(value: string): ConfigurationSelection {
  requireText(value, "user configuration override");
  return { source: "user", selection: "override", value };
}

function validateConfiguration(configuration: HarnessConfiguration): void {
  for (const selection of [configuration.model, configuration.reasoning]) {
    if (selection.selection === "inherit" && selection.source === "coordinator") continue;
    if (selection.selection === "override" && selection.source === "user" && text(selection.value))
      continue;
    throw new Error("Invalid model or reasoning selection");
  }
}

function requireText(value: unknown, name: string): asserts value is string {
  if (!text(value)) throw new Error(`${name} cannot be empty`);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}
