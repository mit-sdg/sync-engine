# sync-engine

[![npm: core](https://img.shields.io/npm/v/@mit-sdg/sync-engine/beta?label=core)](https://www.npmjs.com/package/@mit-sdg/sync-engine)
[![npm: analysis](https://img.shields.io/npm/v/@mit-sdg/sync-engine-analysis/beta?label=analysis)](https://www.npmjs.com/package/@mit-sdg/sync-engine-analysis)
[![npm: HTTP](https://img.shields.io/npm/v/@mit-sdg/sync-engine-http/beta?label=HTTP)](https://www.npmjs.com/package/@mit-sdg/sync-engine-http)
[![npm: catalog](https://img.shields.io/npm/v/@mit-sdg/sync-engine-catalog/beta?label=catalog)](https://www.npmjs.com/package/@mit-sdg/sync-engine-catalog)
[![npm: skill](https://img.shields.io/npm/v/@mit-sdg/sync-engine-skill/beta?label=skill)](https://www.npmjs.com/package/@mit-sdg/sync-engine-skill)
[![CI](https://github.com/mit-sdg/sync-engine/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/mit-sdg/sync-engine/actions/workflows/ci.yml?query=branch%3Amain)

sync-engine builds an application out of independent pieces called concepts. A
concept owns one behavior along with its own state, actions, and queries:
Posting, Commenting, Sessioning, Authenticating. None of them imports another,
so each can be written and tested on its own.

The application is a separate layer that connects them. It declares which
concepts are present, how an outside request reaches them, and what follows
after an action returns. Concepts can then be reused elsewhere, and anything
specific to this application lives in the composition instead of inside a
concept.

At runtime the engine checks the composition, installs the selected concept
instances, and records every action occurrence. The same assembly feeds the
tooling, which generates a TypeScript contract for callers and a record of
everything that was assembled.

## Install

```sh
bun add @mit-sdg/sync-engine@beta
```

To start a new project:

```sh
mkdir board
cd board
bunx --package @mit-sdg/sync-engine@beta sync-engine setup
```

`setup` completes the package manifest, adds development dependencies and
standard scripts, and writes any application files that are missing, without
overwriting anything that is already there. Pin an exact version in place of `@beta`
when the result has to be reproducible.

[Getting started](docs/user/guide/getting-started.md) runs the empty
application.

## What you write

Each concept is a TypeScript class and a Markdown specification. The class holds
the state and implements the actions and queries; the specification records the
concept's purpose, its operational principle, its state, and every action and
query with the refusals it can return. [Concept specification
format](docs/user/reference/concept-specification.md) defines the sections.

The application connects concepts through four kinds of declaration:

- **Endpoints** take a request from outside and produce one answer.
- **Reactions** ask for something after an action returns.
- **Formers** build a result tree out of current state.
- **Views** name a relation or a policy decision that several declarations share.

This endpoint from Message Board resolves the session before publishing, so the
request never gets to name its own author:

```ts
import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { concepts } from "../concepts.ts";

const { Posting, Sessioning } = concepts;

const PublishPost = endpoint(
  "/board/post",
  ({ session, username, content, post }) =>
    receive({ session, content })
      .then(Sessioning.current({ session }).responds({ subject: username }))
      .then(Posting.publish({ author: username, content }).responds({ post }))
      .then(respond({ post })),
  { input: { required: ["session", "content"] } },
);
```

A reaction from Reading Circle opens a discussion whenever the circle chooses
its next reading. Selecting and Discussing never refer to each other, and this
reaction is the only link between them:

```ts
import { reaction, when } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concepts.ts";

const { Discussing, Selecting } = concepts;

const SelectedReadingOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

An assembly makes those endpoints callable, in process or over HTTP through
`@mit-sdg/sync-engine-http`.

## Design documents

Specifications and application prose are Markdown files under `design/`:

```text
design/concepts/*.md       one specification per concept
design/compositions/*.md   what each selected declaration is for
design/types.md            the concept instances and the types they share
```

`sync-engine check-design` checks these files on their own, without loading
application code. `sync-engine check` also compares each registered
specification against the TypeScript that implements it. Conditions and query
meanings stay in natural language, which makes them your tests' responsibility.

Only the design tooling reads these files. A running application never loads
them, so they do not have to be deployed.

## Checks and generated contracts

```sh
sync-engine check-design design/concepts/*.md   # the design alone
sync-engine check                               # design agreement and application diagnostics
sync-engine verify                              # design, application, and artifact checks in one report
sync-engine artifacts pin                       # regenerate the read-back and the wire contract
sync-engine artifacts check                     # confirm both still match the assembly
sync-engine artifacts diff <old-manifest>       # compare a saved manifest with the current application
```

`check-design`, `check`, `verify`, and `artifacts check` accept `--format json`.

## Build it with an agent

[`@mit-sdg/sync-engine-skill`](https://github.com/mit-sdg/sync-engine/blob/main/packages/skill/README.md) is an Agent Skill that
runs the whole workflow: brief, design, independent criticism, then separate
roles for concept implementation, application implementation, and evidence.
Every role is a fresh agent, so the critic did not write the design and the
evidence worker did not build what it tests. The skill installs a matching
release into the application and refuses to run against a different one.

## Packages

| Package                                                                                                           | Role                                                                   |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [`@mit-sdg/sync-engine`](README.md)                                                                               | Concepts, composition, assembly, boundaries, clients, tooling, and CLI |
| [`@mit-sdg/sync-engine-http`](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/README.md)           | HTTP handler, Fetch client, and generated wire projection              |
| [`@mit-sdg/sync-engine-analysis`](https://github.com/mit-sdg/sync-engine/blob/main/packages/analysis/README.md)   | Deterministic queries over the design, with optional source evidence   |
| [`@mit-sdg/sync-engine-catalog`](https://github.com/mit-sdg/sync-engine/blob/main/packages/catalog/README.md)     | Read-only browser for curated concept and recipe source                |
| [`@mit-sdg/sync-engine-skill`](https://github.com/mit-sdg/sync-engine/blob/main/packages/skill/README.md)         | Agent Skill that runs the design and implementation workflow           |
| [`@mit-sdg/sync-engine-rendering`](https://github.com/mit-sdg/sync-engine/blob/main/packages/rendering/README.md) | Portable renderer declarations and endpoint-returned invocation data   |

## Documentation

| Task                                        | Document                                                |
| ------------------------------------------- | ------------------------------------------------------- |
| Understand how an application fits together | [Application model](docs/user/overview.md)              |
| Decide what the concepts should be          | [Designing with concepts](docs/user/design.md)          |
| Write the design files                      | [Application authoring](docs/user/guide/authoring.md)   |
| Look up exports, options, and defaults      | [Public API](docs/user/reference/public-api.md)         |
| Know the exact runtime behavior             | [Execution semantics](docs/user/reference/semantics.md) |
| Plan a deployment                           | [Operational limits](docs/user/reference/operations.md) |

Three complete applications ship with the package. Reading Circle is the
shortest one that uses all four declaration kinds, Operations Room makes its
policy replaceable and its reaction packs selectable, and Message Board covers
authentication, cookies, typed HTTP, and a browser client. The [example
index](examples/README.md) lists the install and start commands for each.

### Coding agents

Start with the installed package's [`docs/user/llms.txt`](docs/user/llms.txt);
its links match the installed beta. Treat `docs/user/`, the shipped examples,
and the declared public entrypoints as the whole surface. Do not infer contracts
from `dist/`, from repository source, or from deep imports; when the public
docs fall short, report that as a documentation gap.

## What the engine does not do

Actions serialize per concept instance inside one assembly, not across concepts,
assemblies, or processes. The engine does not provide multi-action transactions,
cancellation of accepted work, persistence of concept state, replay after a
restart, or exactly-once execution.
Generated contracts describe types and do not check runtime values, so attach
endpoint validators when callers are untyped.

[Execution semantics](docs/user/reference/semantics.md) gives the exact
contract, and [operational limits](docs/user/reference/operations.md) covers
what the host is responsible for.

## Versions

Version 1 is in beta, and only the newest beta is supported. A newer beta can
break the one before it, so read the [changelog](CHANGELOG.md), regenerate the
pinned artifacts, and typecheck consumers before moving a pin.

The library is ESM-only and runs on Node.js 24. The CLI, `setup`, and the
examples need Bun 1.3, and typechecking needs TypeScript 6. The [support
policy](SUPPORT.md) has the exact ranges.

## Working on sync-engine itself

- [Contributing](https://github.com/mit-sdg/sync-engine/blob/main/CONTRIBUTING.md)
  selects the checks a change needs.
- [Repository agent instructions](https://github.com/mit-sdg/sync-engine/blob/main/AGENTS.md)
  cover checkout mechanics and source boundaries for coding agents.
- [Project documentation](https://github.com/mit-sdg/sync-engine/blob/main/docs/project/index.md)
  describes the architecture and the release procedure.

## License

[Apache 2.0](LICENSE)
