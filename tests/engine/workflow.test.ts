import { describe, expect, test } from "vite-plus/test";
import {
  Done,
  Do,
  Err,
  Logging,
  On,
  Sequence,
  SyncConcept,
  Then,
  When,
  Workflow,
  type Empty,
  type Frames,
  type Vars,
} from "@sync-engine/engine";
import { ButtonConcept, ListConcept, RecorderConcept, ThrowingConcept } from "./mocks.ts";

class DecisionConcept {
  decide({ kind }: { kind: string }) {
    return { route: kind === "approve" ? "approved" : "rejected" };
  }
}

class CompletionConcept {
  finish(_: Empty) {
    return {};
  }
}

class DomainFailureConcept {
  fail(_: Empty) {
    const err = new Error("inventory unavailable") as Error & { code: string };
    err.code = "OUT_OF_STOCK";
    throw err;
  }
}

class StepRecorder {
  order: string[] = [];
  step1(_: Empty) {
    this.order.push("step1");
    return { data: "a" };
  }
  step2({ data }: { data: string }) {
    this.order.push("step2:" + data);
    return {};
  }
}

function setup() {
  const Sync = new SyncConcept();
  Sync.logging = Logging.OFF;
  const concepts = Sync.instrument({
    Button: new ButtonConcept(),
    Completion: new CompletionConcept(),
    Decision: new DecisionConcept(),
    DomainFailure: new DomainFailureConcept(),
    List: new ListConcept(),
    Recorder: new RecorderConcept(),
    StepRecorder: new StepRecorder(),
    Throwing: new ThrowingConcept(),
  });
  return { Sync, ...concepts };
}

// ── Outcome branching ─────────────────────────────────────────────────────

describe("nested outcome branching", () => {
  test("branches on ordinary result values via On", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      ApprovalWorkflow: Workflow(({ kind, route }: Vars) => ({
        when: When(Button.clicked, { kind }),
        then: Do(Decision.decide, { kind })
          .as({ route })
          .then(
            On({ route: "approved" }, Do(Recorder.record, { tag: "approved" })),
            On({ route: "rejected" }, Do(Recorder.record, { tag: "rejected" })),
          ),
      })),
    });

    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "reject" });

    expect(Recorder.order).toEqual(["approved", "rejected"]);
  });

  test("routes thrown concept errors through Err branch", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ThrowingWorkflow: Workflow(({ detail }: Vars) => ({
        when: When(Button.clicked, { kind: "throw" }),
        then: Do(Throwing.explode, {}).then(Err({ detail }, Do(Recorder.record, { tag: detail }))),
      })),
    });

    await Button.clicked({ kind: "throw" });

    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual(["kaboom"]);
  });

  test("preserves domain error codes thrown by concept actions", async () => {
    const { Sync, Button, DomainFailure, Recorder } = setup();

    Sync.register({
      DomainErrorWorkflow: Workflow(({ detail }: Vars) => ({
        when: When(Button.clicked, { kind: "domain-error" }),
        then: Do(DomainFailure.fail, {}).then(
          Err({ error: "OUT_OF_STOCK", detail }, Do(Recorder.record, { tag: detail })),
        ),
      })),
    });

    await Button.clicked({ kind: "domain-error" });

    expect(Recorder.order).toEqual(["inventory unavailable"]);
  });

  test("Done and On result both fire for completion outputs", async () => {
    const { Sync, Button, Completion, Recorder } = setup();

    Sync.register({
      CompletionWorkflow: Workflow((_vars: Vars) => ({
        when: When(Button.clicked, { kind: "complete" }),
        then: Do(Completion.finish, {}, {}).then(
          Done(Do(Recorder.record, { tag: "complete" })),
          On({}, Do(Recorder.record, { tag: "result" })),
        ),
      })),
    });

    await Button.clicked({ kind: "complete" });

    expect(Recorder.order).toEqual(["complete", "result"]);
  });
});

// ── DSL sugar ─────────────────────────────────────────────────────────────

describe("DSL sugar (#2)", () => {
  test("Workflow registers and triggers a simple sync", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      PingPong: Workflow(({ kind }: Vars) => ({
        when: When(Button.clicked, { kind }, {}),
        then: Then(Recorder.record, { tag: kind }),
      })),
    });

    await Button.clicked({ kind: "ping" });
    await Button.clicked({ kind: "pong" });

    expect(Recorder.order).toEqual(["ping", "pong"]);
  });

  test("When multi-pattern matches multiple journal entries", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      Seed: Workflow(({ tag, kind }: Vars) => ({
        when: When(Button.clicked, { kind: "seed" }, {}),
        then: Then(Recorder.record, { tag: "tok" }),
      })),
    });

    Sync.register({
      MultiWhen: Workflow(({ kind, tag }: Vars) => ({
        when: When([Button.clicked, { kind: "seed" }, {}], [Recorder.record, { tag }, {}]),
        then: Then(Recorder.record, { tag: "multi-fire" }),
      })),
    });

    await Button.clicked({ kind: "seed" });

    expect(Recorder.order).toContain("multi-fire");
  });

  test("Do with as() binds step output to variables", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      AsBinding: Workflow(({ kind, route }: Vars) => ({
        when: When(Button.clicked, { kind }),
        then: Do(Decision.decide, { kind })
          .as({ route })
          .then(Do(Recorder.record, { tag: route })),
      })),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("supports nested where fanout after a step completes", async () => {
    const { Sync, Button, Completion, List, Recorder } = setup();
    await List.add({ value: 1 });
    await List.add({ value: 2 });

    Sync.register({
      FanoutWorkflow: Workflow(({ value, tag }: Vars) => {
        const stepNode = {
          kind: "step" as const,
          action: {
            action: Completion.finish as any,
            concept: Completion,
            input: {},
            flow: Symbol("flow"),
          },
          where: (frames: Frames) =>
            frames.query(List._items, {}, { value }).map((frame: any) => ({
              ...frame,
              [tag]: "v:" + String(frame[value]),
            })),
          nested: [Do(Recorder.record, { tag })],
        };
        return {
          when: When(Button.clicked, { kind: "fanout" }),
          then: stepNode,
        };
      }),
    });

    await Button.clicked({ kind: "fanout" });

    expect(Recorder.order).toEqual(["v:1", "v:2"]);
  });
});

// ── Sequence / Parallel ───────────────────────────────────────────────────

describe("Sequence and Parallel execution (#1)", () => {
  test("Sequence carries output bindings forward between steps", async () => {
    const { Sync, Button, StepRecorder: SR } = setup();

    Sync.register({
      Sequential: Workflow(({ data }: Vars) => ({
        when: When(Button.clicked, { kind: "seq-test" }),
        then: Sequence(Do((SR as any).step1, {}, {}).as({ data }), Do((SR as any).step2, { data })),
      })),
    });

    await Button.clicked({ kind: "seq-test" });
    expect((SR as any).order).toEqual(["step1", "step2:a"]);
  });

  test("default sibling order is deterministic sequential", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      SequentialSiblings: Workflow(({ kind }: Vars) => ({
        when: When(Button.clicked, { kind }, {}),
        then: [
          Do(Recorder.record, { tag: "first" }),
          Do(Recorder.record, { tag: "second" }),
          Do(Recorder.record, { tag: "third" }),
        ] as any,
      })),
    });

    await Button.clicked({ kind: "start" });
    expect(Recorder.order).toEqual(["first", "second", "third"]);
  });

  test("concurrent actions in default siblings complete before the next begins", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;

    const finishes: string[] = [];
    class TimedActor {
      slow(_: Empty) {
        return { done: "slow" };
      }
      fast(_: Empty) {
        return { done: "fast" };
      }
    }

    const { Recorder, TimedActor: TA } = Sync.instrument({
      Recorder: new RecorderConcept(),
      TimedActor: new TimedActor(),
    });

    const origSlow = (TA as any).slow;
    (TA as any).slow = async function (...args: any[]) {
      await new Promise((r) => setTimeout(r, 30));
      finishes.push("slow-done");
      return origSlow.apply(this, args);
    };
    const origFast = (TA as any).fast;
    (TA as any).fast = async function (...args: any[]) {
      finishes.push("fast-done");
      return origFast.apply(this, args);
    };

    Sync.register({
      DefaultSeq: Workflow((_vars: Vars) => ({
        when: When(Recorder.record, { tag: "go" }, {}),
        then: [Do((TA as any).slow, {}, {}), Do((TA as any).fast, {}, {})] as any,
      })),
    });

    await Recorder.record({ tag: "go" });

    expect(finishes).toEqual(["slow-done", "fast-done"]);
  });
});

// ── ActionOutcome / edge cases ────────────────────────────────────────────

describe("ActionOutcome normalisation (#3)", () => {
  test("result outcome fires On branches", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      ResultBranch: Workflow(({ kind, route }: Vars) => ({
        when: When(Button.clicked, { kind }, {}),
        then: Do(Decision.decide, { kind })
          .as({ route })
          .then(On({ route: "approved" }, Do(Recorder.record, { tag: "result-match" }))),
      })),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["result-match"]);
  });

  test("error outcome triggers Err branch", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ErrOnly: Workflow(({ detail }: Vars) => ({
        when: When(Button.clicked, { kind: "err-test" }),
        then: Do(Throwing.explode, {}).then(Err({ detail }, Do(Recorder.record, { tag: detail }))),
      })),
    });

    await Button.clicked({ kind: "err-test" });
    expect(Recorder.order).toEqual(["kaboom"]);
  });

  test("complete outcome triggers Done branch", async () => {
    const { Sync, Button, Completion, Recorder } = setup();

    Sync.register({
      CompletionOnly: Workflow((_vars: Vars) => ({
        when: When(Button.clicked, { kind: "done-test" }),
        then: Do(Completion.finish, {}, {}).then(Done(Do(Recorder.record, { tag: "completed" }))),
      })),
    });

    await Button.clicked({ kind: "done-test" });
    expect(Recorder.order).toEqual(["completed"]);
  });
});

describe("Sequence and Parallel edge cases", () => {
  test("Sequence stops executing after an error step", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      SeqWithError: Workflow((_vars: Vars) => ({
        when: When(Button.clicked, { kind: "seq-err" }),
        then: Sequence(
          Do(Recorder.record, { tag: "before" }),
          Do(Throwing.explode, {}),
          Do(Recorder.record, { tag: "after-error" }),
        ),
      })),
    });

    await Button.clicked({ kind: "seq-err" });
    expect(Recorder.order).toEqual(["before"]);
    expect(Throwing.hit).toBe(true);
  });

  test("Sequence propagates data from result outcomes", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      SeqWithData: Workflow(({ kind, route }: Vars) => ({
        when: When(Button.clicked, { kind }),
        then: Sequence(
          Do(Decision.decide, { kind: "approve" }).as({ route }),
          Do(Recorder.record, { tag: route }),
        ),
      })),
    });

    await Button.clicked({ kind: "any" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("nested Sequence inside Sequence executes correctly", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      NestedSeq: Workflow(({ kind }: Vars) => ({
        when: When(Button.clicked, { kind: "nested-seq" }, {}),
        then: Sequence(
          Do(Recorder.record, { tag: "outer-1" }),
          Sequence(
            Do(Recorder.record, { tag: "inner-1" }),
            Do(Recorder.record, { tag: "inner-2" }),
          ),
          Do(Recorder.record, { tag: "outer-2" }),
        ),
      })),
    });

    await Button.clicked({ kind: "nested-seq" });
    expect(Recorder.order).toEqual(["outer-1", "inner-1", "inner-2", "outer-2"]);
  });

  test("error step blocks direct successors in nested workflow", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ErrorInNested: Workflow((_vars: Vars) => ({
        when: When(Button.clicked, { kind: "error-direct" }),
        then: Do(Throwing.explode, {}).then(Do(Recorder.record, { tag: "after-error-direct" })),
      })),
    });

    await Button.clicked({ kind: "error-direct" });
    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual([]);
  });
});
