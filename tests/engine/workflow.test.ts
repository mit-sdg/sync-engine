import { describe, expect, test } from "vite-plus/test";
import {
  act,
  declareVars,
  guard,
  is,
  type Empty,
  type Frames,
  Logging,
  on,
  onError,
  oneOf,
  otherwise,
  par,
  sync,
  SyncConcept,
  type Vars,
  when,
} from "@sync-engine/engine";
import { ButtonConcept, ListConcept, RecorderConcept, ThrowingConcept } from "./mocks.ts";

class DecisionConcept {
  decide({ kind }: { kind: string }) {
    return { route: kind === "approve" ? "approved" : kind === "manual" ? "manual" : "rejected" };
  }
}

class CompletionConcept {
  finish(_: Empty) {
    return {};
  }
}

class DomainFailureConcept {
  fail(_: Empty) {
    return { error: "TIMEOUT", detail: "late" };
  }
}

class StepRecorder {
  order: string[] = [];
  step1(_: Empty) {
    this.order.push("step1");
    return { data: "a" };
  }
  step2({ data }: { data: string }) {
    this.order.push(`step2:${data}`);
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

describe("pipeline then", () => {
  test("threads act output bindings through top-level siblings", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    Sync.register({
      Pipeline: sync(({ kind, route }: Vars) =>
        when(Button.clicked, { kind }).then(
          act(Decision.decide, { kind }, { route }),
          act(Recorder.record, { tag: route }),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("stops after an error outcome", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();
    Sync.register({
      Stop: sync(({ detail }: Vars) =>
        when(Button.clicked, { kind: "stop" }).then(
          act(Recorder.record, { tag: "before" }),
          act(Throwing.explode, {}).match(
            onError({ detail }, act(Recorder.record, { tag: detail })),
          ),
          act(Recorder.record, { tag: "after" }),
        ),
      ),
    });

    await Button.clicked({ kind: "stop" });
    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual(["before", "kaboom"]);
  });

  test("drops a frame when a successful output pattern does not unify", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    Sync.register({
      Mismatch: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "mismatch" }).then(
          act(Decision.decide, { kind: "approve" }, { route: "rejected" }),
          act(Recorder.record, { tag: "unreachable" }),
        ),
      ),
    });

    await Button.clicked({ kind: "mismatch" });
    expect(Recorder.order).toEqual([]);
  });

  test("allows only empty output mappings for completion", async () => {
    const { Sync, Button, Completion, Recorder } = setup();
    Sync.register({
      Complete: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "complete" }).then(
          act(Completion.finish, {}, {}),
          act(Recorder.record, { tag: "ok" }),
        ),
      ),
      CompleteMismatch: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "complete" }).then(
          act(Completion.finish, {}, { absent: "value" }),
          act(Recorder.record, { tag: "bad" }),
        ),
      ),
    });

    await Button.clicked({ kind: "complete" });
    expect(Recorder.order).toEqual(["ok"]);
  });
});

describe("ordered match cases", () => {
  test("selects the first matching success case", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    Sync.register({
      First: sync(({ route }: Vars) =>
        when(Button.clicked, { kind: "approve" }).then(
          act(Decision.decide, { kind: "approve" }).match(
            on({ route }, act(Recorder.record, { tag: "first" })),
            on({ route: "approved" }, act(Recorder.record, { tag: "second" })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["first"]);
  });

  test("falls through a failing guard and keeps rejected bindings local", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    const { route } = declareVars<{ route: string }>();
    Sync.register({
      GuardFallthrough: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "approve" }).then(
          act(Decision.decide, { kind: "approve" }).match(
            on(
              { route },
              guard(($) => $(route) === "rejected"),
              act(Recorder.record, { tag: "wrong" }),
            ),
            on({ route: "approved" }, act(Recorder.record, { tag: "fallback" })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["fallback"]);
  });

  test("runs error cases from the pre-step frame then stops the outer pipeline", async () => {
    const { Sync, Button, DomainFailure, Recorder } = setup();
    Sync.register({
      Recover: sync(({ kind, detail }: Vars) =>
        when(Button.clicked, { kind }).then(
          act(DomainFailure.fail, {}, { payment: detail }).match(
            onError({ error: "TIMEOUT", detail }, act(Recorder.record, { tag: detail })),
            otherwise(act(Recorder.record, { tag: "wrong-default" })),
          ),
          act(Recorder.record, { tag: "after-error" }),
        ),
      ),
    });

    await Button.clicked({ kind: "recover" });
    expect(Recorder.order).toEqual(["late"]);
  });

  test("uses otherwise only after all earlier cases fail", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    Sync.register({
      Default: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "reject" }).then(
          act(Decision.decide, { kind: "reject" }).match(
            on({ route: "approved" }, act(Recorder.record, { tag: "approved" })),
            otherwise(act(Recorder.record, { tag: "default" })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "reject" });
    expect(Recorder.order).toEqual(["default"]);
  });

  test("runs a selected case body as a pipeline", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    Sync.register({
      CasePipeline: sync(({ route }: Vars) =>
        when(Button.clicked, { kind: "approve" }).then(
          act(Decision.decide, { kind: "approve" }).match(
            on(
              { route },
              act(Recorder.record, { tag: "case-1" }),
              act(Recorder.record, { tag: "case-2" }),
            ),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["case-1", "case-2"]);
  });
});

describe("matchers and guards", () => {
  test("uses RegExp, oneOf, and is in when and match patterns", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    const global = /^appro/g;
    Sync.register({
      Matcher: sync((_vars: Vars) =>
        when(Button.clicked, { kind: /^appro/ }).then(
          act(Decision.decide, { kind: "approve" }).match(
            on({ route: global }, act(Recorder.record, { tag: "regex" })),
            otherwise(act(Recorder.record, { tag: "default" })),
          ),
        ),
      ),
      OneOf: sync((_vars: Vars) =>
        when(Button.clicked, { kind: oneOf("manual", "reject") }).then(
          act(Decision.decide, { kind: "manual" }).match(
            on(
              { route: is((value) => value === "manual", "manual route") },
              act(Recorder.record, { tag: "is" }),
            ),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "manual" });
    expect(Recorder.order).toEqual(["regex", "regex", "is"]);
  });

  test("terminates a frame when a matcher or guard throws", async () => {
    const { Sync, Button, Decision, Recorder } = setup();
    Sync.register({
      BadMatcher: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "matcher" }).then(
          act(Decision.decide, { kind: "approve" }).match(
            on(
              {
                route: is(() => {
                  throw new Error("matcher");
                }),
              },
              act(Recorder.record, { tag: "bad" }),
            ),
            otherwise(act(Recorder.record, { tag: "default" })),
          ),
        ),
      ),
      BadGuard: sync((_vars: Vars) =>
        when(Button.clicked, { kind: "guard" }).then(
          act(Decision.decide, { kind: "approve" }).match(
            on(
              {},
              guard(($) => $(Symbol("unbound"))),
              act(Recorder.record, { tag: "bad" }),
            ),
            otherwise(act(Recorder.record, { tag: "default" })),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "matcher" });
    await Button.clicked({ kind: "guard" });
    expect(Recorder.order).toEqual([]);
  });
});

describe("where and par", () => {
  test("step where fan-out reaches match bodies and following siblings", async () => {
    const { Sync, Button, Completion, List, Recorder } = setup();
    await List.add({ value: 1 });
    await List.add({ value: 2 });
    Sync.register({
      Fanout: sync(({ value, tag }: Vars) =>
        when(Button.clicked, { kind: "fanout" }).then(
          act(Completion.finish, {})
            .where((frames: Frames) =>
              frames
                .query(List._items, {}, { value })
                .map((frame) => ({ ...frame, [tag]: `v:${frame[value]}` })),
            )
            .match(on(act(Recorder.record, { tag }))),
          act(Recorder.record, { tag }),
        ),
      ),
    });

    await Button.clicked({ kind: "fanout" });
    expect(Recorder.order).toEqual(["v:1", "v:2", "v:1", "v:2"]);
  });

  test("threads bindings only inside an array pipeline child of par", async () => {
    const { Sync, Button, Recorder, StepRecorder: SR } = setup();
    Sync.register({
      ParallelPipeline: sync(({ data }: Vars) =>
        when(Button.clicked, { kind: "parallel" }).then(
          par(
            [act(SR.step1, {}, { data }), act(SR.step2, { data })],
            act(Recorder.record, { tag: "sibling" }),
          ),
        ),
      ),
    });

    await Button.clicked({ kind: "parallel" });
    expect(SR.order).toEqual(["step1", "step2:a"]);
    expect(Recorder.order).toEqual(["sibling"]);
  });
});

describe("construction guards", () => {
  test("rejects invalid pipeline and match shapes", () => {
    const { Button, Completion, Recorder } = setup();
    expect(() => when(Button.clicked, {}).then()).toThrow("at least one node");
    expect(() => par()).toThrow("at least one child");
    expect(() => act(Completion.finish, {}).match()).toThrow("at least one case");
    expect(() => on({})).toThrow("at least one");
    expect(() => onError({})).toThrow("at least one");
    expect(() => otherwise()).toThrow("at least one");
    expect(() => when(Button.clicked, {}).then(on(act(Recorder.record, {})) as any)).toThrow(
      "only appear inside",
    );
    expect(() => act(Completion.finish, {}).match(act(Recorder.record, {}) as any)).toThrow("only");
    expect(() =>
      act(Completion.finish, {}).match(
        otherwise(act(Recorder.record, {})),
        on(act(Recorder.record, {})),
      ),
    ).toThrow("final");
    expect(() => par([])).toThrow("at least one");
  });

  test("when builders and action chains are not thenable", async () => {
    const { Button, Completion } = setup();
    await expect(
      Promise.resolve(when(Button.clicked, {}) as unknown as Promise<unknown>),
    ).rejects.toThrow("not a promise");
    expect((act(Completion.finish, {}) as any).then).toBeUndefined();
  });
});
