# Contract design guidance

The boundary authority fixes boundaries and ownership: use the accepted decomposition
when supplied, otherwise the brief plus affected approved contracts. Concept contracts
define each mechanism; application contracts define selected identities, cross-concept
decisions, coordination, and recovery. Preserve every accepted obligation ID and its
trigger, closing reaction, observable false interval, retry identity, and recovery.

## Purpose, state, and ownership

Purpose predicts behavior, rules out a plausible design, and names no peer. Principle
tells one or more short stories in event order with named individuals and real values.
Include a variant or refusal only where the purpose needs it.

State records observable identity, relations, lifecycle, order, multiplicity, and
invariants—not storage. Give each relation one semantic owner. External identities are
opaque; relate but never inspect peer facts. Derive behavior from owned state, inputs,
and explicit non-peer environment. Race-sensitive and security-critical rules stay in
the action owning changed state.

## Actions and lifecycle

Actions name domain occurrences or transitions, declare preconditions and effects, and
avoid case flags. Owner actions and transactions enforce local invariants. Expected
domain rejection is a declared refusal with a stable code; other failure is a fault. A
refusal never partially applies the requested transition. Queries have no effects and
state their rows, empty case, and stable ordering for `many`.

Cover every lifecycle stage the mechanism has, with no invented CRUD symmetry.
Repetition succeeds again, returns a prior result, or refuses. Deduplication atomically
checks an operation identity; a correlation ID is only a trace token.

## Composition, authorization, and failure

Only composition coordinates concepts. It owns cross-concept policy, workflow, boundary
adaptation, and repair, never owner invariants or race decisions. State the behavioral
commitment: its owner, visible success and refusal, ordering relative to acknowledgement,
and material failure or recovery guarantee. Do not prescribe framework stages, trigger
syntax, binding flow, or endpoint fallback construction.

Give every selected public endpoint its own reaction link as a trace identity. An endpoint
may realize all coordination needed for that behavior. Add a separate internal reaction
link only when the design intentionally selects a distinct deferred or independently
triggered behavior; do not create one merely to narrate an endpoint's next step.

Declare a computation when a pure application decision is itself part of the accepted
behavior or is shared by multiple declarations. Do not introduce computations solely to
spell out framework adaptation, defaults, or variable transport that implementation may
choose without changing visible behavior.

A reaction cannot make separate owners atomic. Realize every accepted obligation with
its triggering action, closing reaction, observable false interval, stable retry
identity, and recovery. Consume nothing irreversibly before its acknowledgement. Decide
cycle termination, bounded fan-out, partial effects, idempotency, causal order, and stale
reads; never assume rollback or exactly-once execution.

For each protected effect identify actor, resource, condition, and enforcement point.
Request data is a claim, not authentication. Owner actions enforce non-bypassable rules;
composition may also deny early. Model a host effect as a concept only when it owns
observable policy, state, lifecycle, failure, or tests.
