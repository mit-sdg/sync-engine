import type { HarnessAdapterDefinition } from "../harness.ts";

export const claudeCodeAdapter = {
  id: "claude-code",
  identity: { kind: "agent-id", label: "Claude Code agent ID", stableContinuation: true },
  promptDelivery: {
    fresh: { mode: "agent-file-instruction", field: "prompt" },
    continuation: { mode: "agent-file-instruction", field: "prompt" },
  },
  cwd: { mode: "inherit-application-workspace", field: "coordinator workspace" },
  configurationInheritance: "native-inheritance",
  fresh: {
    mechanism: "Claude Code Agent tool",
    operation: "invoke",
    instruction: "Invoke one fresh general-purpose Agent without worktree isolation.",
  },
  continuation: {
    mechanism: "Claude Code Agent tool",
    operation: "resume",
    instruction: "Resume the recorded Claude Code agent ID for one turn.",
  },
} as const satisfies HarnessAdapterDefinition;
