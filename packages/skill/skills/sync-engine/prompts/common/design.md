# Design rules

## Useful independent concepts

A concept owns one coherent mechanism: purpose, state, actions, queries. Layout,
workflow, and shared identity do not define boundaries. Purpose states one evaluable
need, predicts behavior without methods or peers, and rules out at least one
plausible design.

Principle uses one or more short archetypal scenarios showing the mechanism's value,
not a full specification. Include variants, errors, or refusals only when essential to
the purpose. External context is allowed; peer behavior is never concept-owned.

Every element serves purpose and brief. Concepts never call, import, or require peers.
Split a concept that mixes distinct purposes, lifecycles, authorities, state, failures,
or reuse; combine only when parts are useless alone, an invariant needs one atomic
owner, or reactions would reconstruct one operation.

## State and ownership

State records observable identity, relations, lifecycle, order, multiplicity, and
invariants—not storage. Give each relation one semantic owner. Runtime persistence
belongs to implementation and evidence, not State. Write State only in Simple State
Form.

External types are generic and identities opaque; relate but never inspect peer facts.
For a necessary copy of a peer fact, state its authority, updates, staleness,
divergence detection, and repair; mark historical snapshots. Derive all behavior from
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
effects. Every query has an indented prose body stating rows, the unknown or empty
case, and stable `many` ordering.

Cover each applicable lifecycle stage—creation, completion, expiry, retention,
reversal, compensation, deletion, or permanence—and add no CRUD symmetry the
mechanism lacks. Repetition succeeds again, returns a prior result, or refuses.
Deduplication atomically checks the caller's operation identity; a correlation id is
only a trace token.

## Composition and failure

Only composition coordinates concepts. One reaction is one trigger-condition-effect
decision. Stages express causality; give independent consequences separate reactions;
named sibling reaction cases are alternatives whose order carries no priority.

Composition owns cross-concept policy, workflow, context, adaptation, notification,
compensation, and repair—not owner invariants, mutation, race decisions, or
reconstructed operations. Pass-through reactions reveal a bad split or missing action.

A reaction cannot make separate owners atomic. For each cross-concept relation, state
its owners, violation, repair and whether it is automatic, permitted false interval,
and failure outcome. If no false interval is safe, combine ownership or transact.
Decide relevant cycle termination, bounded fan-out and partial effects, idempotency,
causal order, and stale reads. Never assume rollback, cancellation, or exactly-once
execution.

## Authorization and external effects

For each protected effect identify actor, authenticated identity, resource, fact
owners, condition, and enforcement point. Request data is a claim, not authentication.
Composition may deny early; owner actions enforce non-bypassable rules.

Model a host effect as a concept only if it has observable policy, state, lifecycle, or
failure or needs its own tests; otherwise adapt thinly.

## Authored application design

Inventory exact selected static instances; never declare core-owned `RequestBoundary`.
A definition may have zero or more instances, none carrying its name. Bind each external
once to a concrete or SSF-owned type. Reject chains between externals, alias syntax other than
`alias Alias for Target`, external targets, inline and detached bindings mixed on one
instance, missing, duplicate, or unresolved bindings, and unused concretes. Direct
qualified owned-type dependency cycles are valid: edges resolve independently. Bindings
convey identity—not ownership, validation, TypeScript equivalence, dynamic creation, or
storage isolation.

The bounded SSF parser proves structural declarations and owned type names, not opaque
invariants/prose, storage, or behavior.

Put exact `reaction:`, `view:`, `former:`, and `computation:` links beside prose, never
wildcards. Cover each authored endpoint and reaction tree and each named view and
former; declare each executable computation once. A composition document reads as prose
carrying its links, each naming module, group and declaration:

```text
Choosing a reading [opens a discussion](reaction:Circle.Reading.SelectedOpensDiscussion)
about it. A circle page shows the circle, its members and that discussion
[as one record](former:Circle.Pages.CirclePage), and only a member
[may respond](view:Circle.Reading.MemberMayRespond).
```

`check-design` proves grammar and authored form only. Config checking proves shapes,
bindings, links, computations, source agreement. Neither proves boundaries, prose truth,
persistence, transactions, authorization, repair, or behavior; review and test.
