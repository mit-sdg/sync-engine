# Operations room application types

Mitigating refers to rooms created by Rooming instead of defining a second room
identity. The binding keeps mitigation history attached to the same identity
that callers receive when a room opens.

```instances
instantiate Rooming
instantiate Mitigating
```

```bindings
Mitigating.Room is Rooming.Room
  A mitigation selection belongs to an operations room opened by Rooming.
```
