# Workshop Selection

A workshop gathers members around one current item while keeping membership and selection under their respective concept owners.

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
