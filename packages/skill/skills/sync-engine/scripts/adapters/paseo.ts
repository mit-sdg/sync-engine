import type { HarnessAdapterDefinition } from "../harness.ts";

export const paseoAdapter = {
  id: "paseo",
  identity: { kind: "agent-id", label: "Paseo agent ID", stableContinuation: true },
  promptDelivery: { mode: "agent-file-instruction", field: "prompt" },
  cwd: { mode: "explicit-application-cwd", field: "cwd" },
  configurationInheritance: "coordinator-supplied",
  fresh: {
    mechanism: "Paseo native agent delegation",
    operation: "launch fresh agent",
    instruction:
      "Create one fresh Paseo agent with a short instruction to read the generated prompt path.",
  },
  continuation: {
    mechanism: "Paseo native agent delegation",
    operation: "send prompt file to agent",
    instruction: "Send one file-reading continuation instruction to the recorded Paseo agent ID.",
  },
} as const satisfies HarnessAdapterDefinition;
