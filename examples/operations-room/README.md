# Operations Room

An independently installable incident-response example with selectable alert
and discussion packs, swappable contribution policy, and a composed dashboard.

The scenario creates an incident room, joins a responder, observes a duplicate
join refusal, selects a rollback, contributes an update, and reads the composed
dashboard. With the defaults, selecting the rollback also opens a discussion
and alerts the responders.

## Assembly Options

`assembleOperationsRoom` accepts:

| Option          | Default        | Selects                                                     |
| --------------- | -------------- | ----------------------------------------------------------- |
| `alerts`        | `true`         | The responder-alert reaction pack                           |
| `discussion`    | `true`         | The mitigation-discussion reaction pack                     |
| `contributions` | `"responders"` | Responder or host-only contribution policy                  |
| `instances`     | `{}`           | Concept implementation overrides, useful for tests or hosts |

Follow the relevant guide instead of reading the example as reference prose:

- Reaction packs: [Keep the reaction in the
  composition](../../docs/guide/reactions.md#keep-the-reaction-in-the-composition)
- Swappable policy: [Change the answer, not the
  concepts](../../docs/guide/views-and-formers.md#change-the-answer-not-the-concepts)
- Staged formers: [Build the read in
  stages](../../docs/guide/views-and-formers.md#build-the-read-in-stages)
- Generated artifacts: [Generate the wire
  contract](../../docs/guide/application-boundary.md#generate-the-wire-contract)

## Commands

Run every command from this directory:

```sh
bun install
bun run check
bun start
```

Use `bun run artifacts:pin` only when intentionally regenerating the pinned
read-back and wire contract. Use `bun test`, `bun run typecheck`, or
`bun run artifacts:check` to isolate a failed aggregate check.

## Source Map

| Path                                                           | Role                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/concepts/`                                                | Vendored Alerting, Discussing, Gathering, and Selecting concepts, specifications, and principle tests |
| `src/concept-set.ts`, `src/identities.ts`                      | Concept registration, deterministic floor construction, and identities                                |
| `src/composition/`                                             | Room formers, endpoints, optional reaction packs, and contribution policies                           |
| `src/assembly.ts`                                              | Application assembly and selectable options                                                           |
| `src/edge.ts`                                                  | Gateway and HTTP wiring                                                                               |
| `src/client.ts`                                                | Typed client factories                                                                                |
| `src/scenario.ts`                                              | Runnable end-to-end scenario                                                                          |
| `tests/application.test.ts`                                    | Full application and HTTP coverage                                                                    |
| `generated.config.ts`                                          | Artifact command configuration                                                                        |
| [`generated/operations-room.md`](generated/operations-room.md) | Pinned assembled read-back                                                                            |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned TypeScript wire contract                                                                       |
