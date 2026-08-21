import { describe, expect, test } from "vite-plus/test";
import {
  configurationWithUserOverrides,
  harnessAdapters,
  harnessIds,
  inheritedHarnessConfiguration,
  prepareHarnessInvocation,
  promptGuidedCapabilitySupport,
  summarizeCapabilitySupport,
  validateHarnessAdapters,
  type CapabilitySupport,
  type CapabilitySupportMap,
  type HarnessAdapterDefinition,
} from "../skills/sync-engine/scripts/harness.ts";
import { capabilityCategories } from "../skills/sync-engine/scripts/roles.ts";
import { thrownValue } from "./test-support.ts";

const request = {
  promptPath: "/application/.sync-engine/work/example/run.prompt.md",
  cwd: "/application",
  effectiveCapabilities: { read: ["src/**"] },
  timeoutSeconds: 45,
} as const;

describe("harness adapter conformance", () => {
  test("registers every adapter with one shared prompt-guided support map", () => {
    expect(harnessAdapters.map(({ id }) => id)).toEqual(harnessIds);
    expect(validateHarnessAdapters(harnessAdapters)).toEqual([]);
    expect(promptGuidedCapabilitySupport).toEqual(
      Object.fromEntries(capabilityCategories.map((kind) => [kind, "prompt-guided"])),
    );
    expect(summarizeCapabilitySupport(promptGuidedCapabilitySupport)).toBe("prompt-guided");
  });

  test("contains only the documented native differences", () => {
    const [paseo, codex, claude, antigravity, cursor] = harnessAdapters;
    expect(harnessAdapters.map(({ promptDelivery }) => promptDelivery.mode)).toEqual([
      "agent-file-instruction",
      "agent-file-instruction",
      "agent-file-instruction",
      "agent-file-instruction",
      "agent-file-instruction",
    ]);
    expect(harnessAdapters.map(({ cwd }) => cwd.mode)).toEqual([
      "explicit-application-cwd",
      "inherit-application-workspace",
      "inherit-application-workspace",
      "inherit-application-workspace",
      "explicit-application-cwd",
    ]);
    expect({
      paseo: paseo?.fresh.mechanism,
      codex: codex?.fresh.instruction,
      claude: claude?.fresh.mechanism,
      antigravity: antigravity?.fresh.instruction,
      cursorFresh: cursor?.fresh.operation,
      cursorContinuation: cursor?.continuation.operation,
    }).toEqual({
      paseo: "Paseo native agent delegation",
      codex: "Spawn a fresh worker thread, falling back to the general-purpose agent.",
      claude: "Claude Code Agent tool",
      antigravity: "Invoke one fresh subagent with workspace inherit and return at Idle.",
      cursorFresh: "cursor-agent --print --output-format json",
      cursorContinuation: "cursor-agent --print --output-format json --resume <session-id>",
    });
  });

  test("prepares fresh and same-agent continuation requests for every adapter", () => {
    for (const adapter of harnessAdapters) {
      const fresh = prepareHarnessInvocation({
        ...request,
        harness: adapter.id,
        target: { kind: "fresh" },
      });
      const continuation = prepareHarnessInvocation({
        ...request,
        harness: adapter.id,
        target: { kind: "continuation", agentId: "stable-id" },
      });
      expect(fresh.native).toMatchObject({
        mechanism: adapter.fresh.mechanism,
        operation: adapter.fresh.operation,
      });
      const freshConfiguration =
        adapter.configurationInheritance === "native-inheritance"
          ? "inherit coordinator model; inherit coordinator reasoning"
          : "use coordinator-supplied model without provider lookup; use coordinator-supplied reasoning without provider lookup";
      expect(fresh.native.instruction).toBe(
        [
          adapter.fresh.instruction,
          "Give the agent the generated file-reading instruction.",
          `Use ${adapter.cwd.mode} at the supplied cwd.`,
          freshConfiguration,
          `Capture the new ${adapter.identity.label}.`,
          "Wait once through the native harness for at most 45 seconds; do not poll or resend automatically.",
          "Do not inline or rewrite the prompt.",
        ].join(" "),
      );
      expect(fresh.prompt).toMatchObject({
        path: request.promptPath,
        delivery: adapter.promptDelivery.mode,
        nativeField: adapter.promptDelivery.field,
      });
      expect(fresh.cwd).toMatchObject({ path: request.cwd, behavior: adapter.cwd.mode });
      expect(fresh.capabilitySupport).toBe(promptGuidedCapabilitySupport);
      expect(fresh.capabilityEnforcement).toBe("prompt-guided");
      expect(fresh.timeoutSeconds).toBe(45);
      expect(fresh.prompt.agentInstruction === undefined).toBe(
        adapter.promptDelivery.mode === "native-file-input",
      );
      expect(continuation.target).toEqual({ kind: "continuation", agentId: "stable-id" });
      expect(continuation.timeoutSeconds).toBe(45);
      expect(continuation.native.instruction).toBe(
        [
          adapter.continuation.instruction,
          "Give the agent the generated file-reading instruction.",
          "Preserve the original agent workspace.",
          "preserve the agent's model; preserve the agent's reasoning",
          `Continue the exact ${adapter.identity.label}; never substitute a fresh agent.`,
          "Wait once through the native harness for at most 45 seconds; do not poll or resend automatically.",
          "Do not inline or rewrite the prompt.",
        ].join(" "),
      );
      expect(continuation.cwd.behavior).toBe("preserve-agent-workspace");
      expect(adapter.identity.stableContinuation).toBe(true);
    }
  });

  test("rejects non-positive, fractional, and non-finite timeouts", () => {
    for (const timeoutSeconds of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        thrownValue(() =>
          prepareHarnessInvocation({
            ...request,
            timeoutSeconds,
            harness: "paseo",
            target: { kind: "fresh" },
          }),
        ),
      ).toEqual({ name: "Error", message: "timeoutSeconds must be a positive whole number" });
    }
  });

  test("represents inherited and explicit user model/reasoning settings", () => {
    const overrides = configurationWithUserOverrides({
      model: "requested-model",
      reasoning: "high",
    });
    expect(overrides).toEqual({
      model: { source: "user", selection: "override", value: "requested-model" },
      reasoning: { source: "user", selection: "override", value: "high" },
    });
    for (const adapter of harnessAdapters) {
      expect(
        prepareHarnessInvocation({ ...request, harness: adapter.id, target: { kind: "fresh" } })
          .configuration,
      ).toEqual(inheritedHarnessConfiguration);
      expect(
        prepareHarnessInvocation({
          ...request,
          harness: adapter.id,
          target: { kind: "fresh" },
          configuration: overrides,
        }).configuration,
      ).toBe(overrides);
    }
    expect(thrownValue(() => configurationWithUserOverrides({ model: " " }))).toEqual({
      name: "Error",
      message: "user configuration override cannot be empty",
    });
  });

  test("summarizes support conservatively and rejects incomplete adapters", () => {
    const map = (level: CapabilitySupport) =>
      Object.fromEntries(capabilityCategories.map((kind) => [kind, level])) as CapabilitySupportMap;
    expect(summarizeCapabilitySupport(map("harness-enforced"))).toBe("harness-enforced");
    expect(
      summarizeCapabilitySupport({ ...map("harness-enforced"), network: "prompt-guided" }),
    ).toBe("prompt-guided");
    expect(summarizeCapabilitySupport({ ...map("harness-enforced"), network: "unsupported" })).toBe(
      "unsupported",
    );

    const broken = structuredClone(harnessAdapters) as Array<Partial<HarnessAdapterDefinition>>;
    (broken[0]!.identity as { stableContinuation: boolean }).stableContinuation = false;
    delete (broken[1] as { continuation?: unknown }).continuation;
    expect(validateHarnessAdapters(broken)).toEqual([
      "paseo: stable continuation identity is required",
      "codex: incomplete continuation action",
    ]);
  });
});
