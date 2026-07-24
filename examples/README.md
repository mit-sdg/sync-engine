# Examples

Two complete applications that demonstrate the engine surface end to end.
Each is a standalone TypeScript project — `cd` in and `bun start`.

- [Reading Circle](reading-circle/README.md) — a book club app. Members join
  circles, choose books, and discuss them. Policy views gate membership.
  Everything lives in one composition file — reactions, views, formers, and
  boundary declarations side by side. Start here for the shortest path
  through the full design.
- [Operations Room](operations-room/README.md) — an incident-response app
  with selectable reaction packs, swappable contribution policy, and a
  dashboard built from staged formers. Each concern (policy, packs,
  endpoints, formers) has its own module. Start here to see modular
  composition at scale.

## Shared concepts

Both applications use the same four domain concepts under
[`concepts/`](concepts/). Each concept is a standalone behavior with its own
specification, implementation, error classes, test, and registry. The
[concept authoring guide](concepts/README.md) explains the discipline.

## Shared support

[`support/identities.ts`](support/identities.ts) provides deterministic IDs
for stable scenario output. [`support/deterministic-floor.ts`](support/deterministic-floor.ts)
types the identity factory each concept receives.
[`text.d.ts`](text.d.ts) lets TypeScript import `.md` files as strings so
concept registries can carry their specifications into generated read-backs.

## Monorepo scripts

From the repo root, these commands build the engine and run each example:

```sh
bun run example               # reading circle
bun run example:operations    # operations room
bun run scenario              # both
```
