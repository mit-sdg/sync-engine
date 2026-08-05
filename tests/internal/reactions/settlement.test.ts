import { describe, expect, test } from "vite-plus/test";
import { Logging } from "@sync-engine/assembly";
import type { LogEntry, LogSink } from "@sync-engine/assembly";
import { earlier, no, reaction, vocabulary, when, where } from "@sync-engine/language";
import type { Empty, Vars } from "@sync-engine/internal/reactions/types";
import { SettlementBook } from "@sync-engine/internal/reactions/runtime/settlement";
import type { MatchedTrigger } from "@sync-engine/internal/reactions/runtime/firing-pipeline";
import { Frames } from "@sync-engine/internal/reads/frames";
import type { PatternIR, ReactionIR } from "@sync-engine/internal/reads/ir";
import { flow } from "@sync-engine/internal/reactions/context";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import { quietReacting } from "../../utils/reacting.ts";

/**
 * A phased job: `start` announces the first phase, `advance` announces the
 * next one, and the last `advance` leaves no running job. Ordinary reactions
 * perform each phase's work; a deferred reaction advances the phase only once
 * that work has drained.
 */
class PhasingConcept {
  private readonly attempts = new Map<string, number>();
  private readonly states = new Map<string, string>();
  readonly journal: string[] = [];

  constructor(private readonly phases = 3) {}

  start({ sequence }: { sequence: string }) {
    const job = `${sequence}/job`;
    this.attempts.set(job, 1);
    this.states.set(job, "running");
    this.journal.push("start");
    return { job, attempt: 1 };
  }

  advance({ job, attempt }: { job: string; attempt: number }) {
    const next = attempt + 1;
    this.journal.push(`advance:${next}`);
    if (next > this.phases) {
      this.attempts.delete(job);
      this.states.set(job, "finished");
    } else {
      this.attempts.set(job, next);
    }
    return { job, attempt: next };
  }

  _running({ job }: { job: string }): { attempt: number }[] {
    const attempt = this.attempts.get(job);
    return attempt === undefined ? [] : [{ attempt }];
  }

  _latest({ sequence }: { sequence: string }): { job: string; state: string }[] {
    const job = `${sequence}/job`;
    const state = this.states.get(job);
    return state === undefined ? [] : [{ job, state }];
  }
}

/** Occurrences used to probe `earlier(...)` scope around an anchor. */
class MarkingConcept {
  readonly observed: string[] = [];

  mark({ tag }: { tag: string }) {
    return { tag };
  }

  observe({ tag }: { tag: string }) {
    this.observed.push(tag);
    return { tag };
  }
}

/** A query that fails while a reaction's conditions are read. */
class FaultyConcept {
  _boom(_: Empty): Empty[] {
    throw new Error("query failed");
  }
}

class JointEventConcept {
  first(input: { group: string; key?: string }) {
    return input;
  }
  second(input: { group: string; key: string }) {
    return input;
  }
}

class JointGateConcept {
  private readonly ready = new Set(["one"]);
  readonly reads: string[] = [];
  readonly opened: string[] = [];

  constructor(private readonly unlockSecond = false) {}

  _ready({ key }: { key: string }): Empty[] {
    this.reads.push(key);
    return this.ready.has(key) ? [{}] : [];
  }

  open({ key }: { key: string }) {
    this.opened.push(key);
    if (this.unlockSecond && key === "one") this.ready.add("two");
    return {};
  }
}

function jointReaction(name: string, firstInput: PatternIR): ReactionIR {
  return {
    name,
    when: [
      {
        kind: "action",
        concept: "JointEvent",
        action: "first",
        posture: "returned",
        input: firstInput,
        output: {},
      },
      {
        kind: "action",
        concept: "JointEvent",
        action: "second",
        posture: "returned",
        input: { group: { $var: "group" }, key: { $var: "key" } },
        output: {},
      },
    ],
    deferred: true,
    where: [
      {
        op: "find",
        query: { concept: "JointGate", query: "_ready" },
        in: { key: { $var: "key" } },
        out: {},
      },
    ],
    then: [
      {
        kind: "request",
        concept: "JointGate",
        action: "open",
        input: { key: { $var: "key" } },
      },
    ],
  };
}

/** The per-phase work an ordinary reaction contributes. */
class PhaseWorkConcept {
  constructor(private readonly journal: string[]) {}

  perform({ job, attempt }: { job: string; attempt: number }) {
    this.journal.push(`work:${attempt}`);
    return { job, attempt };
  }

  /** A second, deeper stage of the same phase's work. */
  record({ job, attempt }: { job: string; attempt: number }) {
    this.journal.push(`record:${attempt}`);
    return { job, attempt };
  }

  _nothing(_: Empty): Empty[] {
    return [];
  }
}

const refs = vocabulary({
  concepts: {
    Phasing: PhasingConcept,
    PhaseWork: PhaseWorkConcept,
    Marking: MarkingConcept,
    Faulty: FaultyConcept,
  },
}).concepts;

function setup(phases = 3) {
  const reacting = quietReacting();
  const phasing = new PhasingConcept(phases);
  const marking = new MarkingConcept();
  const { Phasing, PhaseWork, Marking } = reacting.instrument({
    Phasing: phasing,
    PhaseWork: new PhaseWorkConcept(phasing.journal),
    Marking: marking,
    Faulty: new FaultyConcept(),
  });
  return { reacting, Phasing, PhaseWork, Marking, marking, journal: phasing.journal };
}

/** The phase work every phase contributes, plus the deferred advance rules. */
function phaseReactions() {
  return {
    WorkOnStart: reaction(({ sequence, job, attempt }: Vars) =>
      when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
        .then(refs.PhaseWork.perform({ job, attempt }).responds({ attempt }))
        .then(refs.PhaseWork.record({ job, attempt })),
    ),
    WorkOnAdvance: reaction(({ job, attempt }: Vars) =>
      when(refs.Phasing.advance({ job }).responds({ attempt }))
        .where(refs.Phasing._running({ job }).is({ attempt }))
        .then(refs.PhaseWork.perform({ job, attempt }).responds({ attempt }))
        .then(refs.PhaseWork.record({ job, attempt })),
    ),
    AdvanceAfterStart: reaction(({ sequence, job, attempt }: Vars) =>
      when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
        .afterFlowSettles()
        .where(refs.Phasing._running({ job }).is({ attempt }))
        .then(refs.Phasing.advance({ job, attempt })),
    ),
    AdvanceAfterAdvance: reaction(({ job, attempt }: Vars) =>
      when(refs.Phasing.advance({ job }).responds({ attempt }))
        .afterFlowSettles()
        .where(refs.Phasing._running({ job }).is({ attempt }))
        .then(refs.Phasing.advance({ job, attempt })),
    ),
  };
}

describe("deferred triggers at settlement frontiers", () => {
  test("a phase advances only after the work its announcement started drains", async () => {
    const { reacting, Phasing, journal } = setup();
    reacting.register(phaseReactions());

    await Phasing.start({ sequence: "s" });

    expect(journal).toEqual([
      "start",
      "work:1",
      "record:1",
      "advance:2",
      "work:2",
      "record:2",
      "advance:3",
      "work:3",
      "record:3",
      "advance:4",
    ]);
  });

  test("a deferred reaction retires an anchor once it qualifies", async () => {
    const { reacting, Phasing, journal } = setup(1);
    reacting.register(phaseReactions());

    await Phasing.start({ sequence: "s" });

    // One frontier advances past the only phase; the next finds no running
    // job, so the rule anchored on that advance never fires.
    expect(journal).toEqual(["start", "work:1", "record:1", "advance:2"]);
    const firings = reacting.Action.store.firingsByReaction("AdvanceAfterStart");
    expect(firings).toHaveLength(1);
  });

  test("an unmatched deferred guard stays eligible at a later frontier", async () => {
    const { reacting, Phasing, journal } = setup();
    reacting.register({
      ...phaseReactions(),
      // Only true once every phase has run and the job is finished.
      Finish: reaction(({ sequence, job }: Vars) =>
        when(refs.Phasing.start({ sequence }).responds({ job }))
          .afterFlowSettles()
          .where(no(refs.Phasing._running({ job })), refs.Phasing._latest({ sequence }).is({ job }))
          .then(refs.PhaseWork.record({ job, attempt: 99 })),
      ),
    });

    await Phasing.start({ sequence: "s" });

    expect(journal.at(-1)).toBe("record:99");
    expect(journal.filter((entry) => entry === "record:99")).toHaveLength(1);
  });

  test("every deferred firing of one frontier is prepared before any is dispatched", async () => {
    const { reacting, Phasing, journal } = setup(1);
    reacting.register({
      // Both rules read the same running job at the same frontier. The first
      // one dispatched finishes the job; the second still fires, because its
      // guard was read before any consequence ran.
      First: reaction(({ sequence, job, attempt }: Vars) =>
        when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
          .afterFlowSettles()
          .where(refs.Phasing._running({ job }).is({ attempt }))
          .then(refs.Phasing.advance({ job, attempt })),
      ),
      Second: reaction(({ sequence, job, attempt }: Vars) =>
        when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
          .afterFlowSettles()
          .where(refs.Phasing._running({ job }).is({ attempt }))
          .then(refs.PhaseWork.record({ job, attempt })),
      ),
    });

    await Phasing.start({ sequence: "s" });

    expect(journal).toEqual(["start", "advance:2", "record:1"]);
  });

  test("an unrelated root flow neither delays nor triggers a deferred rule", async () => {
    const { reacting, Phasing, PhaseWork, journal } = setup(1);
    reacting.register(phaseReactions());

    const unrelated = PhaseWork.perform({ job: "other", attempt: 7 });
    await Phasing.start({ sequence: "s" });
    await unrelated;

    expect(journal.filter((entry) => entry.startsWith("advance"))).toEqual(["advance:2"]);
    expect(journal).toContain("work:7");
  });

  test("a deferred consequence keeps its flow, provenance, and firing record", async () => {
    const { reacting, Phasing } = setup(1);
    reacting.register(phaseReactions());

    const started = await Phasing.start({ sequence: "s" });
    const records = [...reacting.Action.actions.values()];
    const root = records.find((record) => record.by === undefined);
    const advance = records.find((record) => record.by === "AdvanceAfterStart");

    expect(started).toMatchObject({ attempt: 1 });
    expect(advance?.flow).toBe(root?.flow);
    expect(advance?.input).toMatchObject({ job: "s/job", attempt: 1 });
    const firing = reacting.Action.store.firingsByReaction("AdvanceAfterStart").at(0);
    expect(firing?.consumed).toEqual([root?.id]);
    expect(firing?.produced).toEqual([advance?.id]);
  });

  test("a deferred stage in an unlowerable pipeline is rejected at registration", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.register({
        // A closure `where` keeps the chain local, so stage 2 never becomes a
        // reaction of its own and has no trigger to defer from.
        Local: reaction(({ sequence, job, attempt }: Vars) =>
          when(refs.Phasing.start({ sequence }).responds({ job }))
            .afterFlowSettles()
            .where((frames) => frames)
            .then(refs.PhaseWork.perform({ job, attempt: 1 }).responds({}))
            .afterFlowSettles()
            .then(refs.PhaseWork.record({ job, attempt })),
        ),
      }),
    ).toThrow(/afterFlowSettles\(\), which needs its stage to lower/);
  });

  test("a functional guard still applies before branch-local deferred conditions", async () => {
    const { reacting, Phasing, journal } = setup(1);
    reacting.register({
      Guarded: reaction(({ sequence, job, attempt }: Vars) =>
        when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
          .afterFlowSettles()
          .where(() => new Frames())
          .then(
            where(refs.Phasing._running({ job }).is({ attempt })).then(
              refs.PhaseWork.record({ job, attempt }),
            ),
          ),
      ),
    });

    const exported = reacting.exportReactions();
    expect(exported.reactions).toEqual([]);
    expect(exported.unlowered[0]).toMatchObject({
      reason: "a closure where combined with declarative conditions",
      known: { deferred: true },
    });
    expect(reacting.readBack()).toContain(
      "local executable reaction at the flow's settlement frontier",
    );
    expect(reacting.renderApp()).toContain("`Guarded` — at the flow's settlement frontier");

    await Phasing.start({ sequence: "s" });
    expect(journal).toEqual(["start"]);
  });

  test("afterFlowSettles(...).where(...) refuses a frame function", () => {
    const { reacting } = setup();
    expect(() =>
      reacting.register({
        Bad: reaction(({ sequence, job, attempt }: Vars) =>
          when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
            .then(refs.PhaseWork.perform({ job, attempt }).responds({}))
            .afterFlowSettles()
            .where(((frames: unknown) => frames) as never)
            .then(refs.PhaseWork.record({ job, attempt })),
        ),
      }),
    ).toThrow(/states condition lines/);
  });

  test("earlier(...) keeps the anchor's scope at a later frontier", async () => {
    const { reacting, Marking, marking } = setup(1);
    reacting.register({
      // The root mark lands before `start`; this one lands after it.
      StartAfterMark: reaction(({ sequence }: Vars) =>
        when(refs.Marking.mark({ tag: "before" }).responds()).then(
          refs.Phasing.start({ sequence: "s" }).responds({ job: sequence }),
        ),
      ),
      MarkAfterStart: reaction((_vars: Vars) =>
        when(refs.Phasing.start({ sequence: "s" }).responds()).then(
          refs.Marking.mark({ tag: "after" }),
        ),
      ),
      ObserveEarlier: reaction(({ tag }: Vars) =>
        when(refs.Phasing.start({ sequence: "s" }).responds())
          .afterFlowSettles()
          .where(earlier(refs.Marking.mark, { tag }))
          .then(refs.Marking.observe({ tag })),
      ),
    });

    await Marking.mark({ tag: "before" });

    expect(marking.observed).toEqual(["before"]);
  });

  test("an interpreter failure stops deferred advancement", async () => {
    const { reacting, Phasing, journal } = setup(1);
    reacting.register({
      ...phaseReactions(),
      Breaking: reaction(({ sequence }: Vars) =>
        when(refs.Phasing.start({ sequence }).responds())
          .where(refs.Faulty._boom({}).is({}))
          .then(refs.PhaseWork.record({ job: "unused", attempt: 0 })),
      ),
    });

    await Phasing.start({ sequence: "s" });

    expect(journal).toEqual(["start", "work:1", "record:1"]);
    expect(reacting.Action.store.reactionFailures.map(({ stage }) => stage)).toEqual(["where"]);
  });

  test("a requested-ask trigger defers to the frontier it anchors", async () => {
    const { reacting, Phasing, marking } = setup(1);
    reacting.register({
      ...phaseReactions(),
      ObserveAsk: reaction(({ sequence }: Vars) =>
        when(refs.Phasing.start({ sequence }))
          .afterFlowSettles()
          .where(no(refs.Phasing._running({ job: "s/job" })))
          .then(refs.Marking.observe({ tag: sequence })),
      ),
    });

    await Phasing.start({ sequence: "s" });

    // The ask's own frontier is the flow's, so the guard reads the state the
    // whole phase cascade left behind.
    expect(marking.observed).toEqual(["s"]);
  });

  test("a deferred trigger survives the portable IR round trip", async () => {
    const source = setup(1);
    source.reacting.register(phaseReactions());
    const exported = source.reacting.exportReactions();
    const advance = exported.reactions.find(({ name }) => name === "AdvanceAfterStart");

    expect(advance?.deferred).toBe(true);
    expect(source.reacting.readBack()).toContain("at the flow's settlement frontier");

    const target = setup(1);
    target.reacting.registerReactions(exported.reactions);
    await target.Phasing.start({ sequence: "s" });

    expect(target.journal).toEqual(["start", "work:1", "record:1", "advance:2"]);
  });

  test("imported deferred timing rejects non-true values", () => {
    const source = setup(1);
    source.reacting.register(phaseReactions());
    const deferred = source.reacting
      .exportReactions()
      .reactions.find(({ name }) => name === "AdvanceAfterStart");
    if (deferred === undefined) throw new Error("expected a deferred reaction");

    const target = setup(1);
    expect(() =>
      target.reacting.registerReactions([{ ...deferred, deferred: false } as never]),
    ).toThrow('Reaction "AdvanceAfterStart": deferred must be true when present.');
  });

  test("unqualified joint matches remain armed for a later frontier", async () => {
    const reacting = quietReacting();
    const gate = new JointGateConcept(true);
    const { JointEvent } = reacting.instrument({
      JointEvent: new JointEventConcept(),
      JointGate: gate,
    });
    const flowToken = "joint-flow";
    await JointEvent.first({ group: "one", key: "one", [flow]: flowToken } as never);
    await JointEvent.second({ group: "one", key: "one", [flow]: flowToken } as never);
    await JointEvent.first({ group: "two", key: "two", [flow]: flowToken } as never);
    await JointEvent.second({ group: "two", key: "two", [flow]: flowToken } as never);

    reacting.registerReactions([
      jointReaction("OpenReadyPairs", {
        group: { $var: "group" },
        key: { $var: "key" },
      }),
    ]);

    await JointEvent.second({ group: "other", key: "unmatched", [flow]: flowToken } as never);

    expect(gate.opened).toEqual(["one", "two"]);
    expect(reacting.Action.store.firingsByReaction("OpenReadyPairs")).toHaveLength(2);
  });

  test("a joint match retires combinations that share a consumed occurrence", async () => {
    const reacting = quietReacting();
    const gate = new JointGateConcept();
    const { JointEvent } = reacting.instrument({
      JointEvent: new JointEventConcept(),
      JointGate: gate,
    });
    const flowToken = "overlap-flow";
    await JointEvent.first({ group: "shared", [flow]: flowToken } as never);
    await JointEvent.second({ group: "shared", key: "one", [flow]: flowToken } as never);
    await JointEvent.second({ group: "shared", key: "two", [flow]: flowToken } as never);

    reacting.registerReactions([
      jointReaction("OpenOneOverlappingPair", { group: { $var: "group" } }),
    ]);

    await JointEvent.second({ group: "other", key: "unmatched", [flow]: flowToken } as never);

    expect(gate.opened).toEqual(["one"]);
    expect(gate.reads).toEqual(["one", "two"]);
    expect(reacting.Action.store.firingsByReaction("OpenOneOverlappingPair")).toHaveLength(1);
  });

  test("settlement failure still clears matching state", async () => {
    class RejectSettlementEntries implements LogSink {
      append(entry: LogEntry): undefined {
        if (entry.kind === "firing" || entry.kind === "reaction-failure") {
          throw new Error("settlement log unavailable");
        }
      }
    }

    const store = new MemoryStore("keepAll", new RejectSettlementEntries());
    const actions = new ActionConcept(store);
    const reacting = new Reacting(actions);
    reacting.logging = Logging.OFF;
    const { Phasing } = reacting.instrument({ Phasing: new PhasingConcept(1) });
    reacting.register({
      Advance: reaction(({ sequence, job, attempt }: Vars) =>
        when(refs.Phasing.start({ sequence }).responds({ job, attempt }))
          .afterFlowSettles()
          .then(refs.Phasing.advance({ job, attempt })),
      ),
    });

    await expect(Phasing.start({ sequence: "s" })).rejects.toThrow("settlement log unavailable");
    expect(actions._getMatchingRecordCount()).toBe(0);
  });
});

describe("the settlement book", () => {
  const armed = (name: string): MatchedTrigger => ({ reaction: { name } }) as MatchedTrigger;

  test("holds, retires, and discards armed triggers per flow", () => {
    const book = new SettlementBook();
    const first = armed("First");
    const second = armed("Second");

    book.arm("flow-a", first);
    book.arm("flow-a", second);
    book.arm("flow-b", armed("Other"));

    expect(book.pending("flow-a")).toEqual([first, second]);
    expect(book.pending("flow-c")).toEqual([]);
    expect(book.size).toBe(2);

    book.retire("flow-a", first);
    expect(book.pending("flow-a")).toEqual([second]);

    book.retire("flow-a", second);
    expect(book.has("flow-a")).toBe(false);
    expect(book.size).toBe(1);

    book.discard("flow-b");
    expect(book.size).toBe(0);
  });
});
