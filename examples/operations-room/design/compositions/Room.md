# Room

The room composition owns the incident-room boundary and the read models used to
present current room state.

## Compositions

### RoomMembership

A host creates an incident room and responders join it.

### MitigationSelection

The room chooses a current mitigation through Selecting.

### RoomDashboard

The read endpoint returns the owned room dashboard rather than rebuilding that
read at the boundary.

## Formers

### ResponderRoster

The responder roster lists the current room members.

### RoomSummary

The room summary combines the room's name and host with its responder roster.

### RequiredCurrentMitigation

This read requires the room to have a current mitigation.

### CurrentMitigation

This optional read returns the current mitigation when one has been selected.

### ResponseStats

Response statistics report the response count, first response, and distinct
responders for a discussion.

### RoomDashboard

The dashboard combines room details, responders, current mitigation,
discussion, responses, and alerts.
