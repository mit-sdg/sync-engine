export class InvitationAlreadyPending extends Error {}
export class InvitationNotPendingForInvitee extends Error {}
export class InvitationNotPendingForInviter extends Error {}

export const INVITATION_ALREADY_PENDING_MESSAGE =
  "This person already has a pending invitation for the target.";
export const INVITATION_NOT_PENDING_FOR_INVITEE_MESSAGE =
  "There is no such pending invitation for this invitee.";
export const INVITATION_NOT_PENDING_FOR_INVITER_MESSAGE =
  "There is no such pending invitation for this inviter.";

export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked";

export interface InvitationRecord {
  invitation: string;
  target: string;
  inviter: string;
  invitee: string;
  status: InvitationStatus;
  issuedAt: Date;
  decidedAt?: Date;
}

export function compareInvitations(left: InvitationRecord, right: InvitationRecord): number {
  const byTime = left.issuedAt.getTime() - right.issuedAt.getTime();
  if (byTime !== 0) return byTime;
  return left.invitation < right.invitation ? -1 : left.invitation > right.invitation ? 1 : 0;
}
