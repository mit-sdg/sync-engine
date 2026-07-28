# sync-engine

Build TypeScript applications from independent behaviors, then describe how
those behaviors work together without coupling their implementations.

sync-engine calls each independent behavior a **concept**. A concept owns its
state, actions, queries, and errors. An application combines concepts with:

- **reactions**, which connect one action to another;
- **views**, which name shared questions and policy decisions;
- **formers**, which assemble query results into typed values;
- **endpoints**, which expose selected behavior to clients.

The engine validates this composition, executes it, and can generate a readable
description and TypeScript wire contract from the assembled application.

## Install

```sh
bun add @mit-sdg/sync-engine@alpha
```

All CLI commands and shipped TypeScript projects require Bun 1.3 or newer. The
ESM-only library supports Node.js 24 or newer.

Start a project with the package-qualified CLI:

```sh
bunx --package @mit-sdg/sync-engine@alpha sync-engine new operations-room
```

## Alpha Status

sync-engine v1 is alpha and is not recommended for production. Public APIs and
generated files may change incompatibly. For serious evaluation, pin an exact
version such as `@mit-sdg/sync-engine@1.0.0-alpha.0` instead of the moving
`@alpha` tag. See the [operational limits](docs/semantics.md#operational-limits).

### Upgrading Alpha Versions

Alpha releases carry no migration guarantee. Before changing a pinned version,
read the [changelog](CHANGELOG.md) and matching [GitHub
release](https://github.com/mit-sdg/sync-engine/releases); release-specific
migration guidance is published there when available.

## Three Tiers

The examples below build the same operations-room application one layer at a
time. They use package subpaths so each import states which part of the library
it needs.

### Tier 1: One Independent Behavior

Start with a normal TypeScript class. `SelectingConcept` knows how to keep one
current mitigation for each room, but knows nothing about discussions, alerts,
HTTP, or the rest of the application.

```ts
type Selection = { selection: string; scope: string; item: string };

class SelectingConcept {
  private readonly selections = new Map<string, Selection>();
  private readonly current = new Map<string, string>();

  choose({ scope, item }: { scope: string; item: string }) {
    const selection = crypto.randomUUID();
    this.selections.set(selection, { selection, scope, item });
    this.current.set(scope, selection);
    return { selection };
  }

  _current({ scope }: { scope: string }) {
    const selection = this.current.get(scope);
    const found = selection === undefined ? undefined : this.selections.get(selection);
    return found === undefined ? [] : [found];
  }
}
```

Public methods are recorded **actions**. Methods prefixed with `_` are
**queries**: standing questions over current concept state. A registration pairs
the class with its specification and makes both available to assembly. See the
[concept authoring guide](docs/guide/concepts.md) for the complete class,
specification, errors, registry, and principle test.

### Tier 2: Compose Independent Behaviors

The Selecting concept should not import a discussion concept merely because
this application opens a discussion after choosing a mitigation. That decision
belongs in the composition:

```ts
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Discussing, Selecting } = concepts;

export const SelectedMitigationOpensDiscussion = reaction(({ room, selection }) =>
  when(Selecting.choose({ scope: room }).responds({ selection })).then(
    Discussing.open({ subject: selection }),
  ),
);
```

Calling a vocabulary ref produces data, not a runtime action. Here,
`{ scope: room }` reads the `scope` argument from the triggering call and binds
it as `room`. `.responds({ selection })` tells the engine to match after the
action returns and bind `selection` from that return value. Under `then`, the
bare `Discussing.open(...)` is the consequence ask.

Neither concept names the other, so either remains reusable and the
application-level decision remains visible. The engine can read the reaction
back in plain text — a checkable description it generates from the composition,
not syntax you author:

```reaction
when Selecting.choose — opens (room, selection)
then
  Discussing.open (subject: selection)
```

Reactions can also query state, branch, sequence actions, and match refusals.
The [reaction guide](docs/guide/reactions.md) introduces those forms in order;
the [example book](docs/book.md) places close variations beside their exact
read-backs and registration errors.

### Tier 3: Expose a Complete Application

An endpoint is a reaction at the application boundary. This one receives a
request, asks Selecting to choose the mitigation, and returns a typed result:

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "./concept-set.ts";

const { Selecting } = concepts;

export const ChooseMitigation = endpoint(
  "/rooms/choose-mitigation",
  ({ room, mitigation, selection }) =>
    receive({ room, mitigation })
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(respond({ mitigation })),
);
```

Assembly selects concept implementations and composition modules. From that
single value, sync-engine can provide a local gateway, an HTTP handler, a
generated wire contract, and a client whose paths and payloads are inferred:

```ts
const chooseMitigation = operations.rooms["choose-mitigation"];
const result = await chooseMitigation({
  room: "checkout-latency",
  mitigation: "rollback-build-842",
});
```

The [getting-started walkthrough](docs/guide/getting-started.md) explains what
the scaffold generated and how to grow it. The full [Operations Room
example](examples/operations-room/README.md) extends the same shape with formers,
generated artifacts, selectable reaction packs, and swappable policy.

## What The Engine Guarantees

- Concepts remain independently implemented and registered.
- Composition is validated before execution and can be read back as text.
- Calls are typed from concept action signatures through generated clients.
- Every action occurrence is recorded in an append-only occurrence log.

The occurrence log is execution evidence and observability infrastructure. It
does not automatically persist concept state, replay an application, or provide
restart recovery. See [execution semantics](docs/semantics.md) for the precise
guarantees and operational limits.

## Examples And Documentation

From a source checkout, run both independently runnable examples with:

```sh
bun install
bun run scenario
```

Choose a path based on what you need next:

- [Getting started](docs/guide/getting-started.md): scaffold a project, then
  walk through its concept, composition, and boundary.
- Authoring curriculum: [Concepts](docs/guide/concepts.md),
  [Reactions](docs/guide/reactions.md), [Views and
  formers](docs/guide/views-and-formers.md), [Application
  boundary](docs/guide/application-boundary.md), then [Execution
  semantics](docs/semantics.md).
- [Examples map](examples/README.md): compare the compact Reading Circle with
  the modular Operations Room.
- [Public API](docs/public-surface.md): find package subpaths, exports, and
  signatures.
- [Release status](#alpha-status), [migration guidance](#upgrading-alpha-versions),
  and [changelog](CHANGELOG.md):
  evaluate or upgrade an alpha version.
- [Engine architecture](docs/architecture.md): navigate the implementation as
  a contributor.
- [Contributor release procedure](docs/releasing.md): prepare, publish, verify,
  or respond to a release.

## License

[Apache 2.0](LICENSE)
