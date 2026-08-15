# Room

The room composition owns the incident-room boundary and the read models used to
present current room state.

A host [creates an incident room](reaction:Room.RoomMembership.CreateRoom), and
responders [join it](reaction:Room.RoomMembership.JoinRoom). The
[responder roster](former:Room.ReadModels.ResponderRoster) lists its current
members, while the [room summary](former:Room.ReadModels.RoomSummary) combines
the room's name and host with that roster.

The room [chooses a current mitigation](reaction:Room.MitigationSelection.ChooseMitigation)
through Selecting. One read
[requires a current mitigation](former:Room.ReadModels.RequiredCurrentMitigation);
another [returns it when present](former:Room.ReadModels.CurrentMitigation).

The [room endpoint](reaction:Room.RoomDashboard.GetRoom) returns the owned
[dashboard read](former:Room.RoomDashboard.RoomDashboard) rather than rebuilding
that result at the boundary. The dashboard combines room details, responders,
current mitigation, discussion, responses, and alerts.

For narrower uses, [response statistics](former:Room.ReadModels.ResponseStats)
report the response count, first response, and distinct responders for a
discussion.
