import { describe, expect, test } from "vite-plus/test";
import { earlier, request, when } from "@sync-engine/internal/reactions/words.ts";
import type { InstrumentedAction } from "@sync-engine/internal/reactions/types.ts";

function action(name: string): InstrumentedAction {
  const fn = Object.defineProperty(async () => ({}), "name", { value: name }) as InstrumentedAction;
  fn.concept = {};
  return fn;
}

describe("reaction words", () => {
  test("when and request build one declarative sentence", () => {
    const opened = action("opened");
    const notify = action("notify");
    const declaration = when(opened, { id: "a" }).then(request(notify, { id: "a" }));
    expect(declaration.when).toHaveLength(1);
    expect(declaration.then[0].action.action).toBe(notify);
  });

  test("earlier is a branded non-consuming flow read", () => {
    const opened = action("opened");
    expect(earlier(opened, { id: "a" })).toMatchObject({
      op: "earlier",
      pattern: { action: opened, input: { id: "a" }, output: {} },
    });
  });
});
