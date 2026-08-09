# @mit-sdg/catalog

`@mit-sdg/catalog` copies curated sync-engine concepts, composition recipes, and
application bundles into a project. The current catalog is an account-center
starter built from separate profile, preference, and in-app notification state.
The receiving application owns the copied source immediately.

The package exposes one `catalog` executable and no JavaScript import surface.
The copied application does not depend on the catalog package at runtime.

## Start the account center

Create a Bun and TypeScript package with the matching sync-engine beta:

```sh
mkdir account-center
cd account-center
bun init -y
bun add --exact @mit-sdg/sync-engine@beta
bun add --dev "typescript@>=6 <7"
bunx --package @mit-sdg/catalog@beta catalog init bundle/account-center
```

The bundle selects the `memory` Profiling variant, copies a complete local
application, and writes one `catalog.lock` in the current directory. The
installer does not run a package manager, execute project code, or overwrite an
existing destination.

Pin and check the generated contracts, typecheck the copied source, and run the
asserting scenario:

```sh
bunx sync-engine artifacts pin
bunx sync-engine check --config generated.config.ts
bunx sync-engine artifacts check
bunx tsc --noEmit
bun src/scenario.ts
```

`sync-engine check` currently reports conservative endpoint-fallback advisories
for action/refusal chains and an order-sensitive-former advisory for the
deliberately ordered preference and inbox rows. Review them when adapting the
boundary; the copied scenario exercises the declared refusal branches and
ordering but does not turn those advisories into general concurrency proofs.

The scenario exercises one account through a stateful lifecycle:

1. It creates a profile for an opaque principal, refuses a duplicate profile
   with `PROFILE_ALREADY_EXISTS`, and verifies that the original profile did not
   change.
2. It sets appearance and communication preferences, rejects a preference for
   an unknown profile, and verifies first-set order in the joined account.
3. A trusted service route delivers product and security inbox items, rejects an
   unknown recipient, and preserves delivery order.
4. It renames the profile, refuses a different profile reading the inbox item,
   marks the item read correctly, and verifies both changes through the joined
   account read.
5. It clears a preference, refuses a repeated clear, dismisses the inbox items,
   and verifies that the final account retains only the theme preference.

## What was copied

The bundle copies three concepts with independent state responsibilities:

- `concept/profiling` owns one display profile for each opaque external
  principal. It does not own credentials or identity-provider data.
- `concept/preferring` owns one value for each owner, scope, and key. Its queries
  return preferences in first-set order; replacing a value keeps its identity
  and position.
- `concept/notifying` retains ordered in-app inbox records and their read and
  dismissed state. Dismissed records remain in concept state but are omitted
  from inbox reads.

`recipe/account-center` composes those state owners into validated profile,
preference, trusted inbox-delivery, read, dismiss, and joined-account endpoints.
The bundle also copies the concept set, assembly, local gateway, artifact
configuration, executable evidence, and scenario.

This package snapshot ships no computation entry. Computations remain a
supported catalog entry kind.

Run `catalog list` to see every entry and `catalog show <entry>` to inspect one:

```sh
bunx --package @mit-sdg/catalog@beta catalog list
bunx --package @mit-sdg/catalog@beta catalog show concept/profiling
```

## Identity and delivery boundaries

The copied endpoint validators check exact object keys, bounded strings, and
response shapes. Validation does not establish identity. The `principal`,
`profile`, and notification `recipient` fields remain caller claims until a
trusted application adapter binds them to verified request context.

`createGateway` does not authenticate a request or authorize access to an
account. An HTTP, RPC, or worker adapter must verify credentials, derive the
opaque principal, resolve the principal's profile, and replace caller-supplied
identity fields before invoking the gateway. Treat
`/account/notifications/deliver` as a trusted service operation and bind its
profile from authorized application context.

Preferences do not automatically gate notification delivery. Enforce channel
or topic policy in a state owner or deployment service that can make the
decision atomically; separately evaluated mutable guards are not a security or
exactly-once boundary. An accepted delivery creates an in-app inbox record. It
does not send email or push messages, deduplicate a retry, or confirm external
delivery.

## Persistence and Profiling variants

The bundle installs memory-backed Profiling, Preferring, and Notifying
implementations. Their state is process-local. Restarting the process loses all
profiles, preferences, and notifications.

`concept/profiling` also provides a `repository` variant. It accepts an
application-supplied synchronous repository whose `create` operation must
enforce principal uniqueness atomically. In an initialized application where
Profiling is not already tracked, install that variant with:

```sh
bunx --package @mit-sdg/catalog@beta catalog add concept/profiling --variant concept/profiling=repository
```

The repository interface is a storage seam, not a supplied database. Persistence
depends on the repository the application provides. An installed concept
variant cannot be switched; `bundle/account-center` has already selected the
Profiling `memory` variant.

## Add source to an existing application

Initialize and install the account-center recipe directly from an application
root with no `catalog.lock`:

```sh
bunx --package @mit-sdg/catalog@beta catalog init recipe/account-center --variant concept/profiling=memory
```

The recipe depends on all three concepts. Profiling has two variants, so a
direct recipe installation must select one explicitly. The complete bundle
instead constrains Profiling to `memory` and selects it automatically.

The standard layout needs no configuration:

| Source                                | Default destination                      |
| ------------------------------------- | ---------------------------------------- |
| Concepts                              | `src/concepts`                           |
| Computations                          | `src/computations`                       |
| Recipes                               | `src/composition`                        |
| Application concept set               | `src/concept-set.ts`                     |
| Markdown declaration                  | `src/catalog/text.generated.d.ts`        |
| Managed registrations and computation | `src/catalog/registrations.generated.ts` |
| Managed recipe composition            | `src/catalog/composition.generated.ts`   |

`init` prints the two imports an existing application needs. Combine
`catalogRegistrations` and `catalogComputations` with the concept set, and
spread `catalogComposition` into the assembly's composition. A complete bundle
already contains those two integration points, so it prints no manual step.

`init` writes one `catalog.lock` in the current directory and refuses if that
file already exists. Later `add`, `diff`, and `forget` commands use the nearest
ancestor containing the lock. Applications with another layout pass path flags
to `init`; only non-default paths are retained in `catalog.lock`. Run `catalog
--help` or use the [path option contract](public-surface.md#path-options) for the
exact options.

## Source ownership

Copied concepts, computations, recipes, tests, and bundle files are
application-owned. Catalog commands never update, merge, overwrite, or delete
them.

`catalog.lock` records where each entry came from, its dependency edges,
selected variant, copied destinations, and original hashes. Commit the lock.
Three small generated integration files remain catalog-managed; a mutating
command refuses if one was edited or removed.

Use the lifecycle commands when needed:

```sh
bunx --package @mit-sdg/catalog@beta catalog diff
bunx --package @mit-sdg/catalog@beta catalog forget recipe/account-center
```

`diff` compares local source with the catalog version currently being invoked
and never writes. `forget` stops tracking entries and updates managed imports;
it leaves every copied file and npm dependency in place. `forget` refuses to
remove a lock record while a retained entry directly depends on it.

A new recipe may depend on source your application has changed. Installation
keeps the local source and prints a compatibility warning. A filename collision
aborts the whole operation; for an explicitly requested recipe, the error also
shows how to retry with `--file alternative.ts`.

## Exact contracts

The [catalog public surface](public-surface.md) defines every command, option,
default path, persisted field, managed file, output rule, and failure boundary.
There is no supported package import or deep import.

To add or change catalog entries, use the package-local [contribution
guide](CONTRIBUTING.md).
