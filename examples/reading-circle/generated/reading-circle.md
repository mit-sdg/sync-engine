<!-- Generated from the Reading circle assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.8; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.8. -->

# Reading circle — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

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
(member) may not respond in (circle) — inputs (member, circle); outputs (); bindings ()
  where Gathering._membership (gathering: circle, member) has (joined: false)
```

```view
(member) may respond in (circle) — inputs (member, circle); outputs (); bindings ()
  where Gathering._membership (gathering: circle, member) has (joined: true)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

```former
Former "the circle page (circle)" — inputs (circle); bindings (name, host, member, selection, reading, discussion, response, author, text); promises exactly one record — forms:
  a record of
    where Gathering._get (gathering: circle) has (host, name)
    circle
    host
    members: each Gathering._members (gathering: circle) has (member)
      form a record of
        member
    name
    reading: a record of
      where Selecting._current (scope: circle) has (item: reading, selection)
      where Discussing._openFor (subject: selection) has (discussion)
      reading
      responses: each Discussing._responses (discussion) has (author, response, text)
        form a record of
          member: author
          response
          text
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

### ReadingCircle.CircleMembership.CreateCircle

```reaction
when RequestBoundary.request (host, name, path: "/circles/create", requestId)
then
  Gathering.create (host, name)
```

### ReadingCircle.CircleMembership.CreateCircle#2

```reaction
when Gathering.create (host, name, gathering: circle), asked by ReadingCircle.CircleMembership.CreateCircle
where
  earlier, RequestBoundary.request (host, name, path: "/circles/create", requestId)
then
  RequestBoundary.respond (circle, requestId)
```

### ReadingCircle.CircleMembership.JoinCircle

```reaction
when RequestBoundary.request (circle, member, path: "/circles/join", requestId)
then
  Gathering.join (gathering: circle, member)
```

### ReadingCircle.CircleMembership.JoinCircle#2

```reaction
when Gathering.join (gathering: circle, member, membership), asked by ReadingCircle.CircleMembership.JoinCircle
where
  earlier, RequestBoundary.request (circle, member, path: "/circles/join", requestId)
then
  RequestBoundary.respond (member, requestId)
```

### ReadingCircle.CirclePages.GetCirclePage

```reaction
when RequestBoundary.request (circle, path: "/circles/page", requestId)
then
  RequestBoundary.respond (page: former "the circle page (circle)" with (circle), requestId)
```

### ReadingCircle.ReadingDiscussion.AddResponse

```reaction
when RequestBoundary.request (circle, member, path: "/circles/respond", reading, requestId, text)
where
  view "(member) may respond in (circle)" with (circle, member)
  Selecting._current (scope: circle) has (item: reading, selection)
  Discussing._openFor (subject: selection) has (discussion)
then
  Discussing.respond (author: member, discussion, text)
```

### ReadingCircle.ReadingDiscussion.AddResponse#2

```reaction
when Discussing.respond (author: member, discussion, text, response), asked by ReadingCircle.ReadingDiscussion.AddResponse
where
  earlier, RequestBoundary.request (circle, member, path: "/circles/respond", reading, requestId, text)
then
  RequestBoundary.respond (requestId, response)
```

### ReadingCircle.ReadingDiscussion.ChooseReading

```reaction
when RequestBoundary.request (circle, path: "/circles/choose", reading, requestId)
then
  Selecting.choose (item: reading, scope: circle)
```

### ReadingCircle.ReadingDiscussion.ChooseReading#2

```reaction
when Selecting.choose (item: reading, scope: circle, selection), asked by ReadingCircle.ReadingDiscussion.ChooseReading
where
  earlier, RequestBoundary.request (circle, path: "/circles/choose", reading, requestId)
then
  RequestBoundary.respond (reading, requestId)
```

### ReadingCircle.ReadingDiscussion.RejectNonmemberResponse

```reaction
when RequestBoundary.request (circle, member, path: "/circles/respond", reading, requestId, text)
where
  view "(member) may not respond in (circle)" with (circle, member)
then
  RequestBoundary.respond (error: "NOT_A_MEMBER", requestId)
```

### ReadingCircle.ReadingDiscussion.SelectedReadingOpensDiscussion

```reaction
when Selecting.choose (selection)
then
  Discussing.open (subject: selection)
```

## Endpoint input contracts

Before recording an action ask, the boundary rejects a body that is not an
object or lacks a required key. The response uses `INVALID_INPUT` and names
the path or missing key. A declared default fills an absent key. Endpoints
not listed here have no explicit input contract.

- `/circles/choose` — requires `circle`, `reading`
- `/circles/create` — requires `host`, `name`
- `/circles/join` — requires `circle`, `member`
- `/circles/page` — requires `circle`
- `/circles/respond` — requires `circle`, `member`, `reading`, `text`
