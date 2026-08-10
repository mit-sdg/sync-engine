import { expect, test } from "vite-plus/test";
import { NoCurrentSelection } from "./selecting.shared.ts";
import { SelectingMemoryConcept } from "./selecting.memory.ts";

test("Selecting memory principle", () => {
  const ids = ["first", "second"];
  const selecting = new SelectingMemoryConcept(() => ids.shift() ?? "unexpected");
  const first = selecting.choose({ scope: "workshop", item: "Essay A" });
  expect(selecting._get(first)).toEqual([
    { selection: "first", scope: "workshop", item: "Essay A" },
  ]);
  expect(selecting._current({ scope: "workshop" })).toEqual([
    { selection: "first", scope: "workshop", item: "Essay A" },
  ]);
  selecting.choose({ scope: "workshop", item: "Essay B" });
  expect(selecting.clear({ scope: "workshop" }).selection).toBe("second");
  expect(() => selecting.clear({ scope: "workshop" })).toThrow(NoCurrentSelection);
});
