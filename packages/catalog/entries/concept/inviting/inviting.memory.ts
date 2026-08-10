import {
  compareInvitations,
  INVITATION_ALREADY_PENDING_MESSAGE,
  INVITATION_NOT_PENDING_FOR_INVITEE_MESSAGE,
  INVITATION_NOT_PENDING_FOR_INVITER_MESSAGE,
  InvitationAlreadyPending,
  InvitationNotPendingForInvitee,
  InvitationNotPendingForInviter,
  type InvitationRecord,
  type InvitationStatus,
} from "./inviting.shared.ts";

export class InvitingMemoryConcept {
  private readonly invitations = new Map<string, InvitationRecord>();
  private readonly pending = new Map<string, Map<string, string>>();

  constructor(private readonly freshID: () => string = () => crypto.randomUUID()) {}

  issue({
    target,
    inviter,
    invitee,
    at,
  }: {
    target: string;
    inviter: string;
    invitee: string;
    at: Date;
  }) {
    if (this.#pending(target, invitee) !== undefined)
      throw new InvitationAlreadyPending(INVITATION_ALREADY_PENDING_MESSAGE);
    const invitation = this.freshID();
    this.invitations.set(invitation, {
      invitation,
      target,
      inviter,
      invitee,
      status: "pending",
      issuedAt: new Date(at.getTime()),
    });
    let byInvitee = this.pending.get(target);
    if (byInvitee === undefined) {
      byInvitee = new Map();
      this.pending.set(target, byInvitee);
    }
    byInvitee.set(invitee, invitation);
    return { invitation };
  }

  accept({ invitation, invitee, at }: { invitation: string; invitee: string; at: Date }) {
    return this.#decideForInvitee(invitation, invitee, "accepted", at);
  }

  decline({ invitation, invitee, at }: { invitation: string; invitee: string; at: Date }) {
    return this.#decideForInvitee(invitation, invitee, "declined", at);
  }

  revoke({ invitation, inviter, at }: { invitation: string; inviter: string; at: Date }) {
    const found = this.invitations.get(invitation);
    if (found === undefined || found.status !== "pending" || found.inviter !== inviter)
      throw new InvitationNotPendingForInviter(INVITATION_NOT_PENDING_FOR_INVITER_MESSAGE);
    this.#finish(found, "revoked", at);
    return { invitation };
  }

  _get({ invitation }: { invitation: string }): Omit<InvitationRecord, "invitation">[] {
    const found = this.invitations.get(invitation);
    return found === undefined
      ? []
      : [
          {
            target: found.target,
            inviter: found.inviter,
            invitee: found.invitee,
            status: found.status,
            issuedAt: new Date(found.issuedAt.getTime()),
            decidedAt:
              found.decidedAt === undefined ? undefined : new Date(found.decidedAt.getTime()),
          },
        ];
  }

  _pendingFor({
    invitee,
  }: {
    invitee: string;
  }): Pick<InvitationRecord, "invitation" | "target" | "inviter" | "issuedAt">[] {
    return [...this.invitations.values()]
      .filter((invitation) => invitation.invitee === invitee && invitation.status === "pending")
      .sort(compareInvitations)
      .map(({ invitation, target, inviter, issuedAt }) => ({
        invitation,
        target,
        inviter,
        issuedAt: new Date(issuedAt.getTime()),
      }));
  }

  #decideForInvitee(
    invitation: string,
    invitee: string,
    status: "accepted" | "declined",
    at: Date,
  ) {
    const found = this.invitations.get(invitation);
    if (found === undefined || found.status !== "pending" || found.invitee !== invitee)
      throw new InvitationNotPendingForInvitee(INVITATION_NOT_PENDING_FOR_INVITEE_MESSAGE);
    this.#finish(found, status, at);
    return { invitation };
  }

  #finish(found: InvitationRecord, status: Exclude<InvitationStatus, "pending">, at: Date): void {
    this.invitations.set(found.invitation, {
      ...found,
      status,
      decidedAt: new Date(at.getTime()),
    });
    const byInvitee = this.pending.get(found.target);
    byInvitee?.delete(found.invitee);
    if (byInvitee?.size === 0) this.pending.delete(found.target);
  }

  #pending(target: string, invitee: string): string | undefined {
    return this.pending.get(target)?.get(invitee);
  }
}
