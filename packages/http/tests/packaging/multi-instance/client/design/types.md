# Multi-instance application types

The entry, observation, and fault contracts refer to the same caller-supplied domain operation identity.

```types
concrete OperationId
  A stable identifier supplied by the domain operation initiating a request.

Entries.Operation is OperationId
  Entry idempotency is scoped to the initiating operation.

Effects.Operation is OperationId
  Observations retain the operation that caused the entry action.

Faulting.Operation is OperationId
  Requested faults remain associated with the initiating operation.
```
