/**
 * `queryCache: "since-dispatch"` keeps answers only while an open read may
 * reuse them, so a direct read that never settles must not keep every answer
 * read after it.
 */
import { describe, expect, test } from "vite-plus/test";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { vocabulary } from "@sync-engine/advanced";
import { endpoint, receive, respond } from "@sync-engine/boundary";
import { former, where } from "@sync-engine/language";
import type { Vars } from "@sync-engine/internal/reactions/types";
import { assemble } from "@sync-engine/internal/boundary/assembly/assemble";

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as () => void;

const READS = 50;

function app(maxRequestDurationMs?: number) {
  const gates: Array<() => void> = [];
  const answers: WeakRef<object>[] = [];
  class ShelfConcept {
    static readonly queries = { _value: "one", _pause: "one" } as const;
    async _value({ key }: { key: string }) {
      const answer = { value: key };
      answers.push(new WeakRef(answer));
      return answer;
    }
    async _pause(_: Record<string, never>) {
      await new Promise<void>((resolve) => gates.push(resolve));
      return { paused: true };
    }
  }
  const words = vocabulary({ concepts: { Shelf: ShelfConcept }, computations: {} });
  const { Shelf } = words.concepts;
  const paused = former("the pause ()", (_input, { paused: value }) =>
    where(Shelf._pause({}).is({ paused: value })).form({ paused: value }),
  );
  const Read = endpoint("/read", ({ key, value }: Vars) =>
    receive({ key }).where(Shelf._value({ key }).is({ value })).then(respond({ value })),
  );
  const assembled = assemble({
    vocabulary: words,
    composition: { paused, Read },
    queryCache: "since-dispatch",
    retention: { window: 0 },
    ...(maxRequestDurationMs === undefined
      ? {}
      : {
          executionLimits: {
            maxActiveRootFlows: 1_000,
            maxPendingRequests: 1_000,
            maxActionsPerFlow: 100,
            maxFiringsPerFlow: 100,
            maxRowsPerEvaluation: 1_000,
            maxRequestDurationMs,
          },
        }),
  });
  return {
    assembled,
    paused,
    open: () => gates.splice(0).forEach((release) => release()),
    waiting: () => gates.length,
    alive: () => {
      gc();
      return answers.filter((ref) => ref.deref() !== undefined).length;
    },
  };
}

const until = async (ready: () => boolean) => {
  for (let turn = 0; turn < 1000 && !ready(); turn++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  expect(ready()).toBe(true);
};

const readMany = async (assembled: ReturnType<typeof app>["assembled"], from = 0) => {
  for (let i = from; i < from + READS; i++) {
    expect((await assembled.invoker.invoke("/read", { key: `k${i}` })).ok).toBe(true);
  }
  // Let the last invocation's flow settle.
  await new Promise((resolve) => setTimeout(resolve, 5));
};

describe("queryCache since-dispatch, memory", () => {
  test("a direct query that never settles does not keep later answers", async () => {
    const { assembled, open, waiting, alive } = app();
    const hung = assembled.concepts.Shelf._pause({});
    await until(() => waiting() === 1);

    await readMany(assembled);

    expect(alive()).toBeLessThanOrEqual(2);
    open();
    await hung;
  });

  test("a direct form that never settles keeps later answers only until the request deadline", async () => {
    const { assembled, paused, open, waiting, alive } = app(200);
    const hung = assembled.form(paused({}));
    await until(() => waiting() === 1);

    await readMany(assembled);
    expect(alive()).toBeGreaterThanOrEqual(READS);
    await new Promise((resolve) => setTimeout(resolve, 250));
    // The next invocation forgets what no open read may reuse.
    await readMany(assembled, READS);

    expect(alive()).toBeLessThanOrEqual(2);
    open();
    await hung;
  });
});
