# Example applications

Each example is a complete private TypeScript package with its own concepts,
specifications, composition, tests, generated contracts, and package scripts.
The directories are independently installable; no example imports source from
another. Each example declares its requirements in `package.json` and follows
the repository [support policy](../SUPPORT.md).

| Example                                      | Use it to study                                                                                                                         |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Reading Circle](reading-circle/README.md)   | The shortest complete multi-concept application: one composition module, policy views, one page former, endpoints, gateway, and client  |
| [Operations Room](operations-room/README.md) | A modular composition: selectable reaction packs, replaceable policy, implementation overrides, staged formers, and a nested dashboard  |
| [Message Board](message-board/README.md)     | Complete same-origin web app with independent concepts, authentication, secure cookies, typed HTTP, runtime validation, and a real host |

Start with Reading Circle when learning the complete request lifecycle. Use
Operations Room after the basic concept, reaction, view, former, and endpoint
roles are familiar. Use Message Board to study a complete public transport and
browser-session boundary.

## Same concepts, different applications

Reading Circle and Operations Room assign different application meanings to the
same three concept designs. Each example contains its own standalone copy;
neither imports source from the other. Operations Room adds Alerting.

| Concept        | Reading Circle role                  | Operations Room role                            |
| -------------- | ------------------------------------ | ----------------------------------------------- |
| **Gathering**  | A circle, its host, and its members  | An incident room, its host, and its responders  |
| **Selecting**  | The circle's current reading         | The room's current mitigation                   |
| **Discussing** | Responses about one selected reading | Responder updates about one selected mitigation |
| **Alerting**   | Not used                             | Each responder's open mitigation alerts         |

In Reading Circle and the default Operations Room composition, a Selecting
choice opens a Discussing discussion. Reading Circle fixes one membership policy
for responses. Operations Room makes that policy replaceable and can also alert
every responder when a mitigation is selected. The concepts retain the same
independent behavior; composition gives their identities these
application-specific roles and connects their actions.

From any example directory:

```sh
bun install
bun run check
bun run start
```

`check` verifies formatting, types, tests, and pinned artifacts. `start` prints
the deterministic scenario result. Run `bun run artifacts:pin` only when an
intentional composition or contract change requires updated generated files.
