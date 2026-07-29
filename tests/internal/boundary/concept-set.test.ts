import { describe, expect, test, vi } from "vite-plus/test";
import {
  assemble as assembleApplication,
  conceptFloor,
  conceptSet,
  PublicError,
  registerConcept,
} from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { applicationManifest, renderApp } from "@sync-engine/tooling";

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
}

class PersistentCataloging extends Cataloging {
  constructor(readonly store: string) {
    super();
  }
}

/** A specification document with the given fences under the required prose. */
function specFor(body = ""): string {
  return `# Concept\n\n## Purpose\n\nKeep a catalog.\n\n## Principle\n\nA missing item is refused.\n${body}`;
}

const bare = specFor();

const catalogingSpec = specFor(`
## Actions

\`\`\`actions
find () : return ()
  where the item is absent
  then
    refuse ITEM_NOT_FOUND "There is no such item."

misplaced () : return ()
  then
    return
\`\`\`

## Queries

\`\`\`queries
_find () : optional (item: Item)
\`\`\`
`);

const cataloging = registerConcept({
  class: Cataloging,
  spec: catalogingSpec,
  refusals: { ITEM_NOT_FOUND: MissingItem },
  publicErrors: { ITEM_NOT_FOUND: PublicError.NOT_FOUND },
});

describe("external concept registration", () => {
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
      vocabulary: set.vocabulary,
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
    expect(application.publicErrors).toEqual({ ITEM_NOT_FOUND: "NOT_FOUND" });
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
      vocabulary: set.vocabulary,
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

  test("retains explicitly registered prototype-named public error codes as own keys", () => {
    class ToStringRefusal extends Error {}
    class ConstructorRefusal extends Error {}
    class ProtoRefusal extends Error {}
    class Refusing {
      refuse(_: Record<string, never>) {
        return {};
      }
    }
    const specialSpec = specFor(`
## Actions

\`\`\`actions
refuse () : return ()
  then
    refuse toString "A registered toString refusal."
    refuse constructor "A registered constructor refusal."
    refuse __proto__ "A registered proto refusal."
\`\`\`
`);
    const refusals = Object.fromEntries([
      ["toString", ToStringRefusal],
      ["constructor", ConstructorRefusal],
      ["__proto__", ProtoRefusal],
    ]);
    const publicErrors = Object.fromEntries([
      ["toString", PublicError.NOT_FOUND],
      ["constructor", PublicError.CONFLICT],
      ["__proto__", PublicError.FORBIDDEN],
    ]);
    const set = conceptSet({
      Refusing: registerConcept({
        class: Refusing,
        spec: specialSpec,
        refusals,
        publicErrors,
      }),
    });
    const application = assemble({ vocabulary: set.vocabulary, composition: {} });

    for (const categories of [set.publicErrors, application.publicErrors]) {
      expect(Object.hasOwn(categories, "toString")).toBe(true);
      expect(Object.hasOwn(categories, "constructor")).toBe(true);
      expect(Object.hasOwn(categories, "__proto__")).toBe(true);
      expect(categories.toString).toBe("NOT_FOUND");
      expect(categories.constructor).toBe("CONFLICT");
      expect(categories.__proto__).toBe("FORBIDDEN");
      expect(Object.getPrototypeOf(categories)).toBe(Object.prototype);
    }
  });
});

describe("parsed declarations and class methods", () => {
  test("state notation is absent from registration and every generated design surface", () => {
    const marker = "STATE_ONLY_SENTINEL";
    const registration = registerConcept({
      class: Cataloging,
      spec: catalogingSpec.replace(
        "## Actions",
        `## State\n\n\`\`\`state\n${marker}\n` +
          "there are no methods and the database has an incompatible field {]\n" +
          "```\n\n## Actions",
      ),
      refusals: { ITEM_NOT_FOUND: MissingItem },
    });

    expect(registration.specification).toEqual(cataloging.specification);
    expect(registration.specification).not.toHaveProperty("state");

    const set = conceptSet({ Cataloging: registration });
    const Find = endpoint("/find", () =>
      receive({})
        .then(set.concepts.Cataloging.find({}).responds())
        .then(respond({ found: true })),
    );
    const application = assembleApplication({
      vocabulary: set.vocabulary,
      composition: { Find },
      instances: set.implementations(),
    });
    const manifest = applicationManifest(application);
    const readBack = renderApp({
      title: "State boundary",
      concepts: manifest.concepts,
      app: manifest.application,
    });

    expect(JSON.stringify(manifest)).not.toContain(marker);
    expect(readBack).not.toContain(marker);
    expect(manifest.endpoints[0]?.validators).toEqual({ input: false, output: false });
  });

  test("an action the class does not implement fails by name", () => {
    expect(() =>
      registerConcept({
        class: Remembering,
        spec: specFor("\n## Actions\n\n```actions\nforget () : return ()\n```\n"),
      }),
    ).toThrow(/declares the action `forget`, which the class does not implement/);
  });

  test("an action the specification does not declare fails by name", () => {
    expect(() => registerConcept({ class: Cataloging, spec: bare })).toThrow(
      /implements the action `find`, `misplaced`, which the specification does not declare/,
    );
  });

  test("a query the specification does not declare fails by name", () => {
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: specFor("\n```actions\nfind () : return ()\nmisplaced () : return ()\n```\n"),
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
        spec: specFor("\n```actions\nshelve (item: Item, aisle: Aisle) : return ()\n```\n"),
      }),
    ).toThrow(/`shelve` declares the inputs `item`, `aisle` but the class takes `item`, `shelf`/);
  });

  test("a member naming no inputs is left to its specification", () => {
    // `misplaced(_)` states nothing about what it takes, so the signature stands.
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: specFor(
          "\n```actions\nfind () : return ()\n  then\n" +
            '    refuse ITEM_NOT_FOUND "There is no such item."\n' +
            "misplaced (shelf: Shelf) : return ()\n```\n" +
            "\n```queries\n_find () : optional (item: Item)\n```\n",
        ),
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
        spec: specFor(
          "\n```actions\nfind () : return ()\n  then\n" +
            '    refuse ITEM_NOT_FOUND "There is no such item."\n' +
            "misplaced () : return ()\n  then\n" +
            '    refuse SHELVED_WRONG "The item sits on the wrong shelf."\n```\n' +
            "\n```queries\n_find () : optional (item: Item)\n```\n",
        ),
        refusals: { ITEM_NOT_FOUND: MissingItem, SHELVED_WRONG: MissingItem },
      }),
    ).toThrow(/share one Error class/);
  });

  test("a public category for an undeclared refusal fails", () => {
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: catalogingSpec,
        refusals: { ITEM_NOT_FOUND: MissingItem },
        publicErrors: { ABSENT: PublicError.NOT_FOUND },
      }),
    ).toThrow(/public error `ABSENT` is not a declared refusal/);
  });
});

describe("concept floors", () => {
  test("an incomplete floor names what it is missing", () => {
    const set = conceptSet({ Cataloging: cataloging });
    expect(() =>
      conceptFloor(set.vocabulary, {
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
      vocabulary: set.vocabulary,
      composition: {},
      instances: set.implementations("persistent", undefined),
    });

    expect(applicationManifest(application).concepts).toContainEqual({
      name: "Cataloging",
      purpose: "Keep a catalog.",
      principle: "A missing item is refused.",
      actions: [
        { name: "find", roles: [], refusals: ["ITEM_NOT_FOUND"] },
        { name: "misplaced", roles: [] },
      ],
      queries: [{ name: "_find", roles: [], returns: "optional" }],
    });
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
      vocabulary: set.vocabulary,
      composition: {},
      instances: set.implementations("structural", undefined),
    });

    expect(applicationManifest(application).concepts).toContainEqual({
      name: "Cataloging",
      purpose: "Keep a catalog.",
      principle: "A missing item is refused.",
      actions: [
        { name: "find", roles: [], refusals: ["ITEM_NOT_FOUND"] },
        { name: "misplaced", roles: [] },
      ],
      queries: [{ name: "_find", roles: [], returns: "optional" }],
    });
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
