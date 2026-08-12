# Reviewing a design

Review concept boundaries before state and actions, then composition and
whole-system failure. Apply [Designing with concepts](../design.md), record
evidence and unresolved decisions, and defer field-level review until purpose and
boundaries are settled.

## 1. Inventory the design

For each concept, record its purpose, managed entities, owned facts, and external
identities. For each larger composition group, record its overall purpose and the
names of its executable reaction or endpoint groups. For each reaction, record
its trigger, reads, effects, and the application decision it expresses. For each
endpoint, record its route, admitted input, concepts reached, and possible
answers. Inventory independently meaningful views and formers separately.

Confirm that registered specifications live under `design/concepts/`, composition
prose under `design/compositions/`, and any application-wide type-role edges and
pure computations in `design/vocabulary.md`. The authored files should explain
intent without copying generated mechanics. If a reaction's decision cannot be
stated, it may reconstruct a missing action or connect an artificial split.

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
in the principle and be supported by actions, queries, refusals, and owned state;
every declared member and owned fact must support a commitment. The specification
is authored evidence, not proof of implementation behavior. Compare it with the
executable declaration and its focused test; use generated read-back only to
confirm what the selected assembly contains. Apply the [writing
conventions](../reference/concept-specification.md#writing-conventions) and
[boundary criteria](../design.md#choosing-concept-boundaries).

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

Trace cycles from effects back to triggers. Record each cross-concept invariant's
false interval and repair behavior. Consolidate duplicated policy into a named
view. Confirm the canonical `compositions`, `views`, and `formers` categories
remain separate, whether one group exports all three or assembly collects
separately owned modules. Assembly must install every view and former exactly
once. Reuse by import must not become re-export from another owner.

## 4. Trace scenarios end to end

For each representative scenario, follow every matching rule. Record each fact's
owner, authorization decisions, fan-out, cycles, and final result. After each
refusal, fault, timeout, or interruption, record state and durable effects rather
than one success/failure label.

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

For each effect, record what remains if the next step fails. Identify unanswered
endpoint paths, compensation failures, and work that can outlive its caller. See
[failure delivery](../reference/semantics.md#failures-between-action-asks) and
[cancellation](../reference/semantics.md#cancellation).

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

For each accepted revision, record the failed criterion, changed owner or rule,
new failure boundary, and evidence of correction. Retain rejected alternatives
only when they explain the chosen boundary.
