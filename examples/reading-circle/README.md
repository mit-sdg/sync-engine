# Reading Circle

Reading Circle is a small application for discussing a shared reading. A host
creates a circle, members join it, the circle chooses its current reading, and
members post responses. Opening the circle page returns the roster, current
reading, and responses as one value.

The deterministic scenario creates the `after-dinner` circle for Mara, joins
Lin, chooses _The Dispossessed_, and records Lin's response. It also shows two
rejections: Lin cannot join twice, and Niko cannot respond without joining.

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

Reading Circle gives three independent concepts application-specific roles:

- **Gathering** stores the circle's name, host, and members.
- **Selecting** stores the circle's current reading.
- **Discussing** stores responses about a selected reading.

Each selection identifies a separate discussion. Choosing the same reading text
in two circles therefore does not combine their responses.

The composition in `src/composition/reading-circle.ts` connects them. When
Selecting chooses a reading, a reaction opens a Discussing discussion for that
selection. Two policy views divide response requests: a member may respond, while
a nonmember receives `NOT_A_MEMBER`. The `circlePage` former joins the three
concepts into the page returned by `/circles/page`.

The endpoints expose this workflow through the standard gateway and generated
client contract:

1. `/circles/create` creates the circle and makes its host the first member.
2. `/circles/join` adds another member.
3. `/circles/choose` selects the current reading and triggers its discussion.
4. `/circles/respond` checks membership and records a response in the current
   reading's discussion.
5. `/circles/page` forms the complete page.

The concepts do not import one another or contain these application-specific
connections. Their specifications and direct tests live under `src/concepts/`;
`tests/application.test.ts` checks the assembled behavior.

## Source map

| Path                                                         | Role                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `src/concepts/*/`                                            | Independent concept specifications, implementations, and principle tests |
| `src/concept-set.ts`                                         | Named registrations, vocabulary, and implementations                     |
| `src/composition/reading-circle.ts`                          | Reading reaction, membership policy, page former, and endpoints          |
| `src/assembly.ts`                                            | Application assembly                                                     |
| `src/edge.ts`                                                | Standard gateway                                                         |
| `src/client.ts`                                              | Transport-neutral generated-contract client helper                       |
| `src/scenario.ts`                                            | Complete local-gateway workflow                                          |
| `tests/application.test.ts`                                  | Assembled behavior and deterministic scenario tests                      |
| `generated.config.ts`                                        | Artifact command configuration                                           |
| [`generated/reading-circle.md`](generated/reading-circle.md) | Pinned assembled read-back                                               |
| [`generated/wire.ts`](generated/wire.ts)                     | Pinned TypeScript wire contract                                          |

## Individual checks

```sh
bun run test
bun run typecheck
bun run artifacts:check
```

Run `bun run artifacts:pin` only after an intentional composition,
specification, or contract change, then review both generated files.

Continue with the [application authoring guide](../../docs/user/guide/authoring.md)
for a progressive construction of this example, or the [read construction
cookbook](../../docs/user/guide/read-construction.md) for smaller former examples.
