# Reading Circle Application Types

People host and join circles and author discussion responses under one shared
application identity. A reading is supplied by the application; selecting it
creates the identity to which its discussion is attached.

The bindings preserve these application decisions:

- Circle hosts and members are reading-circle people.
- Each circle has its own current reading.
- The selectable items are readings.
- A discussion belongs to one particular reading selection.
- Discussion responses are authored by reading-circle people.

```types
concrete Person
  A person who may host or join a reading circle.

concrete Reading
  A work that a circle may choose for discussion.
```

```instances
instantiate Gathering with
  Person is Person

instantiate Selecting with
  Scope is Gathering.Gathering
  Item is Reading

instantiate Discussing with
  Subject is Selecting.Selection
  Person is Person
```
