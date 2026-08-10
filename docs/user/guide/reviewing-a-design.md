# Reviewing a design

This procedure reviews concept boundaries before state and actions, then reviews
composition and whole-system failure. It assumes the criteria in [Designing with
concepts](../design.md). Record the evidence and unresolved decisions from each
step. Do not begin field-level review while a purpose or boundary remains
disputed.

## 1. Inventory the design

For each concept, record its purpose, managed entities, owned facts, and external
identities. For each reaction, record its trigger, reads, effects, and the
application decision it expresses. For each endpoint, record its route, admitted
input, concepts reached, and possible answers.

A purpose that cannot be stated in one line often contains several mechanisms. A
reaction whose decision cannot be stated often reconstructs a missing action or
connects an artificial split.

## 2. Review each concept

Stop at the first failed criterion; later detail cannot repair an earlier
boundary defect.

| Criterion         | Evidence                                                                                                                                                                |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose           | Names a useful capability and the undesirable outcome it prevents or the capability otherwise lost, rules out a plausible design, and can be fulfilled by this concept. |
| Principle         | Demonstrates the purpose from empty state using only this concept's actions and queries, including any distinguishing refusal.                                          |
| Independence      | Does not depend on a peer concept's API or facts; stores only opaque identities for peer-owned entities; and completes its lifecycle alone.                             |
| State sufficiency | Every precondition, result, and effect follows from owned state, input, or an explicit environment dependency.                                                          |
| Ownership         | Each durable fact has one authority; copies state update, staleness, and repair rules.                                                                                  |
| Actions           | Name only transitions required by the purpose and enforce local invariants, including direct calls.                                                                     |
| Lifecycle         | Covers applicable creation, use, completion, expiry, reversal, retention, deletion, or deliberate permanence.                                                           |
| Failure           | Expected rejection is a refusal; reversal, compensation, and repetition are deliberate.                                                                                 |
| Durability        | Shared-state races and idempotency have storage-level enforcement where required.                                                                                       |
| Documentation     | States each bound, lifetime, and order in the declaration that enforces it; matches each refusal sentence to its rule; and does not restate declarations in prose.      |

Trace the specification in both directions. Every purpose commitment must appear
in the principle and be supported by the applicable actions, queries, refusals,
and owned state. Every declared member and owned fact must contribute to a
purpose commitment. Treat the specification as authored evidence, not proof that
the implementation satisfies the prose. The [concept specification writing
conventions](../reference/concept-specification.md#writing-conventions) define
section placement, prose notation, and the documentation criterion.

Use [Choosing concept boundaries](../design.md#choosing-concept-boundaries) when
state partitions or several purposes appear, or when reactions mostly pass calls
between the same pair of concepts.

## 3. Review the composition

For every reaction and endpoint:

- confirm the name states one application decision;
- verify the trigger posture and every bound identity are intentional;
- distinguish later stages, independent reactions, and sibling alternatives;
- identify fan-out and its practical bound;
- state what persists when an effect refuses or faults;
- verify repeated execution is safe, refused, or deduplicated by an owner;
- move local invariants and race-sensitive decisions into owner actions; and
- ensure case-split endpoints have deliberate coverage and overlap.

Trace cycles from effects back to triggers. For each cross-concept invariant,
record its false interval and repair behavior. Consolidate duplicated policy into
a named view.

## 4. Trace scenarios end to end

For each representative scenario, follow every matching rule, state which owner
changes each fact, identify authorization decisions, note fan-out and cycles, and
record the final observable result. Record the state and durable effects after
each refusal, fault, timeout, or interruption; do not collapse those outcomes into
a single success/failure label.

At minimum, trace:

| Scenario                         | Question                                                                                                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Ordinary success                 | Does the design deliver its stated purpose?                                                                  |
| Expected refusal                 | Does the caller receive a stable domain outcome, and does owned state match the documented refusal behavior? |
| Unauthorized request             | Which authenticated fact and policy produce the denial?                                                      |
| Duplicate or retry               | Is repetition meaningful, refused, or durably deduplicated?                                                  |
| Concurrent actions               | Which decisions race, and where does storage coordinate them?                                                |
| Partial fan-out or chain failure | Which effects remain, and what repairs them?                                                                 |
| Timeout or abort                 | Which accepted work continues after the caller stops waiting?                                                |
| Process interruption             | Which concept-owned state supports recovery?                                                                 |

Trace interruption before the first effect and after every durable effect. Do not
describe a multi-action path as “all or nothing” unless one owner and transaction
make that statement true.

## 5. Review failure and security

For each effect, ask what remains if the next step does not happen. Identify
unanswered endpoint paths, compensation that can itself fail, and work that can
outlive its caller. Use [failure delivery](../reference/semantics.md#failures-between-action-asks)
and [cancellation](../reference/semantics.md#cancellation) for the runtime contract.

For each protected effect, record the actor, authenticated identity, resource,
owner of every fact, condition, and enforcement point. Check direct
`Assembly.concepts` roots as well as endpoints. A composition read may provide an
early denial, but the owner action must enforce security-critical decisions so a
direct call cannot bypass them. Use the owner's storage transaction when the
decision must remain true as shared durable state changes.

Review what leaves the boundary. Generated types are not runtime validators.
Check the selected transport's package documentation for its public error and
validation boundary.

## 6. Record revisions and evidence

| Finding                                            | Typical revision                                       |
| -------------------------------------------------- | ------------------------------------------------------ |
| State divides across disjoint actions              | Extract a concept and review the lost atomicity.       |
| Neither part completes a principle                 | Merge the fragments and remove joining reactions.      |
| A passive field gains lifecycle or authority       | Promote it to a concept.                               |
| A concept is a passive field with forwarding rules | Demote it to owner state.                              |
| Rules reconstruct one owner operation              | Add the missing semantic action.                       |
| A read-then-act decision races                     | Move it into the owner action and storage transaction. |
| Several endpoints repeat a condition               | Name one policy view.                                  |
| Reusable behavior has an application name          | Rename the mechanism and bind meaning in composition.  |

For each accepted revision, record the failed criterion, the changed owner or
rule, the new failure boundary, and the test or design evidence that demonstrates
the correction. Retain rejected alternatives when they explain why the chosen
boundary is necessary.
