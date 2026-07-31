import { describe, expect, test } from "vite-plus/test";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { ReactionLogger, Logging } from "@sync-engine/internal/reactions/runtime/logging.ts";
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

  test("verbose action log records details without throwing", () => {
    class Drafting {}
    const concept = new Drafting();
    const rawSave = Object.defineProperty(async () => ({}), "name", { value: "save" });
    const save = rawSave as InstrumentedAction;
    save.concept = concept;
    save.action = rawSave;
    const logging = new ReactionLogger(new ActionConcept());
    logging.level = Logging.VERBOSE;
    expect(() =>
      logging.action({ id: "verbose", concept, action: save, input: { title: "A" }, flow: "flow" }),
    ).not.toThrow();
  });

  test("trace action log records details without throwing", () => {
    class Drafting {}
    const concept = new Drafting();
    const rawSave = Object.defineProperty(async () => ({}), "name", { value: "save" });
    const save = rawSave as InstrumentedAction;
    save.concept = concept;
    save.action = rawSave;
    const logging = new ReactionLogger(new ActionConcept());
    logging.level = Logging.TRACE;
    expect(() =>
      logging.action({ id: "trace", concept, action: save, input: { title: "A" }, flow: "flow" }),
    ).not.toThrow();
  });
});
