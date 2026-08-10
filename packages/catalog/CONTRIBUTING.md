# Contributing catalog entries

The catalog discovers entries only through `entries/index.json`, in index order.
Read the [catalog command reference](public-surface.md#manifest-fields) before
writing a manifest.

## Add an entry

A concept entry includes:

- one specification and shared declarations;
- one implementation and principle test for each floor; and
- one registry containing the exact floor and class markers consumed by the
  renderer.

A recipe declares every concept dependency, the exact exported composition
members that may enter `catalogComposition`, and one route for each member.
Every relative import in an installed floor must resolve to another selected
file.

Copied tests are source assets. Do not use repository-only aliases. Recipe
source may use `@catalog/concepts`; installation rewrites that reserved alias to
the application's concept set. A declared recipe test may use
`@catalog/registrations` to construct real selected-floor fixtures; installation
rewrites it to `src/catalog/registrations.generated.ts`. Production recipe modules
must remain composition-only and must not import registrations.

## Separate implementation floors

Declare every external import in the manifest. Keep floor-specific imports,
implementation code, factories, tests, and package requirements inside that
floor. A memory installation must not retain Mongo source or imports, and a
Mongo installation must not retain memory source or imports.

A Mongo implementation receives exactly `{ db: Db }`. The host owns and closes
`MongoClient`; concept assembly receives the database handle and does not own
the client. Export index creation as a module function rather than adding an
undeclared public concept method. When an implementation uses transactions, its
floor summary and package documentation must require a transaction-capable replica
set or sharded cluster. Its Mongo tests must reject unsupported topology and must
exercise rollback after a later write in the transaction faults.

## Verify an entry

Add focused evidence for:

- manifest and byte-exact rendering failures;
- the concept principle against each implementation;
- memory-only and Mongo-only installed-project typechecking; and
- installer collision, lock ownership, and repeated-add behavior.

Run the repository typecheck against full registries through
`entries/_typecheck/concept-set.ts`. Mongo tests must skip unless
`MONGODB_URI` is available and must honor `CATALOG_SKIP_MONGO=1`. To let the
repository test setup start a temporary Mongo server, run:

```sh
CATALOG_MONGO=1 bun run test
```

Before submitting an entry change, run:

```sh
bun run check
bun run test
bun run coverage
bun run build
bun run package:check
```
