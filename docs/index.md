# Documentation

This index routes application authors, client authors, operators, and
contributors to the page that answers each kind of question. The guides explain
representative use. The reference pages define the observable contracts.

## Understand the application model

Read [How sync-engine applications fit together](overview.md) for the roles of
concepts, composition, assembly, gateways, clients, generated contracts, and
occurrence evidence. Use the [Glossary](glossary.md) when a term has a narrower
meaning than it does in ordinary TypeScript or HTTP code.

## Decide what the concepts are

[Designing with concepts](design/index.md) is the design document set: how to
tell a concept from an entity, screen, workflow, or implementation component;
how to judge a candidate; when to split or combine; what a concept owns; how
reactions compose concepts through explicit rules; and how to review a whole
design. It teaches design decisions. Start there when designing or reviewing an
application, and use the guides below for the authoring API.

## Build an application

Read these pages in order:

1. [Getting started](guide/getting-started.md) scaffolds and runs one complete
   Note Keeper application.
2. [Define one behavior](guide/concepts.md) begins an Operations Room case study
   by specifying, implementing, testing, and registering its Alerting concept.
3. [Connect independent behaviors](guide/reactions.md) adds consequences,
   current-state reads, fan-out, independent paths, and chains to that case
   study.
4. [Views and formers](guide/views-and-formers.md) names policy and constructs
   current result trees across the Operations Room concepts.
5. [Application boundary](guide/application-boundary.md) declares endpoints,
   assembles the application, generates the wire, and calls a typed client.

The first page is a standalone tutorial. The remaining pages inspect one larger
shipped example and leave the generated Note Keeper project unchanged. The
guides are introductory. [Execution semantics](semantics.md) is authoritative
when a guide simplifies a runtime rule.

## Call an existing application

Client code uses the generated wire type and the `client` package. Start with [Call the typed
client](guide/application-boundary.md#call-the-typed-client), then use the
[`client` API reference](public-surface.md#client) for local and custom
transport constructors, then the [HTTP companion package](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md)
for the maintained fetch transport. The [Production HTTP
example](../examples/production-http/README.md) shows the projected public
contract used by an HTTP client.

## Look up a contract

- [Core Public API](public-surface.md) lists every supported core package
  subpath and export, then records signatures, defaults, and directly observable
  behavior.
- [HTTP Public API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md) lists the maintained
  companion's supported subpaths, exports, and transport behavior.
- [Concept specification format](concept-specification.md) defines `spec.md`,
  registration checks, source checks, and deliberately unchecked prose.
- [CLI reference](cli.md) defines `sync-engine new`, `check`, and `artifacts`,
  including output and failure behavior.
- [Execution semantics](semantics.md) defines action outcomes, matching,
  cardinality, ordering, failure, cancellation, retention, and boundary
  settlement.
- [Glossary](glossary.md) distinguishes the terms used by the guides and API.

## Find an example

- [Persistence, restart, and recovery](advanced-recipes.md) separates durable
  concept state, occurrence evidence, process-local derived state, and explicit
  recovery.
- [Read construction cookbook](book.md) places small read constructions beside
  generated read-back and representative errors.

| Application                                              | Use it for                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Note Keeper](guide/getting-started.md)                  | The smallest scaffolded lifecycle: one concept, two endpoints, a gateway, and a local client                    |
| [Reading Circle](../examples/reading-circle/README.md)   | The shortest complete multi-concept application and the vocabulary used by the cookbook                         |
| [Operations Room](../examples/operations-room/README.md) | Selectable reaction packs, replaceable policy, implementation overrides, staged formers, and a nested dashboard |
| [Production HTTP](../examples/production-http/README.md) | Public-error projection, runtime validators, limits, correlation, and optional same-origin cookie credentials   |

All applications are independently installable. Their generated Markdown and
TypeScript files are pinned outputs from their assemblies.

## Evaluate a deployment

- [Operational limits](operations.md) states suitable and unsuitable uses,
  concurrency boundaries, resource limits, persistence limits, and host
  responsibilities.
- [Support policy](../SUPPORT.md) defines stable SemVer and generated-format
  compatibility, runtime/toolchain ranges, and the support window.
- [Security policy](../SECURITY.md) defines private vulnerability reporting,
  security-fix eligibility, response targets, and the host/application boundary.
- [Execution semantics](semantics.md#boundary-gateway-and-client) defines the
  transport-neutral boundary and client result model.
- [Changelog](../CHANGELOG.md) records release-specific compatibility changes.

## Contribute

- [Contributing](../CONTRIBUTING.md) selects checks by change type and identifies
  generated files.
- [Engine architecture](architecture.md) maps runtime and tooling subsystems and
  records dependency rules.
- [Contributor release procedure](releasing.md) describes release preparation,
  publication, verification, and bad-release response.

## Agent index

[`llms.txt`](llms.txt) is the compact index for coding agents and other
automated tools using sync-engine. It records supported imports, the authoring
sequence, commands, examples, contract boundaries, and the order in which to
resolve conflicting guidance.
