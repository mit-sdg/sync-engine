import type { HarnessAdapterDefinition } from "../harness.ts";

export const codexAdapter = {
  id: "codex",
  identity: { kind: "agent-id", label: "Codex subagent thread ID", stableContinuation: true },
  promptDelivery: { mode: "agent-file-instruction", field: "instruction" },
  cwd: { mode: "inherit-application-workspace", field: "coordinator workspace" },
  configurationInheritance: "native-inheritance",
  fresh: {
    mechanism: "Codex subagent",
    operation: "spawn",
    instruction: "Spawn a fresh worker thread, falling back to the general-purpose agent.",
  },
  continuation: {
    mechanism: "Codex subagent",
    operation: "resume",
    instruction: "Resume the recorded Codex subagent thread for one turn.",
  },
} as const satisfies HarnessAdapterDefinition;
