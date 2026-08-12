# Invite-only Workshop recipe

## Purpose

Require a directed accepted invitation before a person joins a workshop.

## Concepts

Timing timestamps invitation decisions. Gathering owns workshops and membership.
Inviting owns the offer, recipient, and terminal invitation decision.

## Decisions

Issuing first confirms that the Gathering exists. A public adapter must bind the
inviter to the authenticated caller when issuing or revoking, and bind the invitee
when accepting, declining, repairing, or reading the private invitation list. An
accepted Invitation is durable evidence even when the later Gathering join faults.

## Compositions

- `CreateInviteOnlyWorkshop` — `/invite-workshops/create`
- `IssueWorkshopInvitation` — `/invite-workshops/invite`
- `AcceptWorkshopInvitation` — `/invite-workshops/accept`
- `DeclineWorkshopInvitation` — `/invite-workshops/decline`
- `RevokeWorkshopInvitation` — `/invite-workshops/revoke`
- `RepairAcceptedWorkshopInvitation` — `/invite-workshops/repair`
- `GetWorkshopInvitations` — `/invite-workshops/invitations`

## Formers

`pendingInvitations`.

## Failure and repair

Acceptance is recorded before the membership consequence. If joining faults, repair
reads the accepted Invitation and current membership and retries only the missing
join. Repair treats an existing membership as convergence, not as a reason to reverse
acceptance. The recipe does not claim atomicity between Inviting and Gathering.
