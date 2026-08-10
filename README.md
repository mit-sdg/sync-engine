# sync-engine

[![npm](https://img.shields.io/npm/v/@mit-sdg/sync-engine/beta?label=npm)](https://www.npmjs.com/package/@mit-sdg/sync-engine)
[![CI](https://github.com/mit-sdg/sync-engine/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mit-sdg/sync-engine/actions/workflows/ci.yml?query=branch%3Amain)

sync-engine is a TypeScript library for composing independently implemented
application behaviors. Each behavior, called a **concept**, owns its state,
actions, queries, and expected refusals. The application connects concepts in a
separate composition, leaving their implementations independent of peers.

Composition has four main parts:

- **reactions** ask for consequences after action asks or outcomes;
- **views** name shared relations and policy decisions;
- **formers** build current-state result trees;
- **endpoints** connect outside requests to composed behavior.

The engine validates the composition, instruments the selected concept
instances, and records action occurrences. Tooling can derive an assembled
read-back and TypeScript boundary contract from that assembly.

## Status and requirements

Version 1 is in beta. Only the newest beta release is supported. Read the
[support policy](SUPPORT.md) and review the
[operational limits](docs/user/reference/operations.md) before choosing a deployment.

The package is ESM-only. See the [support policy](SUPPORT.md) for current runtime
and toolchain requirements.

## Install in an existing project

```sh
bun add @mit-sdg/sync-engine@beta
```

## Packages

| Package                                                        | Role                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`@mit-sdg/sync-engine`](README.md)                            | Concepts, composition, assembly, boundaries, clients, tooling, and CLI   |
| [`@mit-sdg/sync-engine-analysis`](packages/analysis/README.md) | Deterministic IR queries and optional TypeScript project/source evidence |
| [`@mit-sdg/sync-engine-http`](packages/http/README.md)         | Maintained HTTP handler, Fetch client, and generated wire projection     |
| [`@mit-sdg/sync-engine-catalog`](packages/catalog/README.md)   | CLI-only curated concept and recipe source installer                     |

## Create an application

Create a Bun package, install core, and initialize the concept-free application
files:

```sh
mkdir workshop-app
cd workshop-app
bun init -y
bun add --exact @mit-sdg/sync-engine@beta
bunx --package @mit-sdg/sync-engine@beta sync-engine setup
```

For a reproducible evaluation, replace `@beta` with a pinned version. `setup`
never edits `package.json` or overwrites an application file. It reports missing
dependencies and scripts as guidance.

Continue with [Getting started](docs/user/guide/getting-started.md) to run the
empty application.

## Documentation

Choose the path that matches the work:

| Task                                                         | Start here                                                      |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| Understand concepts, composition, assembly, and the boundary | [Application model](docs/user/overview.md)                      |
| Decide what the concepts are and review a design             | [Designing with concepts](docs/user/design.md)                  |
| Initialize and run a concept-free application                | [Getting started](docs/user/guide/getting-started.md)           |
| Add concepts, reactions, views, formers, and endpoints       | [Authoring path](docs/user/index.md#application-authoring-path) |
| Look up exports, options, and defaults                       | [Public API](docs/user/reference/public-api.md)                 |
| Determine exact runtime behavior                             | [Execution semantics](docs/user/reference/semantics.md)         |
| Select a deployment and identify host responsibilities       | [Operational limits](docs/user/reference/operations.md)         |
| Inspect complete applications                                | [Example applications](examples/README.md)                      |

The [consumer documentation index](docs/user/index.md) routes application
designers, authors, callers, and operators. Human and software agents using the
engine can start with [`docs/user/llms.txt`](docs/user/llms.txt), which records
the supported imports, authoring sequence, commands, and source-of-truth order.

## How composition works

This reaction is part of the application composition. It opens a
discussion whenever Selecting returns a new selection:

```ts
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Discussing, Selecting } = concepts;

export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

Calling `Selecting.choose(...)` in this declaration records an action reference.
At runtime, a returned `Selecting.choose` occurrence activates the reaction,
binds `selection` from the result, and causes the reaction to ask
`Discussing.open`. Selecting and Discussing remain independently implemented.

See [Connect independent
behaviors](docs/user/guide/authoring.md#connect-independent-behaviors) for the
authoring path and [Execution semantics](docs/user/reference/semantics.md) for ordering and
failure behavior.

## Expose an application boundary

An endpoint uses the same reaction model to receive an outside request and
produce one answer:

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "./concept-set.ts";

const { Selecting } = concepts;

export const ChooseMitigation = endpoint(
  "/rooms/choose-mitigation",
  ({ room, mitigation, selection }) =>
    receive({ room, mitigation })
      .then(Selecting.choose({ scope: room, item: mitigation }).responds({ selection }))
      .then(respond({ mitigation })),
);
```

An assembly exposes endpoints through its direct invoker, the standard gateway,
a local client with JSON parity, or a transport adapter. Generated TypeScript
describes endpoint inputs, successful outputs, and errors for typed callers.
Applications attach endpoint validators when they also need runtime value
validation.

## Contract boundaries

Actions serialize per concept instance within one assembly, not across concepts,
assemblies, or processes. The engine does not provide multi-action transactions,
accepted-work cancellation, concept-state persistence, restart replay,
distributed serialization, or exactly-once execution. Generated contracts do
not validate runtime values. See [Execution semantics](docs/user/reference/semantics.md) for
the contract and [Operational limits](docs/user/reference/operations.md) before deployment.

## Run the shipped examples

Each example is a standalone application. The [example
index](examples/README.md) selects an application and lists its local install,
check, and start commands.

## Work on sync-engine itself

Consumer documentation does not describe changes to this repository. Project
contributors use these repository documents:

- [Contributing](https://github.com/mit-sdg/sync-engine/blob/main/CONTRIBUTING.md)
  selects checks by change type.
- [Repository agent instructions](https://github.com/mit-sdg/sync-engine/blob/main/AGENTS.md)
  define checkout mechanics and source boundaries for coding agents.
- [Project documentation](https://github.com/mit-sdg/sync-engine/blob/main/docs/project/index.md)
  classifies the implementation architecture and release procedure.

## Upgrading beta versions

A newer beta may make incompatible changes. Before changing a pinned version,
read the [changelog](CHANGELOG.md), regenerate and review pinned artifacts, and
typecheck consumers. Each installed package README defines its compatibility
requirements. The [support policy](SUPPORT.md) defines the core support window.

## License

[Apache 2.0](LICENSE)
