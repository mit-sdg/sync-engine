import type { Collection, Db } from "mongodb";
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

function duplicatePendingPair(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    (error as { code?: unknown }).code !== 11000
  )
    return false;
  const pattern =
    "keyPattern" in error ? (error as { keyPattern?: unknown }).keyPattern : undefined;
  if (typeof pattern === "object" && pattern !== null) {
    const keys = Object.keys(pattern).sort();
    return keys.length === 2 && keys[0] === "invitee" && keys[1] === "target";
  }
  return (
    error instanceof Error && error.message.includes("one_pending_invitation_per_target_invitee")
  );
}

const indexes = new WeakMap<Db, Promise<void>>();
export function ensureInvitingIndexes(db: Db): Promise<void> {
  let ready = indexes.get(db);
  if (ready === undefined) {
    ready = db
      .collection<InvitationRecord>("inviting_invitations")
      .createIndexes([
        { key: { invitation: 1 }, name: "invitation_identity", unique: true },
        {
          key: { target: 1, invitee: 1 },
          name: "one_pending_invitation_per_target_invitee",
          unique: true,
          partialFilterExpression: { status: "pending" },
        },
        {
          key: { invitee: 1, status: 1, issuedAt: 1, invitation: 1 },
          name: "pending_invitations_in_contract_order",
        },
      ])
      .then(() => undefined);
    indexes.set(db, ready);
  }
  return ready;
}

export class InvitingMongoConcept {
  private readonly invitations: Collection<InvitationRecord>;

  constructor(
    private readonly db: Db,
    private readonly freshID: () => string = () => crypto.randomUUID(),
  ) {
    this.invitations = db.collection("inviting_invitations");
  }

  async issue({
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
    const issuedAt = new Date(at.getTime());
    await ensureInvitingIndexes(this.db);
    if (
      (await this.invitations.countDocuments(
        { target, invitee, status: "pending" },
        { limit: 1 },
      )) > 0
    )
      throw new InvitationAlreadyPending(INVITATION_ALREADY_PENDING_MESSAGE);
    const invitation = this.freshID();
    try {
      await this.invitations.insertOne({
        invitation,
        target,
        inviter,
        invitee,
        status: "pending",
        issuedAt,
      });
    } catch (error) {
      if (duplicatePendingPair(error))
        throw new InvitationAlreadyPending(INVITATION_ALREADY_PENDING_MESSAGE);
      throw error;
    }
    return { invitation };
  }

  async accept({ invitation, invitee, at }: { invitation: string; invitee: string; at: Date }) {
    return this.#decide(
      { invitation, invitee, status: "pending" },
      "accepted",
      at,
      () => new InvitationNotPendingForInvitee(INVITATION_NOT_PENDING_FOR_INVITEE_MESSAGE),
    );
  }

  async decline({ invitation, invitee, at }: { invitation: string; invitee: string; at: Date }) {
    return this.#decide(
      { invitation, invitee, status: "pending" },
      "declined",
      at,
      () => new InvitationNotPendingForInvitee(INVITATION_NOT_PENDING_FOR_INVITEE_MESSAGE),
    );
  }

  async revoke({ invitation, inviter, at }: { invitation: string; inviter: string; at: Date }) {
    return this.#decide(
      { invitation, inviter, status: "pending" },
      "revoked",
      at,
      () => new InvitationNotPendingForInviter(INVITATION_NOT_PENDING_FOR_INVITER_MESSAGE),
    );
  }

  async _get({
    invitation,
  }: {
    invitation: string;
  }): Promise<Omit<InvitationRecord, "invitation">[]> {
    const found = await this.invitations.findOne(
      { invitation },
      {
        projection: {
          _id: 0,
          target: 1,
          inviter: 1,
          invitee: 1,
          status: 1,
          issuedAt: 1,
          decidedAt: 1,
        },
      },
    );
    return found === null
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

  async _pendingFor({
    invitee,
  }: {
    invitee: string;
  }): Promise<Pick<InvitationRecord, "invitation" | "target" | "inviter" | "issuedAt">[]> {
    const found = await this.invitations
      .find(
        { invitee, status: "pending" },
        { projection: { _id: 0, invitation: 1, target: 1, inviter: 1, issuedAt: 1 } },
      )
      .toArray();
    return found.sort(compareInvitations).map(({ invitation, target, inviter, issuedAt }) => ({
      invitation,
      target,
      inviter,
      issuedAt: new Date(issuedAt.getTime()),
    }));
  }

  async #decide(
    filter: { invitation: string; status: "pending"; invitee?: string; inviter?: string },
    status: Exclude<InvitationStatus, "pending">,
    at: Date,
    refusal: () => Error,
  ) {
    const decidedAt = new Date(at.getTime());
    await ensureInvitingIndexes(this.db);
    const decided = await this.invitations.updateOne(filter, {
      $set: { status, decidedAt },
    });
    if (decided.matchedCount === 0) throw refusal();
    return { invitation: filter.invitation };
  }
}
