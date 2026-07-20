import { lineOf } from "@sync-engine/internal/reads/lines";
import { describe, expect, test } from "vite-plus/test";
import {
  request,
  custom,
  type Empty,
  Logging,
  oneOf,
  reaction,
  Reacting,
  type Vars,
  when,
} from "@sync-engine/internal/reactions";
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
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const concepts = reacting.instrument({
    Button: new ButtonConcept(),
    Completion: new CompletionConcept(),
    Decision: new DecisionConcept(),
    List: new ListConcept(),
    Recorder: new RecorderConcept(),
    StepRecorder: new StepRecorder(),
    Throwing: new ThrowingConcept(),
  });
  return { reacting, ...concepts };
}

describe("pipeline then", () => {
  test("threads request output bindings through chained steps", async () => {
    const { reacting, Button, Decision, Recorder } = setup();
    reacting.register({
      Pipeline: reaction(({ kind, route }: Vars) =>
        when(Button.clicked, { kind }).then(
          request(Decision.decide, { kind }, { route }),
          request(Recorder.record, { tag: route }),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("stops after an error outcome", async () => {
    const { reacting, Button, Recorder, Throwing } = setup();
    reacting.register({
      // explode refuses (an error outcome), so the chain never reaches the
      // "after" step — the ask's pipeline stops at the refusal.
      Stop: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "stop" }).then(
          request(Recorder.record, { tag: "before" }),
          request(Throwing.explode, {}),
          request(Recorder.record, { tag: "after" }),
        ),
      ),
    });

    await Button.clicked({ kind: "stop" });
    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual(["before"]);
  });

  test("drops a frame when a successful output pattern does not unify", async () => {
    const { reacting, Button, Decision, Recorder } = setup();
    reacting.register({
      Mismatch: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "mismatch" }).then(
          request(Decision.decide, { kind: "approve" }, { route: "rejected" }),
          request(Recorder.record, { tag: "unreachable" }),
        ),
      ),
    });

    await Button.clicked({ kind: "mismatch" });
    expect(Recorder.order).toEqual([]);
  });

  test("allows only empty output mappings for completion", async () => {
    const { reacting, Button, Completion, Recorder } = setup();
    reacting.register({
      Complete: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "complete" }).then(
          request(Completion.finish, {}, {}),
          request(Recorder.record, { tag: "ok" }),
        ),
      ),
      CompleteMismatch: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "complete" }).then(
          request(Completion.finish, {}, { absent: "value" }),
          request(Recorder.record, { tag: "bad" }),
        ),
      ),
    });

    await Button.clicked({ kind: "complete" });
    expect(Recorder.order).toEqual(["ok"]);
  });
});

describe("matchers in when patterns", () => {
  test("uses RegExp and oneOf to shape a when trigger", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Matcher: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: /^appro/ }).then(request(Recorder.record, { tag: "regex" })),
      ),
      OneOf: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: oneOf("manual", "reject") }).then(
          request(Recorder.record, { tag: "oneof" }),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "manual" });
    expect(Recorder.order).toEqual(["regex", "regex", "oneof"]);
  });
});

describe("step where fan-out", () => {
  test("step where fan-out reaches following siblings", async () => {
    const { reacting, Button, Completion, List, Recorder } = setup();
    await List.add({ value: 1 });
    await List.add({ value: 2 });
    reacting.register({
      Fanout: reaction(({ value, tag }: Vars) =>
        when(Button.clicked, { kind: "fanout" }).then(
          request(Completion.finish, {}).where(
            lineOf({ query: List._items }, {}).is({ value }),
            custom((item) => `v:${String(item)}`, [value], [tag]),
          ),
          request(Recorder.record, { tag }),
          request(Recorder.record, { tag }),
        ),
      ),
    });

    await Button.clicked({ kind: "fanout" });
    expect(Recorder.order).toEqual(["v:1", "v:2", "v:1", "v:2"]);
  });
});

describe("sibling reactions on a shared trigger", () => {
  test("a chained pipeline threads bindings while a sibling fires on the same trigger", async () => {
    const { reacting, Button, Recorder, StepRecorder: SR } = setup();
    reacting.register({
      // step1's output binding threads into step2; order matters within the chain.
      ParallelPipeline: reaction(({ data }: Vars) =>
        when(Button.clicked, { kind: "parallel" }).then(
          request(SR.step1, {}, { data }),
          request(SR.step2, { data }),
        ),
      ),
      // A separate reaction on the same trigger — an independent sibling.
      Sibling: reaction((_vars: Vars) =>
        when(Button.clicked, { kind: "parallel" }).then(
          request(Recorder.record, { tag: "sibling" }),
        ),
      ),
    });

    await Button.clicked({ kind: "parallel" });
    expect(SR.order).toEqual(["step1", "step2:a"]);
    expect(Recorder.order).toEqual(["sibling"]);
  });
});

describe("construction guards", () => {
  test("rejects an empty pipeline", () => {
    const { Button } = setup();
    expect(() => when(Button.clicked, {}).then()).toThrow("at least one request");
  });

  test("when builders and action chains are not thenable", async () => {
    const { Button, Completion } = setup();
    await expect(
      Promise.resolve(when(Button.clicked, {}) as unknown as Promise<unknown>),
    ).rejects.toThrow("not a promise");
    expect((request(Completion.finish, {}) as any).then).toBeUndefined();
  });
});
