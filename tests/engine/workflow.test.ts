import { describe, expect, test } from "vite-plus/test";
import {
  actions,
  branch,
  Logging,
  outcome,
  step,
  SyncConcept,
  workflow,
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
    Throwing: new ThrowingConcept(),
  });

  return { Sync, ...concepts };
}

describe("nested workflow then clauses", () => {
  test("branches on ordinary result values, not just errors", async () => {
    const { Sync, Button, Decision, Recorder } = setup();

    Sync.register({
      ApprovalWorkflow: workflow(({ kind }: Vars) => ({
        when: actions([Button.clicked, { kind }, {}]),
        then: [
          step([Decision.decide, { kind }], {
            then: [
              branch(
                { route: "approved" },
                {
                  then: [step([Recorder.record, { tag: "approved" }])],
                },
              ),
              branch(
                { route: "rejected" },
                {
                  then: [step([Recorder.record, { tag: "rejected" }])],
                },
              ),
            ],
          }),
        ],
      })),
    });

    await Button.clicked({ kind: "approve" });
    await Button.clicked({ kind: "reject" });

    expect(Recorder.order).toEqual(["approved", "rejected"]);
  });

  test("routes thrown concept errors through outcome.error", async () => {
    const { Sync, Button, Recorder, Throwing } = setup();

    Sync.register({
      ThrowingWorkflow: workflow(({ detail }: Vars) => ({
        when: actions([Button.clicked, { kind: "throw" }, {}]),
        then: [
          step([Throwing.explode, {}], {
            then: [
              outcome.error(
                { detail },
                {
                  then: [step([Recorder.record, { tag: detail }])],
                },
              ),
              step([Recorder.record, { tag: "should-not-run" }]),
            ],
          }),
        ],
      })),
    });

    await Button.clicked({ kind: "throw" });

    expect(Throwing.hit).toBe(true);
    expect(Recorder.order).toEqual(["kaboom"]);
  });

  test("preserves domain error codes thrown by concept actions", async () => {
    const { Sync, Button, DomainFailure, Recorder } = setup();

    Sync.register({
      DomainErrorWorkflow: workflow(({ detail }: Vars) => ({
        when: actions([Button.clicked, { kind: "domain-error" }, {}]),
        then: [
          step([DomainFailure.fail, {}], {
            then: [
              outcome.error(
                { error: "OUT_OF_STOCK", detail },
                {
                  then: [step([Recorder.record, { tag: detail }])],
                },
              ),
            ],
          }),
        ],
      })),
    });

    await Button.clicked({ kind: "domain-error" });

    expect(Recorder.order).toEqual(["inventory unavailable"]);
  });

  test("treats completion as a successful result", async () => {
    const { Sync, Button, Completion, Recorder } = setup();

    Sync.register({
      CompletionWorkflow: workflow((_vars: Vars) => ({
        when: actions([Button.clicked, { kind: "complete" }, {}]),
        then: [
          step([Completion.finish, {}, {}], {
            then: [
              outcome.complete({
                then: [step([Recorder.record, { tag: "complete" }])],
              }),
              outcome.result({
                then: [step([Recorder.record, { tag: "result" }])],
              }),
            ],
          }),
        ],
      })),
    });

    await Button.clicked({ kind: "complete" });

    expect(Recorder.order).toEqual(["complete", "result"]);
  });

  test("supports nested where fanout after a step completes", async () => {
    const { Sync, Button, Completion, List, Recorder } = setup();

    await List.add({ value: 1 });
    await List.add({ value: 2 });

    Sync.register({
      FanoutWorkflow: workflow(({ value, tag }: Vars) => ({
        when: actions([Button.clicked, { kind: "fanout" }, {}]),
        then: [
          step([Completion.finish, {}, {}], {
            where: (frames: Frames) =>
              frames.query(List._items, {}, { value }).map((frame) => ({
                ...frame,
                [tag]: `v:${String(frame[value])}`,
              })),
            then: [step([Recorder.record, { tag }])],
          }),
        ],
      })),
    });

    await Button.clicked({ kind: "fanout" });

    expect(Recorder.order).toEqual(["v:1", "v:2"]);
  });
});
