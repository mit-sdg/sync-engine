import type { HarnessAdapterDefinition } from "../harness.ts";

export const antigravityAdapter = {
  id: "antigravity",
  identity: { kind: "conversation-id", label: "conversation ID", stableContinuation: true },
  promptDelivery: { mode: "agent-file-instruction", field: "instruction" },
  cwd: { mode: "inherit-application-workspace", field: "workspace: inherit" },
  configurationInheritance: "native-inheritance",
  fresh: {
    mechanism: "Antigravity invoke_subagent",
    operation: "invoke_subagent",
    instruction: "Invoke one fresh subagent with workspace inherit and return at Idle.",
  },
  continuation: {
    mechanism: "Antigravity subagent conversation",
    operation: "send follow-up",
    instruction: "Continue the recorded conversation for one turn and return at Idle.",
  },
} as const satisfies HarnessAdapterDefinition;
