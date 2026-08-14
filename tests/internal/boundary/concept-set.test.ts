import { describe, expect, test, vi } from "vite-plus/test";
import {
  assemble as assembleApplication,
  conceptFloor,
  conceptSet,
  registerConcept,
} from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { applicationManifest, renderApp } from "@sync-engine/tooling";
import { compute, former, vocabulary, where } from "@sync-engine/language";

class MissingItem extends Error {}

class Cataloging {
  find(_: Record<string, never>) {
    throw new MissingItem("missing");
  }

  misplaced(_: Record<string, never>) {
    throw new MissingItem("same class, wrong action");
  }

  _find(_: Record<string, never>): { item: string }[] {
    return [];
  }
}

class Remembering {
  constructor(readonly store = "memory") {}

  remember(_: Record<string, never>) {
    return {};
  }
}

class PersistentCataloging extends Cataloging {
  constructor(readonly store: string) {
    super();
  }
}

interface SpecificationParts {
  readonly actions?: string;
  readonly name?: string;
  readonly queries?: string;
  readonly state?: string;
  readonly types?: string;
}

/** Build a complete strict specification while varying only declarations under test. */
function specFor({
  actions = "remember() : return ()\n  where true\n  then\n    return",
  name = "Remembering",
  queries = "",
  state = "a set of Items",
  types = "",
}: SpecificationParts = {}): string {
  return `# ${name}

## Purpose

Keep a catalog.

## Principle

A missing item is refused.

## Types

\`\`\`types
${types}
\`\`\`

## State

\`\`\`state
${state}
\`\`\`

## Actions

\`\`\`actions
${actions}
\`\`\`

## Queries

\`\`\`queries
${queries}
\`\`\`
`;
}

const bare = specFor();

const withoutLocations = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (key, item) => (key === "location" ? undefined : item)));

const catalogingActions = `find() : return ()
  where the item is absent
  then
    refuse ITEM_NOT_FOUND "There is no such item."

misplaced() : return ()
  where true
  then
    return`;
const catalogingQueries = "_find() : optional (item: Item)";
const catalogingSpec = specFor({
  actions: catalogingActions,
  name: "Cataloging",
  queries: catalogingQueries,
});

const cataloging = registerConcept({
  class: Cataloging,
  spec: catalogingSpec,
  refusals: { ITEM_NOT_FOUND: MissingItem },
});

describe("external concept registration", () => {
  test("adds typed named computations to a registered concept set", async () => {
    const set = conceptSet(
      { Cataloging: cataloging },
      { normalize: ({ value }: { value: string }) => value.trim().toLowerCase() },
    );
    const normalized = former("the normalized (value)", ({ value }, { result }) =>
      where(compute(set.computations.normalize, { value }, result)).form({ result }),
    );
    const application = assembleApplication({
      conceptSet: set,
      composition: { normalized },
      instances: set.implementations(),
    });

    expect(set.computations.normalize.computationName).toBe("normalize");
    expect(await application.form(normalized({ value: "  Ready  " }))).toEqual({
      result: "ready",
    });
  });

  test("requires exactly one concept selection", () => {
    const set = conceptSet({ Cataloging: cataloging });
    expect(() => assembleApplication({ composition: {} } as never)).toThrow(
      "supply exactly one conceptSet or vocabulary declaration",
    );
    expect(() =>
      assembleApplication({ conceptSet: set, vocabulary: {}, composition: {} } as never),
    ).toThrow("supply exactly one conceptSet or vocabulary declaration");
  });

  test("carries the specification's refusal branch into action-aware instrumentation", async () => {
    const set = conceptSet({ Cataloging: cataloging });
    const { Cataloging: Catalog } = set.concepts;
    const Find = endpoint("/find", () =>
      receive({})
        .then(Catalog.find({}))
        .then(respond({ ok: true })),
    );
    const Misplaced = endpoint("/misplaced", () =>
      receive({})
        .then(Catalog.misplaced({}))
        .then(respond({ ok: true })),
    );
    const application = assemble({
      conceptSet: set,
      composition: { Find, Misplaced },
      instances: { Cataloging: new PersistentCataloging("primary") },
    });

    expect(await application.invoker.invoke("/find", {})).toEqual({
      ok: false,
      error: { kind: "domain", value: "ITEM_NOT_FOUND" },
    });
    // `misplaced` signals the same class, but no branch declares it there.
    // That is a specification the implementation has outgrown: it stays a
    // fault, and it says so rather than passing silently.
    const reported = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await application.invoker.invoke("/misplaced", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: "INTERNAL_ERROR" },
    });
    const said = reported.mock.calls.flat().join("\n");
    reported.mockRestore();
    expect(said).toContain("ITEM_NOT_FOUND");
    expect(said).toContain("which its specification declares only on find");
    expect(
      (application.concepts.Cataloging._find as unknown as { queryPromise?: string }).queryPromise,
    ).toBe("optional");
    expect((Catalog._find as unknown as { queryPromise?: string }).queryPromise).toBe("optional");
  });

  test("reports the specification's sentence, not the class's, as the refusal detail", async () => {
    const set = conceptSet({ Cataloging: cataloging });
    // The class throws `new MissingItem("missing")`; the specification's
    // sentence is the one a caller is entitled to see.
    const Find = endpoint("/find", ({ detail }) =>
      receive({})
        .then(set.concepts.Cataloging.find({}).refuses({ detail }))
        .then(respond({ detail })),
    );
    const application = assemble({
      conceptSet: set,
      composition: { Find },
      instances: { Cataloging: new Cataloging() },
    });

    expect(await application.invoker.invoke("/find", {})).toEqual({
      ok: true,
      value: { detail: "There is no such item." },
    });
    expect(await application.concepts.Cataloging.find({})).toEqual({
      error: "ITEM_NOT_FOUND",
      detail: "There is no such item.",
    });
  });
});

describe("parsed declarations and class methods", () => {
  test("raw state is retained in registration and manifests but omitted from read-back", () => {
    const marker = "STATE_ONLY_SENTINEL";
    const state = `${marker}\nthere are no methods and the database has an incompatible field {]`;
    const registration = registerConcept({
      class: Cataloging,
      spec: specFor({
        actions: catalogingActions,
        name: "Cataloging",
        queries: catalogingQueries,
        state,
      }),
      refusals: { ITEM_NOT_FOUND: MissingItem },
    });

    expect(withoutLocations(registration.specification)).not.toEqual(
      withoutLocations(cataloging.specification),
    );
    expect(registration.specification.state.body).toBe(state);

    const set = conceptSet({ Cataloging: registration });
    const Find = endpoint("/find", () =>
      receive({})
        .then(set.concepts.Cataloging.find({}).responds())
        .then(respond({ found: true })),
    );
    const application = assembleApplication({
      conceptSet: set,
      composition: { Find },
      instances: set.implementations(),
    });
    const manifest = applicationManifest(application);
    const readBack = renderApp({
      title: "State boundary",
      concepts: manifest.concepts,
      app: manifest.application,
    });

    expect(JSON.stringify(manifest)).toContain(marker);
    expect(readBack).not.toContain(marker);
    expect(manifest.endpoints[0]?.validators).toEqual({ input: false, output: false });
  });

  test("an action the class does not implement fails by name", () => {
    expect(() =>
      registerConcept({
        class: Remembering,
        spec: specFor({
          actions: "forget() : return ()\n  where true\n  then\n    return",
        }),
      }),
    ).toThrow(/declares the action `forget`, which the class does not implement/);
  });

  test("an action the specification does not declare fails by name", () => {
    const findOnly = specFor({
      actions: catalogingActions.split("\n\nmisplaced", 1)[0],
      name: "Cataloging",
      queries: catalogingQueries,
    });
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: findOnly,
        refusals: { ITEM_NOT_FOUND: MissingItem },
      }),
    ).toThrow(/implements the action `misplaced`, which the specification does not declare/);
  });

  test("a query the specification does not declare fails by name", () => {
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: specFor({
          actions:
            "find() : return ()\n  where true\n  then\n    return\n\n" +
            "misplaced() : return ()\n  where true\n  then\n    return",
        }),
      }),
    ).toThrow(/implements the query `_find`, which the specification does not declare/);
  });

  test("a signature naming inputs the class does not take fails", () => {
    class Shelving {
      shelve({ item, shelf }: { item: string; shelf: string }) {
        return { item, shelf };
      }
    }
    expect(() =>
      registerConcept({
        class: Shelving,
        spec: specFor({
          actions: "shelve(item: Item, aisle: Aisle) : return ()\n  where true\n  then\n    return",
        }),
      }),
    ).toThrow(/`shelve` declares the inputs `item`, `aisle` but the class takes `item`, `shelf`/);
  });

  test("a member naming no inputs is left to its specification", () => {
    // `misplaced(_)` states nothing about what it takes, so the signature stands.
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: specFor({
          actions:
            "find() : return ()\n  where true\n  then\n" +
            '    refuse ITEM_NOT_FOUND "There is no such item."\n\n' +
            "misplaced(shelf: Shelf) : return ()\n  where true\n  then\n    return",
          queries: catalogingQueries,
        }),
        refusals: { ITEM_NOT_FOUND: MissingItem },
      }),
    ).not.toThrow();
  });

  test("a refusal branch no Error class signals fails by code", () => {
    expect(() => registerConcept({ class: Cataloging, spec: catalogingSpec })).toThrow(
      /refuses with `ITEM_NOT_FOUND`, which no Error class signals/,
    );
  });

  test("an Error class for a branch the specification lacks fails by code", () => {
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem, ABSENT: MissingItem },
      }),
    ).toThrow(/`ABSENT` names no branch of the specification/);
  });

  test("two codes sharing one Error class fail", () => {
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: specFor({
          actions:
            "find() : return ()\n  where true\n  then\n" +
            '    refuse ITEM_NOT_FOUND "There is no such item."\n\n' +
            "misplaced() : return ()\n  where true\n  then\n" +
            '    refuse SHELVED_WRONG "The item sits on the wrong shelf."',
          queries: catalogingQueries,
        }),
        refusals: { ITEM_NOT_FOUND: MissingItem, SHELVED_WRONG: MissingItem },
      }),
    ).toThrow(/share one Error class/);
  });
});

describe("concept floors", () => {
  test("accepts a lower-level declaration and validates descriptor shape", () => {
    const declared = vocabulary({ concepts: { Remembering }, computations: {} });
    const valid = {
      name: "memory",
      instances: { Remembering: new Remembering() },
      resources: [],
      async close() {},
    };
    expect(conceptFloor(declared, valid)).toBe(valid);

    const set = conceptSet({ Remembering: registerConcept({ class: Remembering, spec: bare }) });
    expect(() => conceptFloor(set, { ...valid, name: "" })).toThrow("name must not be empty");
    expect(() =>
      conceptFloor(set, {
        ...valid,
        instances: { Remembering: new Remembering(), Extra: {} } as never,
      }),
    ).toThrow("unknown Extra");
    expect(() => conceptFloor(set, { ...valid, resources: "database" as never })).toThrow(
      "resources must be a list",
    );
    expect(() => conceptFloor(set, { ...valid, resources: [1] as never })).toThrow(
      "resources must be a list",
    );
    expect(() => conceptFloor(set, { ...valid, close: true as never })).toThrow(
      "close must release",
    );
  });

  test("an incomplete floor names what it is missing", () => {
    const set = conceptSet({ Cataloging: cataloging });
    expect(() =>
      conceptFloor(set, {
        name: "incomplete",
        instances: {} as never,
        resources: [],
        async close() {},
      }),
    ).toThrow(/missing Cataloging/);
  });

  test("constructs a complete named floor and keeps unnamed implementations as classes", () => {
    const set = conceptSet({
      Remembering: registerConcept({
        class: Remembering,
        spec: bare,
        floors: { mongo: ({ store }: { store: string }) => new Remembering(store) },
      }),
      Cataloging: registerConcept({
        class: Cataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem },
        floors: { mongo: ({ store }: { store: string }) => new PersistentCataloging(store) },
      }),
    });

    const memory = set.implementations();
    expect(memory.Remembering).toBeInstanceOf(Remembering);
    expect(memory.Cataloging).toBeInstanceOf(Cataloging);

    const mongo = set.implementations("mongo", { store: "primary" });
    expect(mongo.Remembering).toEqual(new Remembering("primary"));
    expect(mongo.Cataloging).toEqual(new PersistentCataloging("primary"));
  });

  test("retains named-floor provenance through exact and safely spread implementation maps", () => {
    const set = conceptSet({
      Remembering: registerConcept({
        class: Remembering,
        spec: bare,
        floors: { mongo: ({ store }: { store: string }) => new Remembering(store) },
      }),
    });
    const mongo = set.implementations("mongo", { store: "primary" });
    const selected = (instances: typeof mongo) =>
      applicationManifest(
        assembleApplication({ conceptSet: set, instances, composition: {} }),
      ).conceptImplementations.find(({ concept }) => concept === "Remembering")?.selected;

    expect(selected(mongo)).toEqual({
      via: "instances",
      constructorName: "Remembering",
      floor: "mongo",
    });
    expect(selected({ ...mongo })).toEqual({
      via: "instances",
      constructorName: "Remembering",
      floor: "mongo",
    });

    const hosted = conceptFloor(set, {
      name: "hosted",
      instances: { Remembering: new Remembering("hosted") },
      resources: [],
      async close() {},
    });
    expect(selected({ ...hosted.instances })).toEqual({
      via: "instances",
      constructorName: "Remembering",
      floor: "hosted",
    });
  });

  test("omits a spread floor when one instance has conflicting named-floor hints", () => {
    const set = conceptSet({
      Remembering: registerConcept({ class: Remembering, spec: bare }),
    });
    const shared = new Remembering("shared");
    const first = conceptFloor(set, {
      name: "first",
      instances: { Remembering: shared },
      resources: [],
      async close() {},
    });
    conceptFloor(set, {
      name: "second",
      instances: { Remembering: shared },
      resources: [],
      async close() {},
    });

    const selected = applicationManifest(
      assembleApplication({
        conceptSet: set,
        instances: { ...first.instances },
        composition: {},
      }),
    ).conceptImplementations.find(({ concept }) => concept === "Remembering")?.selected;
    expect(selected).toEqual({ via: "instances", constructorName: "Remembering" });
  });

  test("requires a named floor for a concept with required constructor arguments", () => {
    const set = conceptSet({
      Cataloging: registerConcept({
        class: PersistentCataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem },
        floors: { persistent: () => new PersistentCataloging("primary") },
      }),
    });

    expect(() => (set.implementations as () => unknown)()).toThrow(
      'conceptSet: concept "Cataloging" requires constructor arguments; use a named floor.',
    );
    expect(set.implementations("persistent", undefined).Cataloging).toEqual(
      new PersistentCataloging("primary"),
    );
  });

  test("accepts an inherited subclass replacement and inventories its complete protocol", () => {
    const set = conceptSet({
      Cataloging: registerConcept({
        class: Cataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem },
        floors: { persistent: () => new PersistentCataloging("primary") },
      }),
    });
    const application = assembleApplication({
      conceptSet: set,
      composition: {},
      instances: set.implementations("persistent", undefined),
    });

    expect(applicationManifest(application).concepts).toContainEqual(
      expect.objectContaining({
        name: "Cataloging",
        purpose: "Keep a catalog.",
        principle: "A missing item is refused.",
        actions: [
          { name: "find", roles: [], refusals: ["ITEM_NOT_FOUND"] },
          { name: "misplaced", roles: [] },
        ],
        queries: [{ name: "_find", roles: [], returns: "optional" }],
      }),
    );
  });

  test("accepts own-method object replacements and inventories them deterministically", () => {
    const set = conceptSet({
      Cataloging: registerConcept({
        class: Cataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem },
        floors: {
          structural: () => ({
            freshID: () => "injected-helper",
            misplaced(_: Record<string, never>) {
              throw new MissingItem("same class, wrong action");
            },
            _find(_: Record<string, never>): { item: string }[] {
              return [];
            },
            find(_: Record<string, never>) {
              throw new MissingItem("missing");
            },
          }),
        },
      }),
    });
    const application = assembleApplication({
      conceptSet: set,
      composition: {},
      instances: set.implementations("structural", undefined),
    });

    expect(applicationManifest(application).concepts).toContainEqual(
      expect.objectContaining({
        name: "Cataloging",
        purpose: "Keep a catalog.",
        principle: "A missing item is refused.",
        actions: [
          { name: "find", roles: [], refusals: ["ITEM_NOT_FOUND"] },
          { name: "misplaced", roles: [] },
        ],
        queries: [{ name: "_find", roles: [], returns: "optional" }],
      }),
    );
    expect(JSON.stringify(applicationManifest(application).concepts)).not.toContain("freshID");
  });

  test("rejects a malformed floor implementation before it reaches assembly", () => {
    const set = conceptSet({
      Cataloging: registerConcept({
        class: Cataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem },
        floors: {
          malformed: (() => ({
            find: "not callable",
            misplaced(_: Record<string, never>) {
              return {};
            },
            _find(_: Record<string, never>) {
              return [];
            },
          })) as never,
        },
      }),
    });

    expect(() => set.implementations("malformed", undefined)).toThrow(
      'floor "malformed": implementation for "Cataloging" does not implement `find`',
    );
  });

  test("a floor factory receives the name the concept is registered under", () => {
    const set = conceptSet({
      Warehouse: registerConcept({
        class: Remembering,
        spec: bare,
        floors: { named: (_: Record<string, never>, name: string) => new Remembering(name) },
      }),
    });
    expect(set.implementations("named", {}).Warehouse).toEqual(new Remembering("Warehouse"));
  });

  test("reports every missing named-floor registration before any factory runs", () => {
    const constructed: string[] = [];
    const set = conceptSet({
      Complete: registerConcept({
        class: Remembering,
        spec: bare,
        floors: {
          mongo: () => {
            constructed.push("Complete");
            return new Remembering("primary");
          },
        },
      }),
      MissingFirst: registerConcept({ class: Remembering, spec: bare }),
      MissingSecond: registerConcept({ class: Remembering, spec: bare }),
    });

    expect(() => set.implementations("mongo" as never, undefined as never)).toThrow(
      'floor "mongo" is missing implementations for MissingFirst, MissingSecond',
    );
    expect(constructed).toEqual([]);
  });
});
