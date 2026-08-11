<!-- Generated from the Operations room assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.8; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.8. -->

# Operations room — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Alerting

**Purpose.** Keep an alert visible to its recipient until they acknowledge it, so pending
matters do not depend on memory.

**Principle.** An alert is raised for Mina about a failed checkout, followed by one about a
delayed deployment. She sees both in that order. An alert raised for Jo does not
change Mina's alerts. Mina acknowledges the failed-checkout alert; her delayed-
deployment alert and Jo's alert remain. Trying to acknowledge the first alert
again is refused because it is no longer open.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `raise (recipient: Person, subject: Subject) : return (alert: Alert)`

**Authored behavior:**

    then
      add a new alert with recipient and subject
      return alert

##### `acknowledge (alert: Alert) : return (alert: Alert)`

**Authored behavior:**

    where alert not in alerts
    then
      refuse ALERT_NOT_FOUND "There is no such open alert."
    where alert in alerts
    then
      delete alert
      return alert

**Registered refusal codes:** `ALERT_NOT_FOUND`

#### Queries

##### `_openFor (recipient: Person) : many (alert: Alert, subject: Subject)`

**Authored behavior:**

    answers no rows for a Person with no open Alerts
    orders rows by when each Alert was raised

#### Types

`Alert` is an identity allocated by Alerting. `Person` and `Subject` are opaque
external identities.

### Discussing

**Purpose.** Open a discussion about a subject and collect authored responses, so people can
carry an exchange forward and close it deliberately.

**Principle.** Mina opens a discussion about a proposal. Sol responds, and the response is
shown in the order it arrived. Mina closes the discussion. A later response is
refused because the discussion is closed, as is an attempt to open a second
discussion about the same subject while the first one is open.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `open (subject: Subject) : return (discussion: Discussion)`

**Authored behavior:**

    where no open discussion has subject
    then
      add a new discussion with subject
      add discussion to open
      return discussion
    where some open discussion has subject
    then
      refuse DISCUSSION_ALREADY_OPEN "This subject already has an open discussion."

**Registered refusal codes:** `DISCUSSION_ALREADY_OPEN`

##### `respond (discussion: Discussion, author: Person, text: String) : return (response: Response)`

**Authored behavior:**

    where discussion in open
    then
      add a new response with discussion, author, and text
      return response
    where discussion not in open
    then
      refuse DISCUSSION_NOT_OPEN "This discussion is not open."

**Registered refusal codes:** `DISCUSSION_NOT_OPEN`

##### `close (discussion: Discussion) : return ()`

**Authored behavior:**

    where discussion in open
    then
      remove discussion from open
      return
    where discussion not in open
    then
      refuse DISCUSSION_NOT_OPEN "This discussion is not open."

**Registered refusal codes:** `DISCUSSION_NOT_OPEN`

#### Queries

##### `_openFor (subject: Subject) : optional (discussion: Discussion)`

**Authored behavior:**

    answers no row for a Subject with no open Discussion

##### `_responses (discussion: Discussion) : many (response: Response, author: Person, text: String)`

**Authored behavior:**

    answers no rows for a Discussion with no Responses
    orders rows by when each Response was added

#### Types

`Discussion` and `Response` are identities allocated by Discussing. `Subject`
and `Person` are opaque external identities. `String` is owned text.

### Gathering

**Purpose.** Let a host create a named gathering and let people join or leave it, so
belonging is an explicit, visible state.

**Principle.** Asha creates Saturday Workshop and becomes its first member. Bo joins and appears
among its members. When Bo tries to join again, the gathering refuses the
duplicate. Bo leaves; a second attempt to leave is refused because Bo no longer
belongs. When Cy tries to join an unknown gathering, it is refused because the
gathering does not exist.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `create (name: String, host: Person) : return (gathering: Gathering)`

**Authored behavior:**

    then
      add a new gathering with name and host
      add a new membership with gathering and member host
      return gathering

##### `join (gathering: Gathering, member: Person) : return (membership: Membership)`

**Authored behavior:**

    where gathering not in gatherings
    then
      refuse GATHERING_NOT_FOUND "There is no such gathering."
    where gathering in gatherings and some membership has gathering and member
    then
      refuse ALREADY_JOINED "This person already belongs to the gathering."
    where gathering in gatherings and no membership has gathering and member
    then
      add a new membership with gathering and member
      return membership

**Registered refusal codes:** `GATHERING_NOT_FOUND`, `ALREADY_JOINED`

##### `leave (gathering: Gathering, member: Person) : return (membership: Membership)`

**Authored behavior:**

    where gathering not in gatherings
    then
      refuse GATHERING_NOT_FOUND "There is no such gathering."
    where gathering in gatherings and no membership has gathering and member
    then
      refuse NOT_JOINED "This person does not belong to the gathering."
    where gathering in gatherings and some membership has gathering and member
    then
      delete that membership
      return membership

**Registered refusal codes:** `GATHERING_NOT_FOUND`, `NOT_JOINED`

#### Queries

##### `_get (gathering: Gathering) : optional (name: String, host: Person)`

**Authored behavior:**

    answers no row for an unknown Gathering

##### `_members (gathering: Gathering) : many (member: Person)`

**Authored behavior:**

    answers no rows for an unknown Gathering
    orders rows by when each Person joined

##### `_membership (gathering: Gathering, member: Person) : one (joined: Flag)`

**Authored behavior:**

    answers false when Person is not a member or Gathering is unknown

#### Types

`Gathering` and `Membership` are identities allocated by Gathering. `Person` is
an opaque external identity. `String` is owned text. `Flag` is a Boolean value.

### RequestBoundary

**Purpose.** Let the outside world ask for things and receive answers, so each authored answer belongs to one pending call and failed waits settle without forging one.

**Principle.** A call arrives and becomes pending. An answer travels back once; timeout or abort ends only the wait, while a quiescent interpreter failure returns an opaque internal error.

Actions:

- `request (…)`
- `respond (…)` — may refuse `NOT_PENDING`

### Selecting

**Purpose.** Keep one current item for a shared scope, so everyone working in that scope can
begin from the same choice.

**Principle.** A workshop chooses Essay A and it becomes the workshop's current selection.
Later it chooses Essay B; the new selection replaces Essay A as current without
changing another workshop's selection. Clearing the workshop removes its
current selection. A second clear is refused because there is nothing left to
clear.

_Registration checks member names, recoverable input names, and refusal mappings._
_Engine-evaluated reads enforce query cardinality. Types, results, and behavior prose are not executable assertions._

#### Actions

##### `choose (scope: Scope, item: Item) : return (selection: Selection)`

**Authored behavior:**

    then
      remove any selection with scope from current
      add a new selection with scope and item
      add selection to current
      return selection

##### `clear (scope: Scope) : return (selection: Selection)`

**Authored behavior:**

    where some current selection has scope
    then
      remove that selection from current
      return selection
    where no current selection has scope
    then
      refuse NO_CURRENT_SELECTION "This scope has no current selection."

**Registered refusal codes:** `NO_CURRENT_SELECTION`

#### Queries

##### `_current (scope: Scope) : optional (selection: Selection, item: Item)`

**Authored behavior:**

    answers no row for a Scope with no current Selection

##### `_get (selection: Selection) : optional (scope: Scope, item: Item)`

**Authored behavior:**

    answers no row for an unknown Selection

#### Types

`Selection` is an identity allocated by Selecting. `Scope` and `Item` are opaque
external identities.

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

```view
(responder) may contribute in (room) — inputs (responder, room); outputs (); bindings ()
  where Gathering._membership (gathering: room, member: responder) has (joined: true)
```

```view
(responder) may not contribute in (room) — inputs (responder, room); outputs (); bindings ()
  where Gathering._membership (gathering: room, member: responder) has (joined: false)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

```former
Former "the current mitigation (room)" — inputs (room); bindings (mitigation); promises at most one record — forms:
  a record of
    where Selecting._current (scope: room) has (item: mitigation)
    mitigation
    room
```

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

```former
Former "the required current mitigation (room)" — inputs (room); bindings (mitigation); promises exactly one record — forms:
  a record of
    where Selecting._current (scope: room) has (item: mitigation)
    mitigation
    room
```

```former
Former "the responder roster of (room)" — inputs (room); bindings (responder); promises exactly one record — forms:
  a record of
    responders: each Gathering._members (gathering: room) has (member: responder)
      form a record of
        responder
```

```former
Former "the response stats of (discussion)" — inputs (discussion); bindings (response, responder); promises exactly one record — forms:
  a record of
    firstResponse: the response of the first Discussing._responses (discussion) has (author: responder, response)
    responders: the distinct responder of each Discussing._responses (discussion) has (author: responder, response)
    responseCount: the count of Discussing._responses (discussion) has (author: responder, response)
```

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

### alerts.SelectedMitigationAlertsResponders

```reaction
when Selecting.choose (scope: room, selection)
where
  Gathering._members (gathering: room) has (member: responder)
then
  Alerting.raise (recipient: responder, subject: selection)
```

### contributions.AddContribution

```reaction
when RequestBoundary.request (path: "/rooms/contribute", requestId, responder, room, text)
where
  view "(responder) may contribute in (room)" with (responder, room)
  Selecting._current (scope: room) has (selection)
  Discussing._openFor (subject: selection) has (discussion)
then
  Discussing.respond (author: responder, discussion, text)
```

### contributions.AddContribution#2

```reaction
when Discussing.respond (author: responder, discussion, text, response), asked by contributions.AddContribution
where
  earlier, RequestBoundary.request (path: "/rooms/contribute", requestId, responder, room, text)
then
  RequestBoundary.respond (requestId, response)
```

### contributions.RejectContribution

```reaction
when RequestBoundary.request (path: "/rooms/contribute", requestId, responder, room, text)
where
  view "(responder) may not contribute in (room)" with (responder, room)
then
  RequestBoundary.respond (error: "RESPONDERS_ONLY", requestId)
```

### discussion.SelectedMitigationOpensDiscussion

```reaction
when Selecting.choose (selection)
then
  Discussing.open (subject: selection)
```

### room.ChooseMitigation

```reaction
when RequestBoundary.request (mitigation, path: "/rooms/choose-mitigation", requestId, room)
then
  Selecting.choose (item: mitigation, scope: room)
```

### room.ChooseMitigation#2

```reaction
when Selecting.choose (item: mitigation, scope: room, selection), asked by room.ChooseMitigation
where
  earlier, RequestBoundary.request (mitigation, path: "/rooms/choose-mitigation", requestId, room)
then
  RequestBoundary.respond (mitigation, requestId)
```

### room.CreateRoom

```reaction
when RequestBoundary.request (host, name, path: "/rooms/create", requestId)
then
  Gathering.create (host, name)
```

### room.CreateRoom#2

```reaction
when Gathering.create (host, name, gathering: room), asked by room.CreateRoom
where
  earlier, RequestBoundary.request (host, name, path: "/rooms/create", requestId)
then
  RequestBoundary.respond (requestId, room)
```

### room.GetRoom

```reaction
when RequestBoundary.request (path: "/rooms/get", requestId, room)
then
  RequestBoundary.respond (dashboard: former "the operations room (room)" with (room), requestId)
```

### room.JoinRoom

```reaction
when RequestBoundary.request (path: "/rooms/join", requestId, responder, room)
then
  Gathering.join (gathering: room, member: responder)
```

### room.JoinRoom#2

```reaction
when Gathering.join (gathering: room, member: responder, membership), asked by room.JoinRoom
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
