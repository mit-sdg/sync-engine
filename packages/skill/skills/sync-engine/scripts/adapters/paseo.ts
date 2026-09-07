import type { HarnessAdapterDefinition } from "../harness.ts";

export const paseoAdapter = {
  id: "paseo",
  identity: { kind: "agent-id", label: "Paseo agent ID", stableContinuation: true },
  promptDelivery: {
    fresh: { mode: "agent-file-instruction", field: "the paseo run positional prompt" },
    continuation: { mode: "agent-file-instruction", field: "the paseo send prompt" },
  },
  cwd: { mode: "explicit-application-cwd", field: "cwd" },
  configurationInheritance: "coordinator-supplied",
  freshTitleField: "--title",
  fresh: {
    mechanism: "Paseo CLI",
    operation: "paseo run",
    instruction:
      "Start paseo run in the background with explicit provider and model settings plus the short generated file-reading instruction; record the returned child agent ID and observe it through short wait slices.",
  },
  continuation: {
    mechanism: "Paseo CLI",
    operation: "paseo send",
    instruction:
      "Send the short generated file-reading instruction without waiting to the recorded Paseo agent ID, then observe it through short wait slices.",
  },
} as const satisfies HarnessAdapterDefinition;
