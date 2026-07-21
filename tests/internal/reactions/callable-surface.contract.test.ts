import { reaction, vocabulary, when, where } from "@sync-engine/language";
import { describe, expect, test } from "vite-plus/test";
import { Refuse, Reacting, type AppIR } from "@sync-engine/internal/reactions";

class StartingConcept {
  started: string[] = [];

  start({ item }: { item: string }) {
    this.started.push(item);
    return { job: `job:${item}` };
  }
}

class FailingConcept {
  fail({ item }: { item: string }): Record<string, never> {
    throw new Refuse("FAILED", { detail: item });
  }
}

class HandlingConcept {
  calls: string[] = [];

  left({ item }: { item: string }) {
    this.calls.push(`left:${item}`);
    return {};
  }

  right({ item }: { item: string }) {
    this.calls.push(`right:${item}`);
    return {};
  }
}

class AuditingConcept {
  calls: string[] = [];

  c({ item }: { item: string }) {
    this.calls.push(`c:${item}`);
    return {};
  }

  d({ item }: { item: string }) {
    this.calls.push(`d:${item}`);
    return {};
  }
}

class PreparingConcept {
  prepare({ item }: { item: string }) {
    return { prepared: `prepared:${item}` };
  }
}

class FinishingConcept {
  finished: string[] = [];

  finish({ prepared }: { prepared: string }) {
    this.finished.push(prepared);
    return {};
  }
}

class RoutingConcept {
  static readonly queries = { _enabled: "one" } as const;

  _enabled({ item }: { item: string }) {
    return { enabled: item === "ready" };
  }
}

class RecordingConcept {
  events: string[] = [];

  record({ event }: { event: string }) {
    this.events.push(event);
    return {};
  }
}

const words = vocabulary({
  concepts: {
    Starting: StartingConcept,
    Failing: FailingConcept,
    Handling: HandlingConcept,
    Auditing: AuditingConcept,
    Preparing: PreparingConcept,
    Finishing: FinishingConcept,
    Routing: { class: RoutingConcept, queries: RoutingConcept.queries },
    Recording: RecordingConcept,
  },
  computations: {},
});

const { Starting, Failing, Handling, Auditing, Preparing, Finishing, Routing, Recording } =
  words.concepts;

function setup() {
  const engine = new Reacting();
  const raw = {
    Starting: new StartingConcept(),
    Failing: new FailingConcept(),
    Handling: new HandlingConcept(),
    Auditing: new AuditingConcept(),
    Preparing: new PreparingConcept(),
    Finishing: new FinishingConcept(),
    Routing: new RoutingConcept(),
    Recording: new RecordingConcept(),
  };
  const concepts = Object.fromEntries(
    Object.entries(raw).map(([name, concept]) => [name, engine.instrumentConcept(concept, name)]),
  ) as typeof raw;
  return { engine, concepts, raw };
}

function siblingReaction(reverse: boolean) {
  return reaction(({ item }) => {
    const left = Handling.left({ item }).named("left");
    const right = Handling.right({ item }).named("right");
    const trigger = when(Starting.start({ item }).responds());
    return reverse ? trigger.then(right, left) : trigger.then(left, right);
  });
}

function byText(left: string, right: string) {
  return left.localeCompare(right);
}

describe("callable action posture", () => {
  test("requested, returned, and refused lines watch distinct occurrences", async () => {
    const { engine, concepts, raw } = setup();
    engine.register({
      Requested: reaction(({ item }) =>
        when(Starting.start({ item })).then(Recording.record({ event: "requested" })),
      ),
      Returned: reaction(({ item, job }) =>
        when(Starting.start({ item }).responds({ job })).then(Recording.record({ event: job })),
      ),
      Refused: reaction(({ item, message }) =>
        when(Failing.fail({ item }).refuses({ message })).then(
          Recording.record({ event: message }),
        ),
      ),
    });

    await concepts.Starting.start({ item: "one" });
    await concepts.Failing.fail({ item: "one" });

    expect(raw.Recording.events).toEqual(["requested", "job:one", "FAILED"]);
    expect(engine.exportReactions().reactions.map(({ when: [trigger] }) => trigger)).toMatchObject([
      { kind: "action", posture: "requested" },
      { kind: "action", posture: "returned" },
      { kind: "action", posture: "refused" },
    ]);
  });
});

describe("sibling paths", () => {
  test("overlapping siblings both fire and labels survive source reordering", async () => {
    const first = setup();
    first.engine.register({ Spread: siblingReaction(false) });
    const reversed = setup();
    reversed.engine.register({ Spread: siblingReaction(true) });

    const names = (app: AppIR) => app.reactions.map(({ name }) => name).sort(byText);
    expect(names(first.engine.exportReactions())).toEqual(["Spread:left", "Spread:right"]);
    expect(names(reversed.engine.exportReactions())).toEqual(names(first.engine.exportReactions()));

    await first.concepts.Starting.start({ item: "one" });
    expect(first.raw.Handling.calls.sort(byText)).toEqual(["left:one", "right:one"]);

    const provenance = [...first.engine.Action.actions.values()]
      .flatMap(({ by }) => (by?.startsWith("Spread:") === true ? [by] : []))
      .sort(byText);
    expect(provenance).toEqual(["Spread:left", "Spread:right"]);
  });

  test("later sibling groups distribute over existing frontiers without repeating parents", async () => {
    const { engine, concepts, raw } = setup();
    engine.register({
      Distributed: reaction(({ item }) =>
        when(Starting.start({ item }).responds())
          .then(Handling.left({ item }).named("left"), Handling.right({ item }).named("right"))
          .then(Auditing.c({ item }).named("c"), Auditing.d({ item }).named("d")),
      ),
    });

    expect(
      engine
        .exportReactions()
        .reactions.map(({ name }) => name)
        .sort(byText),
    ).toEqual([
      "Distributed:left",
      "Distributed:left:c#2",
      "Distributed:left:d#2",
      "Distributed:right",
      "Distributed:right:c#2",
      "Distributed:right:d#2",
    ]);

    await concepts.Starting.start({ item: "one" });
    expect(raw.Handling.calls.sort(byText)).toEqual(["left:one", "right:one"]);
    expect(raw.Auditing.calls.sort(byText)).toEqual(["c:one", "c:one", "d:one", "d:one"]);
  });

  test("registration names the path and fresh name used by an unreachable stage", () => {
    const { engine } = setup();
    expect(() =>
      engine.register({
        UnboundPath: reaction(({ item, ghost }) =>
          when(Starting.start({ item }).responds())
            .then(Handling.left({ item }).named("left"), Handling.right({ item }).named("right"))
            .then(Auditing.c({ item: ghost }).named("c"), Auditing.d({ item }).named("d")),
        ),
      }),
    ).toThrow('Reaction "UnboundPath", path "left → c": stage 2 uses "ghost" before it is bound.');
  });
});

describe("branch-local chains", () => {
  test("runtime rejects variadic local stages and labels inside the path", () => {
    expect(() =>
      (where(Routing._enabled({ item: "ready" }).is({ enabled: true })).then as Function)(
        Preparing.prepare({ item: "ready" }),
        Finishing.finish({ prepared: "ready" }),
      ),
    ).toThrow("a branch-local then(...) takes one callable action line.");

    expect(() =>
      where(Routing._enabled({ item: "ready" }).is({ enabled: true })).then(
        Preparing.prepare({ item: "ready" }).named("inside") as never,
      ),
    ).toThrow("name the qualified branch after its local action chain");
  });

  test("a branch carries a returned binding into its private next stage", async () => {
    const { engine, concepts, raw } = setup();
    engine.register({
      PrepareReady: reaction(({ item, prepared }) =>
        when(Starting.start({ item }).responds()).then(
          where(Routing._enabled({ item }).is({ enabled: true }))
            .then(Preparing.prepare({ item }).responds({ prepared }))
            .then(Finishing.finish({ prepared }))
            .named("ready"),
        ),
      ),
    });

    await concepts.Starting.start({ item: "ready" });
    await concepts.Starting.start({ item: "blocked" });

    expect(raw.Finishing.finished).toEqual(["prepared:ready"]);
    expect(engine.exportReactions().reactions.map(({ name }) => name)).toEqual([
      "PrepareReady",
      "PrepareReady#2",
    ]);
  });

  test("a refusal stops a returned chain and continues a refused frontier", async () => {
    const { engine, concepts, raw } = setup();
    engine.register({
      ReturnedOnly: reaction(({ item }) =>
        when(Starting.start({ item }).responds())
          .then(Failing.fail({ item }))
          .then(Recording.record({ event: "unreachable" })),
      ),
      RefusedPath: reaction(({ item, message }) =>
        when(Starting.start({ item }).responds())
          .then(Failing.fail({ item }).refuses({ message }))
          .then(Recording.record({ event: message })),
      ),
    });

    await concepts.Starting.start({ item: "one" });

    expect(raw.Recording.events).toEqual(["FAILED"]);
    const exported = engine.exportReactions().reactions;
    expect(exported.find(({ name }) => name === "ReturnedOnly#2")?.when[0]).toMatchObject({
      posture: "returned",
      by: "ReturnedOnly",
    });
    expect(exported.find(({ name }) => name === "RefusedPath#2")?.when[0]).toMatchObject({
      posture: "refused",
      by: "RefusedPath",
    });
  });
});

describe("serialized sibling registration", () => {
  test("JSON-imported sibling reactions preserve names, behavior, and idempotent registration", async () => {
    const authored = setup();
    authored.engine.register({ Spread: siblingReaction(false) });
    const exported: AppIR = JSON.parse(JSON.stringify(authored.engine.exportReactions()));

    const imported = setup();
    imported.engine.registerReactions(exported.reactions);
    imported.engine.registerReactions(exported.reactions);

    await imported.concepts.Starting.start({ item: "one" });

    expect(imported.raw.Handling.calls.sort(byText)).toEqual(["left:one", "right:one"]);
    expect(JSON.parse(JSON.stringify(imported.engine.exportReactions())).reactions).toEqual(
      exported.reactions,
    );
  });
});
