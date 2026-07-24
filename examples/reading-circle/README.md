# Reading Circle

A book club app where members join reading circles, choose books, and
discuss them. Policy views admit members to discussions and block non-members
with a clear refusal.

**Run it:**

```sh
bun start
```

The scenario creates a circle, adds members, chooses a book, records
responses, and prints both the full circle page and the refusals.

**What it demonstrates:**

- Concept registration from shared domain concepts (Gathering, Selecting,
  Discussing)
- Reaction-based composition — choosing a book opens its discussion
  automatically
- Policy views (`memberMayRespond`, `nonmemberMayNotRespond`) — access
  control as declarative conditions
- Boundary declarations (`endpoint`, `receive`, `respond`) — typed
  request/response contracts
- A gateway that admits calls through a generated wire contract
- A typed client created from the wire contract
- A whole-page former that stitches the circle state, reading, and
  discussion into one view

## Files

| File                                                         | Role                                                       |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `src/scenario.ts`                                            | Entry point — runs the full story through a local gateway  |
| `src/concept-set.ts`                                         | Exposes the vocabulary, refs, and implementations          |
| `src/composition/reading-circle.ts`                          | Reactions, policy views, formers, and boundary definitions |
| `src/assembly.ts`                                            | The single `assemble()` call with optional overrides       |
| `src/edge.ts`                                                | Gateway wiring and HTTP handler                            |
| `src/client.ts`                                              | Typed client factories                                     |
| `generated.config.ts`                                        | Instructions for the `sync-engine` CLI artifact commands   |
| [`generated/reading-circle.md`](generated/reading-circle.md) | Assembled read-back (concepts, views, reactions)           |
| [`generated/wire.ts`](generated/wire.ts)                     | Generated TypeScript wire contract                         |
| [`generated/README.md`](generated/README.md)                 | Provenance and regeneration notes                          |

## Regenerate artifacts

```sh
cd ../.. && bun run build && bun scripts/examples.ts check readingCircle
```
