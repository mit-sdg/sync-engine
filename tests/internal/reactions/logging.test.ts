import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/actions.ts";
import { ReactionLogger } from "@sync-engine/internal/reactions/logging.ts";
import type { InstrumentedAction } from "@sync-engine/internal/reactions/types.ts";

describe("reaction logging", () => {
  test("emits one named LogEvent after recording an action", () => {
    class Drafting {}
    const concept = new Drafting();
    const rawSave = Object.defineProperty(async () => ({}), "name", { value: "save" });
    const save = rawSave as InstrumentedAction;
    save.concept = concept;
    save.action = rawSave;
    const actions = new ActionConcept();
    actions.invoke({ id: "ask", concept, action: save, input: { title: "A" }, flow: "flow" });
    actions.invoked({ id: "ask", output: {}, outcome: { kind: "result", value: {} } });
    const logging = new ReactionLogger(actions);
    const events: unknown[] = [];
    logging.addObserver({ onAction: (event) => events.push(event) });
    logging.emit({ id: "ask", concept, action: save, input: { title: "A" }, flow: "flow" }, 2);
    expect(events).toMatchObject([{ concept: "Drafting", action: "save", durationMs: 2 }]);
  });
});
