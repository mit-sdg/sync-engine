# Multi-instance request behavior

The client contract [creates an entry](reaction:CreateEntry) and reports the committed identity. A retry with the same operation observes that same result through the [instance-local creation effect](reaction:RecordCreation).

```endpoints
CreateEntry at /entries/create
```

The fault scenario [creates an entry before exercising an unexpected failure](reaction:CreateThenFault), allowing the backend fixture to verify that the earlier action remains committed.

```endpoints
CreateThenFault at /entries/create-then-fault
```
