# Reading Circle Application Types

People host and join circles and author discussion responses under one shared
application identity. A reading is supplied by the application; selecting it
creates the identity to which its discussion is attached.

```types
concrete Person
  A person who may host or join a reading circle.

concrete Reading
  A work that a circle may choose for discussion.
```

```instances
instantiate Gathering
instantiate Selecting
instantiate Discussing
```

```bindings
Gathering.Person is Person
  Circle hosts and members are reading-circle people.

Selecting.Scope is Gathering.Gathering
  Each circle has its own current reading.

Selecting.Item is Reading
  The selectable items are readings.

Discussing.Subject is Selecting.Selection
  A discussion belongs to one particular reading selection.

Discussing.Person is Person
  Discussion responses are authored by reading-circle people.
```
