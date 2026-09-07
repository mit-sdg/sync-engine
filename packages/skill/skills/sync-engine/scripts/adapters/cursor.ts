import type { HarnessAdapterDefinition } from "../harness.ts";

export const cursorAdapter = {
  id: "cursor",
  identity: { kind: "conversation-id", label: "Cursor session ID", stableContinuation: true },
  promptDelivery: {
    fresh: { mode: "agent-file-instruction", field: "the prompt argument" },
    continuation: { mode: "agent-file-instruction", field: "the resumed prompt argument" },
  },
  cwd: { mode: "explicit-application-cwd", field: "--workspace" },
  configurationInheritance: "coordinator-supplied",
  fresh: {
    mechanism: "Cursor Agent CLI",
    operation: "cursor-agent --print --output-format json",
    instruction:
      "Run Cursor Agent once with --workspace at the application root and capture session_id from its JSON result.",
  },
  continuation: {
    mechanism: "Cursor Agent CLI",
    operation: "cursor-agent --print --output-format json --resume <session-id>",
    instruction: "Resume the recorded Cursor session ID and verify the JSON result preserves it.",
  },
} as const satisfies HarnessAdapterDefinition;
