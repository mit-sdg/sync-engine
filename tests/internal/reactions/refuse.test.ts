/**
 * The refusal/fault split during action instrumentation.
 *
 * A concept refuses by `throw new Refuse(message, data?)` — the
 * implementation-language spelling of its declared refuse branch.
 * Instrumentation records a refusal outcome for posture triggers. Any other
 * throw is a runtime fault and leaves the ask without an outcome.
 */

import { describe, expect, test } from "vite-plus/test";
import { Refuse } from "@sync-engine/advanced";
import { vocabulary } from "@sync-engine/advanced";
import { reaction, when } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { isRefuse, refusalMapping } from "@sync-engine/internal/reactions/concepts/refuse";
import { quietReacting } from "../../utils/reacting.ts";
import type { Empty } from "@sync-engine/internal/reactions/types";
import { ButtonConcept, RecorderConcept } from "./mocks.ts";
import { ActionConcept } from "@sync-engine/internal/reactions/runtime/actions.ts";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { Reacting } from "@sync-engine/internal/reactions/runtime/reacting.ts";
import type { RawFaultReport } from "@sync-engine/assembly";

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

const refs = vocabulary({
  concepts: {
    Broken: BrokenConcept,
    Button: ButtonConcept,
    GateKeeper: GateKeeperConcept,
    Recorder: RecorderConcept,
  },
}).concepts;

function setup() {
  const reacting = quietReacting();
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
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      // A refusal's outcome carries its whole mapping; a when output pattern
      // keyed on any of its keys unifies against it. `error` binds the code…
      OnRefused: reaction(({ error }: Vars) =>
        when(refs.GateKeeper.admit({}).refuses({ error })).then(
          refs.Recorder.record({ tag: error }),
        ),
      ),
      // …and `detail` binds the message, pinned to the ask that raised it —
      // the chain's path for failures, without a per-step error callback.
      Pipeline: reaction(({ detail }: Vars) =>
        when(refs.Button.clicked({ kind: "admit" }).responds())
          .then(refs.GateKeeper.admit({ name: "" }).refuses({ detail }))
          .then(refs.Recorder.record({ tag: detail })),
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
    expect(
      [...reacting.Action.store.actions.values()].filter(({ outcome }) => outcome === undefined),
    ).toHaveLength(1);
  });

  test("reports the original action fault only through the privileged reporter", async () => {
    const fault = new TypeError("private fault detail");
    const reports: RawFaultReport[] = [];
    class Faulting {
      run(_: Empty): never {
        throw fault;
      }
    }
    const store = new MemoryStore();
    const reacting = new Reacting(
      new ActionConcept(store, undefined, undefined, (report) => {
        reports.push(report);
        throw new Error("reporter failure");
      }),
    );
    const Fault = reacting.instrumentConcept(new Faulting(), "Faulting");

    await expect(Fault.run({})).rejects.toBe(fault);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: "action",
      error: fault,
      concept: "Faulting",
      action: "run",
    });
    expect(JSON.stringify(store.actions)).not.toContain("private fault detail");
  });

  test("a refusal is not a fault", async () => {
    const { reacting, GateKeeper } = setup();
    await GateKeeper.admit({ name: "" });
    const records = [...reacting.Action.actions.values()];
    expect(records[0]?.fault).toBeUndefined();
    expect(records[0]?.outcome?.kind).toBe("error");
  });

  test("a mid-pipeline fault keeps the firing and records an unanswered ask", async () => {
    const { reacting, Button, Recorder } = setup();
    reacting.register({
      FaultyPipeline: reaction((_vars: Vars) =>
        when(refs.Button.clicked({ kind: "go" }).responds())
          .then(refs.Broken.run({}))
          .then(refs.Recorder.record({ tag: "after-fault" })),
      ),
    });

    await Button.clicked({ kind: "go" });

    // The pipeline stopped at the fault; the firing retains the faulted
    // ask on its produced list, and the trigger stays consumed.
    expect(Recorder.order).toEqual([]);
    const firings = reacting.Action.store.firingsByReaction("FaultyPipeline");
    expect(firings).toHaveLength(1);
    const faulted = [...reacting.Action.store.actions.values()].filter(
      ({ fault }) => fault !== undefined,
    );
    expect(faulted).toHaveLength(1);
    expect(firings[0]?.produced).toContain(faulted[0]?.id);
  });
});
