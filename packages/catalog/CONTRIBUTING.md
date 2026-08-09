# Contributing To The Catalog

This guide is for changes under `packages/catalog/`. Use the repository root
`CONTRIBUTING.md` for checkout, review, and pull-request workflow.

Catalog documentation stays with this package:

- `README.md` is the approachable user guide;
- `public-surface.md` is the complete supported CLI and format contract;
- this file owns entry-authoring and implementation workflow.

Do not add catalog design notes or usage documents under `docs/`.

## Entry Standard

Add an entry only when it provides a common application capability with a clear
owner and observable behavior. A concept must own state independently of
unrelated capabilities. A recipe must express a reusable cross-concept policy,
boundary, or read. A bundle must demonstrate how independent entries compose;
it must not hide one large coupled behavior.

The useful-entry bar requires executable evidence for the behavior that makes
the entry worth adopting. Evidence must cover meaningful refusals and ordering
when the contract defines them. Do not add a filler entry merely to exercise an
entry kind. Do not rename application-specific behavior and present it as a
generic capability.

Names, summaries, and examples must not imply authentication, authorization,
audit, or external-delivery guarantees that the source does not implement and
test. A profile association is not authentication. Retained records are not by
themselves an audit log. An in-app inbox insertion is not email or push delivery
and does not imply deduplication or exactly-once behavior.

Every entry lives below `entries/<kind>/<name>/` and appears once in
`entries/index.json`. Its ID is the same lowercase kebab-case path:

```text
concept/profiling
concept/preferring
concept/notifying
recipe/account-center
bundle/account-center
```

The allowed kinds are `concept`, `computation`, `recipe`, and `bundle`. The
current snapshot intentionally has no computation entry; `computation` remains
supported. Do not add one solely to fill that gap.

## Design Process

Start with the application need and choose the smallest reusable entry that
expresses it. Before writing source:

1. Name the common application capability and the concrete behavior or
   composition contrast the entry adds. State what the entry does not provide.
2. Assign each state transition to one independently owned concept. Put policy
   that coordinates concepts in a recipe rather than moving their state into a
   shared implementation.
3. Write the observable contract: accepted inputs, state changes, query
   cardinality, ordering, refusal precedence, idempotency, and trust boundaries
   where each applies.
4. Identify exact entry dependencies, package requirements, and implementation
   seams. A variant must change implementation rather than concept semantics.
5. Define executable evidence for the principle, normal path, state-preserving
   refusals, cardinality, and ordering. One happy-path construction is not
   enough when refusal or ordering behavior is part of the value.
6. For a bundle, explain why the selected entries form one coherent application,
   which variants its assembly supports, and which operational responsibilities
   remain with the receiving application.

`concept/profiling` is the model for a meaningful storage seam. Its `memory` and
`repository` variants share one specification, registry, refusal contract, and
conformance expectation. The repository variant delegates atomic
principal-unique creation to an application-supplied repository; it does not
change Profiling semantics or claim that every supplied repository is durable.

`bundle/account-center` is the model for bundle-level evidence. It composes
three independent state owners and one boundary recipe, constrains Profiling to the
constructor shape its assembly supports, and runs an asserting lifecycle that
covers duplicate refusal, preference order, delivery policy, read state, and
dismissal.

Reject proposals that duplicate an existing entry with renamed application
vocabulary, couple unrelated state into one concept, or require the installer
to infer equivalence. Review concept semantics with the repository's design and
design-review guides before treating catalog packaging as the implementation
problem.

## Implementation Sequence

1. Write or update the concept specification or recipe contract before the
   application bundle. Record state ownership, action and query behavior,
   refusals, ordering, and boundary assumptions in the entry-owned source.
2. Implement the source under `entries/<kind>/<name>/`. Keep common concept
   files outside variant directories and keep all variants conformant with the
   same specification and registration contract.
3. Add executable evidence beside the copied source. Exercise the implementation
   directly for concepts; exercise composed policy at the narrowest practical
   level. Check state after refusals and compare complete ordered results when
   order is contractual.
4. Add the manifest and register it once in `entries/index.json`. Declare exact
   entry dependencies, package requirements, copied files, integration members,
   and variant constraints. Keep every recipe independently installable.
5. Build a bundle only after its reusable concepts and recipes stand alone. Add
   the concept set, assembly, edge, artifact descriptor, and an asserting
   scenario. The account-center bundle, for example, explicitly constrains
   `concept/profiling` to `memory` rather than relying on installer inference.
6. Add or update registry and installation tests for manifest validation,
   dependency resolution, rendering, ownership, collisions, selected variants,
   lock data, and integration metadata. Test the complete preflight and rollback
   boundary for observable installer changes.
7. Update `README.md` for the ordinary workflow and `public-surface.md` for every
   observable command, option, format, entry, output, or failure change. Keep
   package-owned catalog documentation under `packages/catalog/`, not `docs/`.
8. Verify the source checkout, then install the packed tarball in an isolated
   consumer and run its evidence, generated-artifact checks, typecheck, and
   scenario.

## Manifest Shape

Every `manifest.json` contains:

```json
{
  "schema": 1,
  "id": "recipe/account-center",
  "kind": "recipe",
  "summary": "Expose one validated account boundary.",
  "requires": ["concept/notifying", "concept/preferring", "concept/profiling"],
  "files": [
    {
      "source": "account-center.ts",
      "target": "$recipes/account-center.ts"
    },
    {
      "source": "account-center.test.ts",
      "target": "$recipes/account-center.test.ts"
    }
  ],
  "recipe": {
    "module": "$recipes/account-center.ts",
    "test": "$recipes/account-center.test.ts",
    "members": [
      "accountCenter",
      "CreateProfile",
      "RenameProfile",
      "SetPreference",
      "RejectUnknownPreferenceOwner",
      "ClearPreference",
      "RejectUnknownPreferenceClear",
      "DeliverNotification",
      "RejectUnknownNotificationRecipient",
      "MarkNotificationRead",
      "DismissNotification",
      "GetAccountCenter"
    ]
  }
}
```

`requires` names exact entry IDs. `packages` maps npm package names to exact
required ranges. Do not infer structural substitutes or execute configuration
from a manifest.

File records contain `source`, relative to the entry directory, and `target`,
which uses one supported token:

| Token            | Destination                             |
| ---------------- | --------------------------------------- |
| `$concepts/`     | Configured concept directory            |
| `$computations/` | Configured computation directory        |
| `$recipes/`      | Configured recipe directory             |
| `$concept-set`   | Configured application concept-set file |
| `$root/`         | Project root                            |

Source and target paths must remain inside their owners and be portable across
Linux, macOS, and Windows.

## Concept Entries

A concept entry owns common files, one or more implementation variants, and
`concept` integration metadata. For example, the relevant
`concept/profiling` fields are:

```json
{
  "variants": {
    "memory": {
      "summary": "Dependency-free in-memory state with injectable identity generation.",
      "files": [
        {
          "source": "variants/memory/profiling.ts",
          "target": "$concepts/profiling/profiling.ts"
        },
        {
          "source": "variants/memory/profiling.test.ts",
          "target": "$concepts/profiling/profiling.test.ts"
        }
      ]
    },
    "repository": {
      "summary": "Application-supplied synchronous repository with atomic profile creation.",
      "files": [
        {
          "source": "variants/repository/profiling.ts",
          "target": "$concepts/profiling/profiling.ts"
        },
        {
          "source": "variants/repository/profiling.test.ts",
          "target": "$concepts/profiling/profiling.test.ts"
        }
      ]
    }
  },
  "concept": {
    "name": "Profiling",
    "registration": "$concepts/profiling/registry.ts",
    "export": "profiling"
  }
}
```

Variants share one specification, registration, action/query contract, refusal
contract, and conformance expectation. Use variants only for a meaningful
implementation seam such as storage. A bundle may constrain compatible
variants through `variantConstraints`. For the Profiling repository variant,
the repository's `create` operation owns the atomic principal-uniqueness check;
a read followed by a separate write does not satisfy that contract.

Concept evidence must run the implementation directly and demonstrate its
principle, normal behavior, refusal behavior, query cardinality, and relevant
ordering. Each variant must satisfy equivalent evidence.

## Computation Entries

A computation entry declares its copied `$computations/` module and every
exported vocabulary function in the manifest's `computation` record.

Computations are pure. Evidence should cover representative values and edge
cases without assembling an application. No computation currently ships, but
the manifest kind, installer integration, path option, and lock form remain
supported.

## Recipe Entries

A recipe owns one composition module, an optional paired test, and every member
that its namespace contributes:

```json
{
  "recipe": {
    "module": "$recipes/account-center.ts",
    "test": "$recipes/account-center.test.ts",
    "members": [
      "accountCenter",
      "CreateProfile",
      "RenameProfile",
      "SetPreference",
      "RejectUnknownPreferenceOwner",
      "ClearPreference",
      "RejectUnknownPreferenceClear",
      "DeliverNotification",
      "RejectUnknownNotificationRecipient",
      "MarkNotificationRead",
      "DismissNotification",
      "GetAccountCenter"
    ]
  }
}
```

Declare the exact concept and computation entries used by the module. Recipes
may contain reactions, views, formers, endpoints, and computed lines. Keep each
recipe focused on one policy or read construction so applications can adopt it
independently.

Recipe source may use `@catalog/concepts` for the configured concept set.
Paired evidence may use `@catalog/recipe` for the installed recipe module. The
installer renders only declared tokens; do not add application-specific aliases
or AST rewrite assumptions.

## Bundle Entries

A bundle depends on reusable entries and may copy application-level files such
as a concept set, assembly, edge, scenario, and artifact descriptor. Use
`@catalog/registrations` and `@catalog/composition` in those files so custom
layouts render correctly.

A bundle must install from the packed package into an isolated ordinary
consumer, typecheck, generate and check artifacts, run entry evidence, and run
its scenario. Keep bundle source readable after copying; it is a starting point,
not generated internals.

The account-center bundle must continue to state its trust and persistence
limits in copied documentation. Endpoint validation is not authentication or
authorization, memory-backed state is lost on restart, and an in-app
notification record is not proof of external or exactly-once delivery.

## Implementation Changes

The CLI source is private package implementation. Preserve these boundaries:

- discovery commands work without a project or core installation;
- standard initialization writes one lock and three managed files;
- path overrides live only in `catalog.lock.paths`;
- copied source is never overwritten or deleted;
- mutating commands preflight the complete operation;
- the package exports no importable JavaScript API.

Avoid adding prompts, remote registries, package-manager execution, source
merging, AST editing, or compatibility layers for unreleased formats.

## Verification

Run focused checks while iterating:

```sh
bun run test packages/catalog/tests
bun run coverage packages/catalog/tests
bun run check
```

Before review, run the packed consumer and full release gates:

```sh
bun run package:check
bun run release:verify
```

Update `README.md` for the ordinary workflow and `public-surface.md` for every
observable command, option, default, output, persisted field, or failure
change. Package verification must exercise the installed tarball rather than
relying only on source-checkout imports.
