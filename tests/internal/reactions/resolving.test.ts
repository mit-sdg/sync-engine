import { describe, expect, test } from "vite-plus/test";
import { NameResolver } from "@sync-engine/internal/reactions/resolving.ts";
import type {
  InstrumentedAction,
  InstrumentedQuery,
} from "@sync-engine/internal/reactions/types.ts";
import { computationRef } from "@sync-engine/internal/reads/computations";

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

  test("action rejects concept methods that are not instrumented actions", () => {
    const resolver = new NameResolver(
      new Map([["ValidName", { notAnAction: () => {} }]]),
      new Map(),
    );
    expect(() => resolver.action("ValidName", "notAnAction", {}, {}, "test")).toThrow(
      "ValidName.notAnAction is not an action.",
    );
  });

  test("query rejects concept methods that are not instrumented queries", () => {
    const resolver = new NameResolver(new Map([["ValidName", { notAQuery: () => {} }]]), new Map());
    expect(() => resolver.query("ValidName", "notAQuery", "test")).toThrow(
      "ValidName.notAQuery is not a query.",
    );
  });

  test("computation rejects unregistered names", () => {
    const resolver = new NameResolver(new Map(), new Map());
    expect(() => resolver.computation("NonexistentComp", "test")).toThrow(
      'computation "NonexistentComp" is not registered.',
    );
  });

  test("computation enforces vocabulary-only source when flag is set", () => {
    const ref = computationRef("MyComp", () => 42, "standard");
    const resolver = new NameResolver(new Map(), new Map([["MyComp", ref]]));
    expect(() => resolver.computation("MyComp", "test", true)).toThrow(
      'computation "MyComp" is not vocabulary-owned.',
    );
  });
});
