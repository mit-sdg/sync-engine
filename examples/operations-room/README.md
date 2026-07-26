# Operations Room

An independently installable incident-response example with selectable alert
and discussion packs, swappable contribution policy, and a composed dashboard.

## Commands

Run every command from this directory:

```sh
bun install
bun start
bun test
bun run typecheck
bun run artifacts:check
bun run check
```

Use `bun run artifacts:pin` only when intentionally regenerating the pinned
read-back and wire contract.

## Source Map

| Path                                                           | Role                                                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `src/concepts/`                                                | Vendored Alerting, Discussing, Gathering, and Selecting concepts, specifications, and principle tests |
| `src/support/`                                                 | Deterministic identities and floor context                                                            |
| `src/composition/`                                             | Room formers, endpoints, optional reaction packs, and contribution policies                           |
| `src/assembly.ts`                                              | Application assembly and selectable options                                                           |
| `src/edge.ts`                                                  | Gateway and HTTP wiring                                                                               |
| `src/client.ts`                                                | Typed client factories                                                                                |
| `src/scenario.ts`                                              | Runnable end-to-end scenario                                                                          |
| `tests/application.test.ts`                                    | Full application and HTTP coverage                                                                    |
| `generated.config.ts`                                          | Artifact command configuration                                                                        |
| [`generated/operations-room.md`](generated/operations-room.md) | Pinned assembled read-back                                                                            |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned TypeScript wire contract                                                                       |
