import { describe, expect, test } from "vite-plus/test";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { no, reaction, vocabulary, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";

/** A phased job whose phases run as ordinary reactions inside one request. */
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

  _latest({ job }: { job: string }): { state: string }[] {
    const state = this.states.get(job);
    return state === undefined ? [] : [{ state }];
  }
}

class PhaseWorkConcept {
  readonly journal: string[] = [];

  perform({ job, attempt }: { job: string; attempt: number }) {
    this.journal.push(`work:${attempt}`);
    return { job, attempt };
  }
}

const words = vocabulary({
  concepts: { Phasing: PhasingConcept, PhaseWork: PhaseWorkConcept },
  computations: {},
});
const { Phasing, PhaseWork } = words.concepts;

/** The phase work and the deferred advance rules, as ordinary composition. */
const phaseRules = {
  WorkOnStart: reaction(({ sequence, job, attempt }: Vars) =>
    when(Phasing.start({ sequence }).responds({ job, attempt })).then(
      PhaseWork.perform({ job, attempt }),
    ),
  ),
  WorkOnAdvance: reaction(({ job, attempt }: Vars) =>
    when(Phasing.advance({ job }).responds({ attempt }))
      .where(Phasing._running({ job }).is({ attempt }))
      .then(PhaseWork.perform({ job, attempt })),
  ),
  AdvanceAfterStart: reaction(({ sequence, job, attempt }: Vars) =>
    when(Phasing.start({ sequence }).responds({ job, attempt }))
      .afterFlowSettles()
      .where(Phasing._running({ job }).is({ attempt }))
      .then(Phasing.advance({ job, attempt })),
  ),
  AdvanceAfterAdvance: reaction(({ job, attempt }: Vars) =>
    when(Phasing.advance({ job }).responds({ attempt }))
      .afterFlowSettles()
      .where(Phasing._running({ job }).is({ attempt }))
      .then(Phasing.advance({ job, attempt })),
  ),
};

/** The endpoint answers from terminal state, without a host `whenIdle()`. */
const RunSequence = endpoint("/sequence/run", ({ sequence, job }: Vars) =>
  receive({ sequence })
    .then(Phasing.start({ sequence }).responds({ job }))
    .afterFlowSettles()
    .where(no(Phasing._running({ job })), Phasing._latest({ job }).is({ state: "finished" }))
    .then(respond({ job })),
);

function setup(phases = 3) {
  const phasing = new PhasingConcept(phases);
  const work = new PhaseWorkConcept();
  const app = assemble({
    vocabulary: words,
    instances: { Phasing: phasing, PhaseWork: work },
    composition: { ...phaseRules, RunSequence },
  });
  return { app, phasing, work };
}

describe("deferred endpoint stages", () => {
  test("a deferred response answers from terminal state after every phase", async () => {
    const { app, phasing, work } = setup();

    const result = await app.invoker.invoke("/sequence/run" as never, { sequence: "s" } as never);

    expect(result).toEqual({ ok: true, value: { job: "s/job" } });
    expect(work.journal).toEqual(["work:1", "work:2", "work:3"]);
    expect(phasing.journal).toEqual(["start", "advance:2", "advance:3", "advance:4"]);
    await app.whenIdle();
  });

  test("the deferred stage is a lowered reaction pinned to its endpoint path", () => {
    const { app } = setup();

    const stage = app.engine
      .exportReactions()
      .reactions.find(({ name }) => name === "RunSequence#2");
    expect(stage?.deferred).toBe(true);
    expect(stage?.when[0]).toMatchObject({
      kind: "action",
      concept: "Phasing",
      action: "start",
      posture: "returned",
      by: "RunSequence",
    });
    expect(stage?.where.some((op) => op.op === "earlier")).toBe(true);
  });

  test("a deferred endpoint stage survives a JSON registration fixed point", async () => {
    const source = setup();
    const exported = JSON.parse(JSON.stringify(source.app.engine.exportReactions()));
    const sourceStage = exported.reactions.find(
      ({ name }: { name: string }) => name === "RunSequence#2",
    );

    const target = setup();
    target.app.engine.registerReactions(exported.reactions);
    const targetStage = target.app.engine
      .exportReactions()
      .reactions.find(({ name }) => name === "RunSequence#2");
    expect(targetStage).toEqual(sourceStage);

    const result = await target.app.invoker.invoke(
      "/sequence/run" as never,
      {
        sequence: "s",
      } as never,
    );
    expect(result).toEqual({ ok: true, value: { job: "s/job" } });
  });

  test("an unanswered deferred stage leaves the existing timeout behavior", async () => {
    // Without the advance rules the job stays running, so the response guard
    // never holds and the frontier that finds no firing finalizes the flow.
    const phasing = new PhasingConcept();
    const app = assemble({
      vocabulary: words,
      instances: { Phasing: phasing, PhaseWork: new PhaseWorkConcept() },
      composition: { RunSequence },
    });

    const result = await app.invoker.invoke("/sequence/run" as never, { sequence: "s" } as never, {
      timeoutMs: 30,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "framework", code: "TIMED_OUT" } });
    expect(phasing.journal).toEqual(["start"]);
  });

  test("execution limits bound a deferred cascade and stop advancement", async () => {
    const phasing = new PhasingConcept(Number.POSITIVE_INFINITY);
    const app = assemble({
      vocabulary: words,
      instances: { Phasing: phasing, PhaseWork: new PhaseWorkConcept() },
      composition: { ...phaseRules, RunSequence },
      executionLimits: {
        maxActiveRootFlows: 8,
        maxPendingRequests: 8,
        maxActionsPerFlow: 12,
        maxFiringsPerFlow: 12,
        maxRowsPerEvaluation: 64,
        maxRequestDurationMs: 1_000,
      },
    });

    const result = await app.invoker.invoke("/sequence/run" as never, { sequence: "s" } as never, {
      timeoutMs: 200,
    });

    expect(result).toMatchObject({ ok: false, error: { kind: "framework" } });
    expect(phasing.journal.length).toBeLessThan(12);
  });
});
