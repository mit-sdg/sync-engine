# @mit-sdg/catalog

`@mit-sdg/catalog` installs curated sync-engine concepts, vocabulary
computations, composition recipes, and complete bundles as source that your
application owns.

The package is a CLI and source registry. Installed applications do not import
it at runtime, and the CLI never overwrites copied source.

## Discover entries

```sh
bunx --package @mit-sdg/catalog@beta catalog list
bunx --package @mit-sdg/catalog@beta catalog show bundle/operations-room
```

## Start with a bundle

Create an ordinary Bun/TypeScript package and add the matching sync-engine
release, then initialize and install:

```sh
bunx --package @mit-sdg/catalog@beta catalog init bundle/operations-room \
  --variant concept/gathering=memory
```

For an existing application, run `catalog init`, apply the two printed
integration snippets, and use `catalog add <entry>`. Run `catalog --help` for
path overrides and source lifecycle commands.

## Existing applications

The default layout is explicit in the generated `catalog.json`:

```json
{
  "$schema": 1,
  "concepts": "src/concepts",
  "computations": "src/computations",
  "recipes": "src/composition",
  "conceptSet": "src/concept-set.ts",
  "declarations": "src/catalog/text.generated.d.ts",
  "registrations": "src/catalog/registrations.generated.ts",
  "composition": "src/catalog/composition.generated.ts"
}
```

Use path flags with `catalog init` when the application differs. The CLI does
not inspect or rewrite the concept set or assembly. It prints the two imports
and spreads they need once. The managed declaration lets specification text
imports typecheck even when a concept is installed without a bundle.

Concepts with several implementations require an explicit choice:

```sh
catalog add concept/gathering --variant concept/gathering=repository
```

Recipes install with their exact catalog concept dependencies. A recipe module
owns its default filename; if that path already exists, the error prints a
retry using `--file alternative.ts`.

## Ownership

`catalog.lock` records entry origins, dependency edges, variants, destinations,
and installed source hashes. Commit it with `catalog.json`.

The lock does not transfer ownership back to the catalog. Commands never
overwrite copied source. A later entry may depend on a locally modified concept;
installation names the modification and warns that the catalog-tested
combination no longer applies.

```sh
catalog diff
catalog forget recipe/member-contributions
```

`diff` compares without writing. `forget` removes managed imports and lock
metadata only; it never deletes application source. There is no catalog update,
merge, overwrite, or source-removal command.

## Commands

| Command             | Purpose                                                        |
| ------------------- | -------------------------------------------------------------- |
| `init [entry...]`   | Initialize configuration and optionally install a bundle       |
| `list [kind]`       | Discover concepts, computations, recipes, and bundles          |
| `show <entry>`      | Inspect dependencies, variants, requirements, and copied files |
| `add <entry...>`    | Resolve and copy an entry dependency closure                   |
| `diff [entry...]`   | Compare local source with the invoked catalog package          |
| `forget <entry...>` | Stop tracking entries without deleting source                  |

All commands are noninteractive. Mutating commands validate their complete
plan before writing, reject path traversal and symbolic-link destinations, and
do not execute project scripts or package-manager commands.
