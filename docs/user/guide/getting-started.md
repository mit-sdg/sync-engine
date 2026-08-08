# Getting started

This tutorial installs and runs a complete sync-engine application from the
source catalog. The result is an operations room that creates a gathering,
maintains membership, selects a mitigation, opens a discussion, alerts members,
enforces contribution policy, and forms a joined dashboard.

The catalog is a source starting point, not a runtime dependency. After
installation, the application owns and may change every concept and recipe.

## Prerequisites

Use a supported Bun release and a shell that can run the commands below. The
[runtime and toolchain support policy](../../../SUPPORT.md#runtime-and-toolchain)
lists exact ranges.

## Create the package shell

```sh
mkdir operations-room
cd operations-room
bun init -y
bun add --exact @mit-sdg/sync-engine@beta
bun add --dev "typescript@>=6 <7"
```

Pin matching core and catalog versions instead of `@beta` when reproducing an
evaluation or deployment exactly.

## Install the bundle

```sh
bunx --package @mit-sdg/catalog@beta catalog init bundle/operations-room --variant concept/gathering=memory
```

The explicit variant chooses the in-memory Gathering implementation. The
catalog also offers a repository variant with an application-supplied storage
interface:

```sh
bunx --package @mit-sdg/catalog@beta catalog show concept/gathering
```

`catalog init` writes `catalog.json`, `catalog.lock`, a managed text-module
declaration, two managed integration modules, and application-owned source. It
preflights the complete dependency closure and refuses to overwrite any
copied-source destination.

The important installed groups are:

```text
operations-room/
├── catalog.json
├── catalog.lock
├── generated.config.ts
├── CATALOG.md
└── src/
    ├── concept-set.ts
    ├── assembly.ts
    ├── edge.ts
    ├── scenario.ts
    ├── catalog/
    │   ├── text.generated.d.ts
    │   ├── registrations.generated.ts
    │   └── composition.generated.ts
    ├── computations/
    │   └── normalize-label.ts
    ├── concepts/
    │   ├── alerting/
    │   ├── discussing/
    │   ├── gathering/
    │   └── selecting/
    └── composition/
        ├── member-contributions.ts
        ├── normalized-selection.ts
        ├── operations-dashboard.ts
        ├── selection-alerts-members.ts
        └── selection-opens-discussion.ts
```

Each concept directory contains its specification, implementation,
registration, and executable principle evidence. Each composition recipe has a
paired loading test. `catalog.lock` records where source came from and its
installed hashes; it does not make copied files catalog-owned.

## Generate and check

```sh
bunx sync-engine artifacts pin
bunx sync-engine check --config generated.config.ts
bunx sync-engine artifacts check
bunx tsc --noEmit
```

Generation writes `generated/operations-room.md` and `generated/wire.ts`. Keep
both in source control. The read-back presents the assembled concepts and
composition for review; the wire module gives typed clients their endpoint
contracts.

The application check may report conservative advisory diagnostics for guarded
endpoint alternatives and source-order-sensitive reads. Review diagnostics
rather than treating warning absence as correctness evidence.

## Run entry evidence

```sh
bun src/concepts/alerting/alerting.test.ts
bun src/concepts/discussing/discussing.test.ts
bun src/concepts/gathering/gathering.test.ts
bun src/concepts/selecting/selecting.test.ts
bun src/computations/normalize-label.test.ts
```

Concept evidence runs implementations directly, independently of application
composition. Recipe declarations are exercised again by the complete scenario.

## Run the application

```sh
bun src/scenario.ts
```

The scenario calls the application through its local gateway and JSON boundary.
It creates Checkout latency with Mara as host, joins Lin, chooses a rollback,
records Lin's response, rejects a nonmember contribution, and reads a dashboard.
The dashboard shows both members, their open alerts, the current mitigation,
its discussion, and the ordered response. Generated identities vary by run.

## Understand the composition

The installed concepts remain independent:

- Gathering owns named groups and membership.
- Selecting owns one current item per scope.
- Discussing owns open discussions and ordered responses.
- Alerting owns pending recipient alerts.

Composition supplies the application meaning:

- A normalized gathering name becomes its initial selection.
- A selection opens a discussion.
- A selection alerts every current member.
- Membership views partition accepted and rejected contributions.
- The dashboard joins all four concepts without moving their state ownership.

`src/catalog/text.generated.d.ts`,
`src/catalog/registrations.generated.ts`, and
`src/catalog/composition.generated.ts` are the only catalog-owned TypeScript
files. Do not edit them. The declaration makes copied specification imports
type-safe; the concept set and assembly import the stable integration objects.
All concept, computation, recipe, and bundle source is application-owned.

## Adapt or add entries

Edit copied source normally. To compare it with the currently invoked catalog
snapshot without writing:

```sh
bunx --package @mit-sdg/catalog@beta catalog diff
```

Add another entry with `catalog add <entry>`. A locally changed dependency
produces a warning but is not overwritten. If a recipe filename collides, the
error prints a retry using `--file <alternative.ts>`.

Use [How sync-engine applications fit together](../overview.md) for the model,
[Application authoring](authoring.md) to extend the application, and the
[Public API](../reference/public-api.md) and [Execution semantics](../reference/semantics.md)
as authoritative references.
