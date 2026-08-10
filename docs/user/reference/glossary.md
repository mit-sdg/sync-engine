# Glossary

These terms have project-specific meanings. The [Public API](public-api.md)
defines named interfaces; [Execution semantics](semantics.md) defines observable
behavior.

## Action

A concept operation that may change concept state. An instrumented action has an
ask followed by a return, refusal, or fault.

## Admission

The decision to accept a new root action or request. Route and input checks,
drain state, and configured limits may reject work before an action ask is
recorded.

## Ask

The invocation occurrence for an action, including its input, action identity,
causal flow, and any asking reaction.

## Assembly

One installed vocabulary, concept implementation set, and composition, with its
own execution lifecycle and occurrence index. Creating another assembly creates
another runtime.

## Binding

One named value in a reaction, view, or former match. A fresh name opens a
binding; reusing a bound name tests equality.

## Composition

The application-level collection of reactions, views, formers, and endpoints.
Composition connects concepts without adding peer dependencies to them.

## Concept

An independently implemented behavior with its own purpose, state, actions,
queries, expected refusals, specification, and principle test.

## Concept floor

A named complete implementation map for one concept set, together with
host-owned resources and a `close()` operation. The host, not assembly, owns the
floor lifecycle.

## Consequence

An action ask produced by a matching reaction. Consequences in one `then(...)`
group are siblings; a later group continues each path after its preceding action
returns.

## Correlation ID

A tracing identifier carried through gateway and application observation. It is
not an idempotency key.

## Deferred trigger

A reaction trigger stated with `.afterFlowSettles()`. Its trigger match is armed
where the occurrence lands and qualified at a settlement frontier, so any
consequence follows tracked ordinary work in that causal flow.

## Domain error

An application-authored failure value, such as a concept refusal or an endpoint
response with a top-level `error` field. Domain errors are distinct from
framework errors.

## Endpoint

A reaction specialized for an outside request. It has a route, receives admitted
input, and may produce one boundary response.

## Fault

An unexpected failure attached to an action ask, such as an action throw or a
former-evaluation failure. An interpreter failure between asks is recorded
separately as a reaction failure. A refusal is a deliberate domain outcome.

## Firing

One successful reaction match after its trigger and conditions. A firing records
its bindings, one or more consumed trigger occurrences, and produced asks.

## Flow

The causal identity shared by one root action or request and its consequences.
Reaction matching and `earlier(...)` correlation are flow-local.

## Former

A named current-state read that constructs a value tree when evaluated. The
engine does not store the formed result.

## Framework error

A boundary or transport failure classified by `FrameworkErrorCode`, such as
`INVALID_INPUT`, `TIMED_OUT`, or `TRANSPORT_ERROR`. Transport packages may add
their own error unions.

## Gateway

An `Invoker` decorator that adds route admission, limits, observation, timeout
and abort waiting, and ordered drain. It uses the target assembly's reaction
engine.

## HTTP cookie policy

The optional `HttpPolicy.cookie` binding for one protected logical input. The
handler injects the cookie value on protected requests and removes each issue
route's configured value and expiry fields from the public response and
generated contract.

## Input contract

The outer request-object contract for one endpoint route. It declares required
keys and shallow defaults; endpoint validators separately inspect values.

## Integrity failure

Evidence that accepted execution violated an engine-owned contract, such as an
invalid endpoint output or an execution-budget breach. It is not an action fault.

## Invoker

The transport-neutral interface that accepts a route, input, and call options
and resolves to a success, domain-error, or framework-error result.

## Local behavior

A declaration containing executable state that cannot be reconstructed from its
serialized representation, such as a closure or object-identity pattern.
Ordinary assembly rejects local behavior; manual engines may execute it.

## Log sink

An optional synchronous application-owned destination for validated, redacted
occurrence entries. A sink is for audit output; it does not provide matching,
retention, replay, or concept-state persistence. See [occurrence index and log
sinks](public-api.md#occurrence-index-and-log-sinks).

## Occurrence

Recorded execution evidence for action asks and outcomes, faults, reaction
firings, and selected runtime failures. Occurrences are separate from concept
state.

## Portable behavior

A declaration whose canonical JSON can be registered against the same named
vocabulary. Ordinary assemblies and generated contracts contain portable
behavior only.

## Principle

A concrete behavioral sequence in a concept specification. A principle test
runs the concept directly, without assembly.

## Public error category

A public HTTP classification registered for a concept refusal, such as
`CONFLICT` or `UNAUTHORIZED`. Unmapped refusal codes do not cross that boundary.

## Query

An underscore-prefixed concept operation that reads current state without side
effects. A registered query may promise `one`, `optional`, or `many` rows.

## Raw fault report

A privileged report containing the original value thrown by an action,
interpreter stage, or endpoint validator. It bypasses ordinary fault redaction
and is sensitive data.

## Reaction

An application-level declaration that watches an action ask or outcome,
optionally reads current state, and asks consequence actions for each surviving
binding.

## Read

One query or view line evaluated against a current binding. Its declared promise
and plain, `no`, or `whether` posture determine whether a case continues, drops,
or expands.

## Read-back

A generated textual description of an assembled application's declarations,
paths, bindings, and cardinality behavior. Read-back describes a design; it does
not define execution semantics.

## Refusal

A concept's deliberate rejection of an action. Registered refusal codes are
expected domain outcomes. Ordinary assembly treats an undeclared advanced
`Refuse` code as a fault; a manual engine may accept it as a refusal.

## Settlement frontier

The point where a flow's outermost ask is about to settle and all tracked
ordinary work in that flow has drained. Deferred triggers armed in that flow are
qualified there; a frontier at which none qualifies finalizes the flow.

## View

A named relation over concept queries or other views. A predicate view answers
whether a relation holds; an output view returns rows with a declared
cardinality.

## Vocabulary

The named action, query, and optional computation references for a concept set,
together with concept metadata. Vocabulary references are inert until resolved
against an engine.

## Wire contract

A generated TypeScript mapping from endpoint routes to JSON-projected input,
output, and error types. Runtime validation requires separate validators.
