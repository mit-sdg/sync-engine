# Operations Room

An incident-response app with selectable reaction packs, swappable policy,
and a full dashboard. Choose between host-only or responder-contribution
models.

**Run it:**

```sh
bun start
```

The scenario reports an incident, opens a discussion, lets responders
contribute mitigations, and prints the dashboard.

**What it demonstrates:**

- **Reaction packs** — optional behaviors (alerts, discussion) toggled via
  assembly options
- **Swappable policy** — two implementations of the same contribution-policy
  view (`host-may-contribute` and `responders-may-contribute`)
- **Parameterized endpoints** — factory functions that accept policy views as
  arguments
- **Staged formers** — `currentMitigation` (optional), `requiredCurrentMitigation`
  (required), `responseStats` (aggregation with `each`, `count`, `distinct`)
- **Fragment splicing** — `roomSummary` splices `responderRoster` so each
  fragment stays independently typed and testable

## Files

| File                                                           | Role                                             |
| -------------------------------------------------------------- | ------------------------------------------------ |
| `src/scenario.ts`                                              | Entry point — runs through a local gateway       |
| `src/concept-set.ts`                                           | Vocabulary, refs, and implementations            |
| `src/composition/room.ts`                                      | Formers and room endpoints                       |
| `src/composition/packs.ts`                                     | Optional reaction packs (alerts, discussion)     |
| `src/composition/contributions.ts`                             | Parameterized contribution endpoints             |
| `src/composition/host-may-contribute.ts`                       | Policy: only the incident host may contribute    |
| `src/composition/responders-may-contribute.ts`                 | Policy: any responder may contribute             |
| `src/assembly.ts`                                              | `assemble()` with `OperationsRoomOptions`        |
| `src/edge.ts`                                                  | Gateway and HTTP wiring                          |
| `src/client.ts`                                                | Typed client factories                           |
| `generated.config.ts`                                          | CLI artifact commands                            |
| [`generated/operations-room.md`](generated/operations-room.md) | Assembled read-back (concepts, views, reactions) |
| [`generated/wire.ts`](generated/wire.ts)                       | Generated TypeScript wire contract               |
| [`generated/README.md`](generated/README.md)                   | Provenance and regeneration notes                |

## Check Artifacts

```sh
cd ../.. && bun run build && bun scripts/examples.ts check operationsRoom
```

Use `bun scripts/examples.ts pin operationsRoom` instead of `check` to
regenerate the pinned files intentionally.
