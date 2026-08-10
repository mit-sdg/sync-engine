# Reading Circle

Reading Circle is the shortest complete multi-concept example. Members create
and join circles, select a reading, and discuss it. The application keeps its
reactions, policy views, formers, and endpoints in one composition module so
the whole design can be read in one place. Runtime and toolchain requirements
are declared in `package.json` and the repository [support policy](../../SUPPORT.md).

## Run the example

Run these commands from this directory:

```sh
bun install
bun run check
bun run start
```

The deterministic scenario creates the `after-dinner` circle for Mara, joins
Lin, chooses _The Dispossessed_, records a response, and reads the complete
circle page. It also returns the `ALREADY_JOINED` concept refusal and the
`NOT_A_MEMBER` authored policy response.

## What the example establishes

- Gathering, Selecting, and Discussing remain independently registered.
- Choosing a reading opens its discussion through a reaction.
- `memberMayRespond` and `nonmemberMayNotRespond` express opposite policy cases
  without changing a concept implementation.
- A former joins circle, selection, discussion, and response state into one
  page value.
- Endpoints expose the application through the standard gateway, local client,
  and generated wire contract. Public HTTP behavior belongs in an `HttpPolicy`;
  add its optional cookie policy only when the boundary binds a cookie input.
- Principle tests exercise each concept directly; application tests exercise
  the assembled boundary.

## Source map

| Path                                                         | Role                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/concepts/*/`                                            | Concept specifications, implementations, registries, and principle tests |
| `src/concept-set.ts`                                         | Named registrations, vocabulary, and implementations                     |
| `src/composition/reading-circle.ts`                          | Reactions, views, former, and endpoints                                  |
| `src/assembly.ts`                                            | Application assembly                                                     |
| `src/edge.ts`                                                | Standard gateway                                                         |
| `src/client.ts`                                              | Transport-neutral generated-contract client helper                       |
| `src/scenario.ts`                                            | Complete local-gateway scenario                                          |
| `tests/application.test.ts`                                  | Assembled behavior and deterministic snapshot tests                      |
| `generated.config.ts`                                        | Artifact command configuration                                           |
| [`generated/reading-circle.md`](generated/reading-circle.md) | Pinned assembled read-back                                               |
| [`generated/wire.ts`](generated/wire.ts)                     | Pinned TypeScript wire contract                                          |

## Individual checks

Use these commands to isolate a failed aggregate check:

```sh
bun run test
bun run typecheck
bun run artifacts:check
```

`artifacts:check` is silent on success. To update both generated files after an
intentional source change, run `bun run artifacts:pin` and review the diff.

Continue with the [read construction cookbook](../../docs/user/guide/read-construction.md) for small reading
constructions or [Execution semantics](../../docs/user/reference/semantics.md) for the runtime
contract.
