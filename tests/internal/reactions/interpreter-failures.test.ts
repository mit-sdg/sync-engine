import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import type { RawFaultReport } from "@sync-engine/assembly";

describe("interpreter failure recording", () => {
  test("records stage and consequence provenance without retaining private error text", () => {
    const store = new MemoryStore();
    const reports: RawFaultReport[] = [];
    const actions = new ActionConcept(store, undefined, undefined, (report) =>
      reports.push(report),
    );
    const fault = new TypeError("private");

    actions._recordInterpreterFailure("Notify", "flow", ["trigger"], "consequence-input", fault, {
      action: "Notice.send",
      actionId: "ask",
    });

    expect(store.reactionFailures).toEqual([
      {
        reaction: "Notify",
        flow: "flow",
        triggerIds: ["trigger"],
        stage: "consequence-input",
        action: "Notice.send",
        actionId: "ask",
        errorClass: "TypeError",
        at: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(store.reactionFailures)).not.toContain("private");
    expect(reports).toEqual([
      expect.objectContaining({
        kind: "interpreter",
        error: fault,
        flow: "flow",
        reaction: "Notify",
        stage: "consequence-input",
        action: "Notice.send",
        actionId: "ask",
      }),
    ]);
  });
});
