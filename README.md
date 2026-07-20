# sync-engine

A TypeScript library for composing independent application behaviors in a
modular, declarative way. Each behavior — selecting, discussing, grading — is
written as a self-contained concept with its own state and actions. Applications
grow by assembling these concepts with a small set of statements. One such
statement, a **reaction**, opens a discussion whenever a mitigation is selected:

```ts
const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose, {}, { selection }).then(request(Discussing.open, { subject: selection })),
);
```

`Selecting` remains independent of `Discussing`. Its specification states what
choosing an item does — a readable contract that holds in any application that
uses it:

```actions
choose (scope: Scope, item: Item) : return (selection: Selection)
  then
    remove any selection with scope from current
    add a new selection with scope and item
    add selection to current
    return selection
```

This approach is called Concept Design. In this release, an ordinary
TypeScript class implements each concept's actions, state, and queries. The
engine interprets the reactions that connect actions, the views that name
shared questions, and the formers that shape complete answers. An application
is the incremental composition of these pieces, and every occurrence lands in
its append-only log.

## Install

```bash
bun add @mit-sdg/sync-engine
# or: npm install @mit-sdg/sync-engine
```

Library imports support the Node.js versions declared in `package.json`. The
installed `sync-engine` command for generated artifacts runs with Bun.

## Run the shipped examples

After installing the package in a project, run the operations room — the
application the [guide](docs/guide/getting-started.md) builds:

```sh
bun node_modules/@mit-sdg/sync-engine/examples/operations-room/src/scenario.ts
```

The reading circle is the complete reference fixture:

```sh
bun node_modules/@mit-sdg/sync-engine/examples/reading-circle/src/scenario.ts
```

## Documentation

Start with the [guided walkthrough](docs/guide/getting-started.md) to assemble a
small whole application. The [documentation router](docs/README.md) then points
to deeper guides, worked constructions, execution guarantees, operations, and
the public API according to what you need next.

## License

[Apache 2.0](LICENSE)
