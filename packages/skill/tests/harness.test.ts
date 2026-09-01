import { describe, expect, test } from "vite-plus/test";
import {
  configurationWithUserOverrides,
  harnessAdapters,
  harnessIds,
  inheritedHarnessConfiguration,
  prepareHarnessInvocation,
  promptGuidedCapabilitySupport,
  recommendHarness,
  summarizeCapabilitySupport,
  validateHarnessAdapters,
  validateHarnessIdentity,
  type CapabilitySupport,
  type CapabilitySupportMap,
  type HarnessAdapterDefinition,
} from "../skills/sync-engine/scripts/harness.ts";
import { capabilityCategories } from "../skills/sync-engine/scripts/roles.ts";
import { thrownValue } from "./test-support.ts";

const request = {
  promptPath: "/application/.sync-engine/work/example/run.prompt.md",
  cwd: "/application",
  title: "example — Evidence Worker",
  effectiveCapabilities: { read: ["src/**"] },
  timeoutSeconds: 45,
} as const;

type TestTransport = HarnessAdapterDefinition["promptDelivery"]["fresh"];

function transportInstruction(transport: TestTransport): string {
  switch (transport.mode) {
    case "native-prompt-file":
      return `Give the generated prompt path to ${transport.field}, which must load that file as the complete native agent message; do not send the path as the message.`;
    case "shell-file-expansion":
      return `Feed the generated prompt file contents directly through ${transport.field} without rendering them into coordinator output; do not send the path as the message.`;
    case "agent-file-instruction":
      return "Give the agent the generated file-reading instruction.";
  }
}

function transportClosing(transport: TestTransport): string {
  return transport.mode === "agent-file-instruction"
    ? "Do not inline or rewrite the prompt."
    : "Transmit the generated prompt from its file without reproducing, summarizing, prefixing, or rewriting it in coordinator output.";
}

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
    const [paseo, pi, codex, claude, antigravity, cursor] = harnessAdapters;
    expect(
      harnessAdapters.map(({ promptDelivery }) => [
        promptDelivery.fresh.mode,
        promptDelivery.continuation.mode,
      ]),
    ).toEqual(harnessAdapters.map(() => ["agent-file-instruction", "agent-file-instruction"]));
    expect(harnessAdapters.map(({ cwd }) => cwd.mode)).toEqual([
      "explicit-application-cwd",
      "explicit-application-cwd",
      "inherit-application-workspace",
      "inherit-application-workspace",
      "inherit-application-workspace",
      "explicit-application-cwd",
    ]);
    expect({
      paseo: paseo?.fresh.mechanism,
      paseoTitle: paseo?.freshTitleField,
      piFresh: pi?.fresh.operation,
      piContinuation: pi?.continuation.operation,
      piTitle: pi?.freshTitleField,
      codex: codex?.fresh.instruction,
      claude: claude?.fresh.mechanism,
      claudeTitle: claude?.freshTitleField,
      antigravity: antigravity?.fresh.instruction,
      cursorFresh: cursor?.fresh.operation,
      cursorContinuation: cursor?.continuation.operation,
    }).toEqual({
      paseo: "Paseo CLI",
      paseoTitle: "--title",
      piFresh: "pi --mode json -p",
      piContinuation: "pi --mode json -p --session <session-id>",
      piTitle: "--name",
      codex: "Spawn a fresh worker thread, falling back to the general-purpose agent.",
      claude: "Claude Code Agent tool",
      claudeTitle: "description",
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
      const freshTransport = adapter.promptDelivery.fresh;
      expect(fresh.native.instruction).toBe(
        [
          adapter.fresh.instruction,
          ...(adapter.freshTitleField === undefined
            ? []
            : [`Set ${adapter.freshTitleField} to ${JSON.stringify(request.title)}.`]),
          transportInstruction(freshTransport),
          `Use ${adapter.cwd.mode} at the supplied cwd.`,
          freshConfiguration,
          `Capture the new ${adapter.identity.label}.`,
          "Observe through the native harness until terminal status or 45 seconds. If the first attempt fails before any agent identity exists and before the prompt is accepted, retry that exact launch once; otherwise never resend the prompt.",
          transportClosing(freshTransport),
        ].join(" "),
      );
      expect(fresh.title).toEqual({
        value: request.title,
        ...(adapter.freshTitleField === undefined ? {} : { nativeField: adapter.freshTitleField }),
      });
      expect(fresh.prompt).toMatchObject({
        path: request.promptPath,
        delivery: freshTransport.mode,
        nativeField: freshTransport.field,
      });
      expect(fresh.cwd).toMatchObject({ path: request.cwd, behavior: adapter.cwd.mode });
      expect(fresh.capabilitySupport).toBe(promptGuidedCapabilitySupport);
      expect(fresh.capabilityEnforcement).toBe("prompt-guided");
      expect(fresh.timeoutSeconds).toBe(45);
      expect(fresh.prompt.agentInstruction).toBe(
        freshTransport.mode === "agent-file-instruction"
          ? `Read and follow the complete assignment in this prompt file:\n${request.promptPath}`
          : undefined,
      );
      expect(continuation.target).toEqual({ kind: "continuation", agentId: "stable-id" });
      expect(continuation.title).toEqual({ value: request.title });
      expect(continuation.timeoutSeconds).toBe(45);
      const continuationTransport = adapter.promptDelivery.continuation;
      expect(continuation.native.instruction).toBe(
        [
          adapter.continuation.instruction,
          transportInstruction(continuationTransport),
          "Preserve the original agent workspace.",
          "preserve the agent's model; preserve the agent's reasoning",
          `Continue the exact ${adapter.identity.label}; never substitute a fresh agent.`,
          "Observe through the native harness until terminal status or 45 seconds; harmless status checks are allowed, but never resend the prompt automatically.",
          transportClosing(continuationTransport),
        ].join(" "),
      );
      expect(continuation.prompt).toMatchObject({
        path: request.promptPath,
        delivery: continuationTransport.mode,
        nativeField: continuationTransport.field,
      });
      expect(continuation.cwd.behavior).toBe("preserve-agent-workspace");
      expect(adapter.identity.stableContinuation).toBe(true);
    }
  });

  test("distinguishes native harness identity forms and outer supervision", () => {
    expect(validateHarnessIdentity("pi", "01a05c1f-e5d2-7c92-9a6d-e6883393f526")).toBe(
      "01a05c1f-e5d2-7c92-9a6d-e6883393f526",
    );
    expect(validateHarnessIdentity("paseo", "1253d8c0-78d9-4739-9300-8f808a9f9d19")).toBe(
      "1253d8c0-78d9-4739-9300-8f808a9f9d19",
    );
    expect(() => validateHarnessIdentity("paseo", "01a05c1f-e5d2-7c92-9a6d-e6883393f526")).toThrow(
      "is not a valid Paseo agent ID for paseo",
    );
    expect(recommendHarness({ PI_CODING_AGENT: "true", PASEO_AGENT_ID: "outer" })).toEqual({
      harness: "paseo",
      outerSupervisor: "paseo",
      reason: "detected Paseo-managed coordinator; Paseo retains role ownership and completion",
    });
    expect(recommendHarness({ PI_CODING_AGENT: "true" })).toEqual({
      harness: "pi",
      reason: "detected native Pi coordinator outside Paseo",
    });
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
    delete (broken[2] as { continuation?: unknown }).continuation;
    expect(validateHarnessAdapters(broken)).toEqual([
      "paseo: stable continuation identity is required",
      "codex: incomplete continuation action",
    ]);
  });
});
