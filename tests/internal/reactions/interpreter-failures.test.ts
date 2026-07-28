import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { InterpreterFailures } from "@sync-engine/internal/reactions/runtime/interpreter-failures.ts";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";

describe("interpreter failure recording", () => {
  test("records stage and consequence provenance without retaining private error text", () => {
    const store = new MemoryStore();
    const failures = new InterpreterFailures(new ActionConcept(store));

    failures.record("Notify", "flow", ["trigger"], "consequence-input", new TypeError("private"), {
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
  });
});
