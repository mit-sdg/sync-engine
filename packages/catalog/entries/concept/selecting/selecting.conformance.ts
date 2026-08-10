import { describe, expect, test } from "vite-plus/test";
import {
  NoCurrentSelection,
  NO_CURRENT_SELECTION_MESSAGE,
  type SelectionRecord,
} from "./selecting.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface SelectingBehavior {
  choose(input: { scope: string; item: string }): Awaitable<{ selection: string }>;
  clear(input: { scope: string }): Awaitable<{ selection: string }>;
  _current(input: { scope: string }): Awaitable<SelectionRecord[]>;
  _get(input: { selection: string }): Awaitable<SelectionRecord[]>;
}

export interface SelectingHarness {
  concept: SelectingBehavior;
  close(): Awaitable<void>;
}

export type SelectingHarnessFactory = (
  identities: readonly string[],
) => Awaitable<SelectingHarness>;

type Outcome<T> = { returned: true; value: T } | { returned: false; error: unknown };

async function capture<T>(operation: () => Awaitable<T>): Promise<Outcome<T>> {
  try {
    return { returned: true, value: await operation() };
  } catch (error) {
    return { returned: false, error };
  }
}

async function withSelecting(
  create: SelectingHarnessFactory,
  identities: readonly string[],
  run: (concept: SelectingBehavior) => Promise<void>,
): Promise<void> {
  const harness = await create(identities);
  try {
    await run(harness.concept);
  } finally {
    await harness.close();
  }
}

export function selectingConformance(
  floor: string,
  create: SelectingHarnessFactory,
  skip = false,
): void {
  describe(`Selecting ${floor}`, () => {
    test.skipIf(skip)(
      "replaces and clears current selections while retaining complete history",
      async () => {
        await withSelecting(create, ["first", "other", "second"], async (selecting) => {
          expect(await selecting.choose({ scope: "workshop", item: "Essay A" })).toEqual({
            selection: "first",
          });
          expect(await selecting._current({ scope: "workshop" })).toEqual([
            { selection: "first", scope: "workshop", item: "Essay A" },
          ]);
          expect(await selecting._get({ selection: "first" })).toEqual([
            { selection: "first", scope: "workshop", item: "Essay A" },
          ]);

          expect(await selecting.choose({ scope: "other-workshop", item: "Essay C" })).toEqual({
            selection: "other",
          });
          expect(await selecting.choose({ scope: "workshop", item: "Essay B" })).toEqual({
            selection: "second",
          });
          expect(await selecting._current({ scope: "workshop" })).toEqual([
            { selection: "second", scope: "workshop", item: "Essay B" },
          ]);
          expect(await selecting._current({ scope: "other-workshop" })).toEqual([
            { selection: "other", scope: "other-workshop", item: "Essay C" },
          ]);
          expect(await selecting._get({ selection: "first" })).toEqual([
            { selection: "first", scope: "workshop", item: "Essay A" },
          ]);

          expect(await selecting.clear({ scope: "workshop" })).toEqual({
            selection: "second",
          });
          expect(await selecting._current({ scope: "workshop" })).toEqual([]);
          expect(await selecting._get({ selection: "second" })).toEqual([
            { selection: "second", scope: "workshop", item: "Essay B" },
          ]);

          const secondClear = await capture(() => selecting.clear({ scope: "workshop" }));
          if (secondClear.returned)
            throw new Error("Selecting accepted a clear without a current Selection.");
          expect(secondClear.error).toBeInstanceOf(NoCurrentSelection);
          expect((secondClear.error as Error).message).toBe(NO_CURRENT_SELECTION_MESSAGE);
          expect(await selecting._current({ scope: "workshop" })).toEqual([]);
          expect(await selecting._current({ scope: "other-workshop" })).toEqual([
            { selection: "other", scope: "other-workshop", item: "Essay C" },
          ]);
          expect(await selecting._get({ selection: "unknown" })).toEqual([]);
          expect(await selecting._current({ scope: "unknown" })).toEqual([]);
        });
      },
    );

    test.skipIf(skip)(
      "does not create history when identity allocation is interrupted",
      async () => {
        await withSelecting(create, [], async (selecting) => {
          const interrupted = await capture(() =>
            selecting.choose({ scope: "workshop", item: "Essay A" }),
          );
          if (interrupted.returned) throw new Error("Selecting.choose unexpectedly returned.");
          expect(interrupted.error).toBeInstanceOf(Error);
          expect(await selecting._current({ scope: "workshop" })).toEqual([]);
        });
      },
    );

    test.skipIf(skip)(
      "keeps every concurrent choice readable and points current at one complete Selection",
      async () => {
        const identities = ["selection-z", "selection-a", "selection-m", "selection-b"];
        await withSelecting(create, identities, async (selecting) => {
          const items = ["Essay A", "Essay B", "Essay C", "Essay D"];
          const choices = await Promise.all(
            items.map(async (item) => ({
              item,
              ...(await selecting.choose({ scope: "workshop", item })),
            })),
          );
          expect(new Set(choices.map(({ selection }) => selection))).toEqual(new Set(identities));
          for (const { item, selection } of choices)
            expect(await selecting._get({ selection })).toEqual([
              { selection, scope: "workshop", item },
            ]);

          const current = await selecting._current({ scope: "workshop" });
          expect(current).toHaveLength(1);
          const currentSelection = current[0];
          if (currentSelection === undefined) throw new Error("Selecting lost its current row.");
          expect(choices).toContainEqual({
            item: currentSelection.item,
            selection: currentSelection.selection,
          });
          expect(await selecting.clear({ scope: "workshop" })).toEqual({
            selection: currentSelection.selection,
          });
          expect(await selecting._current({ scope: "workshop" })).toEqual([]);
          for (const { item, selection } of choices)
            expect(await selecting._get({ selection })).toEqual([
              { selection, scope: "workshop", item },
            ]);
        });
      },
    );
  });
}
