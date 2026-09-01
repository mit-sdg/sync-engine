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
      "Inspect the current Paseo agent, then run paseo run in the foreground with its provider, model, and thinking settings plus the short generated file-reading instruction; retain the returned child agent ID and final response.",
  },
  continuation: {
    mechanism: "Paseo CLI",
    operation: "paseo send",
    instruction:
      "Send the short generated file-reading instruction to the recorded Paseo agent ID.",
  },
} as const satisfies HarnessAdapterDefinition;
