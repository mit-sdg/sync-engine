# Design rules

Design only the brief; parser success does not prove quality.

## Useful independent concepts

A concept owns one coherent mechanism: purpose, state, actions, queries. Layout,
workflow, and shared identity do not define boundaries. Purpose states one evaluable
need and predicts behavior without methods or peers.

Principle uses one or more short archetypal scenarios showing the mechanism's value,
not a full specification. Include variants, errors, or refusals only when essential to
the purpose. External context is allowed; peer behavior is not concept-owned.

Every element serves purpose and brief. Concepts never call, import, or require peers.
Split distinct purposes, lifecycles, authorities, state, failures, or reuse; combine only
when parts are useless alone, an invariant needs one atomic owner, or reactions would
reconstruct one operation.

## State and ownership

State records observable identity, relations, lifecycle, order, multiplicity, and
invariants—not storage. Each relation has one semantic owner. Runtime persistence
belongs to implementation and evidence, not State. Write State only in Simple State
Form. Set declarations introduce their own identities; follow supplied SSF exactly.

External types are generic and identities opaque; relate but never inspect peer facts.
For a necessary copy state authority, updates, staleness, divergence detection, and
repair; mark historical snapshots. All behavior follows from owned state, input, and
explicit non-peer environment. Otherwise change ownership/input/environment/policy.
Race-sensitive and security-critical rules stay in the action owning changed state.

## Actions and lifecycle

Actions name domain occurrences or transitions, not generic writes. State preconditions
and effects; avoid case flags. Owner actions/transactions enforce local invariants,
non-bypassable authorization, and races. Getters are queries; loops are not actions.

Expected domain rejection is a declared refusal with a stable code; other failure is a
fault. State post-refusal state; no partial effect unless another fact is atomic. Queries
have no effects. Every query has an indented prose body stating rows, unknown/empty
case, and stable `many` ordering.

Cover relevant reversal, compensation, deletion, and repetition. Repetition succeeds
again, returns a prior result, or refuses. Deduplication atomically checks caller
operation identity; correlation only traces.

## Composition and failure

Only composition coordinates concepts. One reaction is one trigger-condition-effect
decision. Stages express causality; separate reactions independent consequences; named
siblings cases, not priority.

Composition owns cross-concept policy, workflow, context, adaptation, notification,
compensation, and repair—not owner invariants, mutation, race decisions, or reconstructed
operations. Pass-through reactions reveal a bad split or missing action.

A reaction cannot make separate owners atomic. For each cross-concept relation state
owners, violation, repair, permitted false interval, and failure outcome. If no false
interval is safe, combine ownership or transact. Decide relevant cycle termination,
bounded fan-out/partial effects, idempotency, causal order, and stale reads. Never assume
rollback, cancellation, or exactly-once execution.

## Authorization and external effects

For each protected effect identify actor, authenticated identity, resource, fact owners,
condition, and enforcement point. Request data is a claim, not
authentication. Composition may deny early; owner actions enforce non-bypassable rules.

Command/process/filesystem/clock/network are concepts only with observable choices,
state, lifecycle, expected problems, or useful tests; otherwise adapt thinly and keep
policy in composition.

## Authored application design

Use `design/concepts/*.md`, `design/types.md`, `design/compositions/*.md`, paired with
`src/compositions/*.ts`. Deviations need a benefit and explicit mapping.

A definition may have many instances. Bind each external type once to a nonempty
concrete or selected concept-owned type. Reject chains, external targets, missing or
duplicate bindings, unresolved names, and unused concretes. Binding conveys identity,
not ownership, validation, or TypeScript equivalence. State is unparsed in version 1;
review manually.

Put exact `reaction:`, `view:`, `former:`, and `computation:` links beside prose, no
wildcards. Cover each authored endpoint/reaction tree, named view/former; declare each
executable computation once.

`check-concepts` proves grammar only. Config checking proves shapes, bindings, links,
computations, source agreement. Neither proves boundaries, prose truth, persistence,
transactions, authorization, repair, or required behavior; review and test.
