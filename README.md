# sync-engine

[![npm: core](https://img.shields.io/npm/v/@mit-sdg/sync-engine/beta?label=core)](https://www.npmjs.com/package/@mit-sdg/sync-engine)
[![npm: analysis](https://img.shields.io/npm/v/@mit-sdg/sync-engine-analysis/beta?label=analysis)](https://www.npmjs.com/package/@mit-sdg/sync-engine-analysis)
[![npm: HTTP](https://img.shields.io/npm/v/@mit-sdg/sync-engine-http/beta?label=HTTP)](https://www.npmjs.com/package/@mit-sdg/sync-engine-http)
[![npm: catalog](https://img.shields.io/npm/v/@mit-sdg/sync-engine-catalog/beta?label=catalog)](https://www.npmjs.com/package/@mit-sdg/sync-engine-catalog)
[![npm: skill](https://img.shields.io/npm/v/@mit-sdg/sync-engine-skill/beta?label=skill)](https://www.npmjs.com/package/@mit-sdg/sync-engine-skill)
[![CI](https://github.com/mit-sdg/sync-engine/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mit-sdg/sync-engine/actions/workflows/ci.yml?query=branch%3Amain)

sync-engine is an ESM-only TypeScript library for composing independently
implemented application behaviors. Each behavior, called a **concept**, owns
its state, actions, queries, and expected refusals. Application composition
connects concepts without making their implementations depend on one another.

The main composition forms are:

- **reactions**, which ask for consequences after action asks or outcomes;
- **views**, which name reusable relations and policy decisions;
- **formers**, which build current-state result trees; and
- **endpoints**, which connect outside requests to composed behavior.

The engine validates the composition, instruments the selected concept
instances, and records action occurrences. Tooling can derive an assembled
read-back and TypeScript boundary contract from that assembly.

## Status and requirements

Version 1 is in beta, and only the newest beta release is supported. Core is
ESM-only. The built library supports Node.js 24; the CLI, setup, and examples
require Bun 1.3; and typechecking requires TypeScript 6. Read the [support
policy](SUPPORT.md) for the exact supported ranges, and review the [operational
limits](docs/user/reference/operations.md) before choosing a deployment.

## Install in an existing project

```sh
bun add @mit-sdg/sync-engine@beta
```

## Packages

| Package                                                                                                         | Role                                                                     |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`@mit-sdg/sync-engine`](README.md)                                                                             | Concepts, composition, assembly, boundaries, clients, tooling, and CLI   |
| [`@mit-sdg/sync-engine-analysis`](https://github.com/mit-sdg/sync-engine/blob/main/packages/analysis/README.md) | Deterministic IR queries and optional TypeScript project/source evidence |
| [`@mit-sdg/sync-engine-http`](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/README.md)         | Maintained HTTP handler, Fetch client, and generated wire projection     |
| [`@mit-sdg/sync-engine-catalog`](https://github.com/mit-sdg/sync-engine/blob/main/packages/catalog/README.md)   | CLI-only read-only browser for curated concept and recipe source         |
| [`@mit-sdg/sync-engine-skill`](https://github.com/mit-sdg/sync-engine/blob/main/packages/skill/README.md)       | Independent design review and isolated implementation Agent Skill        |

## Create your first application

Create a Bun package and initialize the concept-free application files:

```sh
mkdir workshop-app
cd workshop-app
bun init -y
bun add --exact @mit-sdg/sync-engine@beta
bunx --package @mit-sdg/sync-engine@beta sync-engine setup
```

For a reproducible evaluation, replace `@beta` with a pinned version. `setup` adds
missing compatible development dependencies and standard scripts, runs Bun
installation after a manifest edit, and creates only absent source/config templates.
It never overwrites existing source, config, or tsconfig.

[Getting started](docs/user/guide/getting-started.md) verifies the empty application.

## Documentation

Choose the path that matches the next task:

| Task                                                         | Start here                                              |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| Understand concepts, composition, assembly, and the boundary | [Application model](docs/user/overview.md)              |
| Decide what the concepts are and review a design             | [Designing with concepts](docs/user/design.md)          |
| Initialize and run a concept-free application                | [Getting started](docs/user/guide/getting-started.md)   |
| Study concepts, reactions, views, formers, and endpoints     | [Reading Circle](examples/reading-circle/README.md)     |
| Look up exports, options, and defaults                       | [Public API](docs/user/reference/public-api.md)         |
| Determine exact runtime behavior                             | [Execution semantics](docs/user/reference/semantics.md) |
| Select a deployment and identify host responsibilities       | [Operational limits](docs/user/reference/operations.md) |
| Inspect complete applications                                | [Example applications](examples/README.md)              |

### Coding agents

Start with the installed package's [`docs/user/llms.txt`](docs/user/llms.txt).
Its package-local links match the installed beta. Treat `docs/user/`, the shipped
examples, and declared public entrypoints as the consumer surface. Do not infer
contracts from `dist/engine/`, `dist/command/`, repository source, or deep
imports; report a documentation gap when the public docs and exported
TypeScript signatures are insufficient.

## A first composition rule

After the empty application runs, a reaction can connect two independently
implemented concepts. This example opens a discussion whenever Selecting
returns a new selection:

```ts
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concepts.ts";

const { Discussing, Selecting } = concepts;

export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

At runtime, a returned `Selecting.choose` occurrence binds `selection` and asks
`Discussing.open`. Selecting and Discussing remain independently implemented.

See the [Reading Circle source map](examples/reading-circle/README.md#source-map)
for a complete application, [application design authoring](docs/user/guide/authoring.md)
for the authored contract around executable declarations, and [execution
semantics](docs/user/reference/semantics.md) for ordering and failure behavior.

## Expose an application boundary

An endpoint uses the same reaction model to receive an outside request and
produce one answer. It is a declaration in the composition; an assembly makes
that declaration callable:

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "./concepts.ts";

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

## Runtime boundaries to plan for

Actions serialize per concept instance within one assembly, not across concepts,
assemblies, or processes. The engine does not provide multi-action transactions,
accepted-work cancellation, concept-state persistence, restart replay,
distributed serialization, or exactly-once execution. Generated contracts do
not validate runtime values; add endpoint validators when untyped callers need
runtime checks. See [Execution semantics](docs/user/reference/semantics.md) for
the exact contract and [Operational limits](docs/user/reference/operations.md)
for deployment responsibilities.

## Run the shipped examples

The [example index](examples/README.md) lists each standalone application's
install, check, and start commands.

## Work on sync-engine itself

Project contributors use these documents:

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
