<!-- Generated from the Reading circle assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.0.0-beta.10; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.0.0-beta.10. -->

# Reading circle — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

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
  - `Discussing.Subject` is `Selecting.Selection` — [Reading Circle Application Types](../design/types.md), line 23.
  - `Discussing.Person` is `Person` — [Reading Circle Application Types](../design/types.md), line 26.

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
  - `Gathering.Person` is `Person` — [Reading Circle Application Types](../design/types.md), line 14.

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
  - `Selecting.Scope` is `Gathering.Gathering` — [Reading Circle Application Types](../design/types.md), line 17.
  - `Selecting.Item` is `Reading` — [Reading Circle Application Types](../design/types.md), line 20.

## Application types

Concrete types:

- `Person` — [Reading Circle Application Types](../design/types.md), line 8.
- `Reading` — [Reading Circle Application Types](../design/types.md), line 11.

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

### (member) may not respond in (circle)

Authored path: `ReadingCircle.ReadingDiscussion.NonmemberMayNotRespond`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 15.

```view
(member) may not respond in (circle) — inputs (member, circle); outputs (); bindings ()
  where Gathering._membership (gathering: circle, member) has (joined: false)
```

### (member) may respond in (circle)

Authored path: `ReadingCircle.ReadingDiscussion.MemberMayRespond`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 12.

```view
(member) may respond in (circle) — inputs (member, circle); outputs (); bindings ()
  where Gathering._membership (gathering: circle, member) has (joined: true)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

### the circle page (circle)

Authored path: `ReadingCircle.CirclePages.CirclePage`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 20.

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

Authored path: `ReadingCircle.CircleMembership.CreateCircle`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 6.

```reaction
when RequestBoundary.request (host, name, path: "/circles/create", requestId)
then
  Gathering.create (host, name)
```

### ReadingCircle.CircleMembership.CreateCircle#2

Authored path: `ReadingCircle.CircleMembership.CreateCircle`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 6.

```reaction
when Gathering.create (host, name, gathering: circle), asked by ReadingCircle.CircleMembership.CreateCircle
where
  earlier, RequestBoundary.request (host, name, path: "/circles/create", requestId)
then
  RequestBoundary.respond (circle, requestId)
```

### ReadingCircle.CircleMembership.JoinCircle

Authored path: `ReadingCircle.CircleMembership.JoinCircle`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 8.

```reaction
when RequestBoundary.request (circle, member, path: "/circles/join", requestId)
then
  Gathering.join (gathering: circle, member)
```

### ReadingCircle.CircleMembership.JoinCircle#2

Authored path: `ReadingCircle.CircleMembership.JoinCircle`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 8.

```reaction
when Gathering.join (gathering: circle, member, membership), asked by ReadingCircle.CircleMembership.JoinCircle
where
  earlier, RequestBoundary.request (circle, member, path: "/circles/join", requestId)
then
  RequestBoundary.respond (member, requestId)
```

### ReadingCircle.CirclePages.GetCirclePage

Authored path: `ReadingCircle.CirclePages.GetCirclePage`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 19.

```reaction
when RequestBoundary.request (circle, path: "/circles/page", requestId)
then
  RequestBoundary.respond (page: former "the circle page (circle)" with (circle), requestId)
```

### ReadingCircle.ReadingDiscussion.AddResponse

Authored path: `ReadingCircle.ReadingDiscussion.AddResponse`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 13.

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

Authored path: `ReadingCircle.ReadingDiscussion.AddResponse`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 13.

```reaction
when Discussing.respond (author: member, discussion, text, response), asked by ReadingCircle.ReadingDiscussion.AddResponse
where
  earlier, RequestBoundary.request (circle, member, path: "/circles/respond", reading, requestId, text)
then
  RequestBoundary.respond (requestId, response)
```

### ReadingCircle.ReadingDiscussion.ChooseReading

Authored path: `ReadingCircle.ReadingDiscussion.ChooseReading`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 10.

```reaction
when RequestBoundary.request (circle, path: "/circles/choose", reading, requestId)
then
  Selecting.choose (item: reading, scope: circle)
```

### ReadingCircle.ReadingDiscussion.ChooseReading#2

Authored path: `ReadingCircle.ReadingDiscussion.ChooseReading`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 10.

```reaction
when Selecting.choose (item: reading, scope: circle, selection), asked by ReadingCircle.ReadingDiscussion.ChooseReading
where
  earlier, RequestBoundary.request (circle, path: "/circles/choose", reading, requestId)
then
  RequestBoundary.respond (reading, requestId)
```

### ReadingCircle.ReadingDiscussion.RejectNonmemberResponse

Authored path: `ReadingCircle.ReadingDiscussion.RejectNonmemberResponse`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 16.

```reaction
when RequestBoundary.request (circle, member, path: "/circles/respond", reading, requestId, text)
where
  view "(member) may not respond in (circle)" with (circle, member)
then
  RequestBoundary.respond (error: "NOT_A_MEMBER", requestId)
```

### ReadingCircle.ReadingDiscussion.SelectedReadingOpensDiscussion

Authored path: `ReadingCircle.ReadingDiscussion.SelectedReadingOpensDiscussion`.
- Covered by [Reading Circle](../design/compositions/ReadingCircle.md), line 11.

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
