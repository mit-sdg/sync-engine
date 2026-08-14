# Inviting

## Purpose

Record a directed offer that only its intended recipient may accept or decline, so
participation requires consent from both the inviter and invitee.

## Principle

Ari invites Bo to target `workshop-4`. Another pending invitation for Bo and the same
target is refused. Cy cannot accept Bo's invitation. Bo accepts it, after which a
second acceptance and Ari's attempt to revoke it are refused. Ari may issue a new
invitation after an earlier invitation is declined or revoked.

## Types

```types
external Target
  The object to which participation is invited.
external Person
  The external identity of an inviter or invitee.
```

## State

```state
a set of Invitations with
  a target Target
  an inviter Person
  an invitee Person
  a status InvitationStatus
  an issuedAt DateTime
  a decidedAt optional DateTime

at most one pending Invitation has each target and invitee pair
```

## Actions

```actions
issue (target: Target, inviter: Person, invitee: Person, at: DateTime) : return (invitation: Invitation)
  where a pending Invitation has target and invitee
  then
    refuse INVITATION_ALREADY_PENDING "This person already has a pending invitation for the target."
  where no pending Invitation has target and invitee
  then
    add a new pending Invitation with target, inviter, invitee, and issuedAt at
    return invitation

accept (invitation: Invitation, invitee: Person, at: DateTime) : return (invitation: Invitation)
  where invitation is unknown, is not pending, or does not have invitee
  then
    refuse INVITATION_NOT_PENDING_FOR_INVITEE "There is no such pending invitation for this invitee."
  where invitation is pending and has invitee
  then
    mark the Invitation accepted with decidedAt at
    return invitation

decline (invitation: Invitation, invitee: Person, at: DateTime) : return (invitation: Invitation)
  where invitation is unknown, is not pending, or does not have invitee
  then
    refuse INVITATION_NOT_PENDING_FOR_INVITEE "There is no such pending invitation for this invitee."
  where invitation is pending and has invitee
  then
    mark the Invitation declined with decidedAt at
    return invitation

revoke (invitation: Invitation, inviter: Person, at: DateTime) : return (invitation: Invitation)
  where invitation is unknown, is not pending, or does not have inviter
  then
    refuse INVITATION_NOT_PENDING_FOR_INVITER "There is no such pending invitation for this inviter."
  where invitation is pending and has inviter
  then
    mark the Invitation revoked with decidedAt at
    return invitation
```

## Queries

```queries
_get (invitation: Invitation) : optional (target: Target, inviter: Person, invitee: Person, status: InvitationStatus, issuedAt: DateTime, decidedAt: DateTime | undefined)
  answers no row for an unknown Invitation
_pendingFor (invitee: Person) : many (invitation: Invitation, target: Target, inviter: Person, issuedAt: DateTime)
  orders rows by issuedAt and then Invitation identity
```
