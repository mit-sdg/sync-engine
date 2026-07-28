# sync-engine

sync-engine is a TypeScript library for composing independently implemented
application behaviors. Each behavior, called a **concept**, owns its state,
actions, queries, and expected refusals. Application composition connects
concepts without adding peer imports to their implementations.

Composition has four main parts:

- **reactions** ask for consequences after action outcomes;
- **views** name shared relations and policy decisions;
- **formers** build typed result trees from current state;
- **endpoints** connect outside requests to composed behavior.

The engine validates an assembled composition, executes it, records action
occurrences, and can generate an assembled read-back and TypeScript wire
contract.

## Status and requirements

Version 1 is alpha. It is not recommended for production. Public APIs,
execution behavior, and generated files may change incompatibly between alpha
releases. Pin an exact version for evaluation and read the [operational
limits](docs/operations.md) before choosing a deployment.

The package is ESM-only. Shipped TypeScript projects and CLI commands require
Bun 1.3 or newer. Built library modules support Node.js 24 or newer.

## Install in an existing project

```sh
bun add @mit-sdg/sync-engine@alpha
```

## Create an application

```sh
bunx --package @mit-sdg/sync-engine@alpha sync-engine new note-keeper
cd note-keeper
bun install
```

For a reproducible evaluation, replace `@alpha` with an exact version such as
`@1.0.0-alpha.0`.

The generated project declares its own package dependency and contains one
complete behavior: a specification, plain TypeScript class, principle test,
registry, concept set, composition, assembly, gateway scenario, and
generated-artifact configuration. Continue with [Getting
started](docs/guide/getting-started.md#run-the-complete-lifecycle) to run and
inspect it.

## Composition example

This reaction belongs to the application, not to either concept. It opens a
discussion whenever Selecting returns a new selection:

```ts
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "./concept-set.ts";

const { Discussing, Selecting } = concepts;

export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

Calling `Selecting.choose(...)` in this declaration creates authoring data; it
does not invoke the concept. At runtime, the reaction watches a returned
`Selecting.choose` occurrence, binds `selection` from its result, and asks
`Discussing.open`. Selecting and Discussing remain independently implemented.

See [Connect independent behaviors](docs/guide/reactions.md) for the authoring
rules and [Execution semantics](docs/semantics.md) for ordering and failure
behavior.

## Contract boundary

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

An assembly can expose the endpoint through a direct invoker, the standard
gateway, a local JSON-parity client, or HTTP. Use the production HTTP profile to
project only registered public error categories without choosing a credential
mechanism; add the same-origin cookie floor only when the application needs that
binding. The gateway/invoker-only HTTP form is a low-level raw envelope adapter,
not the recommended direct public boundary. Generated TypeScript
describes accepted inputs and possible outputs. It does not validate hostile
values at runtime; endpoint validator hooks provide that separate runtime
contract when an application needs it. Validators are application-supplied;
the engine does not infer them from concept specifications.

## Guarantees and non-guarantees

The ordinary assembly provides these guarantees:

- one action body runs at a time per concept instance within one assembly;
- each action ask and its return, refusal, or fault are recorded;
- composition is checked before registered behavior executes;
- generated artifacts fail rather than silently omit an endpoint they cannot
  represent;
- optional execution profiles bound admission and accepted causal work;
- assemblies and gateways stop admission and report actual idle state;
- stable operational events carry route and correlation without application values;
- handled client and boundary failures resolve as typed result envelopes.

The ordinary assembly does not provide transactions across actions, rollback,
concept-state persistence, occurrence replay, restart recovery, distributed
serialization, exactly-once execution, or runtime validation of generated
types. A specification's optional State section is uninterpreted human notation:
it is not compared with class fields or storage and does not enter manifests,
read-back, wire contracts, input contracts, or endpoint validators. State
properties belong in principle, implementation, and backend constraint tests.
Runtime validation is explicit per endpoint rather than inferred from generated
types or State notation. Timeout and abort stop waiting; they do not cancel
accepted work. The default in-memory log retains a bounded inspection window
rather than every occurrence forever.

See [Execution semantics](docs/semantics.md) for the precise contracts and
[Operational limits](docs/operations.md) for selection and deployment guidance.

## Documentation

The [documentation index](docs/index.md) separates the material by task.

- [Getting started](docs/guide/getting-started.md) — scaffold and run the
  smallest complete application.
- [Authoring guide](docs/guide/concepts.md) — concepts, reactions, views,
  formers, and endpoints in dependency order.
- [Example book](docs/book.md) — small, tested reading constructions and exact
  registration failures.
- [Public API](docs/public-surface.md) — package subpaths, exports, signatures,
  defaults, and error codes.
- [Concept specification format](docs/concept-specification.md) and [CLI
  reference](docs/cli.md) — authoritative file and command contracts.
- [Examples](examples/README.md) — independently installable Reading Circle,
  Operations Room, and Production HTTP applications.
- [Engine architecture](docs/architecture.md) and [contributing
  guide](CONTRIBUTING.md) — implementation and repository work.

From a source checkout, install dependencies and run all example scenarios:

```sh
bun install
bun run scenario
```

## Upgrading alpha versions

Alpha releases carry no migration guarantee. Before changing a pinned version,
read the [changelog](CHANGELOG.md) and the corresponding [GitHub
release](https://github.com/mit-sdg/sync-engine/releases). Regenerate and review
all pinned artifacts after the upgrade.

## License

[Apache 2.0](LICENSE)
