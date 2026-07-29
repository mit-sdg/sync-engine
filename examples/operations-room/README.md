# Operations Room

Operations Room is a modular incident-response example. It combines Gathering,
Selecting, Discussing, and Alerting while keeping reaction packs, contribution
policy, and concept implementation overrides selectable at assembly time. Its
formers build a nested dashboard. Runtime and toolchain requirements are declared
in `package.json` and the repository [support policy](../../SUPPORT.md).

## Run the example

Run these commands from this directory:

```sh
bun install
bun run check
bun run start
```

The deterministic scenario creates the `checkout-latency` room for Mara, joins
Lin, observes an `ALREADY_JOINED` refusal, selects
`rollback-build-842`, contributes one update, and reads the dashboard. With the
default composition, selecting the mitigation opens `discussion-1` and raises
one alert for each responder.

## Assembly options

`assembleOperationsRoom(options?)` creates a new application for each call.
Changing an option does not reconfigure an existing assembly.

| Option          | Default        | Effect                                                                              |
| --------------- | -------------- | ----------------------------------------------------------------------------------- |
| `alerts`        | `true`         | Include `SelectedMitigationAlertsResponders`                                        |
| `discussion`    | `true`         | Include `SelectedMitigationOpensDiscussion`                                         |
| `contributions` | `"responders"` | Select responder or host-only contribution views and denial response                |
| `instances`     | `{}`           | Replace selected concept instances by name, primarily for tests or host integration |

The application tests compare these options. Disabling packs changes the
resulting alerts or discussion without changing concept classes. Selecting the
host-only policy rejects Lin's contribution with `HOST_ONLY` while leaving the
endpoint declaration unchanged.

## Source map

| Path                                                           | Role                                                                                                            |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/concepts/`                                                | Alerting, Discussing, Gathering, and Selecting specifications, implementations, registries, and principle tests |
| `src/concept-set.ts`                                           | Named registrations, vocabulary, default implementations, and the deterministic floor                           |
| `src/composition/packs.ts`                                     | Optional discussion and alert reaction packs                                                                    |
| `src/composition/responders-may-contribute.ts`                 | Default contribution policy                                                                                     |
| `src/composition/host-may-contribute.ts`                       | Replacement host-only policy                                                                                    |
| `src/composition/room.ts`                                      | Room endpoints and staged formers                                                                               |
| `src/composition/contributions.ts`                             | Policy-parameterized contribution endpoints                                                                     |
| `src/assembly.ts`                                              | Composition and implementation selection                                                                        |
| `src/edge.ts`                                                  | Standard gateway                                                                                                |
| `src/client.ts`                                                | Transport-neutral generated-contract client helper                                                              |
| `src/scenario.ts`                                              | End-to-end local scenario                                                                                       |
| `tests/application.test.ts`                                    | Default, pack, policy, and client behavior                                                                      |
| `generated.config.ts`                                          | Artifact command configuration                                                                                  |
| [`generated/operations-room.md`](generated/operations-room.md) | Pinned assembled read-back                                                                                      |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned TypeScript wire contract                                                                                 |

## Individual checks

Use these commands to isolate a failed aggregate check:

```sh
bun run test
bun run typecheck
bun run artifacts:check
```

Run `bun run artifacts:pin` only after an intentional composition or contract
change. Review both generated diffs.

The authoring case study starts with [Define one
behavior](../../docs/guide/concepts.md), then continues through [Connect
independent behaviors](../../docs/guide/reactions.md), [Views and
formers](../../docs/guide/views-and-formers.md), then [Application
boundary](../../docs/guide/application-boundary.md).
