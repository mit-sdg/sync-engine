<!-- Generated from the Operations room assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.9; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.9. -->

# Operations room — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Alerting

Defined in [Alerting](../design/concepts/Alerting.md), line 1.

#### Actions

- `raise(recipient: Person, subject: Subject) : return (alert: Alert)`
- `acknowledge(alert: Alert) : return (alert: Alert)`
  - Refuses `ALERT_NOT_FOUND`: There is no such open alert.

#### Queries

- `_openFor(recipient: Person) : many (alert: Alert, recipient: Person, subject: Subject)`

#### Selected instances and bindings

- `Alerting`
  - `Alerting.Person` is `Person` — [Operations Room Vocabulary](../design/vocabulary.md), line 29.
  - `Alerting.Subject` is `Selecting.Selection` — [Operations Room Vocabulary](../design/vocabulary.md), line 32.

### Discussing

Defined in [Discussing](../design/concepts/Discussing.md), line 1.

#### Actions

- `open(subject: Subject) : return (discussion: Discussion)`
  - Refuses `DISCUSSION_ALREADY_OPEN`: This subject already has an open discussion.
- `respond(discussion: Discussion, author: Person, text: String) : return (response: Response)`
  - Refuses `DISCUSSION_NOT_OPEN`: This discussion is not open.
- `close(discussion: Discussion) : return ()`
  - Refuses `DISCUSSION_NOT_OPEN`: This discussion is not open.

#### Queries

- `_openFor(subject: Subject) : optional (discussion: Discussion)`
- `_responses(discussion: Discussion) : many (response: Response, discussion: Discussion, author: Person, text: String)`

#### Selected instances and bindings

- `Discussing`
  - `Discussing.Subject` is `Selecting.Selection` — [Operations Room Vocabulary](../design/vocabulary.md), line 23.
  - `Discussing.Person` is `Person` — [Operations Room Vocabulary](../design/vocabulary.md), line 26.

### Gathering

Defined in [Gathering](../design/concepts/Gathering.md), line 1.

#### Actions

- `create(name: String, host: Person) : return (gathering: Gathering)`
- `join(gathering: Gathering, member: Person) : return (membership: Membership)`
  - Refuses `GATHERING_NOT_FOUND`: There is no such gathering.
  - Refuses `ALREADY_JOINED`: This person already belongs to the gathering.
- `leave(gathering: Gathering, member: Person) : return (membership: Membership)`
  - Refuses `GATHERING_NOT_FOUND`: There is no such gathering.
  - Refuses `NOT_JOINED`: This person does not belong to the gathering.

#### Queries

- `_get(gathering: Gathering) : optional (gathering: Gathering, name: String, host: Person)`
- `_members(gathering: Gathering) : many (member: Person)`
- `_membership(gathering: Gathering, member: Person) : one (joined: Flag)`

#### Selected instances and bindings

- `Gathering`
  - `Gathering.Person` is `Person` — [Operations Room Vocabulary](../design/vocabulary.md), line 14.

### Selecting

Defined in [Selecting](../design/concepts/Selecting.md), line 1.

#### Actions

- `choose(scope: Scope, item: Item) : return (selection: Selection)`
- `clear(scope: Scope) : return (selection: Selection)`
  - Refuses `NO_CURRENT_SELECTION`: This scope has no current selection.

#### Queries

- `_current(scope: Scope) : optional (selection: Selection, scope: Scope, item: Item)`
- `_get(selection: Selection) : optional (selection: Selection, scope: Scope, item: Item)`

#### Selected instances and bindings

- `Selecting`
  - `Selecting.Scope` is `Gathering.Gathering` — [Operations Room Vocabulary](../design/vocabulary.md), line 17.
  - `Selecting.Item` is `Mitigation` — [Operations Room Vocabulary](../design/vocabulary.md), line 20.

## Application vocabulary

Concrete types:

- `Person` — [Operations Room Vocabulary](../design/vocabulary.md), line 8.
- `Mitigation` — [Operations Room Vocabulary](../design/vocabulary.md), line 11.

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

### (responder) may contribute in (room)

Authored path: `Contributions.ResponderMayContribute`.
- Covered by [Contributions](../design/compositions/Contributions.md), line 8.

```view
(responder) may contribute in (room) — inputs (responder, room); outputs (); bindings ()
  where Gathering._membership (gathering: room, member: responder) has (joined: true)
```

### (responder) may not contribute in (room)

Authored path: `Contributions.ResponderMayNotContribute`.
- Covered by [Contributions](../design/compositions/Contributions.md), line 11.

```view
(responder) may not contribute in (room) — inputs (responder, room); outputs (); bindings ()
  where Gathering._membership (gathering: room, member: responder) has (joined: false)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

### the current mitigation (room)

Authored path: `Room.ReadModels.CurrentMitigation`.
- Covered by [Room](../design/compositions/Room.md), line 15.

```former
Former "the current mitigation (room)" — inputs (room); bindings (mitigation); promises at most one record — forms:
  a record of
    where Selecting._current (scope: room) has (item: mitigation)
    mitigation
    room
```

### the operations room (room)

Authored path: `Room.RoomDashboard.RoomDashboard`.
- Covered by [Room](../design/compositions/Room.md), line 18.

```former
Former "the operations room (room)" — inputs (room); bindings (name, host, responder, selection, mitigation, discussion, response, author, text, alert, subject, alertedMitigation); promises exactly one record — forms:
  a record of
    where Gathering._get (gathering: room) has (host, name)
    current: a record of
      where whether Selecting._current (scope: room) has (item: mitigation, selection)
      where whether Discussing._openFor (subject: selection) has (discussion)
      discussion
      mitigation
      responseCount: the count of Discussing._responses (discussion) has (author, response, text)
      responses: each Discussing._responses (discussion) has (author, response, text)
        form a record of
          responder: author
          response
          text
    host
    name
    responders: each Gathering._members (gathering: room) has (member: responder)
      form a record of
        alerts: each Alerting._openFor (recipient: responder) has (alert, subject)
          where Selecting._get (selection: subject) has (item: alertedMitigation)
          form a record of
            alert
            mitigation: alertedMitigation
        responder
    room
```

### the required current mitigation (room)

Authored path: `Room.ReadModels.RequiredCurrentMitigation`.
- Covered by [Room](../design/compositions/Room.md), line 14.

```former
Former "the required current mitigation (room)" — inputs (room); bindings (mitigation); promises exactly one record — forms:
  a record of
    where Selecting._current (scope: room) has (item: mitigation)
    mitigation
    room
```

### the responder roster of (room)

Authored path: `Room.ReadModels.ResponderRoster`.
- Covered by [Room](../design/compositions/Room.md), line 8.

```former
Former "the responder roster of (room)" — inputs (room); bindings (responder); promises exactly one record — forms:
  a record of
    responders: each Gathering._members (gathering: room) has (member: responder)
      form a record of
        responder
```

### the response stats of (discussion)

Authored path: `Room.ReadModels.ResponseStats`.
- Covered by [Room](../design/compositions/Room.md), line 22.

```former
Former "the response stats of (discussion)" — inputs (discussion); bindings (response, responder); promises exactly one record — forms:
  a record of
    firstResponse: the response of the first Discussing._responses (discussion) has (author: responder, response)
    responders: the distinct responder of each Discussing._responses (discussion) has (author: responder, response)
    responseCount: the count of Discussing._responses (discussion) has (author: responder, response)
```

### the room summary (room)

Authored path: `Room.ReadModels.RoomSummary`.
- Covered by [Room](../design/compositions/Room.md), line 9.

```former
Former "the room summary (room)" — inputs (room); bindings (name, host); promises exactly one record — forms:
  a record of
    where Gathering._get (gathering: room) has (host, name)
    host
    name
    room
    … former "the responder roster of (room)" with (room)
```

## Reactions

### Contributions.AddContribution

Authored path: `Contributions.AddContribution`.
- Covered by [Contributions](../design/compositions/Contributions.md), line 6.

```reaction
when RequestBoundary.request (path: "/rooms/contribute", requestId, responder, room, text)
where
  view "(responder) may contribute in (room)" with (responder, room)
  Selecting._current (scope: room) has (selection)
  Discussing._openFor (subject: selection) has (discussion)
then
  Discussing.respond (author: responder, discussion, text)
```

### Contributions.AddContribution#2

Authored path: `Contributions.AddContribution`.
- Covered by [Contributions](../design/compositions/Contributions.md), line 6.

```reaction
when Discussing.respond (author: responder, discussion, text, response), asked by Contributions.AddContribution
where
  earlier, RequestBoundary.request (path: "/rooms/contribute", requestId, responder, room, text)
then
  RequestBoundary.respond (requestId, response)
```

### Contributions.RejectContribution

Authored path: `Contributions.RejectContribution`.
- Covered by [Contributions](../design/compositions/Contributions.md), line 9.

```reaction
when RequestBoundary.request (path: "/rooms/contribute", requestId, responder, room, text)
where
  view "(responder) may not contribute in (room)" with (responder, room)
then
  RequestBoundary.respond (error: "RESPONDERS_ONLY", requestId)
```

### DeliverFaultToAsker

```reaction
when any action is faulted, not asked by DeliverFaultToAsker
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respondFramework (error: "INTERNAL_ERROR", requestId)
```

### DeliverRefusalToAsker

```reaction
when any action is refused (message), except RequestBoundary
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respond (error: message, requestId)
```

### MitigationAlerts.SelectedMitigationAlertsResponders

Authored path: `MitigationAlerts.SelectedMitigationAlertsResponders`.
- Covered by [Mitigation Alerts](../design/compositions/MitigationAlerts.md), line 5.

```reaction
when Selecting.choose (scope: room, selection)
where
  Gathering._members (gathering: room) has (member: responder)
then
  Alerting.raise (recipient: responder, subject: selection)
```

### MitigationDiscussion.SelectedMitigationOpensDiscussion

Authored path: `MitigationDiscussion.SelectedMitigationOpensDiscussion`.
- Covered by [Mitigation Discussion](../design/compositions/MitigationDiscussion.md), line 4.

```reaction
when Selecting.choose (selection)
then
  Discussing.open (subject: selection)
```

### Room.MitigationSelection.ChooseMitigation

Authored path: `Room.MitigationSelection.ChooseMitigation`.
- Covered by [Room](../design/compositions/Room.md), line 12.

```reaction
when RequestBoundary.request (mitigation, path: "/rooms/choose-mitigation", requestId, room)
then
  Selecting.choose (item: mitigation, scope: room)
```

### Room.MitigationSelection.ChooseMitigation#2

Authored path: `Room.MitigationSelection.ChooseMitigation`.
- Covered by [Room](../design/compositions/Room.md), line 12.

```reaction
when Selecting.choose (item: mitigation, scope: room, selection), asked by Room.MitigationSelection.ChooseMitigation
where
  earlier, RequestBoundary.request (mitigation, path: "/rooms/choose-mitigation", requestId, room)
then
  RequestBoundary.respond (mitigation, requestId)
```

### Room.RoomDashboard.GetRoom

Authored path: `Room.RoomDashboard.GetRoom`.
- Covered by [Room](../design/compositions/Room.md), line 17.

```reaction
when RequestBoundary.request (path: "/rooms/get", requestId, room)
then
  RequestBoundary.respond (dashboard: former "the operations room (room)" with (room), requestId)
```

### Room.RoomMembership.CreateRoom

Authored path: `Room.RoomMembership.CreateRoom`.
- Covered by [Room](../design/compositions/Room.md), line 6.

```reaction
when RequestBoundary.request (host, name, path: "/rooms/create", requestId)
then
  Gathering.create (host, name)
```

### Room.RoomMembership.CreateRoom#2

Authored path: `Room.RoomMembership.CreateRoom`.
- Covered by [Room](../design/compositions/Room.md), line 6.

```reaction
when Gathering.create (host, name, gathering: room), asked by Room.RoomMembership.CreateRoom
where
  earlier, RequestBoundary.request (host, name, path: "/rooms/create", requestId)
then
  RequestBoundary.respond (requestId, room)
```

### Room.RoomMembership.JoinRoom

Authored path: `Room.RoomMembership.JoinRoom`.
- Covered by [Room](../design/compositions/Room.md), line 7.

```reaction
when RequestBoundary.request (path: "/rooms/join", requestId, responder, room)
then
  Gathering.join (gathering: room, member: responder)
```

### Room.RoomMembership.JoinRoom#2

Authored path: `Room.RoomMembership.JoinRoom`.
- Covered by [Room](../design/compositions/Room.md), line 7.

```reaction
when Gathering.join (gathering: room, member: responder, membership), asked by Room.RoomMembership.JoinRoom
where
  earlier, RequestBoundary.request (path: "/rooms/join", requestId, responder, room)
then
  RequestBoundary.respond (requestId, responder)
```

## Endpoint input contracts

Before recording an action ask, the boundary rejects a body that is not an
object or lacks a required key. The response uses `INVALID_INPUT` and names
the path or missing key. A declared default fills an absent key. Endpoints
not listed here have no explicit input contract.

- `/rooms/choose-mitigation` — requires `mitigation`, `room`
- `/rooms/contribute` — requires `responder`, `room`, `text`
- `/rooms/create` — requires `host`, `name`
- `/rooms/get` — requires `room`
- `/rooms/join` — requires `responder`, `room`
