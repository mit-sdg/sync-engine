# `@mit-sdg/sync-engine-catalog`

`catalog` is a read-only browser for curated sync-engine concept and recipe source. It prints designs and explicitly selected source files so you can decide whether and where each asset belongs. It has no runtime import API and never writes to the current project.

Install it as a development dependency, then browse:

```sh
bun add --dev --exact @mit-sdg/sync-engine-catalog@1.0.0-beta.9
bunx catalog list
bunx catalog show recipe/workshop-selection
bunx catalog source recipe/workshop-selection workshop-selection.ts
```

`show` labels the entry's design and lists selectors accepted by `source`. Concept implementation selectors include their implementation name, for example:

```sh
bunx catalog source concept/selecting memory/selecting.memory.ts
```

Use `--raw` with `show` or `source` when stdout must contain only the selected file bytes:

```sh
bunx catalog show concept/selecting --raw
bunx catalog source concept/selecting selecting.shared.ts --raw
```

The printed names identify catalog assets, not proposed destinations. In an application, the current convention uses `src/concepts.ts`, composition modules under `src/compositions/`, and the `@design/*` alias; the catalog neither assumes nor creates that layout. Recipe assets import their adjacent Markdown and export it as `spec`. They use an entry-local relative import because one packaged catalog typecheck covers many independent entries, while an application-owned `@design/*` alias has application-specific targets.

See [`public-surface.md`](public-surface.md) for the exact command and manifest contract. Entry authors should read [`CONTRIBUTING.md`](CONTRIBUTING.md).
