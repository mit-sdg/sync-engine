# `@mit-sdg/sync-engine-catalog`

`sync-engine-catalog` is a read-only browser for curated sync-engine concept and recipe
source. It prints designs and explicitly selected source files so you can decide
whether and where each asset belongs. It has no runtime import API and never writes to
the current project.

Install it as a development dependency, then browse a design before choosing source:

```sh
bun add --dev --exact @mit-sdg/sync-engine-catalog@1.0.0-beta.15
bunx --no-install sync-engine-catalog list
bunx --no-install sync-engine-catalog show concept/labeling
bunx --no-install sync-engine-catalog show recipe/workshop-selection
bunx --no-install sync-engine-catalog source concept/labeling memory/labeling.memory.ts
```

`show` labels the entry's design and lists selectors accepted by `source`. Concept
implementation selectors include their implementation name:

```sh
bunx --no-install sync-engine-catalog source concept/selecting memory/selecting.memory.ts
```

Use `--raw` when stdout must contain only selected file bytes:

```sh
bunx --no-install sync-engine-catalog show concept/selecting --raw
bunx --no-install sync-engine-catalog source concept/selecting selecting.shared.ts --raw
```

The printed names identify inspiration, not a required name, contract, or destination.
Copy only what the application needs: a design may be simplified, split, combined,
renamed, or rejected. Recipe designs show a complete static instance inventory for
their stated concept selection; adapt that inventory and every binding to the exact
assembly variant you actually select. Browse implementation source only after choosing
an approved concept to implement; examples may contain behavior outside an
application's scope.

The recommended application layout uses `design/concepts/*.md`,
`design/compositions/*.md`, `design/types.md`, concept source under
`src/concepts/<name>/`, and paired composition modules under `src/compositions/`.
The catalog neither assumes nor creates that layout. Recipe assets import adjacent
Markdown and export it as `spec`. They use an entry-local relative import because one
packaged catalog typecheck covers many independent entries, while an application-owned
`@design/*` alias has application-specific targets.

See [`public-surface.md`](public-surface.md) for the exact command and manifest contract.
Entry authors should read [`CONTRIBUTING.md`](CONTRIBUTING.md).
