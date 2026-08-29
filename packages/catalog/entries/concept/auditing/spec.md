# Auditing

## Purpose

Keep a permanent numbered record of who did what to which target, so past activity
can be attributed and read back afterwards instead of being reconstructed from state
that shows only its current values.

## Principle

Trail `workspace-1` starts with no entries. Recording event `evt-1`, in which actor
`ari` did "reservation.hold" to target `slot-4`, places it at position 1, and event
`evt-2` from actor `bo` follows at position 2. Reading from position 0 returns both in that
order, reading target `slot-4` returns only Ari's entry, and the trail reports 2
entries ending at position 2. Replaying `evt-1` returns the entry already at position
1 instead of adding a third, and replaying `evt-1` against another target is
refused.

## Types

```types
external Trail
  The record to which entries belong.
external Event
  The idempotency identity of a recorded event.
external Actor
  The identity attributed with an action.
external Target
  The object affected by an action.
```

## State

```state
a set of Entries with
  a trail Trail
  a position Position
  an event Event
  an actor Actor
  an action String
  a detail String
  a target Target
  a recordedAt DateTime
  unique trail and event

Rule: within one Trail the positions are 1 through the number of Entries
```

## Actions

```actions
record (trail: Trail, event: Event, actor: Actor, action: String, detail: String, target: Target, at: DateTime) : return (entry: Entry, position: Position)
  where action is blank or longer than 100 characters
  then
    refuse INVALID_ENTRY_ACTION "An entry action must not be blank and must be at most 100 characters."
  where detail is longer than 500 characters
  then
    refuse INVALID_ENTRY_DETAIL "An entry detail must be at most 500 characters."
  where an Entry in trail has event with the same actor, action, detail, and target
  then
    bind entry and position to that Entry and its position
    return entry, position
  where an Entry in trail has event with a different actor, action, detail, or target
  then
    refuse ENTRY_EVENT_CONFLICT "This event is already recorded in this trail with different facts."
  where action and detail are accepted and no Entry in trail has event
  then
    add a new Entry with trail, event, actor, action, detail, target, and recordedAt at, taking the position after the last Entry in trail and 1 in an empty trail
    return entry, position
```

## Queries

```queries
_get (entry: Entry) : optional (trail: Trail, position: Position, event: Event, actor: Actor, action: String, detail: String, target: Target, recordedAt: DateTime)
  answers the Entry's Trail, position, event, actor, action, detail, target, and recorded time
  answers no row for an unknown Entry
_since (trail: Trail, after: Position) : many (entry: Entry, position: Position, event: Event, actor: Actor, action: String, detail: String, target: Target, recordedAt: DateTime)
  answers the Entries of the Trail above position after, so 0 answers every Entry
  answers no rows when the Trail has no Entry above after
  orders rows by position
_byActor (trail: Trail, actor: Actor) : many (entry: Entry, position: Position, event: Event, action: String, detail: String, target: Target, recordedAt: DateTime)
  answers the Actor's Entries in the Trail with their positions, events, actions, details, targets, and recorded times
  answers no rows when the Actor has no Entries in the Trail
  orders rows by position
_forTarget (trail: Trail, target: Target) : many (entry: Entry, position: Position, event: Event, actor: Actor, action: String, detail: String, recordedAt: DateTime)
  answers the Target's Entries in the Trail with their positions, events, actors, actions, details, and recorded times
  answers no rows when the Target has no Entries in the Trail
  orders rows by position
_extent (trail: Trail) : one (entries: Count, last: Position)
  answers the Trail's Entry count and last position
  answers entries 0 and last 0 for a Trail with no Entries
```
