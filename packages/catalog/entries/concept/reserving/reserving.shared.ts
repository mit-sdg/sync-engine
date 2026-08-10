export class ResourceUnavailable extends Error {}
export class ReservationNotActiveForClaimant extends Error {}

export type ReservationStatus = "active" | "cancelled" | "fulfilled";

export interface ReservationRecord {
  reservation: string;
  resource: string;
  claimant: string;
  status: ReservationStatus;
  reservedAt: Date;
  endedAt?: Date;
}

export interface BlockingReservationRecord {
  reservation: string;
  claimant: string;
  status: ReservationStatus;
  reservedAt: Date;
}

export interface ReservationDetails {
  resource: string;
  claimant: string;
  status: ReservationStatus;
  reservedAt: Date;
  endedAt: Date | undefined;
}

export interface ActiveReservationRecord {
  reservation: string;
  resource: string;
  reservedAt: Date;
}
