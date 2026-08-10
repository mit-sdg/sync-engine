# Operations Room

Operations Room coordinates an incident response. A host creates a room,
responders join it, the room selects a mitigation, responders discuss that
mitigation, and each responder receives an alert. The room dashboard combines
the roster, current mitigation, discussion, updates, and open alerts.

The deterministic scenario creates the `checkout-latency` room for Mara, joins
Lin, selects `rollback-build-842`, and records Lin's update. With the default
composition, selecting the mitigation opens `discussion-1` and raises one alert
for Mara and one for Lin. Lin's second attempt to join returns
`ALREADY_JOINED`.

## Run the example

From this directory:

```sh
bun install
bun run check
bun run start
```

`start` prints the deterministic scenario result. `check` verifies formatting,
types, tests, and pinned generated artifacts.

## How the application is composed

Operations Room gives four independent concepts application-specific roles:

- **Gathering** stores the incident room's name, host, and responders.
- **Selecting** stores the room's current mitigation.
- **Discussing** stores responder updates about a selected mitigation.
- **Alerting** stores each responder's open mitigation alerts.

This example's Alerting concept is a tutorial variant of the
[catalog Alerting contract](https://github.com/mit-sdg/sync-engine/blob/main/packages/catalog/entries/concept/alerting/spec.md).
It omits the catalog contract's caller-supplied `Cause`, so each repeated `raise`
creates another alert instead of returning an existing alert.

Selecting a mitigation can trigger two independent reaction packs. The
discussion pack opens a discussion whose subject is the new selection. The alert
pack raises an alert for every current room member. `roomDashboard` joins each
discussion and alert to its Selecting selection, then renders the corresponding
mitigation.

Contribution policy is also replaceable. The default `responders` policy lets
any room member contribute an update and returns `RESPONDERS_ONLY` for a
nonmember. The `host` policy accepts only the room host and returns `HOST_ONLY`
for another responder. Both policies use the same `/rooms/contribute` endpoint
declaration and leave the concept implementations unchanged.

## Assembly options

`assembleOperationsRoom(options?)` creates a new application for each call.
Changing an option does not reconfigure an existing assembly.

| Option          | Default        | Observable effect                                                                   |
| --------------- | -------------- | ----------------------------------------------------------------------------------- |
| `alerts`        | `true`         | Selecting a mitigation raises one alert for each current responder                  |
| `discussion`    | `true`         | Selecting a mitigation opens the discussion required for contributions              |
| `contributions` | `"responders"` | Choose member-based or host-only contribution policy and its denial response        |
| `instances`     | `{}`           | Replace selected concept instances by name, primarily for tests or host integration |

Disabling alerts leaves each responder's dashboard alert list empty. Disabling
discussion leaves the current mitigation visible but provides no open discussion
for contributions. The application tests compare these variants without
changing the four concept classes.

## Source map

| Path                                                           | Role                                                                                  |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/concepts/`                                                | Independent concept specifications, implementations, registries, and principle tests  |
| `src/concept-set.ts`                                           | Named registrations, vocabulary, default implementations, and deterministic instances |
| `src/composition/packs.ts`                                     | Optional discussion and alert reactions                                               |
| `src/composition/responders-may-contribute.ts`                 | Default member-based contribution policy                                              |
| `src/composition/host-may-contribute.ts`                       | Replacement host-only contribution policy                                             |
| `src/composition/room.ts`                                      | Room endpoints and staged dashboard formers                                           |
| `src/composition/contributions.ts`                             | Policy-parameterized contribution endpoints                                           |
| `src/assembly.ts`                                              | Reaction, policy, and implementation selection                                        |
| `src/edge.ts`                                                  | Standard gateway                                                                      |
| `src/client.ts`                                                | Transport-neutral generated-contract client helper                                    |
| `src/scenario.ts`                                              | Complete local-gateway workflow                                                       |
| `tests/application.test.ts`                                    | Default workflow, reaction-pack, policy, former, and client behavior                  |
| `generated.config.ts`                                          | Artifact command configuration                                                        |
| [`generated/operations-room.md`](generated/operations-room.md) | Pinned assembled read-back                                                            |
| [`generated/wire.ts`](generated/wire.ts)                       | Pinned TypeScript wire contract                                                       |

## Individual checks

```sh
bun run test
bun run typecheck
bun run artifacts:check
```

Run `bun run artifacts:pin` only after an intentional composition,
specification, or contract change, then review both generated files.

The [application authoring guide](../../docs/user/guide/authoring.md) follows
this example from concept registration through modular composition, assembly,
generation, and a typed client.
