# Documentation

This index routes application authors, API consumers, operators, and
contributors to the document that owns each subject. Pages under `guide/` are a
progressive authoring path. Reference pages define contracts; they do not repeat
the tutorials.

## Start an application

Read these pages in order:

1. [Getting started](guide/getting-started.md) scaffolds and runs one complete
   concept, composition, assembly, and client path.
2. [Define one behavior](guide/concepts.md) specifies, implements, tests, and
   registers a concept.
3. [Connect independent behaviors](guide/reactions.md) adds consequences,
   reads, fan-out, sibling paths, and chains.
4. [Views and formers](guide/views-and-formers.md) names policy and constructs
   result trees.
5. [Application boundary](guide/application-boundary.md) declares endpoints,
   assembles the application, generates the wire, and calls a typed client.

The guides are introductory. [Execution semantics](semantics.md) is the
authoritative contract when a guide omits an edge case.

## Look up a contract

- [Public API](public-surface.md) lists every supported package subpath and
  export, then records signatures, defaults, and directly observable behavior.
- [Concept specification format](concept-specification.md) defines `spec.md`,
  registration checks, source checks, and deliberately unchecked prose.
- [CLI reference](cli.md) defines `sync-engine new`, `check`, and `artifacts`,
  including output and failure behavior.
- [Execution semantics](semantics.md) defines action outcomes, matching,
  cardinality, ordering, failure, cancellation, retention, and boundary
  settlement.
- [Glossary](glossary.md) distinguishes the terms used by the guides and API.

## Find an example

- [Example book](book.md) places small read constructions beside generated
  read-back and representative errors.
- [Reading Circle](../examples/reading-circle/README.md) is the shortest complete
  multi-concept application.
- [Operations Room](../examples/operations-room/README.md) demonstrates
  selectable reaction packs, replaceable policy, and staged formers.

Both applications are independently installable. Their generated Markdown and
TypeScript files are pinned outputs from their assemblies.

## Evaluate a deployment

- [Operational limits](operations.md) states suitable and unsuitable uses,
  concurrency boundaries, resource limits, persistence limits, and host
  responsibilities.
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
