/**
 * The refusal/fault split during action instrumentation.
 *
 * A concept refuses by `throw new Refuse(message, data?)` — the
 * implementation-language spelling of its declared refuse branch.
 * Instrumentation records a refusal outcome for posture triggers. Any other
 * throw is a runtime fault and leaves the ask without an outcome.
 */

import { describe, expect, test } from "vite-plus/test";
import {
  request,
  isRefuse,
  Logging,
  Refuse,
  refusalMapping,
  Reacting,
  type Empty,
  type Vars,
  when,
} from "@sync-engine/internal/reactions";
import { ButtonConcept, RecorderConcept } from "./mocks.ts";

class GateKeeperConcept {
  admit({ name }: { name: string }) {
    if (name === "") throw new Refuse("EMPTY_NAME", { detail: "A name is required" });
    return { admitted: name };
  }
}

class BrokenConcept {
  run(_: Empty): Record<string, unknown> {
    throw new TypeError("undefined is not a function");
  }
}

function setup() {
  const reacting = new Reacting();
  reacting.logging = Logging.OFF;
  const concepts = reacting.instrument({
    Broken: new BrokenConcept(),
    Button: new ButtonConcept(),
    GateKeeper: new GateKeeperConcept(),
    Recorder: new RecorderConcept(),
  });
  return { reacting, ...concepts };
}

describe("the Refuse marker", () => {
  test("is recognized by marker symbol, and its message wins the error key", () => {
    const refusal = new Refuse("NO_ROOM", { error: "SMUGGLED", detail: "the event is full" });
    expect(isRefuse(refusal)).toBe(true);
    expect(isRefuse(new Error("NO_ROOM"))).toBe(false);
    expect(refusalMapping(refusal)).toEqual({ error: "NO_ROOM", detail: "the event is full" });
  });

  test("a thrown Refuse records a refusal outcome and returns its mapping", async () => {
    const { reacting, GateKeeper } = setup();

    const result = await GateKeeper.admit({ name: "" });
    expect(result).toEqual({ error: "EMPTY_NAME", detail: "A name is required" });

    const records = [...reacting.Action.actions.values()];
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toEqual({
      kind: "error",
      error: { error: "EMPTY_NAME", detail: "A name is required" },
    });
  });

  test("a refusal triggers when patterns keyed on the refusal mapping", async () => {
    const { reacting, Button, GateKeeper, Recorder } = setup();
    reacting.register({
      // A refusal's outcome carries its whole mapping; a when output pattern
      // keyed on any of its keys unifies against it. `error` binds the code…
      OnRefused: ({ error }: Vars) =>
        when(GateKeeper.admit, {}, { error }).then(request(Recorder.record, { tag: error })),
      Pipeline: (_: Vars) =>
        when(Button.clicked, { kind: "admit" }).then(request(GateKeeper.admit, { name: "" })),
      // …and `detail` binds the message, pinned to the ask that raised it —
      // the chain's path for failures, without a per-step error callback.
      Recover: ({ detail }: Vars) =>
        when(GateKeeper.admit, {}, { detail }, { by: "Pipeline" }).then(
          request(Recorder.record, { tag: detail }),
        ),
    });

    await Button.clicked({ kind: "admit" });
    expect(Recorder.order).toContain("EMPTY_NAME");
    expect(Recorder.order).toContain("A name is required");
  });
});

describe("faults during action instrumentation", () => {
  test("a thrown non-Refuse is a fault: no posture, the ask stays pending", async () => {
    const { reacting, Broken } = setup();

    await expect(Broken.run({})).rejects.toThrow("undefined is not a function");

    const records = [...reacting.Action.actions.values()];
    expect(records[0]?.outcome).toBeUndefined();
    expect(records[0]?.fault).toMatchObject({ error: "UNKNOWN_ERROR" });
    expect(reacting.Action._getPending()).toHaveLength(1);
  });

  test("a refusal is not a fault", async () => {
    const { reacting, GateKeeper } = setup();
    await GateKeeper.admit({ name: "" });
    const records = [...reacting.Action.actions.values()];
    expect(records[0]?.fault).toBeUndefined();
    expect(records[0]?.outcome?.kind).toBe("error");
  });

  test("a mid-pipeline fault keeps the firing and records an unanswered ask", async () => {
    const { reacting, Button, Broken, Recorder } = setup();
    reacting.register({
      FaultyPipeline: (_: Vars) =>
        when(Button.clicked, { kind: "go" })
          .then(request(Broken.run, {}))
          .then(request(Recorder.record, { tag: "after-fault" })),
    });

    await Button.clicked({ kind: "go" });

    // The pipeline stopped at the fault; the firing retains the faulted
    // ask on its produced list, and the trigger stays consumed.
    expect(Recorder.order).toEqual([]);
    const firings = reacting._getFirings("FaultyPipeline");
    expect(firings).toHaveLength(1);
    const faulted = reacting.Action._getFaulted();
    expect(faulted).toHaveLength(1);
    expect(firings[0]?.produced).toContain(faulted[0]?.id);
  });
});
