# Operations room application types

Mitigating refers to rooms created by Rooming instead of defining a second room
identity. A mitigation selection belongs to an operations room opened by Rooming.
The binding keeps mitigation history attached to the same identity that callers
receive when a room opens.

```instances
instantiate Rooming

instantiate Mitigating with
  Room is Rooming.Room
```
