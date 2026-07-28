# Glossary

This glossary defines the terms used by sync-engine documentation. The public
interfaces named here are specified in the [Public API](public-surface.md); the
runtime behavior is specified in [Execution semantics](semantics.md).

## Action

A non-underscore concept method. `registerConcept` requires each specified
action to be an own prototype method declared directly by the registered class.
An assembled action is instrumented: the engine records an ask before running
the method and records a return, refusal, or fault afterward. TypeScript
`private` and `protected` methods still exist on the runtime prototype; use
ECMAScript `#private` methods for implementation helpers that registration must
not treat as concept members.

## Ask

The invocation occurrence for an action. An ask has an action identifier,
concept and action names, input, and causal flow. An ask made by a reaction also
records that reaction as provenance.

## Assembly

One installed vocabulary, implementation set, and composition. An assembly owns
its invoker and occurrence log. Creating another assembly creates another
runtime; it does not reconfigure an existing assembly.

## Binding

One named value in a reaction, view, or former match. A fresh symbol in an
output pattern opens a binding. Reusing a bound symbol tests equality.

## Concept

An independently implemented behavior with its own state, actions, queries,
expected refusals, specification, and principle test. A concept implementation
does not import application composition or peer concepts.

## Concept floor

A named, complete implementation map for one concept set, plus host-owned
resources and an asynchronous `close()` operation. Declaring a floor does not
make the engine own or call its lifecycle operations.

## Consequence

An action ask produced by a matching reaction. Consequences in one
`then(...)` group are siblings. A later group begins after the preceding action
on its own path returns.

## Endpoint

A reaction specialized for an outside request. An endpoint has a path, receives
an admitted input, and may produce one boundary response.

## Fault

An unexpected failure attached to an action ask, such as an action throw or a
former-evaluation failure. A fault is not a deliberate refusal. The engine
records a fault mark and leaves the action ask without a returned/refused
outcome.

## Flow

The causal identity shared by one root action or outside request and its
consequences. Reaction matching and `earlier(...)` correlation are flow-local.

## Former

A named current-state read that constructs a typed value tree. A former is
evaluated when asked; the engine does not store its result.

## Firing

One successful reaction match after all trigger and `where` conditions. A
firing records bindings, consumed triggers, and produced asks.

## Integrity failure

Evidence that accepted execution violated an engine-owned contract, such as an
invalid successful endpoint output or an execution-budget breach discovered
after work was accepted. An integrity failure is distinct from an action fault
and need not leave the underlying action ask without a returned outcome.

## Occurrence

A recorded action invocation, return, refusal, or fault. The occurrence log also
contains firing, reaction-failure, and integrity-failure evidence. Occurrences
are execution evidence, not concept state.

## Principle

A concrete behavioral story in a concept specification. A principle test runs
the concept class directly and verifies the story without an assembly.

## Query

An underscore-prefixed concept method that, by contract, reads current state.
`registerConcept` requires each specified query to be an own prototype method
declared directly by the registered class. Queries are memoized between
invalidation points and are not recorded as action occurrences.

## Reaction

An application-level declaration that watches an action posture, optionally
reads current state, and asks one or more consequence actions for each surviving
binding.

## Refusal

A concept's deliberate rejection of an action. Registered exception classes
map specification codes to refusal outcomes. The advanced `Refuse` escape hatch
also creates a refusal.

## View

A named relation over one or more concept queries or other views. A predicate
view answers whether a relation holds. An output view returns rows with a
declared cardinality. A sync-engine view is not a rendered user interface.

## Vocabulary

The named action and query references for a concept set, together with concept
metadata and optional named computations. Vocabulary references are inert until
resolved against an engine.

## Wire contract

Generated TypeScript mapping endpoint paths to JSON-projected input, output,
and error types. A wire contract checks typed callers; it is not a runtime
schema validator.
