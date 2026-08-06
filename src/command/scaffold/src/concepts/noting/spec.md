# Noting

## Purpose

Keep short notes so a thought outlives the moment it arrived in.

## Principle

Ada writes "buy milk" and receives a note. She reads it back by its identity.
Discarding it removes it; discarding it again is refused because it is gone.

## Types

`Note` is an opaque identity allocated when a note is written.

## State

```state
a set of Notes with
  a text String
```

## Actions

```actions
write (text: String) : return (note: Note)
  then
    add a new note with text
    return note

discard (note: Note) : return (note: Note)
  where note not in notes
  then
    refuse NOTE_NOT_FOUND "There is no such note."
  where note in notes
  then
    delete note
    return note
```

## Queries

```queries
_get (note: Note) : optional (text: String)
  answers no row for an unknown Note
```

## Scope

Noting does not decide what a note means or who may read it.
