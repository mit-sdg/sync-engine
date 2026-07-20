# Shared concept map

This directory is the manifest of the generic concepts shared by the shipped
applications. Read each behavior in its specification before opening the
implementation:

- [Alerting](alerting/spec.md) — keep alerts open for each recipient until
  acknowledgement.
- [Discussing](discussing/spec.md) — open discussions, record responses, and
  close them.
- [Gathering](gathering/spec.md) — create gatherings and manage membership.
- [Selecting](selecting/spec.md) — keep one current item for each scope.

The [concept chapter](../../docs/guide/concepts.md) explains how to specify,
implement, register, and test a concept. Each directory keeps those local
pieces in fixed seats:

- `spec.md` is the behavior's full readable contract;
- the concept class implements its actions, state, and queries;
- `errors.ts` defines the classes used for deliberate refusals;
- the concept test drives its Principle and query promises directly;
- `registry.ts` owns the specification import, stable refusal codes, and named
  floor factories.

The registry imports `spec.md` as text so generated read-backs project Purpose
and Principle from the authored source. An application's explicit concept set
includes each registry once and derives its vocabulary, references, and
implementation sets.
