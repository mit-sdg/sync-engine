# Concept Design with sync-engine

Concept Design builds an application from independent **concepts** joined by
**reactions**, with **views** naming shared questions and **formers** shaping
complete answers. sync-engine interprets that authored design and records what
happens in an append-only occurrence log.

This page routes the documentation. The guided curriculum first builds a small
whole application, then revisits each part in depth. Reference pages answer
exact questions without repeating the guides.

## Build a whole, then revisit its parts

Start with [Getting started](./guide/getting-started.md). It creates a runnable
operations room with concept specifications and implementations, a reaction, a
former, an application boundary, an assembled read-back, a wire contract, and
a typed client.

Then follow the topical chapters in order:

1. [Define one behavior](./guide/concepts.md) — specify, implement, register,
   and test a concept by itself.
2. [Connect independent behaviors](./guide/reactions.md) — add reactions,
   standing reads, and a proven partition in the application composition.
3. [Application boundary](./guide/application-boundary.md) — specialize the
   reaction frame for outside requests, assemble the application, and carry its
   contract to a client.
4. [Views and formers](./guide/views-and-formers.md) — name policy questions
   and form complete read results.

An endpoint belongs to the third chapter because it is a reaction specialized
at the application boundary. It adds an outside trigger, path, input contract,
correlation, and response; it is not another core design piece.

## Find the right reference

- **Compare one construction or diagnose a rejected one.** Use the
  [example book](./book.md), where each variation appears beside the engine's
  generated read-back or exact registration error.
- **Check what execution guarantees.** Read [Execution
  semantics](./semantics.md) for actions, reactions, reads, formed results,
  application boundaries, and generated wire contracts.
- **Plan for failure and operation.** Read [Consistency and
  operations](./consistency-and-operations.md) for ordering, partial failure,
  cancellation, logs, restart, and the guarantees the runtime does not make.
- **Find an import, export, type, or signature.** Use the [Public API
  reference](./public-surface.md), the complete register of package subpaths
  and callable names.
- **Read a complete application.** Choose a route from the [examples
  map](../examples/README.md). Each application README provides a source map
  and points to its generated evidence.
