# Operations Room Application Types

People host and join rooms, contribute to discussions, and receive alerts under
one shared application identity. A mitigation is an application-supplied option;
selecting one creates the identity used by discussion and alert subjects.

The bindings preserve these application decisions:

- Hosts and room members are operations-room people.
- Each room has its own current mitigation.
- The selectable items are incident mitigations.
- A discussion belongs to one particular mitigation selection.
- Discussion responses are authored by operations-room people.
- Alert recipients are operations-room people.
- An alert identifies the mitigation selection that raised it.

```types
concrete Person
  A responder identity supplied to the operations room.

concrete Mitigation
  An incident response option that a room may select.
```

```instances
instantiate Gathering with
  Person is Person

instantiate Selecting with
  Scope is Gathering.Gathering
  Item is Mitigation

instantiate Discussing with
  Subject is Selecting.Selection
  Person is Person

instantiate Alerting with
  Person is Person
  Subject is Selecting.Selection
```
