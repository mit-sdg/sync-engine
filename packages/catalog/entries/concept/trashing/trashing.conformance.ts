import { describe, expect, test } from "vite-plus/test";
import {
  ITEM_ALREADY_TRASHED_MESSAGE,
  ITEM_NOT_TRASHED_MESSAGE,
  ITEM_PURGED_MESSAGE,
  ItemAlreadyTrashed,
  ItemNotTrashed,
  ItemPurged,
  type DispositionStatus,
} from "./trashing.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface TrashingBehavior {
  trash(input: { item: string; at: Date }): Awaitable<{ item: string }>;
  restore(input: { item: string }): Awaitable<{ item: string }>;
  purge(input: { item: string; at: Date }): Awaitable<{ item: string }>;
  _state(input: { item: string }): Awaitable<{ status: DispositionStatus }>;
  _trashed(input: Record<string, never>): Awaitable<Array<{ item: string; trashedAt: Date }>>;
}

export interface TrashingHarness {
  concept: TrashingBehavior;
  close(): Awaitable<void>;
}

export type TrashingHarnessFactory = () => Awaitable<TrashingHarness>;

type Outcome<T> = { returned: true; value: T } | { returned: false; error: unknown };

async function capture<T>(operation: () => Awaitable<T>): Promise<Outcome<T>> {
  try {
    return { returned: true, value: await operation() };
  } catch (error) {
    return { returned: false, error };
  }
}

async function withTrashing(
  create: TrashingHarnessFactory,
  run: (concept: TrashingBehavior) => Promise<void>,
): Promise<void> {
  const harness = await create();
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
  if (outcome.returned) throw new Error("Trashing returned instead of refusing.");
  expect(outcome.error).toBeInstanceOf(refusal);
  expect((outcome.error as Error).message).toBe(message);
}

async function visiblePeer<T>(
  concept: TrashingBehavior,
  item: string,
  peerRecord: T,
): Promise<T | undefined> {
  return (await concept._state({ item })).status === "active" ? peerRecord : undefined;
}

export function trashingConformance(
  floor: string,
  create: TrashingHarnessFactory,
  skip = false,
): void {
  describe(`Trashing ${floor}`, () => {
    test.skipIf(skip)("follows its principle and complete refusal contract", async () => {
      await withTrashing(create, async (trashing) => {
        const item = "post-8";
        const peerRecord = { post: item, content: "Existing peer payload" };
        const firstTrash = new Date("2026-08-10T10:00:00.000Z");
        const secondTrash = new Date("2026-08-10T11:00:00.000Z");
        const purgeAt = new Date("2026-08-10T12:00:00.000Z");

        expect(await trashing._state({ item })).toEqual({ status: "active" });
        expect(await visiblePeer(trashing, item, peerRecord)).toBe(peerRecord);
        expectRefusal(
          await capture(() => trashing.restore({ item })),
          ItemNotTrashed,
          ITEM_NOT_TRASHED_MESSAGE,
        );
        expectRefusal(
          await capture(() => trashing.purge({ item, at: purgeAt })),
          ItemNotTrashed,
          ITEM_NOT_TRASHED_MESSAGE,
        );

        expect(await trashing.trash({ item, at: firstTrash })).toEqual({ item });
        expect(await trashing._state({ item })).toEqual({ status: "trashed" });
        expect(await trashing._trashed({})).toEqual([{ item, trashedAt: firstTrash }]);
        expect(await visiblePeer(trashing, item, peerRecord)).toBeUndefined();
        expectRefusal(
          await capture(() => trashing.trash({ item, at: firstTrash })),
          ItemAlreadyTrashed,
          ITEM_ALREADY_TRASHED_MESSAGE,
        );

        expect(await trashing.restore({ item })).toEqual({ item });
        expect(await trashing._state({ item })).toEqual({ status: "active" });
        expect(await trashing._trashed({})).toEqual([]);
        expect(await visiblePeer(trashing, item, peerRecord)).toBe(peerRecord);

        await trashing.trash({ item, at: secondTrash });
        expect(await trashing.purge({ item, at: purgeAt })).toEqual({ item });
        expect(await trashing._state({ item })).toEqual({ status: "purged" });
        expect(await trashing._trashed({})).toEqual([]);
        expect(await visiblePeer(trashing, item, peerRecord)).toBeUndefined();
        expect(peerRecord).toEqual({ post: item, content: "Existing peer payload" });

        for (const operation of [
          () => trashing.restore({ item }),
          () => trashing.trash({ item, at: purgeAt }),
          () => trashing.purge({ item, at: purgeAt }),
        ]) {
          expectRefusal(await capture(operation), ItemPurged, ITEM_PURGED_MESSAGE);
        }
      });
    });

    test.skipIf(skip)(
      "orders equal trash instants by Item identity and retains explicit time",
      async () => {
        await withTrashing(create, async (trashing) => {
          const supplied = new Date("2026-08-10T13:00:00.000Z");
          const firstTrash = trashing.trash({ item: "item-z", at: supplied });
          const secondTrash = trashing.trash({ item: "item-a", at: supplied });
          supplied.setUTCFullYear(2030);
          await Promise.all([firstTrash, secondTrash]);
          const firstRead = await trashing._trashed({});
          expect(firstRead).toEqual([
            { item: "item-a", trashedAt: new Date("2026-08-10T13:00:00.000Z") },
            { item: "item-z", trashedAt: new Date("2026-08-10T13:00:00.000Z") },
          ]);
          firstRead[0]?.trashedAt.setUTCFullYear(2031);
          expect((await trashing._trashed({}))[0]?.trashedAt).toEqual(
            new Date("2026-08-10T13:00:00.000Z"),
          );
        });
      },
    );

    test.skipIf(skip)("conditionally permits only one first trash", async () => {
      await withTrashing(create, async (trashing) => {
        const at = new Date("2026-08-10T14:00:00.000Z");
        const outcomes = await Promise.all([
          capture(() => trashing.trash({ item: "post-8", at })),
          capture(() => trashing.trash({ item: "post-8", at })),
        ]);
        expect(outcomes.filter(({ returned }) => returned)).toHaveLength(1);
        const refused = outcomes.find(({ returned }) => !returned);
        if (refused === undefined || refused.returned)
          throw new Error("Both trash calls returned.");
        expect(refused.error).toBeInstanceOf(ItemAlreadyTrashed);
        expect(await trashing._state({ item: "post-8" })).toEqual({ status: "trashed" });
      });
    });

    test.skipIf(skip)("serializes restore against purge", async () => {
      await withTrashing(create, async (trashing) => {
        const item = "post-8";
        await trashing.trash({ item, at: new Date("2026-08-10T15:00:00.000Z") });
        const [restore, purge] = await Promise.all([
          capture(() => trashing.restore({ item })),
          capture(() => trashing.purge({ item, at: new Date("2026-08-10T16:00:00.000Z") })),
        ]);
        expect([restore, purge].filter(({ returned }) => returned)).toHaveLength(1);
        const state = await trashing._state({ item });
        if (state.status === "active") {
          expect(restore.returned).toBe(true);
          expectRefusal(purge, ItemNotTrashed, ITEM_NOT_TRASHED_MESSAGE);
        } else {
          expect(state).toEqual({ status: "purged" });
          expect(purge.returned).toBe(true);
          expectRefusal(restore, ItemPurged, ITEM_PURGED_MESSAGE);
        }
      });
    });

    test.skipIf(skip)("conditionally permits only one purge", async () => {
      await withTrashing(create, async (trashing) => {
        const item = "post-8";
        await trashing.trash({ item, at: new Date("2026-08-10T17:00:00.000Z") });
        const at = new Date("2026-08-10T18:00:00.000Z");
        const outcomes = await Promise.all([
          capture(() => trashing.purge({ item, at })),
          capture(() => trashing.purge({ item, at })),
        ]);
        expect(outcomes.filter(({ returned }) => returned)).toHaveLength(1);
        const refused = outcomes.find(({ returned }) => !returned);
        if (refused === undefined || refused.returned)
          throw new Error("Both purge calls returned.");
        expect(refused.error).toBeInstanceOf(ItemPurged);
        expect(await trashing._state({ item })).toEqual({ status: "purged" });
      });
    });
  });
}
