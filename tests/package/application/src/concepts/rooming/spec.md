# Rooming

## Purpose

Open named operations rooms so responders can gather around one incident.

## Principle

Mara opens Checkout latency and receives a room. Opening another room with the
same name is refused because the first room is already open. She closes the
room; a second close is refused because the room is no longer open.

## State

```state
a set of Rooms with
  a name String
```

## Actions

```actions
open (name: String) : return (room: Room), refuse (message: String)
  where no room has name
  then
    add a new room with name
    return room
  where some room has name
  then
    refuse "A room with this name is already open."

close (room: Room) : return (), refuse (message: String)
  where room in rooms
  then
    delete room
    return
  where room not in rooms
  then
    refuse "This room is not open."
```

`_get` answers zero or one room for an identity.
