import design from "./spec.md";
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "@catalog/concepts";

const { Gathering, Inviting, Timing } = concepts;

const pendingInvitations = former(
  "the pending workshop invitations of (invitee)",
  ({ invitee }, { invitation, target, inviter, issuedAt }) =>
    each(Inviting._pendingFor({ invitee }).is({ invitation, target, inviter, issuedAt })).form({
      invitation,
      workshop: target,
      inviter,
      issuedAt,
    }),
);

/** `host` is attribution unless the containing application binds an authenticated identity. */
const CreateInviteOnlyWorkshop = endpoint("/invite-workshops/create", ({ name, host, workshop }) =>
  receive({ name, host })
    .then(Gathering.create({ name, host }).responds({ gathering: workshop }))
    .then(respond({ workshop })),
);

/** A public adapter must bind `inviter` to the authenticated caller. */
const IssueWorkshopInvitation = endpoint(
  "/invite-workshops/invite",
  ({ workshop, inviter, invitee, at, invitation }) =>
    receive({ workshop, inviter, invitee }).then(
      where(Gathering._get({ gathering: workshop }), Timing._now({}).is({ time: at }))
        .then(Inviting.issue({ target: workshop, inviter, invitee, at }).responds({ invitation }))
        .then(respond({ invitation }))
        .named("workshop-exists"),
      where(no(Gathering._get({ gathering: workshop })))
        .then(respond({ error: "GATHERING_NOT_FOUND" }))
        .named("workshop-missing"),
    ),
);

/**
 * `invitee` must be the authenticated caller. Acceptance commits before the
 * membership action; a later fault leaves the accepted invitation for repair.
 */
const AcceptWorkshopInvitation = endpoint(
  "/invite-workshops/accept",
  ({ invitation, invitee, at, workshop }) =>
    receive({ invitation, invitee })
      .where(Timing._now({}).is({ time: at }))
      .then(Inviting.accept({ invitation, invitee, at }).responds({ invitation }))
      .then(
        where(Inviting._get({ invitation }).is({ target: workshop, invitee, status: "accepted" }))
          .then(Gathering.join({ gathering: workshop, member: invitee }).responds())
          .then(respond({ invitation, joined: true }))
          .named("join-invitee"),
      ),
);

/** A public adapter must bind `invitee` to the authenticated caller. */
const DeclineWorkshopInvitation = endpoint(
  "/invite-workshops/decline",
  ({ invitation, invitee, at }) =>
    receive({ invitation, invitee })
      .where(Timing._now({}).is({ time: at }))
      .then(Inviting.decline({ invitation, invitee, at }).responds({ invitation }))
      .then(respond({ invitation })),
);

/** A public adapter must bind `inviter` to the authenticated caller. */
const RevokeWorkshopInvitation = endpoint(
  "/invite-workshops/revoke",
  ({ invitation, inviter, at }) =>
    receive({ invitation, inviter })
      .where(Timing._now({}).is({ time: at }))
      .then(Inviting.revoke({ invitation, inviter, at }).responds({ invitation }))
      .then(respond({ invitation })),
);

/** `invitee` must be the authenticated caller whose accepted invitation is repaired. */
const RepairAcceptedWorkshopInvitation = endpoint(
  "/invite-workshops/repair",
  ({ invitation, invitee, workshop }) =>
    receive({ invitation, invitee }).then(
      where(
        Inviting._get({ invitation }).is({ target: workshop, invitee, status: "accepted" }),
        Gathering._membership({ gathering: workshop, member: invitee }).is({ joined: true }),
      )
        .then(respond({ invitation, joined: true }))
        .named("already-joined"),
      where(
        Inviting._get({ invitation }).is({ target: workshop, invitee, status: "accepted" }),
        Gathering._membership({ gathering: workshop, member: invitee }).is({ joined: false }),
      )
        .then(Gathering.join({ gathering: workshop, member: invitee }).responds({}))
        .then(respond({ invitation, joined: true }))
        .named("join-missing"),
      where(no(Inviting._get({ invitation }).is({ invitee, status: "accepted" })))
        .then(respond({ error: "ACCEPTED_INVITATION_NOT_FOUND" }))
        .named("not-accepted"),
    ),
);

/** `invitee` selects a private inbox and must be bound to the authenticated caller. */
const GetWorkshopInvitations = endpoint("/invite-workshops/invitations", ({ invitee }) =>
  receive({ invitee }).then(respond({ invitations: pendingInvitations({ invitee }) })),
);

export { design };

export const compositions = {
  CreateInviteOnlyWorkshop,
  IssueWorkshopInvitation,
  AcceptWorkshopInvitation,
  DeclineWorkshopInvitation,
  RevokeWorkshopInvitation,
  RepairAcceptedWorkshopInvitation,
  GetWorkshopInvitations,
};

export const formers = {
  pendingInvitations,
};
