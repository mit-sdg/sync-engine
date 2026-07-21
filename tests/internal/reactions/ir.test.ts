import { lineOf } from "@sync-engine/internal/reads/lines";
/**
 * Reaction lowering and serialized reaction registration. These tests cover step
 * chains, consequence-input validation, JSON round trips, and fixture export.
 */
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  type ActionTriggerIR,
  type AppIR,
  compute,
  type Frames,
  Logging,
  opaqueCount,
  reaction,
  Reacting,
  type Vars,
  when,
  vocabulary,
  vocabularyComputations,
} from "@sync-engine/internal/reactions";
import {
  EnrollingConcept,
  GroupingConcept,
  ObligatingConcept,
  OrganizingConcept,
  ProfilingConcept,
  TimingConcept,
} from "../../golden/lms/concepts.ts";
import { makeLMSReactions } from "../../golden/lms/reactions.ts";
import { FocusConcept, HistoryConcept, WorkConcept } from "../../golden/stitch/concepts.ts";
import { makeStitchReactions } from "../../golden/stitch/reactions.ts";
import { AuditConcept, TodoConcept } from "../../golden/todo/concepts.ts";
import { makeTodoReactions } from "../../golden/todo/reactions.ts";
import { ButtonConcept, ListConcept, RecorderConcept } from "./mocks.ts";

class DecidingConcept {
  decide({ kind }: { kind: string }) {
    return { route: `route:${kind}` };
  }
}

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
    const { reacting, Button, Deciding, Recorder } = setup();
    reacting.register({
      Chain: reaction(({ kind, route }: Vars) =>
        when(Button.clicked, { kind })
          .then(request(Deciding.decide, { kind }, { route }))
          .then(request(Recorder.record, { tag: route })),
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
    const { reacting, Button, Deciding, Recorder } = setup();
    reacting.register({
      NeedsRoot: reaction(({ kind, route }: Vars) =>
        when(Button.clicked, { kind })
          .then(request(Deciding.decide, {}, { route }))
          .then(request(Recorder.record, { tag: kind })),
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
        },
      },
    ]);
  });

  test(".named() overrides a derived reaction name", () => {
    const { reacting, Button, Deciding, Recorder } = setup();
    reacting.register({
      Named: reaction(({ route }: Vars) =>
        when(Button.clicked, { kind: "n" })
          .then(request(Deciding.decide, { kind: "n" }, { route }))
          .then(request(Recorder.record, { tag: route }).named("RecordRoute")),
      ),
    });
    expect(reacting.exportReactions().reactions.map((reaction) => reaction.name)).toEqual([
      "Named",
      "RecordRoute",
    ]);
  });

  test("a step transform is reported as executable-only code", () => {
    const { reacting, Button, Deciding, Recorder } = setup();
    reacting.register({
      Transformed: reaction(({ tag }: Vars) =>
        when(Button.clicked, { kind: "c" })
          .then(
            request(Deciding.decide, { kind: "c" }).where((frames: Frames) =>
              frames.map((frame) => ({ ...frame })),
            ),
          )
          .then(request(Recorder.record, { tag })),
      ),
    });
    const app = reacting.exportReactions();
    expect(app.reactions).toEqual([]);
    expect(app.unlowered).toEqual([
      { name: "Transformed", reason: "a step transform in the pipeline" },
    ]);
    expect(opaqueCount(app)).toBe(1);
  });

  test("a later step does not repeat a state read from an earlier step", () => {
    const { reacting, Button, List, Recorder } = setup();
    reacting.register({
      RowCrossing: reaction(({ value }: Vars) =>
        when(Button.clicked, { kind: "rows" })
          .where(lineOf({ query: List._items }, {}).is({ value }))
          .then(request(Recorder.record, { tag: "first" }))
          .then(request(Recorder.record, { tag: value })),
      ),
    });
    const app = reacting.exportReactions();
    expect(app.unlowered[0]?.reason).toContain("re-run at a later position");
  });
});

describe("then-input strictness", () => {
  test("a registration-time Date error points to per-firing calculations", () => {
    const { reacting, Button, Recorder } = setup();
    expect(() =>
      reacting.register({
        Frozen: reaction((_vars: Vars) =>
          when(Button.clicked, { kind: "d" }).then(
            request(Recorder.record, { tag: new Date() as never }),
          ),
        ),
      }),
    ).toThrow(/registration-time value.*vocabulary computation or custom op/s);
  });

  test("a function in a then input is rejected", () => {
    const { reacting, Button, Recorder } = setup();
    expect(() =>
      reacting.register({
        Sneaky: reaction((_vars: Vars) =>
          when(Button.clicked, { kind: "f" }).then(
            request(Recorder.record, { tag: (() => "nope") as never }),
          ),
        ),
      }),
    ).toThrow("a function");
  });

  test("nested literals and variables stay legal", () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Fine: reaction(({ kind }: Vars) =>
        when(Button.clicked, { kind }).then(
          request(Recorder.record, { tag: { nested: [1, "two", null, kind] } as never }),
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
          when(engine.Button.clicked, { kind: "go" })
            .where(compute(stamp, { kind: "go" }, mark))
            .then(request(engine.Deciding.decide, { kind: "go" }, { route }))
            .then(request(engine.Recorder.record, { tag: route })),
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
});

describe("integration fixtures export supported reactions", () => {
  test("LMS: every reaction exports with serializable conditions", () => {
    const reacting = new Reacting();
    reacting.logging = Logging.OFF;
    const { Profiles, Courses, Groups, Enrollments, Obligations, Timing } = reacting.instrument({
      Profiles: new ProfilingConcept(),
      Courses: new OrganizingConcept(),
      Groups: new GroupingConcept(),
      Enrollments: new EnrollingConcept(),
      Obligations: new ObligatingConcept(),
      Timing: new TimingConcept(),
    });
    reacting.register(
      makeLMSReactions(Profiles, Courses, Groups, Enrollments, Obligations, Timing),
    );

    const app = reacting.exportReactions();
    expect(app.unlowered).toEqual([]);
    expect(app.reactions.length).toBe(6);
    expect(opaqueCount(app)).toBe(0);
    // The due date is read from the Timing concept at the firing position.
    const dueDates = app.reactions.flatMap((reaction) =>
      reaction.where.filter(
        (op) =>
          op.op === "find" &&
          "query" in op &&
          op.query?.concept === "Timing" &&
          op.query?.query === "_now",
      ),
    );
    expect(dueDates.length).toBe(1);
    expect(JSON.parse(JSON.stringify(app))).toEqual(app);
  });

  test("stitch and todo: every reaction lowers with zero opaque ops", () => {
    const stitch = new Reacting();
    stitch.logging = Logging.OFF;
    const { Work, Focus, History } = stitch.instrument({
      Work: new WorkConcept({ nextId: 1, items: [] }),
      Focus: new FocusConcept({ current: null, sessions: [] }),
      History: new HistoryConcept({ entries: [] }),
    });
    stitch.register(makeStitchReactions(Work, Focus, History));
    const stitchApp = stitch.exportReactions();
    expect(stitchApp.unlowered).toEqual([]);
    expect(stitchApp.reactions.length).toBe(7);
    expect(opaqueCount(stitchApp)).toBe(0);

    const todo = new Reacting();
    todo.logging = Logging.OFF;
    const { Todo, Audit } = todo.instrument({
      Todo: new TodoConcept(),
      Audit: new AuditConcept(),
    });
    todo.register(makeTodoReactions(Todo, Audit));
    const todoApp = todo.exportReactions();
    expect(todoApp.unlowered).toEqual([]);
    expect(todoApp.reactions.length).toBe(3);
    expect(opaqueCount(todoApp)).toBe(0);
  });
});
