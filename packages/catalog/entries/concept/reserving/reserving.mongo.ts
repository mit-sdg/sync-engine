import type { Collection, Db } from "mongodb";
import {
  ReservationNotActiveForClaimant,
  ResourceUnavailable,
  type ActiveReservationRecord,
  type BlockingReservationRecord,
  type ReservationDetails,
  type ReservationRecord,
} from "./reserving.shared.ts";

interface ReservationDocument extends ReservationRecord {
  blocking: boolean;
}

function duplicateKeyOn(error: unknown, fields: readonly string[]): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  )
    return false;
  const pattern = (error as { keyPattern?: unknown }).keyPattern;
  if (typeof pattern !== "object" || pattern === null || Array.isArray(pattern)) return false;
  const keys = Object.keys(pattern);
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

const indexes = new WeakMap<Db, Promise<void>>();

export function ensureReservingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    const reservations = db.collection<ReservationDocument>("reservations");
    ready = Promise.all([
      reservations.createIndex({ reservation: 1 }, { name: "reservation_identity", unique: true }),
      reservations.createIndex(
        { resource: 1 },
        {
          name: "one_blocking_reservation_per_resource",
          unique: true,
          partialFilterExpression: { blocking: true },
        },
      ),
      reservations.createIndex(
        { claimant: 1, status: 1, reservedAt: 1, reservation: 1 },
        { name: "active_reservations_for_claimant" },
      ),
    ]).then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class ReservingMongoConcept {
  private readonly db: Db;
  private readonly reservations: Collection<ReservationDocument>;
  private readonly freshID: () => string;

  constructor({ db, freshID = () => crypto.randomUUID() }: { db: Db; freshID?: () => string }) {
    this.db = db;
    this.reservations = db.collection("reservations");
    this.freshID = freshID;
  }

  async reserve({ resource, claimant, at }: { resource: string; claimant: string; at: Date }) {
    await ensureReservingIndexes(this.db);
    const reservation = this.freshID();
    try {
      await this.reservations.insertOne({
        reservation,
        resource,
        claimant,
        status: "active",
        reservedAt: new Date(at),
        blocking: true,
      });
      return { reservation };
    } catch (error) {
      if (duplicateKeyOn(error, ["resource"]))
        throw new ResourceUnavailable("This resource is not available.");
      throw error;
    }
  }

  async cancel({ reservation, claimant, at }: { reservation: string; claimant: string; at: Date }) {
    await ensureReservingIndexes(this.db);
    const found = await this.reservations.findOneAndUpdate(
      { reservation, claimant, status: "active" },
      { $set: { status: "cancelled", endedAt: new Date(at), blocking: false } },
      { projection: { _id: 0, reservation: 1 }, returnDocument: "after" },
    );
    if (found === null)
      throw new ReservationNotActiveForClaimant(
        "There is no such active reservation for this claimant.",
      );
    return { reservation: found.reservation };
  }

  async fulfill({
    reservation,
    claimant,
    at,
  }: {
    reservation: string;
    claimant: string;
    at: Date;
  }) {
    await ensureReservingIndexes(this.db);
    const found = await this.reservations.findOneAndUpdate(
      { reservation, claimant, status: "active" },
      { $set: { status: "fulfilled", endedAt: new Date(at), blocking: true } },
      { projection: { _id: 0, reservation: 1 }, returnDocument: "after" },
    );
    if (found === null)
      throw new ReservationNotActiveForClaimant(
        "There is no such active reservation for this claimant.",
      );
    return { reservation: found.reservation };
  }

  async _blocking({ resource }: { resource: string }): Promise<BlockingReservationRecord[]> {
    const found = await this.reservations.findOne({ resource, blocking: true });
    return found === null
      ? []
      : [
          {
            reservation: found.reservation,
            claimant: found.claimant,
            status: found.status,
            reservedAt: found.reservedAt,
          },
        ];
  }

  async _get({ reservation }: { reservation: string }): Promise<ReservationDetails[]> {
    const found = await this.reservations.findOne({ reservation });
    return found === null
      ? []
      : [
          {
            resource: found.resource,
            claimant: found.claimant,
            status: found.status,
            reservedAt: found.reservedAt,
            endedAt: found.endedAt,
          },
        ];
  }

  async _activeFor({ claimant }: { claimant: string }): Promise<ActiveReservationRecord[]> {
    const found = await this.reservations
      .find({ claimant, status: "active" })
      .sort({ reservedAt: 1, reservation: 1 })
      .toArray();
    return found.map((record) => ({
      reservation: record.reservation,
      resource: record.resource,
      reservedAt: record.reservedAt,
    }));
  }
}
