# sync-engine

[![npm](https://img.shields.io/npm/v/@mit-sdg/sync-engine/beta?label=npm)](https://www.npmjs.com/package/@mit-sdg/sync-engine)
[![HTTP npm](https://img.shields.io/npm/v/@mit-sdg/sync-engine-http/beta?label=HTTP%20npm)](https://www.npmjs.com/package/@mit-sdg/sync-engine-http)
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
[operational limits](docs/operations.md) before choosing a deployment.

The package is ESM-only. See the [support policy](SUPPORT.md) for current runtime
and toolchain requirements.

## Install in an existing project

```sh
bun add @mit-sdg/sync-engine@beta
```

## Packages

| Package                                                                                       | Role                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `@mit-sdg/sync-engine`                                                                        | Concepts, composition, assembly, boundaries, clients, tooling, and CLI |
| [`@mit-sdg/sync-engine-http`](https://github.com/mit-sdg/sync-engine/tree/main/packages/http) | Maintained HTTP handler, fetch client, and generated wire projection   |

## Create an application

```sh
bunx --package @mit-sdg/sync-engine@beta sync-engine new note-keeper
cd note-keeper
bun install
```

For a reproducible evaluation, replace `@beta` with a pinned version.

The generated project declares its own package dependency and contains one
complete behavior: a specification, plain TypeScript class, principle test,
registry, concept set, composition, assembly, gateway scenario, and
generated-artifact configuration. Continue with [Getting
started](docs/guide/getting-started.md#run-the-complete-lifecycle) to run and
inspect it.

## Documentation

Choose the path that matches the work:

| Task                                                         | Start here                                           |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| Understand concepts, composition, assembly, and the boundary | [Application model](docs/overview.md)                |
| Decide what the concepts are and review a design             | [Designing with concepts](docs/design/index.md)      |
| Build and run the generated application                      | [Getting started](docs/guide/getting-started.md)     |
| Add concepts, reactions, views, formers, and endpoints       | [Authoring path](docs/index.md#build-an-application) |
| Look up exports, options, and defaults                       | [Public API](docs/public-surface.md)                 |
| Determine exact runtime behavior                             | [Execution semantics](docs/semantics.md)             |
| Select a deployment and identify host responsibilities       | [Operational limits](docs/operations.md)             |
| Inspect complete applications                                | [Example applications](examples/README.md)           |

The [documentation index](docs/index.md) also routes client authors,
operators, and contributors. Automated tools should begin with
[`docs/llms.txt`](docs/llms.txt), which records the supported imports, authoring
sequence, commands, and source-of-truth order.

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

See [Connect independent behaviors](docs/guide/reactions.md) for the authoring
rules and [Execution semantics](docs/semantics.md) for ordering and failure
behavior.

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

An application built with `assemble(...)` has these relevant boundaries:

| Property         | Contract                                                                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action execution | One action body runs at a time per concept instance within one assembly. Different instances and flows may overlap.                                                                                                           |
| Evidence         | Each action ask and its return, refusal, or fault is recorded in an engine-owned occurrence index. An optional `LogSink` receives redacted audit entries and must return `undefined` synchronously. Neither is concept state. |
| Retention        | Ordinary assembly retains the 100 most recent settled flows by default. Configure `{ window: number }` or `"keepAll"`; window enforcement runs after flow settlement.                                                         |
| Composition      | Assembly rejects local reactions, views, and formers before exposing routes or generating artifacts.                                                                                                                          |
| Caller typing    | Generated contracts typecheck callers. They do not validate runtime values.                                                                                                                                                   |
| Cancellation     | Timeout and abort stop the caller's wait. They do not cancel accepted work.                                                                                                                                                   |
| Persistence      | The engine does not provide concept-state persistence, occurrence replay, restart recovery, or transactions across actions.                                                                                                   |
| Distribution     | The engine does not provide distributed serialization, deduplication, or exactly-once execution.                                                                                                                              |

The optional State section in a concept specification is uninterpreted prose for
readers. Registration derives no schema or validator from it. See [Concept
specification format](docs/concept-specification.md#state-notation) for what is parsed,
[Execution semantics](docs/semantics.md) for the complete runtime contract, and
[Operational limits](docs/operations.md) before deployment.

## Run the shipped examples

From a source checkout, install dependencies and run all example scenarios:

```sh
bun install
bun run scenario
```

## Upgrading beta versions

Stable releases follow Semantic Versioning. Before changing a pinned version,
read the [changelog](CHANGELOG.md) and the corresponding [GitHub
release](https://github.com/mit-sdg/sync-engine/releases). Regenerate and review
all pinned artifacts, keep independently published packages within their
declared peer ranges, and typecheck their consumers.

## License

[Apache 2.0](LICENSE)
