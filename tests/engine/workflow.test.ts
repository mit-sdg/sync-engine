import { describe, expect, test } from "vite-plus/test";
import {
  act,
  type Empty,
  type Frames,
  Logging,
  on,
  onError,
  par,
  seq,
  sync,
  SyncConcept,
  type Vars,
  when,
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
  test("branches on ordinary result values via on()", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      ApprovalWorkflow: sync(({ kind, route }: Vars) =>
        when(Button.clicked, { kind }).then(
          act(Decision.decide, { kind })
            .as({ route })
            .branch(
              on({ route: "approved" }, act(Recorder.record, { tag: "approved" })),
              on({ route: "rejected" }, act(Recorder.record, { tag: "rejected" })),
            ),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "reject" });

    expect(Recorder.order).toEqual(["approved", "rejected"]);
  });

  test("routes thrown concept errors through onError() branch", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ThrowingWorkflow: sync(({ detail }: Vars) =>
        when(Button.clicked, { kind: "throw" }).then(
          act(Throwing.explode, {}).branch(
            onError({ detail }, act(Recorder.record, { tag: detail })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "throw" });

    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual(["kaboom"]);
  });

  test("preserves domain error codes thrown by concept actions", async () => {
    const { Sync, Button, DomainFailure, Recorder } = setup();

    Sync.register({
      DomainErrorWorkflow: sync(({ detail }: Vars) =>
        when(Button.clicked, { kind: "domain-error" }).then(
          act(DomainFailure.fail, {}).branch(
            onError({ error: "OUT_OF_STOCK", detail }, act(Recorder.record, { tag: detail })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "domain-error" });

    expect(Recorder.order).toEqual(["inventory unavailable"]);
  });

  test("on({}, …) and on({}) both fire for completion outputs", async () => {
    const { Sync, Button, Completion, Recorder } = setup();

    Sync.register({
      CompletionWorkflow: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "complete" }).then(
          act(Completion.finish, {}).branch(
            on({}, act(Recorder.record, { tag: "complete" })),
            on({}, act(Recorder.record, { tag: "result" })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "complete" });

    expect(Recorder.order).toEqual(["complete", "result"]);
  });

  test("on() does not fire on an error outcome", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    // A success branch and an error branch on the same failing step: only the
    // error branch should fire. Under the old `outcome: "any"` semantics the
    // success branch would have matched (and bound from) the error record.
    Sync.register({
      OnSkipsErrors: sync(({ detail }: Vars) =>
        when(Button.clicked, { kind: "throw" }).then(
          act(Throwing.explode, {}).branch(
            on({}, act(Recorder.record, { tag: "on-fired" })),
            onError({ detail }, act(Recorder.record, { tag: "err-fired" })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "throw" });

    expect(Recorder.order).toEqual(["err-fired"]);
  });
});

// ── DSL surface ─────────────────────────────────────────────────────────────

describe("fluent DSL", () => {
  test("sync() registers and triggers a simple rule", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      PingPong: sync(({ kind }: Vars) =>
        when(Button.clicked, { kind }, {}).then(act(Recorder.record, { tag: kind })),
      ),
    });

    await Button.clicked({ kind: "ping" });
    await Button.clicked({ kind: "pong" });

    expect(Recorder.order).toEqual(["ping", "pong"]);
  });

  test("when(...).and(...) matches multiple journal entries", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      Seed: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "seed" }, {}).then(act(Recorder.record, { tag: "tok" })),
      ),
    });

    Sync.register({
      MultiWhen: sync(({ tag }: Vars) =>
        when(Button.clicked, { kind: "seed" }, {})
          .and(Recorder.record, { tag }, {})
          .then(act(Recorder.record, { tag: "multi-fire" })),
      ),
    });

    await Button.clicked({ kind: "seed" });

    expect(Recorder.order).toContain("multi-fire");
  });

  test("act(...).as() binds step output to variables", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      AsBinding: sync(({ kind, route }: Vars) =>
        when(Button.clicked, { kind }).then(
          act(Decision.decide, { kind })
            .as({ route })
            .branch(act(Recorder.record, { tag: route })),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("act(...).where() fans out after a step completes", async () => {
    const { Sync, Button, Completion, List, Recorder } = setup();
    await List.add({ value: 1 });
    await List.add({ value: 2 });

    Sync.register({
      FanoutWorkflow: sync(({ value, tag }: Vars) =>
        when(Button.clicked, { kind: "fanout" }).then(
          act(Completion.finish, {})
            .where((frames: Frames) =>
              frames.query(List._items, {}, { value }).map((frame: any) => ({
                ...frame,
                [tag]: "v:" + String(frame[value]),
              })),
            )
            .branch(act(Recorder.record, { tag })),
        ),
      ),
    });

    await Button.clicked({ kind: "fanout" });

    expect(Recorder.order).toEqual(["v:1", "v:2"]);
  });
});

// ── seq / par ───────────────────────────────────────────────────────────────

describe("seq and par execution", () => {
  test("seq carries output bindings forward between steps", async () => {
    const { Sync, Button, StepRecorder: SR } = setup();

    Sync.register({
      Sequential: sync(({ data }: Vars) =>
        when(Button.clicked, { kind: "seq-test" }).then(
          seq(act((SR as any).step1, {}).as({ data }), act((SR as any).step2, { data })),
        ),
      ),
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
      SequentialSiblings: sync(({ kind }: Vars) =>
        when(Button.clicked, { kind }, {}).then(
          act(Recorder.record, { tag: "first" }),
          act(Recorder.record, { tag: "second" }),
          act(Recorder.record, { tag: "third" }),
        ),
      ),
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
      DefaultSeq: sync((_vars: Vars) =>
        when(Recorder.record, { tag: "go" }, {}).then(
          act((TA as any).slow, {}),
          act((TA as any).fast, {}),
        ),
      ),
    });

    await Recorder.record({ tag: "go" });

    expect(finishes).toEqual(["slow-done", "fast-done"]);
  });
});

// ── ActionOutcome / edge cases ────────────────────────────────────────────

describe("ActionOutcome normalisation", () => {
  test("result outcome fires on() branches", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      ResultBranch: sync(({ kind, route }: Vars) =>
        when(Button.clicked, { kind }, {}).then(
          act(Decision.decide, { kind })
            .as({ route })
            .branch(on({ route: "approved" }, act(Recorder.record, { tag: "result-match" }))),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["result-match"]);
  });

  test("error outcome triggers onError() branch", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ErrOnly: sync(({ detail }: Vars) =>
        when(Button.clicked, { kind: "err-test" }).then(
          act(Throwing.explode, {}).branch(
            onError({ detail }, act(Recorder.record, { tag: detail })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "err-test" });
    expect(Recorder.order).toEqual(["kaboom"]);
  });

  test("complete outcome triggers on({}, …) branch", async () => {
    const { Sync, Button, Completion, Recorder } = setup();

    Sync.register({
      CompletionOnly: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "done-test" }).then(
          act(Completion.finish, {}).branch(on({}, act(Recorder.record, { tag: "completed" }))),
        ),
      ),
    });

    await Button.clicked({ kind: "done-test" });
    expect(Recorder.order).toEqual(["completed"]);
  });
});

describe("seq and par edge cases", () => {
  test("seq stops executing after an error step", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      SeqWithError: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "seq-err" }).then(
          seq(
            act(Recorder.record, { tag: "before" }),
            act(Throwing.explode, {}),
            act(Recorder.record, { tag: "after-error" }),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "seq-err" });
    expect(Recorder.order).toEqual(["before"]);
    expect(Throwing.hit).toBe(true);
  });

  test("seq propagates data from result outcomes", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      SeqWithData: sync(({ kind, route }: Vars) =>
        when(Button.clicked, { kind }).then(
          seq(
            act(Decision.decide, { kind: "approve" }).as({ route }),
            act(Recorder.record, { tag: route }),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "any" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("nested seq inside seq executes correctly", async () => {
    const Sync = new SyncConcept();
    Sync.logging = Logging.OFF;
    const { Button, Recorder } = Sync.instrument({
      Button: new ButtonConcept(),
      Recorder: new RecorderConcept(),
    });

    Sync.register({
      NestedSeq: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "nested-seq" }, {}).then(
          seq(
            act(Recorder.record, { tag: "outer-1" }),
            seq(act(Recorder.record, { tag: "inner-1" }), act(Recorder.record, { tag: "inner-2" })),
            act(Recorder.record, { tag: "outer-2" }),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "nested-seq" });
    expect(Recorder.order).toEqual(["outer-1", "inner-1", "inner-2", "outer-2"]);
  });

  test("error step blocks direct successors in nested workflow", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ErrorInNested: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "error-direct" }).then(
          act(Throwing.explode, {}).branch(act(Recorder.record, { tag: "after-error-direct" })),
        ),
      ),
    });

    await Button.clicked({ kind: "error-direct" });
    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual([]);
  });
});

// ── Construction-time guards ──────────────────────────────────────────────

describe("DSL construction guards", () => {
  test("awaiting a when(...) chain throws instead of silently resolving", async () => {
    const { Button } = setup();
    const builder = when(Button.clicked, { kind: "x" });
    await expect(Promise.resolve(builder as unknown as Promise<unknown>)).rejects.toThrow(
      "not a promise",
    );
  });

  test(".then() rejects a top-level outcome branch", () => {
    const { Button, Recorder } = setup();
    expect(() => when(Button.clicked, {}).then(on({}, act(Recorder.record, { tag: "x" })))).toThrow(
      "top-level",
    );
  });

  test(".then() requires at least one node", () => {
    const { Button } = setup();
    expect(() => when(Button.clicked, {}).then()).toThrow("at least one node");
  });

  test("seq() rejects a leading branch", () => {
    const { Recorder } = setup();
    expect(() => seq(on({}, act(Recorder.record, { tag: "x" })), act(Recorder.record, {}))).toThrow(
      "must follow an act()",
    );
  });

  test("par() rejects outcome branches", () => {
    const { Recorder } = setup();
    expect(() => par(on({}, act(Recorder.record, { tag: "x" })))).toThrow("not allowed");
  });

  test("when(...).where() twice throws", () => {
    const { Button } = setup();
    expect(() =>
      (when(Button.clicked, {}) as any).where((f: Frames) => f).where((f: Frames) => f),
    ).toThrow("twice");
  });

  test("onError() distinguishes a pattern from a node", () => {
    const { Recorder } = setup();

    // A plain mapping (even one containing a `kind` key) is a pattern.
    const withPattern = onError({ kind: "boom" }, act(Recorder.record, { tag: "x" }));
    expect(withPattern.pattern).toEqual({ kind: "boom" });

    // A leading node means "no pattern".
    const withoutPattern = onError(act(Recorder.record, { tag: "x" }));
    expect(withoutPattern.pattern).toEqual({});
  });

  test("act(...).as() merges successive calls", () => {
    const { Decision } = setup();
    const chain = act(Decision.decide, {}).as({ a: "1" }).as({ b: "2" });
    expect(chain.action.output).toEqual({ a: "1", b: "2" });
  });
});
