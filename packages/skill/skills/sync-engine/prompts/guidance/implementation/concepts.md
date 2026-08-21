# Concept implementation guidance

Implement a concept as an ordinary TypeScript class; no engine base class is needed.
Each action takes one named input object and returns exactly one object-shaped successful
result. Match authored results literally:

- `return (item: Item)` returns `{ item }`;
- `return ()` returns `{}` (prefer `Record<string, never>`), never `void` or `undefined`;
- a `one` query returns one row object;
- an `optional` query returns `[]` or `[row]`; and
- a `many` query returns an array of rows in its promised stable order.

These TypeScript and runtime shapes are part of registration compatibility. Never use
`undefined as any`, a scalar, or a cardinality-changing convenience shape.

Registration reads the class prototype. Only declared actions and `_` queries may appear
there, so keep helpers `#private` or module-level. TypeScript `private` still emits a
prototype method and is therefore visible as an undeclared action. Declare an explicit
constructor, initialize owned state there, and give every dependency parameter a default
so the class constructs with no arguments. The application worker owns specification
registration; export the class and one stable error class per declared refusal, but do not
call `registerConcept` here.

Represent each expected refusal code with one exported stable error class so the
application worker can map it during registration. Faults remain unexpected. Enforce
invariants and race-sensitive decisions in the owning action and, where persistence is
involved, in the same storage transaction or constraint. Implement repetition and
lifecycle behavior exactly as contracted.

Concepts may share opaque identity types but never import, call, inspect, or copy facts
from one another. An example may demonstrate more than the approved contract; implement
the approved behavior only.

Test exact action result objects, observable success, expected refusals, repetition,
lifecycle, query cardinality and ordering, and required storage guarantees. In particular,
test empty optional and many queries as arrays and empty-result actions as `{}`. Tests
should exercise the concept's public contract rather than layout or framework internals.
