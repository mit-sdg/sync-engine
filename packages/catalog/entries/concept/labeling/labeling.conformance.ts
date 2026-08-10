import { describe, expect, test } from "vite-plus/test";
import {
  INVALID_LABEL_NAME_MESSAGE,
  InvalidLabelName,
  LABEL_ALREADY_APPLIED_MESSAGE,
  LABEL_NAME_TAKEN_MESSAGE,
  LABEL_NOT_APPLIED_MESSAGE,
  LABEL_NOT_FOUND_MESSAGE,
  LabelAlreadyApplied,
  LabelNameTaken,
  LabelNotApplied,
  LabelNotFound,
} from "./labeling.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface LabelingBehavior {
  create(input: { scope: string; name: string }): Awaitable<{ label: string }>;
  rename(input: { label: string; name: string }): Awaitable<{ label: string }>;
  apply(input: { label: string; item: string }): Awaitable<{ label: string; item: string }>;
  remove(input: { label: string; item: string }): Awaitable<{ label: string; item: string }>;
  _get(input: { label: string }): Awaitable<Array<{ scope: string; name: string }>>;
  _for(input: { scope: string; item: string }): Awaitable<Array<{ label: string; name: string }>>;
  _items(input: { label: string }): Awaitable<Array<{ item: string }>>;
}

export interface LabelingHarness {
  concept: LabelingBehavior;
  close(): Awaitable<void>;
}

export type LabelingHarnessFactory = (identities: readonly string[]) => Awaitable<LabelingHarness>;

type Outcome<T> = { returned: true; value: T } | { returned: false; error: unknown };

async function capture<T>(operation: () => Awaitable<T>): Promise<Outcome<T>> {
  try {
    return { returned: true, value: await operation() };
  } catch (error) {
    return { returned: false, error };
  }
}

async function withLabeling(
  create: LabelingHarnessFactory,
  identities: readonly string[],
  run: (concept: LabelingBehavior) => Promise<void>,
): Promise<void> {
  const harness = await create(identities);
  try {
    await run(harness.concept);
  } finally {
    await harness.close();
  }
}

function expectRefusal(
  outcome: Outcome<unknown>,
  refusal: new (...args: never[]) => Error,
  message: string,
): void {
  if (outcome.returned) throw new Error("Labeling returned instead of refusing.");
  expect(outcome.error).toBeInstanceOf(refusal);
  expect((outcome.error as Error).message).toBe(message);
}

function oneRefusal(outcomes: readonly Outcome<unknown>[]): Outcome<unknown> {
  expect(outcomes.filter(({ returned }) => returned)).toHaveLength(1);
  const refused = outcomes.find(({ returned }) => !returned);
  if (refused === undefined || refused.returned) throw new Error("Expected one refusal.");
  return refused;
}

export function labelingConformance(
  floor: string,
  create: LabelingHarnessFactory,
  skip = false,
): void {
  describe(`Labeling ${floor}`, () => {
    test.skipIf(skip)("follows its principle and complete refusal contract", async () => {
      await withLabeling(
        create,
        ["label-urgent", "label-customer", "label-other", "label-boundary", "duplicate"],
        async (labeling) => {
          for (const name of [" \n\t", "x".repeat(65)]) {
            expectRefusal(
              await capture(() => labeling.create({ scope: "board-1", name })),
              InvalidLabelName,
              INVALID_LABEL_NAME_MESSAGE,
            );
          }

          const urgent = await labeling.create({ scope: "board-1", name: "urgent" });
          const customer = await labeling.create({ scope: "board-1", name: "customer" });
          const other = await labeling.create({ scope: "board-2", name: "urgent" });
          expect(urgent).toEqual({ label: "label-urgent" });
          expect(customer).toEqual({ label: "label-customer" });
          expect(other).toEqual({ label: "label-other" });
          expect(await labeling.create({ scope: "board-1", name: "x".repeat(64) })).toEqual({
            label: "label-boundary",
          });

          await labeling.apply({ label: urgent.label, item: "post-8" });
          await labeling.apply({ label: customer.label, item: "post-8" });
          await labeling.apply({ label: other.label, item: "post-8" });
          expect(await labeling._for({ scope: "board-1", item: "post-8" })).toEqual([
            { label: "label-customer", name: "customer" },
            { label: "label-urgent", name: "urgent" },
          ]);
          expect(await labeling._items({ label: urgent.label })).toEqual([{ item: "post-8" }]);

          expect(await labeling.rename({ label: urgent.label, name: "immediate" })).toEqual(urgent);
          expect(await labeling._get(urgent)).toEqual([{ scope: "board-1", name: "immediate" }]);
          expect(await labeling._for({ scope: "board-1", item: "post-8" })).toEqual([
            { label: "label-customer", name: "customer" },
            { label: "label-urgent", name: "immediate" },
          ]);
          expect(await labeling.rename({ label: urgent.label, name: "immediate" })).toEqual(urgent);

          expectRefusal(
            await capture(() => labeling.rename({ label: customer.label, name: "immediate" })),
            LabelNameTaken,
            LABEL_NAME_TAKEN_MESSAGE,
          );
          expectRefusal(
            await capture(() => labeling.apply({ label: urgent.label, item: "post-8" })),
            LabelAlreadyApplied,
            LABEL_ALREADY_APPLIED_MESSAGE,
          );
          expectRefusal(
            await capture(() => labeling.rename({ label: urgent.label, name: " " })),
            InvalidLabelName,
            INVALID_LABEL_NAME_MESSAGE,
          );
          expectRefusal(
            await capture(() => labeling.rename({ label: "missing", name: " " })),
            LabelNotFound,
            LABEL_NOT_FOUND_MESSAGE,
          );
          expectRefusal(
            await capture(() => labeling.apply({ label: "missing", item: "post-8" })),
            LabelNotFound,
            LABEL_NOT_FOUND_MESSAGE,
          );

          expect(await labeling.remove({ label: customer.label, item: "post-8" })).toEqual({
            label: customer.label,
            item: "post-8",
          });
          expectRefusal(
            await capture(() => labeling.remove({ label: customer.label, item: "post-8" })),
            LabelNotApplied,
            LABEL_NOT_APPLIED_MESSAGE,
          );
          expectRefusal(
            await capture(() => labeling.remove({ label: "missing", item: "post-8" })),
            LabelNotApplied,
            LABEL_NOT_APPLIED_MESSAGE,
          );
          expect(await labeling._for({ scope: "board-1", item: "post-8" })).toEqual([
            { label: "label-urgent", name: "immediate" },
          ]);
          expect(await labeling._get({ label: "missing" })).toEqual([]);
          expect(await labeling._items({ label: "missing" })).toEqual([]);

          expectRefusal(
            await capture(() => labeling.create({ scope: "board-1", name: "immediate" })),
            LabelNameTaken,
            LABEL_NAME_TAKEN_MESSAGE,
          );
          expect("delete" in labeling).toBe(false);
        },
      );
    });

    test.skipIf(skip)("uses exact names and deterministic query ordering", async () => {
      await withLabeling(create, ["label-beta", "label-upper", "label-lower"], async (labeling) => {
        const beta = await labeling.create({ scope: "board-1", name: "beta" });
        const upper = await labeling.create({ scope: "board-1", name: "Alpha" });
        const lower = await labeling.create({ scope: "board-1", name: "alpha" });
        for (const { label } of [beta, upper, lower]) {
          await labeling.apply({ label, item: "post-8" });
        }
        expect(await labeling._for({ scope: "board-1", item: "post-8" })).toEqual([
          { label: upper.label, name: "Alpha" },
          { label: lower.label, name: "alpha" },
          { label: beta.label, name: "beta" },
        ]);
        await labeling.apply({ label: beta.label, item: "item-z" });
        await labeling.apply({ label: beta.label, item: "item-a" });
        expect(await labeling._items({ label: beta.label })).toEqual([
          { item: "item-a" },
          { item: "item-z" },
          { item: "post-8" },
        ]);
      });
    });

    test.skipIf(skip)("enforces create, application, removal, and rename races", async () => {
      await withLabeling(
        create,
        Array.from({ length: 12 }, (_, index) => `label-${index}`),
        async (labeling) => {
          const duplicateCreates = await Promise.all([
            capture(() => labeling.create({ scope: "board-1", name: "urgent" })),
            capture(() => labeling.create({ scope: "board-1", name: "urgent" })),
          ]);
          const createRefusal = oneRefusal(duplicateCreates);
          expectRefusal(createRefusal, LabelNameTaken, LABEL_NAME_TAKEN_MESSAGE);
          const created = duplicateCreates.find(({ returned }) => returned);
          if (created === undefined || !created.returned) throw new Error("No Label was created.");
          const label = created.value.label;

          const duplicateApplications = await Promise.all([
            capture(() => labeling.apply({ label, item: "post-8" })),
            capture(() => labeling.apply({ label, item: "post-8" })),
          ]);
          expectRefusal(
            oneRefusal(duplicateApplications),
            LabelAlreadyApplied,
            LABEL_ALREADY_APPLIED_MESSAGE,
          );

          const duplicateRemovals = await Promise.all([
            capture(() => labeling.remove({ label, item: "post-8" })),
            capture(() => labeling.remove({ label, item: "post-8" })),
          ]);
          expectRefusal(oneRefusal(duplicateRemovals), LabelNotApplied, LABEL_NOT_APPLIED_MESSAGE);

          const left = await labeling.create({ scope: "board-1", name: "left" });
          const right = await labeling.create({ scope: "board-1", name: "right" });
          const renameCollision = await Promise.all([
            capture(() => labeling.rename({ label: left.label, name: "shared" })),
            capture(() => labeling.rename({ label: right.label, name: "shared" })),
          ]);
          expectRefusal(oneRefusal(renameCollision), LabelNameTaken, LABEL_NAME_TAKEN_MESSAGE);
          const names = [
            ...(await labeling._get({ label: left.label })),
            ...(await labeling._get({ label: right.label })),
          ].map(({ name }) => name);
          expect(names.filter((name) => name === "shared")).toHaveLength(1);
        },
      );
    });
  });
}
