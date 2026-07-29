import { describe, expect, test } from "vite-plus/test";
import { Logging } from "@sync-engine/assembly";
import { reaction, vocabulary, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { oneOf } from "@sync-engine/internal/reads/matchers";
import { applyWhereOps } from "@sync-engine/internal/reads/where-evaluation";
import { conditionOp, custom } from "@sync-engine/internal/reads/where-ops";
import type { WhereOp } from "@sync-engine/internal/reads/where-ops";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting";
import type { Empty, StepNode } from "@sync-engine/internal/reactions/types";
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

const refs = vocabulary({
  concepts: {
    Button: ButtonConcept,
    Completion: CompletionConcept,
    Decision: DecisionConcept,
    List: ListConcept,
    Recorder: RecorderConcept,
    StepRecorder,
    Throwing: ThrowingConcept,
  },
}).concepts;

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
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Pipeline: reaction(({ kind, route }: Vars) =>
        when(refs.Button.clicked({ kind }).responds())
          .then(refs.Decision.decide({ kind }).responds({ route }))
          .then(refs.Recorder.record({ tag: route })),
      ),
    });

    await Button.clicked({ kind: "approve" });
    expect(Recorder.order).toEqual(["approved"]);
  });

  test("stops after an error outcome", async () => {
    const { reacting, Button, Recorder, Throwing } = setup();
    let refusalTransformed = false;
    reacting.register({
      Stop: reaction((_vars: Vars) => {
        const refusing = refs.Throwing.explode({}) as StepNode;
        refusing.transform = (frames) => {
          refusalTransformed = true;
          return frames;
        };
        return when(refs.Button.clicked({ kind: "stop" }).responds())
          .then(refs.Recorder.record({ tag: "before" }))
          .then(refusing as never)
          .then(refs.Recorder.record({ tag: "after" }));
      }),
    });

    await Button.clicked({ kind: "stop" });
    expect(Throwing.hit).toBe(true);
    expect(refusalTransformed).toBe(true);
    expect(Recorder.order).toEqual(["before"]);
  });

  test("drops a frame when a successful output pattern does not unify", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Mismatch: reaction((_vars: Vars) =>
        when(refs.Button.clicked({ kind: "mismatch" }).responds())
          .then(refs.Decision.decide({ kind: "approve" }).responds({ route: "rejected" }))
          .then(refs.Recorder.record({ tag: "unreachable" })),
      ),
    });

    await Button.clicked({ kind: "mismatch" });
    expect(Recorder.order).toEqual([]);
  });

  test("allows only empty output mappings for completion", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      Complete: reaction((_vars: Vars) =>
        when(refs.Button.clicked({ kind: "complete" }).responds())
          .then(refs.Completion.finish({}).responds())
          .then(refs.Recorder.record({ tag: "ok" })),
      ),
      CompleteMismatch: reaction((_vars: Vars) =>
        when(refs.Button.clicked({ kind: "complete" }).responds())
          .then(refs.Completion.finish({}).responds({ absent: "value" } as never))
          .then(refs.Recorder.record({ tag: "bad" })),
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
        when(refs.Button.clicked({ kind: /^appro/ } as never).responds()).then(
          refs.Recorder.record({ tag: "regex" }),
        ),
      ),
      OneOf: reaction((_vars: Vars) =>
        when(refs.Button.clicked({ kind: oneOf("manual", "reject") } as never).responds()).then(
          refs.Recorder.record({ tag: "oneof" }),
        ),
      ),
    });

    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "manual" });
    expect(Recorder.order).toEqual(["regex", "regex", "oneof"]);
  });
});

describe("raw step transforms", () => {
  test("a step transform fans out before following pipeline stages", async () => {
    const { reacting, Button, List, Recorder } = setup();
    await List.add({ value: 1 });
    await List.add({ value: 2 });
    reacting.register({
      Fanout: reaction(({ value, tag }: Vars) => {
        const completion = refs.Completion.finish({}) as StepNode;
        completion.transformOps = [
          conditionOp(refs.List._items({}).is({ value }), "test step transform") as WhereOp,
          custom((item) => `v:${String(item)}`, [value], [tag]),
        ];
        completion.transform = (frames) => applyWhereOps(frames, completion.transformOps ?? []);
        return when(refs.Button.clicked({ kind: "fanout" }).responds())
          .then(completion as never)
          .then(refs.Recorder.record({ tag }))
          .then(refs.Recorder.record({ tag }));
      }),
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
        when(refs.Button.clicked({ kind: "parallel" }).responds())
          .then(refs.StepRecorder.step1({}).responds({ data }))
          .then(refs.StepRecorder.step2({ data })),
      ),
      // A separate reaction on the same trigger — an independent sibling.
      Sibling: reaction((_vars: Vars) =>
        when(refs.Button.clicked({ kind: "parallel" }).responds()).then(
          refs.Recorder.record({ tag: "sibling" }),
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
    setup();
    expect(() => (when(refs.Button.clicked({}).responds()).then as Function)()).toThrow(
      "at least one callable action line",
    );
  });

  test("when builders and action chains are not thenable", async () => {
    setup();
    await expect(
      Promise.resolve(when(refs.Button.clicked({}).responds()) as unknown as Promise<unknown>),
    ).rejects.toThrow("not a promise");
    expect((refs.Completion.finish({}) as any).then).toBeUndefined();
  });
});
