import { expect, test } from "vite-plus/test";
import {
  ReservationNotActiveForClaimant,
  ResourceUnavailable,
  type ActiveReservationRecord,
  type BlockingReservationRecord,
  type ReservationDetails,
} from "./reserving.shared.ts";

type Awaitable<T> = T | Promise<T>;

export interface ReservingImplementation {
  reserve(input: {
    resource: string;
    claimant: string;
    at: Date;
  }): Awaitable<{ reservation: string }>;
  cancel(input: {
    reservation: string;
    claimant: string;
    at: Date;
  }): Awaitable<{ reservation: string }>;
  fulfill(input: {
    reservation: string;
    claimant: string;
    at: Date;
  }): Awaitable<{ reservation: string }>;
  _blocking(input: { resource: string }): Awaitable<BlockingReservationRecord[]>;
  _get(input: { reservation: string }): Awaitable<ReservationDetails[]>;
  _activeFor(input: { claimant: string }): Awaitable<ActiveReservationRecord[]>;
}

export interface ReservingFixture {
  concept: ReservingImplementation;
  close(): Awaitable<void>;
}

export type ReservingFixtureFactory = (
  identities: readonly string[],
) => Awaitable<ReservingFixture>;

function attempt<T>(operation: () => Awaitable<T>): Promise<T> {
  return Promise.resolve().then(operation);
}

export function defineReservingConformance(create: ReservingFixtureFactory): void {
  test("follows the principle and retains cancelled and fulfilled reservations", async () => {
    const fixture = await create([
      "reservation-ari",
      "reservation-attempt",
      "reservation-bo",
      "reservation-final-attempt",
    ]);
    const { concept } = fixture;
    const reservedAt = new Date("2026-01-02T03:04:05.000Z");
    const cancelledAt = new Date("2026-01-03T03:04:05.000Z");
    const boReservedAt = new Date("2026-01-04T03:04:05.000Z");
    const fulfilledAt = new Date("2026-01-05T03:04:05.000Z");
    try {
      const ari = await concept.reserve({ resource: "slot-9", claimant: "Ari", at: reservedAt });
      expect(ari).toEqual({ reservation: "reservation-ari" });
      expect(await concept._blocking({ resource: "slot-9" })).toEqual([
        {
          reservation: ari.reservation,
          claimant: "Ari",
          status: "active",
          reservedAt,
        },
      ]);
      expect(await concept._activeFor({ claimant: "Ari" })).toEqual([
        { reservation: ari.reservation, resource: "slot-9", reservedAt },
      ]);
      expect(await concept._get(ari)).toEqual([
        {
          resource: "slot-9",
          claimant: "Ari",
          status: "active",
          reservedAt,
          endedAt: undefined,
        },
      ]);

      await expect(
        attempt(() => concept.reserve({ resource: "slot-9", claimant: "Bo", at: cancelledAt })),
      ).rejects.toThrow(ResourceUnavailable);
      await expect(
        attempt(() => concept.cancel({ ...ari, claimant: "Bo", at: cancelledAt })),
      ).rejects.toThrow(ReservationNotActiveForClaimant);
      expect(await concept._blocking({ resource: "slot-9" })).toHaveLength(1);

      expect(await concept.cancel({ ...ari, claimant: "Ari", at: cancelledAt })).toEqual(ari);
      await expect(
        attempt(() => concept.cancel({ ...ari, claimant: "Ari", at: fulfilledAt })),
      ).rejects.toThrow(ReservationNotActiveForClaimant);
      expect(await concept._blocking({ resource: "slot-9" })).toEqual([]);
      expect(await concept._get(ari)).toEqual([
        {
          resource: "slot-9",
          claimant: "Ari",
          status: "cancelled",
          reservedAt,
          endedAt: cancelledAt,
        },
      ]);

      const bo = await concept.reserve({ resource: "slot-9", claimant: "Bo", at: boReservedAt });
      expect(await concept._activeFor({ claimant: "Bo" })).toEqual([
        { reservation: bo.reservation, resource: "slot-9", reservedAt: boReservedAt },
      ]);
      expect(await concept.fulfill({ ...bo, claimant: "Bo", at: fulfilledAt })).toEqual(bo);
      await expect(
        attempt(() => concept.fulfill({ ...bo, claimant: "Bo", at: fulfilledAt })),
      ).rejects.toThrow(ReservationNotActiveForClaimant);
      await expect(
        attempt(() => concept.reserve({ resource: "slot-9", claimant: "Cy", at: fulfilledAt })),
      ).rejects.toThrow(ResourceUnavailable);
      expect(await concept._blocking({ resource: "slot-9" })).toEqual([
        {
          reservation: bo.reservation,
          claimant: "Bo",
          status: "fulfilled",
          reservedAt: boReservedAt,
        },
      ]);
      expect(await concept._get(bo)).toEqual([
        {
          resource: "slot-9",
          claimant: "Bo",
          status: "fulfilled",
          reservedAt: boReservedAt,
          endedAt: fulfilledAt,
        },
      ]);
      expect(await concept._get({ reservation: "unknown" })).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

  test("orders active reservations by reserved time and then reservation identity", async () => {
    const fixture = await create(["reservation-z", "reservation-a"]);
    const { concept } = fixture;
    const at = new Date("2026-02-03T04:05:06.000Z");
    try {
      await concept.reserve({ resource: "slot-z", claimant: "Ari", at });
      await concept.reserve({ resource: "slot-a", claimant: "Ari", at });
      expect(await concept._activeFor({ claimant: "Ari" })).toEqual([
        { reservation: "reservation-a", resource: "slot-a", reservedAt: at },
        { reservation: "reservation-z", resource: "slot-z", reservedAt: at },
      ]);
    } finally {
      await fixture.close();
    }
  });

  test("allows exactly one concurrent claim for a resource", async () => {
    const identities = Array.from({ length: 8 }, (_, index) => `reservation-${index}`);
    const fixture = await create(identities);
    const { concept } = fixture;
    const at = new Date("2026-03-04T05:06:07.000Z");
    try {
      const results = await Promise.allSettled(
        identities.map((_, index) =>
          attempt(() => concept.reserve({ resource: "slot-9", claimant: `claimant-${index}`, at })),
        ),
      );
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      for (const result of rejected) expect(result.reason).toBeInstanceOf(ResourceUnavailable);
      const blocking = await concept._blocking({ resource: "slot-9" });
      expect(blocking).toHaveLength(1);
      expect(blocking[0]?.reservation).toBe(fulfilled[0]?.value.reservation);
    } finally {
      await fixture.close();
    }
  });

  test("makes cancel and fulfill conditional terminal transitions", async () => {
    const fixture = await create(["reservation", "replacement", "failed-replacement", "unused"]);
    const { concept } = fixture;
    const reservedAt = new Date("2026-04-05T06:07:08.000Z");
    const cancelledAt = new Date("2026-04-06T06:07:08.000Z");
    const fulfilledAt = new Date("2026-04-07T06:07:08.000Z");
    try {
      const reservation = await concept.reserve({
        resource: "slot-9",
        claimant: "Ari",
        at: reservedAt,
      });
      const results = await Promise.allSettled([
        attempt(async () => ({
          transition: "cancel" as const,
          result: await concept.cancel({ ...reservation, claimant: "Ari", at: cancelledAt }),
        })),
        attempt(async () => ({
          transition: "fulfill" as const,
          result: await concept.fulfill({ ...reservation, claimant: "Ari", at: fulfilledAt }),
        })),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(ReservationNotActiveForClaimant);

      const winner = fulfilled[0]?.value;
      expect(winner?.result).toEqual(reservation);
      const details = await concept._get(reservation);
      if (winner?.transition === "cancel") {
        expect(details).toEqual([
          {
            resource: "slot-9",
            claimant: "Ari",
            status: "cancelled",
            reservedAt,
            endedAt: cancelledAt,
          },
        ]);
        expect(await concept._blocking({ resource: "slot-9" })).toEqual([]);
        await expect(
          attempt(() => concept.reserve({ resource: "slot-9", claimant: "Bo", at: fulfilledAt })),
        ).resolves.toBeDefined();
      } else {
        expect(details).toEqual([
          {
            resource: "slot-9",
            claimant: "Ari",
            status: "fulfilled",
            reservedAt,
            endedAt: fulfilledAt,
          },
        ]);
        expect(await concept._blocking({ resource: "slot-9" })).toHaveLength(1);
        await expect(
          attempt(() => concept.reserve({ resource: "slot-9", claimant: "Bo", at: fulfilledAt })),
        ).rejects.toThrow(ResourceUnavailable);
      }
    } finally {
      await fixture.close();
    }
  });
}
