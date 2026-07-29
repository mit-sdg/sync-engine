import { describe, expect, test } from "vite-plus/test";
import { Registry } from "@sync-engine/internal/reads/definition-registry.ts";
import type { InstrumentedQuery } from "@sync-engine/internal/reactions/types.ts";

describe("definition registry", () => {
  test("keeps cached read environments live as concept definitions are installed", () => {
    const definitions = new Registry();
    const env = definitions.readEnv();
    const first = (() => []) as InstrumentedQuery;
    first.queryName = "_items";
    const second = (() => []) as InstrumentedQuery;
    second.queryName = "_items";

    definitions.registerConcept("Inventory", { _items: first });
    expect(env.query({ concept: "Inventory", query: "_items" }, "test")).toBe(first);

    definitions.registerConcept("Inventory", { _items: second });
    expect(env.query({ concept: "Inventory", query: "_items" }, "test")).toBe(second);
  });

  test("registers imported view and former definitions into the same read environment", () => {
    const definitions = new Registry();
    definitions.registerViews([
      {
        name: "anything holds",
        ins: [],
        outs: [],
        bindings: [],
        holds: true,
        alternatives: [[]],
      },
    ]);
    definitions.registerFormers([
      {
        name: "the supplied value",
        ins: ["value"],
        bindings: [],
        promise: "one",
        body: { node: "leaf", var: "value" },
      },
    ]);

    expect(definitions.readEnv().viewByName("anything holds", "test").viewName).toBe(
      "anything holds",
    );
    expect(definitions.readEnv().formerByName("the supplied value", "test").formerName).toBe(
      "the supplied value",
    );
  });
});
