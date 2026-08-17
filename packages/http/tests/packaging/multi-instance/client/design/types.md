# Multi-instance application types

The entry, observation, and fault contracts refer to the same caller-supplied
domain operation identity.

The bindings preserve these contract decisions:

- Entry idempotency is scoped to the initiating operation.
- Observations retain the operation that caused the entry action.
- Requested faults remain associated with the initiating operation.

```types
concrete OperationId
  A stable identifier supplied by the domain operation initiating a request.
```

```instances
instantiate Entries
instantiate Effects
instantiate Faulting
```

```bindings
Entries.Operation is OperationId
Effects.Operation is OperationId
Faulting.Operation is OperationId
```
