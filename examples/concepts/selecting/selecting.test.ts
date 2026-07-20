import { describe, expect, test } from "vite-plus/test";
import { NoCurrentSelection } from "./errors.ts";
import { SelectingConcept } from "./selecting.ts";

const ids = (...values: string[]) => {
  const remaining = [...values];
  return () => remaining.shift() ?? "unexpected";
};

describe("Selecting", () => {
  test("its principle: a new choice replaces only its scope's current selection", () => {
    const selecting = new SelectingConcept(ids("a", "other", "b"));
    selecting.choose({ scope: "workshop", item: "Essay A" });
    selecting.choose({ scope: "other-workshop", item: "Essay A" });
    expect(selecting.choose({ scope: "workshop", item: "Essay B" })).toEqual({ selection: "b" });
    expect(selecting._current({ scope: "workshop" })).toEqual([
      { selection: "b", scope: "workshop", item: "Essay B" },
    ]);
    expect(selecting._current({ scope: "other-workshop" })).toEqual([
      { selection: "other", scope: "other-workshop", item: "Essay A" },
    ]);
    expect(selecting._get({ selection: "a" })).toEqual([
      { selection: "a", scope: "workshop", item: "Essay A" },
    ]);
    expect(selecting._get({ selection: "missing" })).toEqual([]);
  });

  test("clear removes the current selection and refuses when repeated", () => {
    const selecting = new SelectingConcept(ids("a"));
    selecting.choose({ scope: "workshop", item: "Essay A" });
    expect(selecting.clear({ scope: "workshop" })).toEqual({ selection: "a" });
    expect(selecting._current({ scope: "workshop" })).toEqual([]);
    const repeatedClear = () => selecting.clear({ scope: "workshop" });
    expect(repeatedClear).toThrow(NoCurrentSelection);
    expect(repeatedClear).toThrow("This scope has no current selection.");
  });
});
