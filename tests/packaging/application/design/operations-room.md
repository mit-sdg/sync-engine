# Operations room decisions

Responders open a room by name and receive the room identity only after Rooming
accepts it. The [open-room endpoint](reaction:OpenRoom) exposes that operation at
the application boundary; duplicate names remain Rooming refusals rather than
creating a second room.

```endpoints
OpenRoom at /rooms/open
```

Every accepted opening selects investigation as the room's initial mitigation.
[That selection](reaction:RoomStartsWithInvestigation) gives responders a shared
next move without making the Rooming concept depend on mitigation policy.

The room dashboard combines the room's name with its current mitigation in one
result. [Forming the dashboard](former:roomDashboard) keeps that join inside the
application. The [room lookup endpoint](reaction:GetRoom) returns the dashboard
for a supplied room identity.

```endpoints
GetRoom at /rooms/get
```
