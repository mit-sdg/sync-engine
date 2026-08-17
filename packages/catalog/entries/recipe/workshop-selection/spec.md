# Workshop Selection

A workshop gathers members around one current item while keeping membership and selection under their respective concept owners.

## Application types and instances

```types
concrete Person
  A workshop participant identity supplied by the application.

concrete WorkshopItem
  An item that a workshop may select.
```

```instances
instantiate Gathering with
  Person is Person

instantiate Selecting with
  Scope is Gathering.Gathering
  Item is WorkshopItem
```

## Compositions

### WorkshopMembership

A host creates a workshop as its first member, and other people may join it. Host and member identities are attribution unless the application binds them to authenticated callers.

### WorkshopSelection

A known workshop may choose one current item. An unknown workshop returns `GATHERING_NOT_FOUND` without changing Selecting; concept refusals retain their own codes.

### WorkshopPages

Opening a workshop presents its name, host, and current item together.

## Formers

### Workshop

The workshop read combines Gathering details with the optional current Selection for the same workshop identity.
