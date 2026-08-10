# Example applications

Each example is a complete private TypeScript package with its own concepts,
specifications, composition, tests, generated contracts, and package scripts.
The directories are independently installable; no example imports source from
another. Each example declares its requirements in `package.json` and follows
the repository [support policy](../SUPPORT.md).

| Example                                      | Use it to study                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| [Reading Circle](reading-circle/README.md)   | The shortest complete multi-concept application: one composition module, policy views, one page former, endpoints, gateway, and client      |
| [Operations Room](operations-room/README.md) | A modular composition: selectable reaction packs, replaceable policy, implementation overrides, staged formers, and a nested dashboard      |
| [Message board](message-board/README.md)     | Complete same-origin browser app with independent concepts, authentication, secure cookies, typed HTTP, runtime validation, and a real host |

Start with Reading Circle when learning the complete request lifecycle. Use
Operations Room after the basic concept, reaction, view, former, and endpoint
roles are familiar. Use Message board to study a complete public transport and
browser-session boundary.

From any example directory:

```sh
bun install
bun run check
bun run start
```

`check` verifies formatting, types, tests, and pinned artifacts. `start` prints
the deterministic scenario result. Run `bun run artifacts:pin` only when an
intentional composition or contract change requires updated generated files.
