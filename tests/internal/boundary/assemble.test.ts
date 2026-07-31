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
import { Logging } from "@sync-engine/assembly";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { no, reaction, vocabulary, when, where } from "@sync-engine/language";
import { Frames } from "@sync-engine/internal/reads/frames";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import { wireContracts } from "@sync-engine/tooling";

class CountingConcept {
  // Deliberately broad so this runtime suite can exercise a violated cardinality promise.
  static readonly queries: Record<string, "one" | "optional" | "many"> = {
    _current: "one",
    _named: "optional",
    _seen: "many",
  };
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
  receive({}).then(Counting.increment({}).responds({ count })).then(respond({ count })),
);

describe("assemble", () => {
  test("rejects an unknown query cache mode", () => {
    expect(() =>
      assemble({ vocabulary: vocab, composition: { Increment }, queryCache: "ttl" as never }),
    ).toThrow('queryCache must be "memoize" or "none"');
  });

  test("retains the newest 100 settled flows by default and accepts an override", () => {
    const app = assemble({ vocabulary: vocab, composition: { Increment } });
    const keepAll = assemble({
      vocabulary: vocab,
      composition: { Increment },
      retention: "keepAll",
      logging: Logging.TRACE,
    });

    expect((app.engine.Action.store as MemoryStore).policy).toEqual({ window: 100 });
    expect(app.engine.logging).toBe(Logging.OFF);
    expect((keepAll.engine.Action.store as MemoryStore).policy).toBe("keepAll");
    expect(keepAll.engine.logging).toBe(Logging.TRACE);
  });

  test("reactions register under their dotted composition path", async () => {
    const EchoIncrements = reaction(({ count }) =>
      when(Counting.increment({}).responds({ count })).then(Echoing.hear({ text: "bump" })),
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

  test("rejects omitted constructor arguments even through an untyped call", () => {
    class RequiredConcept {
      constructor(readonly name: string) {}
    }
    const required = vocabulary({ concepts: { Required: RequiredConcept }, computations: {} });

    expect(() => assemble({ vocabulary: required, composition: {} } as never)).toThrow(
      'assemble: concept "Required" requires constructor arguments; supply initialize or instances.',
    );
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

  test("rejects a supplied implementation that omits the concept protocol", () => {
    expect(() =>
      assemble({
        vocabulary: vocab,
        instances: { Counting: {} } as never,
        composition: {},
      }),
    ).toThrow('assemble: implementation for "Counting" does not implement `increment`, `_current`');
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

  test("a declared default makes a receive key optional across route alternatives", async () => {
    const WithText = endpoint(
      "/notes/alternative",
      ({ text }) => receive({ kind: "text", text }).then(respond({ text })),
      { input: { required: ["kind"], defaults: { text: "untitled" } } },
    );
    const WithoutText = endpoint("/notes/alternative", () =>
      receive({ kind: "empty" }).then(respond({ text: null })),
    );
    const app = assemble({ vocabulary: vocab, composition: { WithText, WithoutText } });

    await expect(app.invoker.invoke("/notes/alternative", { kind: "text" })).resolves.toEqual({
      ok: true,
      value: { text: "untitled" },
    });
    const generated = wireContracts(app.engine.exportReactions(), { contracts: app.contracts });
    expect(generated.endpoints[0]?.input).toMatchObject({
      kind: "object",
      fields: [{ key: "kind" }, { key: "text", optional: true }],
    });
  });

  test("rejects an explicit contract whose omitted keys cannot match a receive alternative", () => {
    const WithText = endpoint(
      "/notes/contradictory",
      ({ text }) => receive({ kind: "text", text }).then(respond({ text })),
      { input: { required: ["kind"] } },
    );

    expect(() => assemble({ vocabulary: vocab, composition: { WithText } })).toThrow(
      "assemble: input contract for /notes/contradictory admits omitted optional keys that no receive alternative can match.",
    );
  });

  test("accepts a default that selects one literal receive alternative", async () => {
    const Plain = endpoint(
      "/notes/literal-default",
      () => receive({ format: "plain" }).then(respond({ format: "plain" })),
      { input: { defaults: { format: "rich" } } },
    );
    const Rich = endpoint("/notes/literal-default", () =>
      receive({ format: "rich" }).then(respond({ format: "rich" })),
    );
    const app = assemble({ vocabulary: vocab, composition: { Plain, Rich } });

    await expect(app.invoker.invoke("/notes/literal-default", {})).resolves.toEqual({
      ok: true,
      value: { format: "rich" },
    });
  });

  test("rejects an executable endpoint that cannot join the public route set", () => {
    const ClosureEndpoint = endpoint("/closure", ({ count, hidden }) =>
      receive({})
        .where((frames: Frames) => frames.map((frame) => ({ ...frame, [hidden]: "kept" })))
        .then(Counting.increment({}).responds({ count }))
        .then(respond({ hidden })),
    );

    expect(() =>
      assemble({
        vocabulary: vocab,
        composition: { Api: { ClosureEndpoint } },
      }),
    ).toThrow(
      "assemble: ordinary assembly accepts portable behavior only:\n" +
        '- local reaction "Api.ClosureEndpoint": unlowered reaction: ' +
        "step 2 needs a value bound by a closure where",
    );
  });

  test("the assembled invoker rejects paths outside the declared endpoint catalog", async () => {
    const app = assemble({ vocabulary: vocab, composition: { Increment } });

    await expect(app.invoker.invoke("/missing", {})).resolves.toEqual({
      ok: false,
      error: {
        kind: "framework",
        code: "NOT_FOUND",
        detail: "Unknown endpoint: /missing",
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

  test("respond answers with the named error through the domain-error channel", async () => {
    const Gate = endpoint("/gated", () => receive({}).then(respond({ error: "FORBIDDEN" })));
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
        .map((reaction) => reaction.name),
    ).toEqual(["Named:zero", "Named:one"]);
    expect(app.engine.readBack()).not.toContain("assumes Counting._named fills");
  });
});
