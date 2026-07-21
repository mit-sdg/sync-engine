# Stitch — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### Work

**Purpose.** _[unwritten in the registered concept specification]_

**Principle.** _[unwritten in the registered concept specification]_

Actions:

- `add (title, priority)` — may refuse `EMPTY_TITLE`
- `activate (id)` — may refuse `NOT_FOUND`, `ALREADY_DONE`, `ALREADY_ACTIVE`
- `pause (id)`
- `complete (id)` — may refuse `NOT_FOUND`, `ALREADY_DONE`

Queries (standing questions the state answers):

- `_get (id)` — promises at most one row
- `_list ()` — promises any number of rows
- `_snapshot ()` — promises exactly one row

### Focus

**Purpose.** _[unwritten in the registered concept specification]_

**Principle.** _[unwritten in the registered concept specification]_

Actions:

- `begin (item)`
- `finish (item)`

Queries (standing questions the state answers):

- `_current ()` — promises at most one row
- `_snapshot ()` — promises exactly one row

### History

**Purpose.** _[unwritten in the registered concept specification]_

**Principle.** _[unwritten in the registered concept specification]_

Actions:

- `record (verb, item, title)`

Queries (standing questions the state answers):

- `_list ()`
- `_snapshot ()`

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

```view
(item) has focus — inputs (item); outputs (); bindings ()
  where Focus._current () has (item)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

```former
Former "the open queue ()" — inputs (); bindings (id, title, priority, status); promises exactly one record — forms:
  each Work._list () has (id, title, priority, status) and not (status: "done")
    form a record of
      id
      title
      priority
      status
```

```former
Former "the whole queue ()" — inputs (); bindings (id, title, priority, status); promises exactly one record — forms:
  each Work._list () has (id, title, priority, status)
    form a record of
      id
      title
      priority
      status
```

```former
Former "the focus ()" — inputs (); bindings (item, title, priority, status); promises at most one record — forms:
  a record of
    where Focus._current () has (item)
    where Work._get (id: item) has (title, priority, status)
    item
    title
    priority
    status
```

```former
Former "the history ()" — inputs (); bindings (sequence, verb, item, title); promises exactly one record — forms:
  each History._list () has (sequence, verb, item, title)
    arranged by sequence
    form a record of
      sequence
      verb
      item
      title
```

## Reactions

### RecordAdded

```reaction
when Work.add (item, title)
then
  History.record (verb: "added", item, title)
```

### BeginFocus

```reaction
when Work.activate (item)
then
  Focus.begin (item)
```

### RecordStarted

```reaction
when Work.activate (item, title)
then
  History.record (verb: "started", item, title)
```

### PauseDisplacedWork

```reaction
when Focus.begin (previous)
where
  Work._get (id: previous)
then
  Work.pause (id: previous)
```

### RecordPaused

```reaction
when Work.pause (id: item, item, title, changed: true)
then
  History.record (verb: "paused", item, title)
```

### FinishFocusedWork

```reaction
when Work.complete (item)
where
  view "(item) has focus" with (item)
then
  Focus.finish (item)
```

### RecordCompleted

```reaction
when Work.complete (item, title)
then
  History.record (verb: "completed", item, title)
```
