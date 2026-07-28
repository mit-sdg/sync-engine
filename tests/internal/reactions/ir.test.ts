/**
 * Reaction lowering and serialized reaction registration. These tests cover step
 * chains, consequence-input validation, JSON round trips, and fixture export.
 */
import { describe, expect, test } from "vite-plus/test";
import { Logging } from "@sync-engine/assembly";
import { reaction, vocabulary, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/language";
import type { Frames } from "@sync-engine/internal/reads/frames";
import { analyzeLocalBehavior } from "@sync-engine/internal/reads/local-behavior";
import type { ActionTriggerIR, AppIR } from "@sync-engine/internal/reads/ir";
import { compute } from "@sync-engine/internal/reads/where-ops";
import { vocabularyComputations } from "@sync-engine/internal/reactions/authoring/refs";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import type { StepNode } from "@sync-engine/internal/reactions/types";
import { ButtonConcept, CounterConcept, ListConcept, mockRefs, RecorderConcept } from "./mocks.ts";

class DecidingConcept {
  decide({ kind }: { kind: string }) {
    return { route: `route:${kind}` };
  }
}

const refs = vocabulary({
  concepts: {
    Button: ButtonConcept,
    Deciding: DecidingConcept,
    List: ListConcept,
    Recorder: RecorderConcept,
  },
}).concepts;

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const concepts = reacting.instrument({
    Button: new ButtonConcept(),
    Deciding: new DecidingConcept(),
    List: new ListConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

describe("lowering: chains become reactions", () => {
  test("a two-step then lowers to a chained reaction pinned to its own ask", () => {
    const { reacting } = setup();
    reacting.register({
      Chain: reaction(({ kind, route }: Vars) =>
        when(refs.Button.clicked({ kind }).responds())
          .then(refs.Deciding.decide({ kind }).responds({ route }))
          .then(refs.Recorder.record({ tag: route })),
      ),
    });

    const app = reacting.exportReactions();
    expect(app.unlowered).toEqual([]);
    expect(app.reactions.map((reaction) => reaction.name)).toEqual(["Chain", "Chain#2"]);

    const [head, next] = app.reactions;
    expect(head.when).toEqual([
      {
        kind: "action",
        concept: "Button",
        action: "clicked",
        input: { kind: { $var: "kind" } },
        output: {},
        posture: "returned",
      },
    ]);
    expect(head.then).toEqual([
      { kind: "request", concept: "Deciding", action: "decide", input: { kind: { $var: "kind" } } },
    ]);

    const trigger = next.when[0] as ActionTriggerIR;
    expect(trigger.concept).toBe("Deciding");
    expect(trigger.action).toBe("decide");
    expect(trigger.posture).toBe("returned");
    expect(trigger.by).toBe("Chain");
    expect(trigger.output).toEqual({ route: { $var: "route" } });
    // route travels on the trigger record — no earlier read needed.
    expect(next.where).toEqual([]);
  });

  test("a later step recovers trigger input with an earlier read", () => {
    const { reacting } = setup();
    reacting.register({
      NeedsRoot: reaction(({ kind, route }: Vars) =>
        when(refs.Button.clicked({ kind }).responds())
          .then(refs.Deciding.decide({}).responds({ route }) as never)
          .then(refs.Recorder.record({ tag: kind })),
      ),
    });

    const [, next] = reacting.exportReactions().reactions;
    expect(next.where).toEqual([
      {
        op: "earlier",
        when: {
          kind: "action",
          concept: "Button",
          action: "clicked",
          input: { kind: { $var: "kind" } },
          output: {},
          posture: "returned",
        },
      },
    ]);
  });

  test(".named() overrides a derived reaction name", () => {
    const { reacting } = setup();
    reacting.register({
      Named: reaction(({ route }: Vars) => {
        const record = refs.Recorder.record({ tag: route }) as StepNode;
        record.stepName = "RecordRoute";
        return when(refs.Button.clicked({ kind: "n" }).responds())
          .then(refs.Deciding.decide({ kind: "n" }).responds({ route }))
          .then(record as never);
      }),
    });
    expect(reacting.exportReactions().reactions.map((reaction) => reaction.name)).toEqual([
      "Named",
      "RecordRoute",
    ]);
  });

  test("a step transform is reported as executable-only code", () => {
    const { reacting } = setup();
    reacting.register({
      Transformed: reaction(({ tag }: Vars) => {
        const transformed = refs.Deciding.decide({ kind: "c" }) as StepNode;
        transformed.transform = (frames: Frames) => frames.map((frame) => ({ ...frame }));
        return when(refs.Button.clicked({ kind: "c" }).responds())
          .then(transformed as never)
          .then(refs.Recorder.record({ tag }));
      }),
    });
    const app = reacting.exportReactions();
    expect(app.reactions).toEqual([]);
    expect(app.unlowered).toMatchObject([
      { name: "Transformed", reason: "a step transform in the pipeline" },
    ]);
    expect(analyzeLocalBehavior(app).occurrences).toHaveLength(1);
  });

  test("a later step does not repeat a state read from an earlier step", () => {
    const { reacting } = setup();
    reacting.register({
      RowCrossing: reaction(({ value }: Vars) =>
        when(refs.Button.clicked({ kind: "rows" }).responds())
          .where(refs.List._items({}).is({ value }))
          .then(refs.Recorder.record({ tag: "first" }))
          .then(refs.Recorder.record({ tag: value })),
      ),
    });
    const app = reacting.exportReactions();
    expect(app.unlowered[0]?.reason).toContain("re-run at a later position");
  });
});

describe("then-input strictness", () => {
  test("a registration-time Date error points to per-firing calculations", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.register({
        Frozen: reaction((_vars: Vars) =>
          when(refs.Button.clicked({ kind: "d" }).responds()).then(
            refs.Recorder.record({ tag: new Date() as never }),
          ),
        ),
      }),
    ).toThrow(/registration-time value.*vocabulary computation or custom op/s);
  });

  test("a function in a then input is rejected", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.register({
        Sneaky: reaction((_vars: Vars) =>
          when(refs.Button.clicked({ kind: "f" }).responds()).then(
            refs.Recorder.record({ tag: (() => "nope") as never }),
          ),
        ),
      }),
    ).toThrow("a function");
  });

  test("nested literals and variables stay legal", () => {
    const { reacting } = setup();
    reacting.register({
      Fine: reaction(({ kind }: Vars) =>
        when(refs.Button.clicked({ kind }).responds()).then(
          refs.Recorder.record({ tag: { nested: [1, "two", null, kind] } as never }),
        ),
      ),
    });
    expect(reacting.exportReactions().reactions.length).toBe(1);
  });
});

describe("round trip: export → JSON → registerReactions", () => {
  test("re-registered reactions behave identically and re-export identically", async () => {
    const words = vocabulary({
      concepts: {},
      computations: { stamp: ({ kind }) => `stamped:${String(kind)}` },
    });
    const stamp = words.computations.stamp;

    const declare = (engine: ReturnType<typeof setup>) => {
      engine.reacting.register({
        Chain: reaction(({ route, mark }: Vars) =>
          when(refs.Button.clicked({ kind: "go" }).responds())
            .where(compute(stamp, { kind: "go" }, mark))
            .then(refs.Deciding.decide({ kind: "go" }).responds({ route }))
            .then(refs.Recorder.record({ tag: route })),
        ),
      });
    };

    const first = setup();
    first.reacting.registerComputations(vocabularyComputations(words));
    declare(first);
    const exported: AppIR = JSON.parse(JSON.stringify(first.reacting.exportReactions()));

    await first.Button.clicked({ kind: "go" });
    await first.Button.clicked({ kind: "stop" });

    const second = setup();
    second.reacting.registerComputations(vocabularyComputations(words));
    second.reacting.registerReactions(exported.reactions);

    await second.Button.clicked({ kind: "go" });
    await second.Button.clicked({ kind: "stop" });

    expect(second.Recorder.order).toEqual(first.Recorder.order);
    expect(second.Recorder.order).toEqual(["route:go"]);

    // Registering and exporting the serialized reactions preserves their data.
    expect(JSON.parse(JSON.stringify(second.reacting.exportReactions())).reactions).toEqual(
      exported.reactions,
    );
  });

  test("an unresolvable reference is a registration error", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.registerReactions([
        {
          name: "Ghost",
          when: [{ kind: "action", concept: "Nowhere", action: "does", input: {}, output: {} }],
          where: [],
          then: [{ kind: "request", concept: "Nowhere", action: "does", input: {} }],
        },
      ]),
    ).toThrow(
      'Reaction "Ghost": no instrumented concept is named "Nowhere" — instrument it before registering reactions.',
    );
  });

  test.each([
    ["$oneOf", { $oneOf: "not-an-array" }],
    ["$regexp", { $regexp: { source: "[", flags: "" } }],
    ["$var", { $var: 7 }],
  ])("rejects a malformed serialized %s marker", (_tag, marker) => {
    const { reacting } = setup();
    expect(() =>
      reacting.registerReactions([
        {
          name: "MalformedMarker",
          when: [
            {
              kind: "action",
              concept: "Button",
              action: "clicked",
              input: { kind: marker as never },
              output: {},
            },
          ],
          where: [],
          then: [{ kind: "request", concept: "Recorder", action: "record", input: { tag: "x" } }],
        },
      ]),
    ).toThrow(/marker .* requires/);
  });
});

describe("mock concepts export supported reactions", () => {
  test("every reaction lowers with zero opaque ops and serializes", () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    reacting.instrument({
      Counter: new CounterConcept(),
      Button: new ButtonConcept(),
    });
    reacting.register({
      TrackClicks: ({ kind }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds()).then(mockRefs.Counter.increment({})),
      DoubleClick: ({ kind }: Vars) =>
        when(mockRefs.Button.clicked({ kind }).responds()).then(
          mockRefs.Counter.decrement({}).named("Dec"),
        ),
    });

    const app = reacting.exportReactions();
    expect(app.unlowered).toEqual([]);
    expect(app.reactions.length).toBe(2);
    expect(analyzeLocalBehavior(app).occurrences).toHaveLength(0);
    expect(JSON.parse(JSON.stringify(app))).toEqual(app);
  });
});
