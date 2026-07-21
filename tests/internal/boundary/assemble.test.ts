/**
 * assemble: the whole application from a vocabulary and a composition.
 *
 * Naming is the dotted path through the composition record; instances win
 * over initialize which wins over default construction; contracts come from
 * declarations first and the reactions themselves second; and two reactions
 * answering one request is a visible NOT_PENDING refusal carrying the losing
 * reaction's name — never a silent tiebreak.
 */
import { describe, expect, test } from "vite-plus/test";
import { no, request, reaction, vocabulary, when, where } from "@sync-engine/internal/reactions";
import { assemble, endpoint, fail, receive, respond } from "@sync-engine/internal/boundary";

class CountingConcept {
  static readonly queries = { _current: "one", _named: "optional", _seen: "many" } as const;
  count: number;
  constructor(start = 0) {
    this.count = start;
  }
  increment(_: Record<string, never>) {
    this.count += 1;
    return { count: this.count };
  }
  _current(_: Record<string, never>) {
    return [{ count: this.count }];
  }
  _named({ name }: { name: string }) {
    return name === "counter" ? [{ count: this.count }] : [];
  }
  _seen(_: Record<string, never>) {
    return [{ count: this.count }, { count: this.count + 1 }];
  }
}

class EchoingConcept {
  heard: string[] = [];
  hear({ text }: { text: string }) {
    this.heard.push(text as string);
    return {};
  }
}

const vocab = vocabulary({
  concepts: { Counting: { class: CountingConcept }, Echoing: EchoingConcept },
  computations: {},
});
const { Counting, Echoing } = vocab.concepts;

const Increment = endpoint("/counter/increment", ({ count }) =>
  receive({})
    .then(request(Counting.increment, {}, { count }))
    .then(respond({ count })),
);

describe("assemble", () => {
  test("reactions register under their dotted composition path", async () => {
    const EchoIncrements = reaction(({ count }) =>
      when(Counting.increment, {}, { count }).then(request(Echoing.hear, { text: "bump" })),
    );
    const app = assemble({
      vocabulary: vocab,
      composition: { counter: { Increment, EchoIncrements } },
    });
    const names = app.engine.exportReactions().reactions.map((reaction) => reaction.name);
    expect(names).toContain("counter.Increment");
    expect(names).toContain("counter.EchoIncrements");

    const result = await app.invoker.invoke("/counter/increment", {});
    expect(result).toEqual({ ok: true, value: { count: 1 } });
    expect(app.concepts.Echoing.heard).toEqual(["bump"]);
  });

  test("initialize supplies constructor args; missing names default-construct", async () => {
    const app = assemble({
      vocabulary: vocab,
      initialize: { Counting: [41] },
      composition: { counter: { Increment } },
    });
    const result = await app.invoker.invoke("/counter/increment", {});
    expect(result).toEqual({ ok: true, value: { count: 42 } });
    expect(app.concepts.Echoing.heard).toEqual([]);
  });

  test("instances win outright and answer to the vocabulary name", async () => {
    const substituted = new CountingConcept(100);
    const app = assemble({
      vocabulary: vocab,
      initialize: { Counting: [7] },
      instances: { Counting: substituted },
      composition: { counter: { Increment } },
    });
    await app.invoker.invoke("/counter/increment", {});
    expect(substituted.count).toBe(101);
  });

  test("a name outside the vocabulary is an assembly error", () => {
    expect(() =>
      assemble({
        vocabulary: vocab,
        initialize: { Boating: [] } as never,
        composition: {},
      }),
    ).toThrow(/"Boating" is not a name in the vocabulary/);
  });

  test("declared contracts take precedence; reactions supply the rest", async () => {
    const Declared = endpoint(
      "/notes/create",
      ({ text }) => receive({ text }).then(respond({ ok: true })),
      { input: { required: ["text", "author"] } },
    );
    const app = assemble({
      vocabulary: vocab,
      composition: { notes: { Declared }, counter: { Increment } },
    });
    // Declared stays authoritative (stricter than the pattern would derive).
    const refused = await app.invoker.invoke("/notes/create", { text: "hi" } as never);
    expect(refused.ok).toBe(false);
    if (!refused.ok && refused.error.kind === "framework") {
      expect(refused.error.code).toBe("INVALID_INPUT");
    }
    // Underived, undeclared: /counter/increment takes an empty body.
    expect(app.contracts["/notes/create"]).toEqual({ required: ["text", "author"] });
    expect(app.publicInterface).toEqual({
      routes: {
        "/counter/increment": {},
        "/notes/create": { required: ["text", "author"] },
      },
    });
  });

  test("two reactions answering one request: one wins, the loss is on the record by reaction name", async () => {
    const First = endpoint("/race", () => receive({}).then(respond({ winner: "First" })));
    const Second = endpoint("/race", () => receive({}).then(respond({ winner: "Second" })));
    const app = assemble({ vocabulary: vocab, composition: { race: { First, Second } } });

    const losses: string[] = [];
    app.engine.addObserver({
      onAction(ev) {
        if (ev.concept !== "RequestBoundary" || ev.action !== "respond") return;
        if (ev.outcome?.kind !== "error") return;
        losses.push(ev.by ?? "<direct>");
      },
    });

    const result = await app.invoker.invoke("/race", {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ winner: "First" }); // name order, deterministically
    // The winning answer resolves the invoke; the losing reaction's respond is
    // in flight and receives a NOT_PENDING refusal moments later.
    for (let i = 0; i < 100 && losses.length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(losses).toEqual(["race.Second"]);
  });

  test("fail() answers with the named error through the domain-error channel", async () => {
    const Gate = endpoint("/gated", () => receive({}).then(fail("FORBIDDEN")));
    const app = assemble({ vocabulary: vocab, composition: { Gate } });
    const result = await app.invoker.invoke("/gated", {});
    expect(result).toEqual({ ok: false, error: { kind: "domain", value: "FORBIDDEN" } });
  });

  test("sibling branches lower literal, existence, and value witnesses to stable names", () => {
    const Literal = endpoint("/literal", () =>
      receive({}).then(
        where(Counting._current({}).is({ count: 0 }))
          .then(respond({ branch: "zero" }))
          .named("zero"),
        where(Counting._current({}).is({ count: 1 }))
          .then(respond({ branch: "one" }))
          .named("one"),
      ),
    );
    const Existence = endpoint("/existence", () =>
      receive({}).then(
        where(Counting._named({ name: "counter" }))
          .then(respond({ branch: "present" }))
          .named("present"),
        where(no(Counting._named({ name: "counter" })))
          .then(respond({ branch: "absent" }))
          .named("absent"),
      ),
    );
    const Value = endpoint("/value", () =>
      receive({}).then(
        where(Counting._current({}).is({ count: 0 }))
          .then(respond({ branch: "zero" }))
          .named("zero"),
        where(Counting._current({}).is.not({ count: 0 }))
          .then(respond({ branch: "nonzero" }))
          .named("nonzero"),
      ),
    );
    const app = assemble({ vocabulary: vocab, composition: { Literal, Existence, Value } });
    expect(
      app.engine
        .exportReactions()
        .reactions.map((reaction) => reaction.name)
        .filter((name) => !name.startsWith("Deliver")),
    ).toEqual([
      "Existence:present",
      "Existence:absent",
      "Literal:zero",
      "Literal:one",
      "Value:zero",
      "Value:nonzero",
    ]);
  });

  test("overlapping siblings do not require a disjointness witness", () => {
    const Ambiguous = endpoint("/ambiguous", ({ count }) =>
      receive({}).then(
        where(Counting._current({}).is({ count }))
          .then(respond({ branch: "first", count }))
          .named("first"),
        where(Counting._current({}).is({ count }))
          .then(respond({ branch: "second", count }))
          .named("second"),
      ),
    );
    expect(() => assemble({ vocabulary: vocab, composition: { Ambiguous } })).not.toThrow();
  });

  test("values from a many relation may independently enable siblings", () => {
    const Ambiguous = endpoint("/ambiguous-many", () =>
      receive({}).then(
        where(Counting._seen({}).is({ count: 0 }))
          .then(respond({ branch: "zero" }))
          .named("zero"),
        where(Counting._seen({}).is({ count: 1 }))
          .then(respond({ branch: "one" }))
          .named("one"),
      ),
    );
    expect(() => assemble({ vocabulary: vocab, composition: { Ambiguous } })).not.toThrow();
  });

  test("nested qualifications flatten into stable sibling paths", () => {
    const Nested = endpoint("/nested", () =>
      receive({}).then(
        where(Counting._current({}).is({ count: 0 }))
          .then(respond({ branch: "zero" }))
          .named("zero"),
        where(
          Counting._current({}).is.not({ count: 0 }),
          Counting._named({ name: "counter" }).is({ count: 1 }),
        )
          .then(respond({ branch: "one" }))
          .named("one"),
        where(
          Counting._current({}).is.not({ count: 0 }),
          Counting._named({ name: "counter" }).is.not({ count: 1 }),
        )
          .then(respond({ branch: "many" }))
          .named("many"),
      ),
    );
    const app = assemble({ vocabulary: vocab, composition: { Nested } });
    const nested = app.engine
      .exportReactions()
      .reactions.filter((reaction) => reaction.name.startsWith("Nested"));
    expect(nested.map((reaction) => reaction.name)).toEqual([
      "Nested:zero",
      "Nested:one",
      "Nested:many",
    ]);
    expect(
      nested.every(
        (reaction) => "input" in reaction.when[0] && reaction.when[0].input.path === "/nested",
      ),
    ).toBe(true);
  });

  test("sibling branches lint a shared prefix across the whole group", () => {
    const Shared = endpoint("/shared", ({ count }) =>
      receive({})
        .where(Counting._current({}).is({ count }))
        .then(
          where(Counting._named({ name: "counter" }).is({ count: 0 }))
            .then(respond({ count }))
            .named("zero"),
          where(Counting._named({ name: "counter" }).is({ count: 1 }))
            .then(respond({ branch: "one", count }))
            .named("one"),
        ),
    );
    const app = assemble({ vocabulary: vocab, composition: { Shared } });
    expect(
      app.engine
        .exportReactions()
        .reactions.filter((reaction) => reaction.name.startsWith("Shared"))
        .map((reaction) => reaction.name),
    ).toEqual(["Shared:zero", "Shared:one"]);
  });

  test("a sibling rejects an unused binding inside its own path", () => {
    const Unused = endpoint("/unused", ({ value }) =>
      receive({}).then(
        where(
          Counting._current({}).is({ count: 0 }),
          Counting._named({ name: "first" }).is({ count: value }),
        )
          .then(respond({ branch: "first" }))
          .named("first"),
        where(
          Counting._current({}).is({ count: 1 }),
          Counting._named({ name: "second" }).is({ count: value }),
        )
          .then(respond({ value }))
          .named("second"),
      ),
    );
    expect(() => assemble({ vocabulary: vocab, composition: { Unused } })).toThrow(
      '"value" is opened and never used',
    );
  });

  test("sibling groups carry no coverage proof obligations", () => {
    const Named = endpoint("/named", () =>
      receive({}).then(
        where(Counting._named({ name: "counter" }).is({ count: 0 }))
          .then(respond({ branch: "zero" }))
          .named("zero"),
        where(Counting._named({ name: "counter" }).is({ count: 1 }))
          .then(respond({ branch: "one" }))
          .named("one"),
      ),
    );
    const app = assemble({ vocabulary: vocab, composition: { Named } });
    expect(
      app.engine
        .exportReactions()
        .reactions.filter((reaction) => reaction.name.startsWith("Named"))
        .map((reaction) => reaction.coverage),
    ).toEqual([undefined, undefined]);
    expect(app.engine.readBack()).not.toContain("assumes Counting._named fills");
  });
});
