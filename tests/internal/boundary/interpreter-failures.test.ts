/** Truthful boundary settlement for interpreter failures between action asks. */

import { describe, expect, test } from "vite-plus/test";
import { MemoryStore } from "@sync-engine/internal/reactions/runtime/log-store.ts";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { vocabulary } from "@sync-engine/advanced";
import { reaction, view, when, where } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { Frames } from "@sync-engine/internal/reads/frames";
import { custom } from "@sync-engine/internal/reads/where-ops";
import { FAULT_REPLY } from "@sync-engine/internal/boundary/invocation/funnel";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";
import type { Empty } from "@sync-engine/internal/reactions/types";

const privateSentinel = "private-interpreter-failure";

class FailureSourceConcept {
  static readonly queries = { _broken: "many", _rows: "many" } as const;

  _broken(_: Empty): { value: string }[] {
    throw new Error(privateSentinel);
  }

  _rows(_: Empty): { value: string }[] {
    return [{ value: "one" }, { value: "two" }];
  }

  passthrough(_: { kind?: string }): { value: string } {
    return { value: "ok" };
  }

  consequenceInput({ value }: { value: string }): { value: string } {
    return { value };
  }

  hostileOutput(_: Empty): { value: string } {
    return Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        throw new Error(privateSentinel);
      },
    }) as { value: string };
  }
}

function setup() {
  const words = vocabulary({
    concepts: { FailureSource: FailureSourceConcept },
    computations: {
      broken: () => {
        throw new Error(privateSentinel);
      },
    },
  });
  const { FailureSource } = words.concepts;
  const { broken } = words.computations;
  const onlyRow = view("the only failure-source row", (_inputs, { value }, _bindings) =>
    where(FailureSource._rows({}).is({ value })),
  ).one();

  const QueryFailure = endpoint("/fail/query", ({ value }: Vars) =>
    receive().where(FailureSource._broken({}).is({ value })).then(respond({ value })),
  );
  const ViewFailure = endpoint("/fail/view", ({ value }: Vars) =>
    receive().where(onlyRow({}).is({ value })).then(respond({ value })),
  );
  const ComputationFailure = endpoint("/fail/computation", () =>
    receive()
      .where(broken({}))
      .then(respond({ unreachable: true })),
  );
  const StartCustomFailure = endpoint("/fail/custom", () =>
    receive().then(FailureSource.passthrough({ kind: "custom" })),
  );
  const CustomFailure = reaction(() =>
    when(FailureSource.passthrough({ kind: "custom" }).responds())
      .where(
        custom(
          () => {
            throw new Error(privateSentinel);
          },
          [],
          [],
        ),
      )
      .then(FailureSource.passthrough({})),
  );
  const StartClosureFailure = endpoint("/fail/closure", () =>
    receive().then(FailureSource.passthrough({ kind: "closure" })),
  );
  const ClosureFailure = reaction(() =>
    when(FailureSource.passthrough({ kind: "closure" }).responds())
      .where(() => {
        throw new Error(privateSentinel);
      })
      .then(FailureSource.passthrough({})),
  );
  const StartMalformedClosure = endpoint("/fail/malformed-closure", () =>
    receive().then(FailureSource.passthrough({ kind: "malformed-closure" })),
  );
  const MalformedClosure = reaction(() =>
    when(FailureSource.passthrough({ kind: "malformed-closure" }).responds())
      .where(() => new Frames({}))
      .then(FailureSource.passthrough({})),
  );
  const StartInPlaceMalformedClosure = endpoint("/fail/in-place-malformed-closure", () =>
    receive().then(FailureSource.passthrough({ kind: "in-place-malformed-closure" })),
  );
  const InPlaceMalformedClosure = reaction(() =>
    when(FailureSource.passthrough({ kind: "in-place-malformed-closure" }).responds())
      .where((frames) => {
        for (const frame of frames) {
          for (const symbol of Object.getOwnPropertySymbols(frame)) delete frame[symbol];
        }
        return frames;
      })
      .then(FailureSource.passthrough({})),
  );
  const StartForgedTriggerClosure = endpoint("/fail/forged-trigger-closure", () =>
    receive().then(FailureSource.passthrough({ kind: "forged-trigger-closure" })),
  );
  const ForgedTriggerClosure = reaction(() =>
    when(FailureSource.passthrough({ kind: "forged-trigger-closure" }).responds())
      .where((frames) => {
        for (const frame of frames) {
          for (const symbol of Object.getOwnPropertySymbols(frame)) {
            if (symbol.description?.startsWith("action_") === true) frame[symbol] = "forged";
          }
        }
        return frames;
      })
      .then(FailureSource.passthrough({})),
  );
  const StartAccessorTriggerClosure = endpoint("/accessor-trigger", () =>
    receive()
      .then(FailureSource.passthrough({ kind: "accessor-trigger" }).responds())
      .then(respond({ answer: "safe" })),
  );
  const AccessorTriggerClosure = reaction(() =>
    when(FailureSource.passthrough({ kind: "accessor-trigger" }).responds())
      .where((frames) => {
        for (const frame of frames) {
          for (const symbol of Object.getOwnPropertySymbols(frame)) {
            if (symbol.description?.startsWith("action_") !== true) continue;
            const original = frame[symbol];
            let firstRead = true;
            Object.defineProperty(frame, symbol, {
              enumerable: true,
              get() {
                if (firstRead) {
                  firstRead = false;
                  return original;
                }
                return "forged";
              },
            });
          }
        }
        return frames;
      })
      .then(FailureSource.passthrough({ kind: "accessor-safe" })),
  );
  const StartConsequenceInputFailure = endpoint("/fail/consequence-input", ({ value }: Vars) =>
    receive({ value }).then(FailureSource.consequenceInput({ value }).responds({ value })),
  );
  const ConsequenceInputFailure = reaction(({ value }: Vars) =>
    when(FailureSource.consequenceInput({}).responds({ value }))
      .where(
        (frames) =>
          new Frames(
            ...frames.map((frame) => {
              const withoutValue = { ...frame };
              delete withoutValue[value];
              return withoutValue;
            }),
          ),
      )
      .then(FailureSource.passthrough({ kind: value as unknown as string })),
  );

  const StartResultTransformFailure = endpoint("/fail/result-transform", () =>
    receive().then(FailureSource.passthrough({ kind: "result-transform" })),
  );
  const ResultTransformFailure = reaction(({ value }: Vars) => {
    const transformed = FailureSource.passthrough({}).responds({ value });
    transformed.transform = () => {
      throw new Error(privateSentinel);
    };
    return when(FailureSource.passthrough({ kind: "result-transform" }).responds()).then(
      transformed,
    );
  });

  const StartConsequenceOutputFailure = endpoint("/fail/consequence-output", () =>
    receive().then(FailureSource.passthrough({ kind: "consequence-output" })),
  );
  const ConsequenceOutputFailure = reaction(({ value }: Vars) => {
    const hostile = FailureSource.hostileOutput({}).responds({ value });
    hostile.transform = (frames) => frames;
    return when(FailureSource.passthrough({ kind: "consequence-output" }).responds()).then(hostile);
  });
  const TriggerFailure = endpoint("/fail/trigger", ({ value }: Vars) =>
    receive().then(FailureSource.hostileOutput({}).responds({ value })).then(respond({ value })),
  );

  const StartBrokenSibling = endpoint("/answer-wins", () =>
    receive().then(FailureSource.passthrough({ kind: "answer-wins" })),
  );
  const BrokenSibling = reaction(() =>
    when(FailureSource.passthrough({ kind: "answer-wins" }).responds())
      .where(() => {
        throw new Error(privateSentinel);
      })
      .then(FailureSource.passthrough({})),
  );
  const HealthySibling = endpoint("/answer-wins", () => receive().then(respond({ answer: "ok" })));
  const AnswerBeforeFailure = endpoint("/answer-before-failure", () =>
    receive()
      .then(respond({ answer: "ok" }))
      .then(FailureSource.passthrough({ kind: "after-answer" })),
  );
  const FailureAfterAnswer = reaction(() =>
    when(FailureSource.passthrough({ kind: "after-answer" }).responds())
      .where(() => {
        throw new Error(privateSentinel);
      })
      .then(FailureSource.passthrough({})),
  );
  const Uncovered = endpoint("/uncovered", () =>
    receive().then(FailureSource.passthrough({ kind: "uncovered" })),
  );
  const UncoveredLocal = reaction(() =>
    when(FailureSource.passthrough({ kind: "uncovered" }).responds())
      .where(() => new Frames())
      .then(FailureSource.passthrough({})),
  );

  const app = assemble({
    vocabulary: words,
    composition: {
      AnswerBeforeFailure,
      ComputationFailure,
      HealthySibling,
      QueryFailure,
      StartAccessorTriggerClosure,
      StartBrokenSibling,
      StartClosureFailure,
      StartConsequenceInputFailure,
      StartConsequenceOutputFailure,
      StartCustomFailure,
      StartForgedTriggerClosure,
      StartInPlaceMalformedClosure,
      StartMalformedClosure,
      StartResultTransformFailure,
      TriggerFailure,
      Uncovered,
      ViewFailure,
      onlyRow,
    },
    retention: "keepAll",
  });
  // Manual registration deliberately exercises the advanced local interpreter
  // path without making opaque behavior part of ordinary assembly.
  app.engine.register({
    AccessorTriggerClosure,
    BrokenSibling,
    ClosureFailure,
    ConsequenceInputFailure,
    ConsequenceOutputFailure,
    CustomFailure,
    FailureAfterAnswer,
    ForgedTriggerClosure,
    InPlaceMalformedClosure,
    MalformedClosure,
    ResultTransformFailure,
    UncoveredLocal,
  });
  return app;
}

describe("interpreter failure settlement", () => {
  test.each([
    ["/fail/query", "QueryFailure"],
    ["/fail/view", "ViewFailure"],
    ["/fail/computation", "ComputationFailure"],
    ["/fail/custom", "CustomFailure"],
    ["/fail/closure", "ClosureFailure"],
    ["/fail/malformed-closure", "MalformedClosure"],
    ["/fail/in-place-malformed-closure", "InPlaceMalformedClosure"],
    ["/fail/forged-trigger-closure", "ForgedTriggerClosure"],
  ])("settles a %s where failure without waiting for timeout", async (path, reaction) => {
    const app = setup();
    const result = await app.invoker.invoke(path as never, {} as never, { timeoutMs: 100 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FAULT_REPLY },
    });
    const failures = (app.engine.Action.store as MemoryStore).reactionFailures;
    expect(failures).toMatchObject([{ reaction, stage: "where", errorClass: expect.any(String) }]);
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
    expect(JSON.stringify(failures)).not.toContain(privateSentinel);
  });

  test.each([
    ["/fail/consequence-input", "ConsequenceInputFailure", "consequence-input", { value: "x" }],
    ["/fail/result-transform", "ResultTransformFailure", "result-transform", {}],
    ["/fail/consequence-output", "ConsequenceOutputFailure", "consequence-output", {}],
  ])("settles a %s pipeline failure with its exact stage", async (path, reaction, stage, input) => {
    const app = setup();
    const result = await app.invoker.invoke(path as never, input as never, { timeoutMs: 100 });

    expect(result).toEqual({
      ok: false,
      error: { kind: "framework", code: FAULT_REPLY },
    });
    const failures = (app.engine.Action.store as MemoryStore).reactionFailures;
    expect(failures).toMatchObject([
      { reaction, stage, errorClass: "Error", action: expect.any(String) },
    ]);
    expect(JSON.stringify(result)).not.toContain(privateSentinel);
    expect(JSON.stringify(failures)).not.toContain(privateSentinel);
  });

  test("settles malformed returned-trigger output with its trigger stage", async () => {
    const app = setup();

    expect(await app.invoker.invoke("/fail/trigger", {}, { timeoutMs: 100 })).toEqual({
      ok: false,
      error: { kind: "framework", code: FAULT_REPLY },
    });
    expect((app.engine.Action.store as MemoryStore).reactionFailures).toMatchObject([
      { reaction: "TriggerFailure#2", stage: "trigger", errorClass: "Error" },
    ]);
  });

  test("uses snapshotted trigger ids after validating hostile accessors", async () => {
    const app = setup();

    expect(await app.invoker.invoke("/accessor-trigger", {}, { timeoutMs: 100 })).toEqual({
      ok: true,
      value: { answer: "safe" },
    });
    const firing = app.engine.Action.store.firingsByReaction("AccessorTriggerClosure")[0];
    expect(firing?.consumed).toHaveLength(1);
    expect(firing?.consumed).not.toContain("forged");
  });

  test("keeps an authored answer when a sibling interpreter path fails", async () => {
    const app = setup();

    expect(await app.invoker.invoke("/answer-wins", {}, { timeoutMs: 100 })).toEqual({
      ok: true,
      value: { answer: "ok" },
    });
    expect((app.engine.Action.store as MemoryStore).reactionFailures).toMatchObject([
      { reaction: "BrokenSibling", stage: "where" },
    ]);
  });

  test("keeps an answer delivered before a later interpreter failure", async () => {
    const app = setup();

    expect(await app.invoker.invoke("/answer-before-failure", {}, { timeoutMs: 100 })).toEqual({
      ok: true,
      value: { answer: "ok" },
    });
    expect((app.engine.Action.store as MemoryStore).reactionFailures).toMatchObject([
      { reaction: "FailureAfterAnswer", stage: "where" },
    ]);
  });

  test("leaves a fault-free uncovered endpoint to time out", async () => {
    const app = setup();

    expect(await app.invoker.invoke("/uncovered", {}, { timeoutMs: 5 })).toEqual({
      ok: false,
      error: { kind: "framework", code: "TIMED_OUT", detail: undefined },
    });
    expect((app.engine.Action.store as MemoryStore).reactionFailures).toEqual([]);
    expect(
      [...app.engine.Action.store.actions.values()].filter(({ fault }) => fault !== undefined),
    ).toEqual([]);
  });

  test("waits for root-flow quiescence before settling a recorded failure", async () => {
    let enterWait = () => {};
    const entered = new Promise<void>((resolve) => {
      enterWait = resolve;
    });
    let releaseWait = () => {};
    const waiting = new Promise<void>((resolve) => {
      releaseWait = resolve;
    });
    class SlowConcept {
      async wait(_: Empty): Promise<Empty> {
        enterWait();
        await waiting;
        return {};
      }
    }
    class TriggerConcept {
      start(_: Empty): Empty {
        return {};
      }
    }
    const words = vocabulary({
      concepts: { Slow: SlowConcept, Trigger: TriggerConcept },
      computations: {},
    });
    const { Slow, Trigger } = words.concepts;
    const StartBroken = endpoint("/quiescence", () => receive().then(Trigger.start({})));
    const Broken = reaction(() =>
      when(Trigger.start({}).responds())
        .where(() => {
          throw new Error(privateSentinel);
        })
        .then(Trigger.start({})),
    );
    const SlowSibling = endpoint("/quiescence", () => receive().then(Slow.wait({})));
    const app = assemble({
      vocabulary: words,
      composition: { SlowSibling, StartBroken },
    });
    app.engine.register({ Broken });
    const invocation = app.invoker.invoke("/quiescence", {}, { timeoutMs: 1_000 });

    await entered;
    let settled = false;
    void invocation.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseWait();
    expect(await invocation).toEqual({
      ok: false,
      error: { kind: "framework", code: FAULT_REPLY },
    });
  });

  test("settles before a zero-sized retention window evicts the failed flow", async () => {
    const words = vocabulary({
      concepts: { FailureSource: FailureSourceConcept },
      computations: {},
    });
    const { FailureSource } = words.concepts;
    const Broken = endpoint("/broken", ({ value }: Vars) =>
      receive().where(FailureSource._broken({}).is({ value })).then(respond({ value })),
    );
    const app = assemble({
      vocabulary: words,
      composition: { Broken },
      retention: { window: 0 },
    });

    expect(await app.invoker.invoke("/broken", {}, { timeoutMs: 100 })).toEqual({
      ok: false,
      error: { kind: "framework", code: FAULT_REPLY },
    });
    expect(app.engine.Action.actions.size).toBe(0);
    expect((app.engine.Action.store as MemoryStore).reactionFailures).toEqual([]);
  });
});
