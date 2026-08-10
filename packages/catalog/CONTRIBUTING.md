# Contributing catalog entries

The catalog discovers entries in `entries/index.json` order; unlisted ids are
unavailable. Read the [manifest reference](public-surface.md#manifest-fields)
before writing one.

## Add an entry

A concept entry includes:

- one specification and shared declarations;
- an implementation and principle test for every floor, with shared files when
  the same implementation serves more than one floor; and
- one registry containing the exact floor and class markers consumed by the
  renderer.

A recipe declares every concept dependency, the exact exported composition
members that may enter `catalogComposition`, and one route for each member.
Every relative import in an installed floor must resolve to another selected
file; reserved `@catalog/*` imports are the only additional installer-resolved
imports.

Copied tests are source assets and cannot use repository-only aliases. Recipe
source may use `@catalog/concepts`, which installation rewrites to a relative
concept-set import. A declared recipe test may use `@catalog/registrations` for
selected-floor fixtures; installation rewrites it to
`src/catalog/registrations.generated.ts`. Production recipe modules must remain
composition-only and cannot import registrations.

## Separate implementation floors

Declare every non-`node:` external package import in the manifest. Keep
floor-specific imports, implementation code, factories, tests, and package
requirements inside that floor. A memory installation must not retain Mongo
source or imports, and a Mongo installation must not retain memory source or
imports.

A Mongo implementation receives exactly `{ db: Db }`; the host owns and closes
`MongoClient`. Export index creation as a module function, not an undeclared
public concept method. Transactional implementations must document the need for
a transaction-capable replica set or sharded cluster. Their tests must reject
unsupported topology and exercise rollback after a later write faults.

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
