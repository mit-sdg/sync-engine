import {
  ReservationNotActiveForClaimant,
  ResourceUnavailable,
  type ActiveReservationRecord,
  type BlockingReservationRecord,
  type ReservationDetails,
  type ReservationRecord,
} from "./reserving.shared.ts";

function compareReservations(left: ReservationRecord, right: ReservationRecord): number {
  const byTime = left.reservedAt.getTime() - right.reservedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.reservation < right.reservation ? -1 : left.reservation > right.reservation ? 1 : 0;
}

function details(record: ReservationRecord): ReservationDetails {
  return {
    resource: record.resource,
    claimant: record.claimant,
    status: record.status,
    reservedAt: new Date(record.reservedAt),
    endedAt: record.endedAt === undefined ? undefined : new Date(record.endedAt),
  };
}

export class ReservingMemoryConcept {
  private readonly reservations = new Map<string, ReservationRecord>();
  private readonly blockingByResource = new Map<string, string>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  reserve({ resource, claimant, at }: { resource: string; claimant: string; at: Date }) {
    if (this.blockingByResource.has(resource))
      throw new ResourceUnavailable("This resource is not available.");
    const reservation = this.freshID();
    this.reservations.set(reservation, {
      reservation,
      resource,
      claimant,
      status: "active",
      reservedAt: new Date(at),
    });
    this.blockingByResource.set(resource, reservation);
    return { reservation };
  }

  cancel({ reservation, claimant, at }: { reservation: string; claimant: string; at: Date }) {
    const found = this.reservations.get(reservation);
    if (found === undefined || found.status !== "active" || found.claimant !== claimant)
      throw new ReservationNotActiveForClaimant(
        "There is no such active reservation for this claimant.",
      );
    this.reservations.set(reservation, {
      ...found,
      status: "cancelled",
      endedAt: new Date(at),
    });
    if (this.blockingByResource.get(found.resource) === reservation)
      this.blockingByResource.delete(found.resource);
    return { reservation };
  }

  fulfill({ reservation, claimant, at }: { reservation: string; claimant: string; at: Date }) {
    const found = this.reservations.get(reservation);
    if (found === undefined || found.status !== "active" || found.claimant !== claimant)
      throw new ReservationNotActiveForClaimant(
        "There is no such active reservation for this claimant.",
      );
    this.reservations.set(reservation, {
      ...found,
      status: "fulfilled",
      endedAt: new Date(at),
    });
    return { reservation };
  }

  _blocking({ resource }: { resource: string }): BlockingReservationRecord[] {
    const reservation = this.blockingByResource.get(resource);
    const found = reservation === undefined ? undefined : this.reservations.get(reservation);
    return found === undefined
      ? []
      : [
          {
            reservation: found.reservation,
            claimant: found.claimant,
            status: found.status,
            reservedAt: new Date(found.reservedAt),
          },
        ];
  }

  _get({ reservation }: { reservation: string }): ReservationDetails[] {
    const found = this.reservations.get(reservation);
    return found === undefined ? [] : [details(found)];
  }

  _activeFor({ claimant }: { claimant: string }): ActiveReservationRecord[] {
    return [...this.reservations.values()]
      .filter((record) => record.claimant === claimant && record.status === "active")
      .sort(compareReservations)
      .map((record) => ({
        reservation: record.reservation,
        resource: record.resource,
        reservedAt: new Date(record.reservedAt),
      }));
  }
}
