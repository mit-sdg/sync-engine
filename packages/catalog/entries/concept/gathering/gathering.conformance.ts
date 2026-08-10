import { describe, expect, test } from "vite-plus/test";
import {
  AlreadyJoined,
  ALREADY_JOINED_MESSAGE,
  GatheringNotFound,
  GATHERING_NOT_FOUND_MESSAGE,
  NotJoined,
  NOT_JOINED_MESSAGE,
  type GatheringRecord,
} from "./gathering.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface GatheringBehavior {
  create(input: { name: string; host: string }): Awaitable<{ gathering: string }>;
  join(input: { gathering: string; member: string }): Awaitable<{ membership: string }>;
  leave(input: { gathering: string; member: string }): Awaitable<{ membership: string }>;
  _get(input: { gathering: string }): Awaitable<GatheringRecord[]>;
  _members(input: { gathering: string }): Awaitable<{ member: string }[]>;
  _membership(input: { gathering: string; member: string }): Awaitable<{ joined: boolean }>;
}

export interface GatheringHarness {
  concept: GatheringBehavior;
  close(): Awaitable<void>;
}

export type GatheringHarnessFactory = (
  identities: readonly string[],
) => Awaitable<GatheringHarness>;

type Outcome<T> = { returned: true; value: T } | { returned: false; error: unknown };

async function capture<T>(operation: () => Awaitable<T>): Promise<Outcome<T>> {
  try {
    return { returned: true, value: await operation() };
  } catch (error) {
    return { returned: false, error };
  }
}

async function withGathering(
  create: GatheringHarnessFactory,
  identities: readonly string[],
  run: (concept: GatheringBehavior) => Promise<void>,
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
  errorClass: new (...args: never[]) => Error,
  message: string,
): void {
  if (outcome.returned) throw new Error("Gathering accepted an action that should be refused.");
  expect(outcome.error).toBeInstanceOf(errorClass);
  expect((outcome.error as Error).message).toBe(message);
}

export function gatheringConformance(
  floor: string,
  create: GatheringHarnessFactory,
  skip = false,
): void {
  describe(`Gathering ${floor}`, () => {
    test.skipIf(skip)("follows its principle and preserves state after every refusal", async () => {
      await withGathering(
        create,
        ["workshop", "host-membership", "guest-membership", "duplicate-attempt", "unknown-attempt"],
        async (gathering) => {
          expect(await gathering.create({ name: "Saturday Workshop", host: "Asha" })).toEqual({
            gathering: "workshop",
          });
          expect(await gathering._get({ gathering: "workshop" })).toEqual([
            {
              gathering: "workshop",
              name: "Saturday Workshop",
              host: "Asha",
            },
          ]);
          expect(await gathering._get({ gathering: "unknown" })).toEqual([]);
          expect(await gathering._members({ gathering: "workshop" })).toEqual([{ member: "Asha" }]);
          expect(await gathering._membership({ gathering: "workshop", member: "Asha" })).toEqual({
            joined: true,
          });
          expect(await gathering._membership({ gathering: "unknown", member: "Asha" })).toEqual({
            joined: false,
          });

          expect(await gathering.join({ gathering: "workshop", member: "Bo" })).toEqual({
            membership: "guest-membership",
          });
          expectRefusal(
            await capture(() => gathering.join({ gathering: "workshop", member: "Bo" })),
            AlreadyJoined,
            ALREADY_JOINED_MESSAGE,
          );
          expect(await gathering._members({ gathering: "workshop" })).toEqual([
            { member: "Asha" },
            { member: "Bo" },
          ]);

          expect(await gathering.leave({ gathering: "workshop", member: "Bo" })).toEqual({
            membership: "guest-membership",
          });
          expectRefusal(
            await capture(() => gathering.leave({ gathering: "workshop", member: "Bo" })),
            NotJoined,
            NOT_JOINED_MESSAGE,
          );
          expect(await gathering._membership({ gathering: "workshop", member: "Bo" })).toEqual({
            joined: false,
          });

          expectRefusal(
            await capture(() => gathering.join({ gathering: "unknown", member: "Cy" })),
            GatheringNotFound,
            GATHERING_NOT_FOUND_MESSAGE,
          );
          expectRefusal(
            await capture(() => gathering.leave({ gathering: "unknown", member: "Cy" })),
            GatheringNotFound,
            GATHERING_NOT_FOUND_MESSAGE,
          );
          expect(await gathering._members({ gathering: "unknown" })).toEqual([]);
          expect(await gathering._members({ gathering: "workshop" })).toEqual([{ member: "Asha" }]);
        },
      );
    });

    test.skipIf(skip)(
      "uses persisted join order and leaves host attribution unchanged when the host leaves",
      async () => {
        await withGathering(
          create,
          ["workshop", "host-membership", "membership-z", "membership-a", "host-rejoined"],
          async (gathering) => {
            await gathering.create({ name: "Saturday Workshop", host: "Asha" });
            await gathering.join({ gathering: "workshop", member: "Bo" });
            await gathering.join({ gathering: "workshop", member: "Cy" });
            expect(await gathering._members({ gathering: "workshop" })).toEqual([
              { member: "Asha" },
              { member: "Bo" },
              { member: "Cy" },
            ]);

            expect(await gathering.leave({ gathering: "workshop", member: "Asha" })).toEqual({
              membership: "host-membership",
            });
            expect(await gathering._get({ gathering: "workshop" })).toEqual([
              {
                gathering: "workshop",
                name: "Saturday Workshop",
                host: "Asha",
              },
            ]);
            expect(await gathering._members({ gathering: "workshop" })).toEqual([
              { member: "Bo" },
              { member: "Cy" },
            ]);

            expect(await gathering.join({ gathering: "workshop", member: "Asha" })).toEqual({
              membership: "host-rejoined",
            });
            expect(await gathering._members({ gathering: "workshop" })).toEqual([
              { member: "Bo" },
              { member: "Cy" },
              { member: "Asha" },
            ]);
          },
        );
      },
    );

    test.skipIf(skip)(
      "does not expose a gathering when identity allocation is interrupted",
      async () => {
        await withGathering(create, ["interrupted-gathering"], async (gathering) => {
          const interrupted = await capture(() =>
            gathering.create({ name: "Interrupted", host: "Asha" }),
          );
          if (interrupted.returned) throw new Error("Gathering creation unexpectedly returned.");
          expect(interrupted.error).toBeInstanceOf(Error);
          expect(await gathering._get({ gathering: "interrupted-gathering" })).toEqual([]);
          expect(await gathering._members({ gathering: "interrupted-gathering" })).toEqual([]);
          expect(
            await gathering._membership({ gathering: "interrupted-gathering", member: "Asha" }),
          ).toEqual({ joined: false });
        });
      },
    );

    test.skipIf(skip)("allows exactly one of several concurrent joins for one person", async () => {
      const identities = [
        "workshop",
        "host-membership",
        ...Array.from({ length: 8 }, (_, index) => `guest-membership-${index}`),
      ];
      await withGathering(create, identities, async (gathering) => {
        await gathering.create({ name: "Saturday Workshop", host: "Asha" });
        const outcomes = await Promise.all(
          Array.from({ length: 8 }, () =>
            capture(() => gathering.join({ gathering: "workshop", member: "Bo" })),
          ),
        );
        expect(outcomes.filter(({ returned }) => returned)).toHaveLength(1);
        const refusals = outcomes.filter(({ returned }) => !returned);
        expect(refusals).toHaveLength(7);
        for (const refusal of refusals)
          expectRefusal(refusal, AlreadyJoined, ALREADY_JOINED_MESSAGE);
        expect(await gathering._members({ gathering: "workshop" })).toEqual([
          { member: "Asha" },
          { member: "Bo" },
        ]);
      });
    });
  });
}
