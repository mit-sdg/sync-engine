# `@mit-sdg/sync-engine-catalog`

`catalog` copies curated sync-engine concept and recipe source into an existing
application. Copied files become application source. The package has no runtime
import API.

## Install and inspect

Install the catalog as a development dependency, then inspect the entries
shipped by that version:

```sh
bun add --dev --exact @mit-sdg/sync-engine-catalog@1.0.0-beta.7
bunx catalog list
bunx catalog show <entry>
```

`list` and `show` only read catalog metadata. They do not require the core
package or import entry modules.

## Add source

Run `add` from an application package root. Replace `<entry>` with an id from
`catalog list`.

```sh
bunx catalog add <entry> --floor memory
```

The first successful add selects the project floor. Later adds use the floor in
`catalog.lock`; the catalog does not install a second floor or migrate an
existing project between floors.

The command checks package requirements before writing. When a package is
missing or incompatible, it prints the `bun add --exact` command to run and
makes no changes. After a successful add, apply every integration step printed
by the command. The catalog does not edit application-owned setup, TypeScript,
package, assembly, or host files.

To select the Mongo floor on the first add:

```sh
bunx catalog add <entry> --floor mongo
```

The application host creates and closes `MongoClient`. Entries that use MongoDB
transactions require a replica set or sharded deployment; standalone MongoDB
is unsupported for those installations.

## Ownership and updates

The catalog records copied and generated files in `catalog.lock`. It will not
replace copied source or overwrite edited generated files. Repeating an
unchanged add performs no writes. Review the copied source and generated
integration before committing it.

For command behavior, manifest rules, lock ownership, and failure details, see
[`public-surface.md`](public-surface.md). Entry authors should read
[`CONTRIBUTING.md`](CONTRIBUTING.md).
