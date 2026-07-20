import { describe, expect, test } from "vite-plus/test";
import {
  count,
  no,
  reaction,
  Reacting,
  request,
  type Vars,
  vocabulary,
  when,
  where,
} from "@sync-engine/internal/reactions";
import { ButtonConcept, RecorderConcept } from "./mocks.ts";

class RoutingConcept {
  static readonly queries = {
    _route: "one",
    _named: "optional",
    _routes: "many",
  } as const;

  _route(_: Record<string, never>) {
    return [{ route: "left" }];
  }

  _named({ name }: { name: string }) {
    return name === "present" ? [{ route: "left" }] : [];
  }

  _routes(_: Record<string, never>) {
    return [{ route: "left" }, { route: "right" }];
  }
}

const words = vocabulary({
  concepts: {
    Button: ButtonConcept,
    Recorder: RecorderConcept,
    Routing: RoutingConcept,
  },
  computations: {},
});
const { Button, Recorder, Routing } = words.concepts;

function setup() {
  const engine = new Reacting();
  engine.instrument({
    Button: new ButtonConcept(),
    Recorder: new RecorderConcept(),
    Routing: new RoutingConcept(),
  });
  return { engine, Button, Recorder, Routing };
}

describe("ordinary reaction partitions", () => {
  test("literal, existence, and value witnesses lower to named leaves", () => {
    const { engine, Button, Recorder, Routing } = setup();
    engine.register({
      Literal: reaction(() =>
        when(Button.clicked, {}).either(
          where(Routing._route({}).is({ route: "left" })).then(
            request(Recorder.record, { tag: "left" }),
          ),
          where(Routing._route({}).is({ route: "right" })).then(
            request(Recorder.record, { tag: "right" }),
          ),
        ),
      ),
      Existence: reaction(() =>
        when(Button.clicked, {}).either(
          where(Routing._named({ name: "present" })).then(
            request(Recorder.record, { tag: "present" }),
          ),
          where(no(Routing._named({ name: "present" }))).then(
            request(Recorder.record, { tag: "absent" }),
          ),
        ),
      ),
      Value: reaction(({ route }: Vars) =>
        when(Button.clicked, { kind: route }).either(
          where(Routing._route({}).is({ route })).then(request(Recorder.record, { tag: "same" })),
          where(Routing._route({}).is.not({ route })).then(
            request(Recorder.record, { tag: "different" }),
          ),
        ),
      ),
    });

    expect(engine.exportReactions().reactions.map((entry) => entry.name)).toEqual([
      "Literal",
      "Literal:2",
      "Existence",
      "Existence:2",
      "Value",
      "Value:2",
    ]);
  });

  test("a declarative prefix is shared and a nested partition keeps chain names", () => {
    const { engine, Button, Recorder, Routing } = setup();
    engine.register({
      Routed: reaction(({ route }: Vars) =>
        when(Button.clicked, {})
          .where(Routing._route({}).is({ route }))
          .either(
            where(Routing._route({}).is({ route: "left" })).then(
              request(Recorder.record, { tag: route }),
              request(Recorder.record, { tag: "left-again" }),
            ),
            where(Routing._route({}).is.not({ route: "left" })).either(
              where(Routing._named({ name: "present" }).is({ route: "right" })).then(
                request(Recorder.record, { tag: "right" }),
                request(Recorder.record, { tag: "right-again" }),
              ),
              where(Routing._named({ name: "present" }).is.not({ route: "right" })).then(
                request(Recorder.record, { tag: "other" }),
              ),
            ),
          ),
      ),
    });

    expect(engine.exportReactions().reactions.map((entry) => entry.name)).toEqual([
      "Routed",
      "Routed#2",
      "Routed:2",
      "Routed:2#2",
      "Routed:3",
    ]);
  });

  test("multi-clause triggers retain every clause on every leaf", () => {
    const { engine, Button, Recorder, Routing } = setup();
    engine.register({
      Joined: reaction(() =>
        when([
          [Button.clicked, { kind: "route" }],
          [Recorder.record, { tag: "ready" }],
        ]).either(
          where(Routing._route({}).is({ route: "left" })).then(
            request(Recorder.record, { tag: "left" }),
          ),
          where(Routing._route({}).is({ route: "right" })).then(
            request(Recorder.record, { tag: "right" }),
          ),
        ),
      ),
    });

    expect(engine.exportReactions().reactions.map((entry) => entry.when.length)).toEqual([2, 2]);
  });

  test("registration rejects an absent witness and literals from a many relation", () => {
    const { engine, Button, Recorder, Routing } = setup();
    expect(() =>
      engine.register({
        Ambiguous: reaction(({ route }: Vars) =>
          when(Button.clicked, {}).either(
            where(Routing._route({}).is({ route })).then(
              request(Recorder.record, { tag: "first" }),
            ),
            where(Routing._route({}).is({ route })).then(
              request(Recorder.record, { tag: "second" }),
            ),
          ),
        ),
      }),
    ).toThrow("can both match");

    expect(() =>
      engine.register({
        Many: reaction(() =>
          when(Button.clicked, {}).either(
            where(Routing._routes({}).is({ route: "left" })).then(
              request(Recorder.record, { tag: "left" }),
            ),
            where(Routing._routes({}).is({ route: "right" })).then(
              request(Recorder.record, { tag: "right" }),
            ),
          ),
        ),
      }),
    ).toThrow("can both match");
  });

  test("coverage and unused openings are checked per leaf", () => {
    const { engine, Button, Recorder, Routing } = setup();
    engine.register({
      Covered: reaction(() =>
        when(Button.clicked, {}).either(
          where(Routing._named({ name: "present" }).is({ route: "left" })).then(
            request(Recorder.record, { tag: "left" }),
          ),
          where(Routing._named({ name: "present" }).is({ route: "right" })).then(
            request(Recorder.record, { tag: "right" }),
          ),
        ),
      ),
    });
    expect(engine.exportReactions().reactions.map((entry) => entry.coverage)).toEqual([
      ["Routing._named"],
      ["Routing._named"],
    ]);
    expect(engine.readBack()).toContain("assumes Routing._named fills");

    expect(() =>
      engine.register({
        Unused: reaction(({ unused }: Vars) =>
          when(Button.clicked, {}).either(
            where(
              Routing._route({}).is({ route: "left" }),
              Routing._named({ name: "missing" }).is({ route: unused }),
            ).then(request(Recorder.record, { tag: "left" })),
            where(Routing._route({}).is({ route: "right" })).then(
              request(Recorder.record, { tag: "right" }),
            ),
          ),
        ),
      }),
    ).toThrow('"unused" is opened and never used');
  });

  test("replacing a partition removes old leaves and keeps its family", () => {
    const { engine, Button, Recorder, Routing } = setup();
    engine.register({
      Replaceable: reaction(() =>
        when(Button.clicked, {}).either(
          where(Routing._route({}).is({ route: "left" })).then(
            request(Recorder.record, { tag: "left" }),
          ),
          where(Routing._route({}).is.not({ route: "left" })).either(
            where(Routing._named({ name: "present" }).is({ route: "right" })).then(
              request(Recorder.record, { tag: "right" }),
            ),
            where(Routing._named({ name: "present" }).is.not({ route: "right" })).then(
              request(Recorder.record, { tag: "other" }),
            ),
          ),
        ),
      ),
    });
    expect(engine.exportReactions().reactions.map((entry) => entry.name)).toContain(
      "Replaceable:3",
    );

    engine.register({
      Replaceable: reaction(() =>
        when(Button.clicked, {}).either(
          where(Routing._route({}).is({ route: "left" })).then(
            request(Recorder.record, { tag: "left" }),
          ),
          where(Routing._route({}).is.not({ route: "left" })).then(
            request(Recorder.record, { tag: "other" }),
          ),
        ),
      ),
    });

    expect(engine.exportReactions().reactions.map((entry) => entry.name)).toEqual([
      "Replaceable",
      "Replaceable:2",
    ]);
    expect(engine.reactions["Replaceable:3"]).toBeUndefined();
  });

  test("derived leaf and named chain collisions are rejected before replacement", () => {
    const { engine, Button, Recorder, Routing } = setup();
    engine.register({
      Partitioned: reaction(() =>
        when(Button.clicked, {}).then(request(Recorder.record, { tag: "original" })),
      ),
    });
    engine.register({
      Existing: reaction(() =>
        when(Button.clicked, {}).then(
          request(Recorder.record, { tag: "existing" }).named("Partitioned:2"),
        ),
      ),
    });

    expect(() =>
      engine.register({
        Partitioned: reaction(() =>
          when(Button.clicked, {}).either(
            where(Routing._route({}).is({ route: "left" })).then(
              request(Recorder.record, { tag: "left" }),
            ),
            where(Routing._route({}).is({ route: "right" })).then(
              request(Recorder.record, { tag: "right" }),
            ),
          ),
        ),
      }),
    ).toThrow('already owned by "Existing"');
    expect(engine.exportReactions().reactions.map((entry) => entry.name)).toEqual([
      "Partitioned",
      "Partitioned:2",
    ]);
    expect(engine.exportReactions().reactions[0].then[0]).toMatchObject({
      input: { tag: "original" },
    });
  });

  test("count cannot enter a reaction case", () => {
    const { engine, Button, Recorder, Routing } = setup();
    expect(() =>
      engine.register({
        Counted: reaction(({ total }: Vars) =>
          when(Button.clicked, {}).either(
            where(count(Routing._routes, {}, total)).then(
              request(Recorder.record, { tag: "counted" }),
            ),
            where(Routing._route({}).is({ route: "left" })).then(
              request(Recorder.record, { tag: "left" }),
            ),
          ),
        ),
      }),
    ).toThrow("count(...) cannot be used in a reaction condition");
  });
});
