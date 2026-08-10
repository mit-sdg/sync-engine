# `@mit-sdg/sync-engine-catalog`

The catalog executable copies curated concept and recipe source into an
existing sync-engine application. Copied files become application source. The
package has no runtime import API. It does not edit application-owned setup,
integration, host, TypeScript, or package files. The command supports Bun
`>=1.3.14 <1.4` and Node.js `>=24 <25`.

## Install and inspect

```sh
bun add --dev --exact @mit-sdg/sync-engine-catalog@1.0.0-beta.7
bunx catalog list
bunx catalog show recipe/workshop-selection
```

`list` and `show` do not require core to be installed. `show` reads static
metadata; it does not import entry modules.

## Add a memory-floor recipe

Run the command from an existing package root:

```sh
bunx catalog add recipe/workshop-selection --floor memory
```

The recipe resolves `concept/gathering` and `concept/selecting`. The installer
copies their shared files plus only the memory implementations and tests. It
writes registration and composition modules under `src/catalog/` and records
ownership in `catalog.lock`.

Missing packages stop the plan before any write. Run the printed
`bun add --exact` command, then repeat the command after `Next:`. After a
successful copy, apply every integration step printed by the catalog. These
steps connect the generated registrations and composition to application-owned
files and select the memory implementation floor.

## Add the Mongo floor

A catalog-managed project selects one floor. Select Mongo on the first add:

```sh
bunx catalog add recipe/workshop-selection --floor mongo
```

Mongo output includes the Mongo implementations and tests; it contains no
memory implementation, test, import, or factory. Construct the floor with
`applicationConcepts.implementations("mongo", { db })`. The host creates and
closes `MongoClient`; assembly does not own that resource.

The selected floor is stored in `catalog.lock`. Every later add uses that floor.
The catalog does not install a second floor or migrate between floors.

## Ownership and failures

Copy-owned entry files are written once and never rewritten. A rendered
registry may be regenerated only while its current hash equals the last
catalog-written hash. Generated files under `src/catalog/` must also retain
their catalog-written hashes. An untracked collision or edited generated file
aborts planning before writes.

Repeating an unchanged add performs no writes. Schema 1 does not migrate an
installed entry whose integration metadata or selected package and file
declarations changed; `add` rejects that entry instead.

Catalog commits use sibling temporary files, backups, and a lock-last write.
After a caught I/O failure, the installer attempts to restore completed
replacements. Process termination or a failed cleanup can leave temporary,
backup, or copied files. Without a matching lock, the next `add` reports copied
paths as collisions rather than claiming them.

## Support and security

Only the newest beta is supported. Pin the catalog version exactly and review
the repository changelog before upgrading. The core peer is optional for
inspection commands; copied entries may require an exact core version, which
`add` verifies before writing.

Treat shipped entry source as code that becomes part of the application. Review
copied files and integration guidance before committing or running them. Report
suspected vulnerabilities through the repository's [private reporting
process](https://github.com/mit-sdg/sync-engine/blob/main/SECURITY.md).

See [`public-surface.md`](public-surface.md) for the command, manifest, lock,
dependency, and guidance contracts. Entry authors should read
[`CONTRIBUTING.md`](CONTRIBUTING.md).
