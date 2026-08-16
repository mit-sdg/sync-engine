# Design rules

Design only the brief; parsing does not establish semantic quality.

## Useful independent concepts

A concept owns one coherent mechanism: one purpose, state, actions, and queries.
Implementation layout, workflows, and shared identity do not define its boundary.

Purpose states one specific, evaluable need or problem. It predicts essential behavior
without listing methods and does not depend on a peer.

Principle uses one or more short archetypal scenarios to show how the mechanism
fulfills its purpose; it is not the complete specification. Include setup and enough
individuals and actions to demonstrate the value. Include variants, errors, or
refusals only when essential to the purpose. External context is allowed, but peer
behavior must not appear as concept-owned state or action.

Every element must serve the purpose and brief. A concept never calls, imports, or
requires a peer. Split distinct purposes, lifecycles, authorities, state, failures, or
reuse. Keep parts together when neither is useful alone, one invariant needs one
atomic owner, or reactions would reconstruct one operation.

## State and ownership

State describes observable identities, relations, lifecycle, order, multiplicity, and
invariants—not objects or storage—and supports every action. Assign each state relation
and durable fact one semantic owner.

External types are generic and identities opaque. A concept may own relations on
an external identity, but must not inspect or copy peer facts or infer shared state. For a
copy, state authority, update path, staleness, divergence detection, and repair;
distinguish a historical snapshot.

Every precondition, result, and effect follows from state and action input plus an
explicit non-peer environmental dependency. A missing fact is owned state, caller
input, environment, behavior moved to its owner, or non-critical composition policy.
Race-sensitive and security-critical rules stay in the action that owns changed state.

## Actions and lifecycle

Actions name significant domain occurrences or transitions, not generic writes; they
need not change state. Make preconditions and effects explicit. Do not use optional or
flag inputs to combine unrelated cases. Owner actions and durable transactions enforce
local invariants, non-bypassable authorization, and race-sensitive decisions. Getters
are queries; loop wrappers are not actions.

Expected domain rejection is a declared refusal with a stable code; unexpected failure
is a fault. State the result after refusal. A refused transition is not partly applied
unless another fact is recorded atomically; specify and test it. Queries have no side
effects; their `one`, `optional`, or `many` cardinality is observable.

Cover relevant lifecycle. Distinguish reversal, compensation, deletion, and repetition.
State whether repetition succeeds again, returns a prior result, or refuses. Durable
deduplication atomically checks a caller operation identity; correlation is only
tracing.

## Composition and failure

Composition is the only place concepts coordinate. A reaction states one application
decision: trigger, current condition, and effect. Use a later stage for causal
dependency, separate reactions for independently selectable consequences, and named
siblings for cases—not priority or exclusivity.

Composition owns cross-concept policy, workflow, context, adaptation, authorization,
notification, compensation, and repair—not local invariants, storage mutation,
race-sensitive owner decisions, or reconstructed owner operations. Repeated
pass-through reactions signal a bad split or missing action.

A reaction cannot make separate owners atomic. For each cross-concept relation state
owners, violating event, repair, permitted false interval, failure outcome, and whether
repair is automatic. If failure or a false interval is unacceptable, combine ownership
or use one transaction.

When relevant, decide cycle termination, fan-out and partial effects, repair or
compensation, receiving-action idempotency, causal order, and stale observations. Do
not assume cycle detection, rollback, cancellation, or exactly-once execution.

## Authorization and external effects

For each protected effect identify actor, authenticated identity, resource, fact
owners, condition, and enforcement point. Request data is a claim, not
authentication. Composition may deny early; owner actions and transactions enforce
rules that calls or races cannot bypass.

Command, process, filesystem, clock, and network interactions are concept candidates
when they add observable choices, state, lifecycle, expected problems, or useful tests.
Composition owns application policy. Otherwise use a thin direct adapter.

## Authored application design

For new applications use `design/concepts/*.md`, `design/types.md`, and
`design/compositions/*.md`, paired with `src/compositions/*.ts`. Deviations need a
concrete benefit and explicit prose-to-source mapping; no index is required.

One definition may have several instances; bindings name the selected instance.
Registrations with one definition name require identical canonical specifications.

Bind each selected `ConceptInstance.ExternalType` exactly once to a nonempty
application `concrete` or selected concept-owned type. Reject chains, external targets,
missing or duplicate bindings, unresolved names, and unused concrete declarations.
Bindings establish identity correspondence only—not ownership, validation, or
TypeScript equivalence. State is unparsed in version 1; review ownership manually.

Place each exact `reaction:`, `view:`, `former:`, or `computation:` link beside its
prose decision. Links name one selected dotted path, without wildcards. Cover each
authored reaction or endpoint tree, named view, and named former; declare
each executable computation once.

`check-concepts` proves grammar only. Config checking also proves shapes, bindings,
links, computations, and source agreement. Neither proves boundaries, prose truth,
State/storage agreement, persistence, transactions, durability, authorization, repair,
or required behavior. Review and test those.
