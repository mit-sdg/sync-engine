import { describe, expect, test } from "vite-plus/test";
import { NameResolver } from "@sync-engine/internal/reactions/resolving.ts";
import type {
  InstrumentedAction,
  InstrumentedQuery,
} from "@sync-engine/internal/reactions/types.ts";

describe("name resolution", () => {
  test("resolves actions and queries only from the installed vocabulary", () => {
    const raw = {};
    const save = (async () => ({})) as InstrumentedAction;
    save.concept = raw;
    const find = (() => []) as InstrumentedQuery;
    find.queryName = "_find";
    const resolver = new NameResolver(new Map([["Drafting", { save, _find: find }]]), new Map());

    expect(resolver.action("Drafting", "save", {}, {}, "Saving").action).toBe(save);
    expect(resolver.query("Drafting", "_find", "Reading")).toBe(find);
    expect(() => resolver.concept("Missing", "Reaction")).toThrow("no instrumented concept");
  });
});
