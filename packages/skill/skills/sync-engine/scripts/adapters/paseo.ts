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
    instruction: "Run paseo run with the short generated file-reading instruction.",
  },
  continuation: {
    mechanism: "Paseo CLI",
    operation: "paseo send",
    instruction:
      "Send the short generated file-reading instruction to the recorded Paseo agent ID.",
  },
} as const satisfies HarnessAdapterDefinition;
