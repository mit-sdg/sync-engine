# Incident Room

An incident room coordinates responders around one current mitigation, its discussion, and addressed alerts.

## Application types and instances

```types
concrete Person
  A responder identity supplied by the incident-room application.

concrete Mitigation
  An incident response option that a room may select.
```

```instances
instantiate Timing

instantiate Gathering with
  Person is Person

instantiate Selecting with
  Scope is Gathering.Gathering
  Item is Mitigation

instantiate Discussing with
  Subject is Selecting.Selection
  Author is Person

instantiate Alerting with
  Recipient is Person
  Subject is Selecting.Selection
  Cause is Selecting.Selection
```

## Compositions

### RoomMembership

A host creates a room as its first responder, and other responders may join it.

### MitigationDiscussion

Choosing a mitigation records a Selection, opens a Discussion for that Selection, and alerts every current room member. Only current members may contribute. Selecting may commit before all effects complete, so callers must not assume cross-concept atomicity.

### MitigationAlerts

A recipient may acknowledge an alert. Trusted repair retries a missing discussion or one original recipient's alert using the Selection as Subject and Cause, so retries converge without duplicate open discussions or alerts. The caller supplies the selection-time recipient; later members are not automatically backfilled.

### IncidentDashboard

Opening the dashboard presents room membership, the current mitigation and discussion, responses, and each member's open mitigation alerts.

## Views

### MemberOfRoom

A responder belongs to the room when Gathering reports a joined membership.

### NotMemberOfRoom

A responder is outside the room when Gathering reports no joined membership.

### OpenMitigationDiscussion

The open mitigation discussion is the Discussion whose Subject is the room's current Selection.

## Formers

### IncidentDashboard

The dashboard combines room details, member alerts, the current mitigation, and discussion responses.
