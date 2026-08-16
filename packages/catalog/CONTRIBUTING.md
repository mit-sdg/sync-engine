# Contributing catalog entries

The catalog is a read-only collection of adaptable designs and source examples.
`entries/index.json` defines display order; an unlisted manifest is unavailable. An
entry must be coherent and tested, but consumers remain free to simplify, split,
combine, rename, or reject it.

## Entry shape

Use a Name-style concept design (`# Selecting`, for example) for a concept. Preserve implementations as examples, but list shared source separately from each named implementation so `sync-engine-catalog source` has unambiguous selectors.

Keep a recipe design lean: a short overall purpose followed by `## Compositions`, plus `## Views` and `## Formers` when independently meaningful reads exist. Each composition aggregate key has a matching `### GroupName`; each read has a matching `### Name`. Integrate authority and failure meaning into those sections rather than adding generic headings or route lists. Recipe TypeScript directly exports the imported Markdown as `spec` and exports separate canonical `compositions`, `views`, and `formers` objects as applicable. Tagged declarations are exported only through those aggregates.

Recipe source imports its adjacent `spec.md` relatively. This is the smallest entry-local equivalent of an application's `@design/*` alias: catalog entries are typechecked together, but each independent entry has its own `spec.md`, so one catalog-wide alias cannot identify the importing entry. Applications may adapt the import to their own `@design/*` mapping.

Manifests describe only display: identity, summary, design, source names, recipe relationships, and concept implementation labels. Do not add destinations, package requirements, project inspection, mutation guidance, lock state, ownership, transforms, generation, or installation metadata.

## Verify an entry

Add tests for manifest validation, exact selectors, and source behavior where needed. Concept principle and implementation tests and recipe behavior tests remain catalog-owned evidence for the curated assets; they are not installation machinery.

Run:

```sh
bun run typecheck
bun run test
bun run build
bun run package:check
```
