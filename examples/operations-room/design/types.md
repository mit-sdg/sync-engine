# Operations Room Application Types

People host and join rooms, contribute to discussions, and receive alerts under
one shared application identity. A mitigation is an application-supplied option;
selecting one creates the identity used by discussion and alert subjects.

```types
concrete Person
  A responder identity supplied to the operations room.

concrete Mitigation
  An incident response option that a room may select.
```

```instances
instantiate Gathering
instantiate Selecting
instantiate Discussing
instantiate Alerting
```

```bindings
Gathering.Person is Person
  Hosts and room members are operations-room people.

Selecting.Scope is Gathering.Gathering
  Each room has its own current mitigation.

Selecting.Item is Mitigation
  The selectable items are incident mitigations.

Discussing.Subject is Selecting.Selection
  A discussion belongs to one particular mitigation selection.

Discussing.Person is Person
  Discussion responses are authored by operations-room people.

Alerting.Person is Person
  Alert recipients are operations-room people.

Alerting.Subject is Selecting.Selection
  An alert identifies the mitigation selection that raised it.
```
