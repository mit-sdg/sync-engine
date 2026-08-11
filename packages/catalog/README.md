# `@mit-sdg/sync-engine-catalog`

`catalog` copies curated concept and recipe source into an application and
generates registration and composition modules. The package has no runtime
import API.

## Install and inspect

Install the catalog as a development dependency, then inspect that version's
entries. `list` and `show` read manifests and source assets without loading core
or entry modules:

```sh
bun add --dev --exact @mit-sdg/sync-engine-catalog@1.0.0-beta.8
bunx catalog list
bunx catalog show <entry>
```

## Add source

From an application package root, use an id from `catalog list`:

```sh
bunx catalog add <entry> --floor memory
```

The first add selects the project floor. Later adds use the floor in
`catalog.lock`; a different floor is rejected and cannot migrate the project.
Without `--floor`, all resolved concepts must share one `defaultFloor`.

Before writing, the command checks package requirements. Missing or incompatible
packages produce a `bun add --exact` command and no changes. After an add, apply
every printed integration step; the catalog does not edit application-owned
setup, TypeScript, package, assembly, or host files.

To select the Mongo floor on the first add:

```sh
bunx catalog add <entry> --floor mongo
```

The application host creates and closes `MongoClient`. Entries that use MongoDB
transactions require a replica set or sharded deployment; standalone MongoDB
is unsupported for those installations.

## Ownership and updates

`catalog.lock` records copied and generated files. The catalog never rewrites
copy-owned source; it rewrites rendered registries and generated files only when
their bytes match locked hashes. An unchanged add writes nothing. Review copied
source and generated integration before committing.

For command behavior, manifest rules, lock ownership, and failure details, see
[`public-surface.md`](public-surface.md). Entry authors should read
[`CONTRIBUTING.md`](CONTRIBUTING.md).
