# Invite-only Workshop

An invite-only workshop requires a directed accepted invitation before a person joins.

## Compositions

### WorkshopMembership

A host creates a workshop. Accepting an invitation records acceptance before joining its invitee, so a failed join leaves durable evidence rather than rolling the invitation back. Trusted repair joins an accepted invitee only when membership is missing and treats existing membership as convergence.

### InvitationManagement

A workshop may issue, decline, or revoke invitations, and an invitee may read their pending invitations. Issuing first confirms that the workshop exists. Public boundaries must bind inviter and invitee inputs to authenticated callers because the recipe treats those identities as trusted authority.

## Formers

### PendingInvitations

The pending invitation read lists the invitations currently addressed to one invitee.
