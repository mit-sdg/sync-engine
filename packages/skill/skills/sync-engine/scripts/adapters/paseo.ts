import type { HarnessAdapterDefinition } from "../harness.ts";

export const paseoAdapter = {
  id: "paseo",
  identity: { kind: "agent-id", label: "Paseo agent ID", stableContinuation: true },
  promptDelivery: {
    fresh: { mode: "shell-file-expansion", field: "the paseo run positional prompt" },
    continuation: { mode: "native-prompt-file", field: "paseo send --prompt-file" },
  },
  cwd: { mode: "explicit-application-cwd", field: "cwd" },
  configurationInheritance: "coordinator-supplied",
  freshTitleField: "--title",
  fresh: {
    mechanism: "Paseo CLI",
    operation: "paseo run with file-backed positional prompt",
    instruction:
      "Run paseo run with its positional prompt populated directly from the generated prompt file.",
  },
  continuation: {
    mechanism: "Paseo CLI",
    operation: "paseo send --prompt-file",
    instruction:
      "Run paseo send --prompt-file once for the recorded Paseo agent ID and generated prompt path.",
  },
} as const satisfies HarnessAdapterDefinition;
