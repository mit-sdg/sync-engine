# Example applications

Each example is a complete private TypeScript package with its own concepts,
specifications, composition, tests, generated contracts, and package scripts.
The directories are independently installable; no example imports source from
another. They require Bun 1.3 or newer.

| Example                                      | Use it to study                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [Reading Circle](reading-circle/README.md)   | The shortest complete multi-concept application: one composition module, policy views, one page former, endpoints, gateway, HTTP, and client |
| [Operations Room](operations-room/README.md) | A modular composition: selectable reaction packs, replaceable policy, implementation overrides, staged formers, and a nested dashboard       |
| [Production HTTP](production-http/README.md) | Registered public-error projection with and without same-origin cookie credentials, correlation, base paths, and projected generated wire    |

Start with Reading Circle when learning the complete request lifecycle. Use
Operations Room after the basic concept, reaction, view, former, and endpoint
roles are familiar. Use Production HTTP when selecting a public transport
boundary.

From either example directory:

```sh
bun install
bun run check
bun run start
```

`check` verifies formatting, types, tests, and pinned artifacts. `start` prints
the deterministic scenario result. Run `bun run artifacts:pin` only when an
intentional composition or contract change requires updated generated files.

From the repository root:

```sh
bun install
bun run example
bun run example:operations
bun run example:http
bun run scenario
```

The first three commands run one scenario. `scenario` runs all registered
examples.
