# Reading Circle

A book club app where members join reading circles, choose books, and
discuss them. Policy views admit members to discussions and block non-members
with a clear refusal.

Install and run from this directory:

```sh
bun install
bun start
```

The scenario creates a circle, adds members, chooses a book, records
responses, and prints both the full circle page and the refusals.

**What it demonstrates:**

- Local concept registration for Gathering, Selecting, and Discussing
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

- `src/concepts/*/`: concept implementations, principle tests, and specs
- `src/concept-set.ts`, `src/identities.ts`: concept registration and deterministic identity support
- `src/composition/reading-circle.ts`: reactions, views, formers, and boundaries
- `src/assembly.ts`, `src/edge.ts`, `src/client.ts`: assembly and boundary wiring
- `src/scenario.ts`: complete local-gateway story
- `tests/application.test.ts`: full application and boundary tests
- `generated.config.ts`: artifact command configuration
- [`generated/reading-circle.md`](generated/reading-circle.md): pinned assembled read-back
- [`generated/wire.ts`](generated/wire.ts): pinned TypeScript wire contract

## Commands

```sh
bun start
bun test
bun run typecheck
bun run artifacts:check
bun run check
```

Use `bun run artifacts:pin` to intentionally regenerate the pinned files.
