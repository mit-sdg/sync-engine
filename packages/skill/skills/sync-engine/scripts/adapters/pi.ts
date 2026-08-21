import type { HarnessAdapterDefinition } from "../harness.ts";

export const piAdapter = {
  id: "pi",
  identity: { kind: "conversation-id", label: "Pi session ID", stableContinuation: true },
  promptDelivery: {
    fresh: { mode: "shell-file-expansion", field: "the initial message argument" },
    continuation: { mode: "shell-file-expansion", field: "the continuation message argument" },
  },
  cwd: { mode: "explicit-application-cwd", field: "process cwd" },
  configurationInheritance: "coordinator-supplied",
  freshTitleField: "--name",
  fresh: {
    mechanism: "Pi CLI",
    operation: "pi --mode json -p",
    instruction:
      "Start one persistent Pi session in JSON mode with --session-dir <prompt-directory>/pi-sessions, and capture the session header ID and final assistant message.",
  },
  continuation: {
    mechanism: "Pi CLI",
    operation: "pi --mode json -p --session <session-id>",
    instruction:
      "Open the recorded Pi session ID with --session-dir <prompt-directory>/pi-sessions, verify the emitted session header preserves that ID, and capture the final assistant message.",
  },
} as const satisfies HarnessAdapterDefinition;
