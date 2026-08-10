# Using sync-engine

Files under `docs/user/` are for human or software agents that design, build,
call, or operate applications with sync-engine. This index does not cover
repository work.

If sync-engine is new to you, read [Getting started](guide/getting-started.md)
first. It creates and runs the smallest application. Then read the [application
model](overview.md) before choosing concept boundaries; return to the
[application authoring path](#application-authoring-path) when you are ready to
add behavior.

## Start by task

| Task                                        | Start with                                                                                                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Understand the application model            | [How sync-engine applications fit together](overview.md)                                                                                                   |
| Design concepts                             | [Designing with concepts](design.md)                                                                                                                       |
| Review a concept design                     | [Reviewing a design](guide/reviewing-a-design.md)                                                                                                          |
| Initialize the first application            | [Getting started](guide/getting-started.md)                                                                                                                |
| Extend a multi-concept application          | [Application authoring](guide/authoring.md)                                                                                                                |
| Call an existing application                | [`client` API](reference/public-api.md#client), then [Call the typed client](guide/authoring.md#call-the-typed-client)                                     |
| Construct a read                            | [Read construction cookbook](guide/read-construction.md)                                                                                                   |
| Add persistence, restart, or recovery       | [Persistence, restart, and recovery](guide/persistence-recovery.md)                                                                                        |
| Determine exact runtime behavior            | [Execution semantics](reference/semantics.md)                                                                                                              |
| Look up an export, command, format, or term | [Public API](reference/public-api.md), [CLI](reference/cli.md), [concept format](reference/concept-specification.md), or [glossary](reference/glossary.md) |
| Evaluate a deployment                       | [Operational limits](reference/operations.md)                                                                                                              |

## Application authoring path

The guides form one progression:

1. [Getting started](guide/getting-started.md) initializes and runs a
   concept-free application.
2. [Application authoring](guide/authoring.md) adds concepts, composition,
   assembly, generated artifacts, validation, and a typed client.
3. [Read construction cookbook](guide/read-construction.md) supplies smaller
   tested alternatives when a former needs optional, repeated, or folded data.
4. [Persistence, restart, and recovery](guide/persistence-recovery.md) covers
   host responsibilities beyond the in-memory first application.

The guides demonstrate representative constructions. [Execution
semantics](reference/semantics.md) is authoritative when a guide simplifies
runtime behavior, and [Operational limits](reference/operations.md) is the
selection point for deployment decisions.

## Engine-user document catalog

This catalog is exhaustive. A **tutorial** teaches through one complete first
task. A **how-to guide** completes a defined task. An **explanation** describes
the model or design reasoning. A **reference** defines observable behavior or
accepted forms. An **index** routes readers without owning those contracts.
Reference entries are grouped under `reference/`; task-oriented procedures are
grouped under `guide/`.

| Path                                                                                 | Class        | Scope                                                   |
| ------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------- |
| [`docs/user/index.md`](index.md)                                                     | Index        | Human-readable task and document map                    |
| [`docs/user/llms.txt`](llms.txt)                                                     | Index        | Absolute-link map and constraints for software agents   |
| [`docs/user/guide/getting-started.md`](guide/getting-started.md)                     | Tutorial     | Concept-free application setup                          |
| [`docs/user/guide/authoring.md`](guide/authoring.md)                                 | How-to guide | Multi-concept application authoring                     |
| [`docs/user/guide/reviewing-a-design.md`](guide/reviewing-a-design.md)               | How-to guide | Ordered concept and composition review                  |
| [`docs/user/guide/read-construction.md`](guide/read-construction.md)                 | How-to guide | Small tested read constructions and contrasts           |
| [`docs/user/guide/persistence-recovery.md`](guide/persistence-recovery.md)           | How-to guide | Persistence, restart, occurrence evidence, and recovery |
| [`docs/user/overview.md`](overview.md)                                               | Explanation  | Application model and guarantee boundaries              |
| [`docs/user/design.md`](design.md)                                                   | Explanation  | Concept boundaries, ownership, actions, and composition |
| [`docs/user/reference/public-api.md`](reference/public-api.md)                       | Reference    | Exact core exports and principal API shapes             |
| [`docs/user/reference/semantics.md`](reference/semantics.md)                         | Reference    | Execution, failure, ordering, and settlement contracts  |
| [`docs/user/reference/concept-specification.md`](reference/concept-specification.md) | Reference    | Concept-file grammar and validation boundaries          |
| [`docs/user/reference/cli.md`](reference/cli.md)                                     | Reference    | Installed command syntax and behavior                   |
| [`docs/user/reference/operations.md`](reference/operations.md)                       | Reference    | Deployment selection, limits, and host responsibilities |
| [`docs/user/reference/glossary.md`](reference/glossary.md)                           | Reference    | Preferred terminology                                   |

## Examples and policies

| Resource                                                    | Scope                                                                                  |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [Reading Circle](../../examples/reading-circle/README.md)   | Shortest complete multi-concept application                                            |
| [Operations Room](../../examples/operations-room/README.md) | Selectable reactions, replaceable policy, and staged formers                           |
| [Message board](../../examples/message-board/README.md)     | Complete same-origin browser app, authentication, typed transport, and secure sessions |
| [Support policy](../../SUPPORT.md)                          | Supported versions, runtimes, toolchains, and generated formats                        |
| [Security policy](../../SECURITY.md)                        | Vulnerability reporting and the host/application security boundary                     |
| [Changelog](../../CHANGELOG.md)                             | Release-specific compatibility and migration                                           |
