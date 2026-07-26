# Examples

Each application is a complete, independently installable TypeScript project.
Its directory contains its concepts, specifications, support code, tests,
configuration, generated contracts, and package scripts. Copy either directory
without the rest of this repository and it remains runnable.

- [Reading Circle](reading-circle/README.md) keeps reactions, policy views,
  formers, and endpoints together for the shortest complete example.
- [Operations Room](operations-room/README.md) separates composition into
  selectable reaction packs, swappable policy, endpoints, and staged formers.

From an example directory, `bun install && bun run check` verifies formatting,
types, tests, and pinned artifacts; `bun start` runs its scenario. From the
repository root:

```sh
bun run example               # reading circle
bun run example:operations    # operations room
bun run scenario              # both
```
