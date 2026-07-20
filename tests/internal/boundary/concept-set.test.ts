import { describe, expect, test } from "vite-plus/test";
import { conceptFloor, conceptSet, PublicError, registerConcept } from "@sync-engine/assembly";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { request } from "@sync-engine/language";
import { assemble } from "@sync-engine/internal/boundary";

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

const spec =
  "# Concept\n\n## Purpose\n\nTest concept floors.\n\n## Principle\n\nA concept uses its selected floor.";

const cataloging = registerConcept({
  class: Cataloging,
  spec: "# Cataloging\n\n## Purpose\n\nKeep a catalog.\n\n## Principle\n\nA missing item is refused.",
  queries: { _find: "optional" },
  refusals: {
    ITEM_NOT_FOUND: {
      error: MissingItem,
      on: ["find"],
      public: PublicError.NOT_FOUND,
    },
  },
});

describe("external concept registration", () => {
  test("inverts one refusal entry into action-aware instrumentation", async () => {
    const set = conceptSet({ Cataloging: cataloging });
    const { Cataloging: Catalog } = set.concepts;
    const Find = endpoint("/find", () =>
      receive({}).then(request(Catalog.find, {}), respond({ ok: true })),
    );
    const Misplaced = endpoint("/misplaced", () =>
      receive({}).then(request(Catalog.misplaced, {}), respond({ ok: true })),
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
    expect(await application.invoker.invoke("/misplaced", {})).toEqual({
      ok: false,
      error: { kind: "framework", code: "INTERNAL_ERROR" },
    });
    expect(application.publicErrors).toEqual({ ITEM_NOT_FOUND: "NOT_FOUND" });
    expect(
      (application.concepts.Cataloging._find as unknown as { queryPromise?: string }).queryPromise,
    ).toBe("optional");
    expect((Catalog._find as unknown as { queryPromise?: string }).queryPromise).toBe("optional");
  });

  test("rejects unknown actions and incomplete concept floors", () => {
    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: "spec",
        refusals: {
          ITEM_NOT_FOUND: {
            error: MissingItem,
            on: ["absent"],
          },
        },
      } as never),
    ).toThrow(/unknown action "absent"/);

    expect(() =>
      registerConcept({
        class: Cataloging,
        spec: "spec",
        queries: { _absent: "many" },
      } as never),
    ).toThrow(/queries contract names "_absent"/);

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
        spec,
        floors: { mongo: ({ store }: { store: string }) => new Remembering(store) },
      }),
      Cataloging: registerConcept({
        class: Cataloging,
        spec,
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

  test("reports every missing named-floor registration before any factory runs", () => {
    const constructed: string[] = [];
    const set = conceptSet({
      Complete: registerConcept({
        class: Remembering,
        spec,
        floors: {
          mongo: () => {
            constructed.push("Complete");
            return new Remembering("primary");
          },
        },
      }),
      MissingFirst: registerConcept({ class: Cataloging, spec }),
      MissingSecond: registerConcept({ class: Remembering, spec }),
    });

    expect(() => set.implementations("mongo" as never, undefined as never)).toThrow(
      'floor "mongo" is missing implementations for MissingFirst, MissingSecond',
    );
    expect(constructed).toEqual([]);
  });
});
