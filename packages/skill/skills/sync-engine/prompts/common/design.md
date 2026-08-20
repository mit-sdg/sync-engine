# Design rules

## Useful independent concepts

A concept owns one coherent mechanism: purpose, state, actions, queries. Layout,
workflow, and shared identity do not define boundaries. Purpose states one evaluable
need, predicts behavior without methods or peers, and rules out at least one
plausible design. A purpose gives one independent reason for state to change; one that
only manages, maintains, or handles its subject gives none. Read needs from state,
actions, lifecycles, authorities and failures, never from purpose wording:
rewording a purpose merges nothing.

A concept is generic when some second, unrelated application could use it unchanged.
That test is necessary and never sufficient: name the mechanism rather than this product,
and declare every foreign or application subject an opaque external. Store, compare and
return such a value; parsing, validating or constructing one belongs to the concept whose
mechanism is that format, or outside the concept layer. Many fields served by few actions is a
warning too; confirm it by finding partitions changed by disjoint actions or lifecycles.

Principle tells one or more short stories in the order events happen, with named
individuals and real values—`Ari`, visit `v1`, code `gh7`—each action and what it then
answers. Prose about a generic caller submitting and receiving has restated the actions
and failed. Include a variant, error, or refusal only where the purpose needs it. External context is allowed.

Concepts never call, import, or require peers.
Split a concept that mixes distinct purposes, lifecycles, authorities, state, failures,
or reuse. A part earns its own concept by owning a lifecycle that runs when its siblings
never fire, holding sole authority over some decision, and stating its contract in opaque
identities. Combine only when parts are useless alone, or when reactions would merely
reassemble one authority's transition. A shared invariant, or a wish for atomic commit,
never argues for combining: declare the obligation and keep the parts apart.

## State and ownership

State records observable identity, relations, lifecycle, order, multiplicity, and
invariants—not storage. Give each relation one semantic owner. Runtime persistence
belongs to implementation and evidence, not State. Write State only in Simple State
Form.

External types are generic and identities opaque; relate but never inspect peer facts.
A necessary copy of a peer fact states its authority, staleness and repair, and a
historical snapshot says so. Derive all behavior from
owned state, inputs, and explicit non-peer environment; otherwise change ownership,
inputs, environment, or policy. Race-sensitive and security-critical rules
stay in the action owning changed state.

## Actions and lifecycle

Actions name domain occurrences or transitions, not generic writes. Declare
preconditions and effects; avoid case flags. Owner actions and transactions enforce
local invariants. Getters are queries; loops are not actions.

Expected domain rejection is a declared refusal with a stable code; other failure is a
fault. State the post-refusal state: a refusal never partially applies the requested
transition, though it may atomically record a separate declared fact. Queries have no
effects. Every query has an indented prose body stating its
rows, then the unknown or empty case, and a stable ordering for `many` alone.

Cover every lifecycle stage the mechanism has, from creation through
deletion or permanence, and add no CRUD symmetry it lacks. Repetition succeeds again, returns a prior result, or refuses.
Deduplication atomically checks the caller's operation identity; a correlation id is
only a trace token.

## Composition and failure

Only composition coordinates concepts, one reaction per trigger-condition-effect
decision. Stages express causality; give independent consequences separate reactions.

Composition owns cross-concept policy, workflow and repair, never owner invariants,
mutation, or race decisions. Pass-through reactions reveal a bad split or missing action.

A reaction cannot make separate owners atomic. Where one concept's action obliges
another's, declare that obligation: the triggering action, the closing reaction, the
interval in which the joint condition may be observed false, and the recovery that closes
it—an idempotent retry identity, or a compensating action. Consume nothing irreversibly
before the acknowledgement that completes the operation. A declared, recoverable interval
is sound; an undeclared cross-concept dependency, or one with no recovery, is the defect.
Decide relevant cycle termination, bounded fan-out and partial effects, idempotency,
causal order, and stale reads. Never assume rollback, cancellation, or exactly-once
execution.

## Authorization and external effects

For each protected effect identify its actor, resource, condition and enforcement point.
Request data is a claim, not authentication.
Owner actions enforce non-bypassable rules; composition may also deny early, and need
not when the owner already refuses.

Model a host effect as a concept only if it has observable policy, state, lifecycle, or
failure or needs its own tests; otherwise adapt thinly.
