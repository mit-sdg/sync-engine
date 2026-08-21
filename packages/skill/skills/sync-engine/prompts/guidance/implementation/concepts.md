# Concept implementation guidance

Implement a concept as an ordinary TypeScript class; no engine base class is needed.
Each action takes one named input object and returns its named result. Each `_` query
returns the declared row shape and cardinality.

Registration reads the class prototype. Only declared actions and `_` queries may appear
there, so keep helpers `#private` or module-level. TypeScript `private` still emits a
prototype method and is therefore visible as an undeclared action. Declare an explicit
constructor, initialize owned state there, and give every dependency parameter a default
so the class constructs with no arguments. The application worker owns specification
registration; export the class and one stable error class per declared refusal, but do not
call `registerConcept` here.

Map each expected refusal code to a stable error class. Faults remain unexpected. Enforce
invariants and race-sensitive decisions in the owning action and, where persistence is
involved, in the same storage transaction or constraint. Implement repetition and
lifecycle behavior exactly as contracted.

Concepts may share opaque identity types but never import, call, inspect, or copy facts
from one another. An example may demonstrate more than the approved contract; implement
the approved behavior only.

Test observable success, expected refusals, repetition, lifecycle, query cardinality and
ordering, and required storage guarantees. Tests should exercise the concept's public
contract rather than layout or framework internals.
