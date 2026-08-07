# Designing with concepts

This page defines the design criteria for dividing an application into concepts
and reconnecting them through composition. It assumes the [application
model](overview.md). The [authoring guides](index.md#application-authoring-path)
show the TypeScript API; [Execution semantics](reference/semantics.md) defines runtime
behavior.

A **concept** is a semantic mechanism with one purpose, owned state, actions, and
queries. Its specification can be understood without reading another concept. A
**reaction** is an application-level rule that connects concepts. Registration
does not enforce these design constraints against arbitrary TypeScript imports;
peer imports remain a design-review finding.

<!-- sync-engine-guidance: {"id":"design-concepts-composition","anchor":"concepts-and-composition","authority":"criteria","topics":["composition","concept-boundaries","concept-design"],"stages":["design","review"]} -->

## Concepts and composition

Concept boundaries follow behavior, not implementation layout.

| Candidate boundary | Why it is not a concept boundary                                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Class or package   | Code organization does not establish an independent purpose or lifecycle.                                                    |
| Domain entity      | A shared noun can accumulate unrelated behavior that merely uses the same identifier.                                        |
| Database table     | Storage shape may split one concept or combine several concepts.                                                             |
| Service            | Deployment and team ownership do not establish semantic independence.                                                        |
| Screen or endpoint | Interfaces combine the behaviors needed for one interaction.                                                                 |
| Workflow           | A workflow sequences independently complete behaviors.                                                                       |
| Data structure     | Domain-neutral builders, caches, indexes, and graphs remain implementation modules unless they implement a domain mechanism. |

A concept names no peer concept, stores peer identities rather than peer-owned
facts, and completes its lifecycle through its own actions. Cross-concept policy,
workflow, notification, adaptation, and repair belong in composition. This puts
each dependency in one inspectable rule and permits a concept to participate in
another composition.

## Purpose and principle

A purpose states the useful need that justifies the concept. A usable purpose:

- names a useful capability and the undesirable outcome or lost capability it
  prevents;
- predicts the behavior without listing methods;
- rejects at least one plausible design;
- names no peer concept and names an application only when intentionally scoped;
  and
- can be fulfilled by this concept alone.

Mechanism descriptions such as “store memberships in a set” and goals such as
“run an operations room” do not meet those criteria. The first describes an
implementation; the second describes an application composed from several
mechanisms.

A broad goal or value does not determine a concept. Several mechanisms can serve
the same goal while imposing different state, authority, lifecycle, and failure
rules. Reduce the goal to a concrete capability people need or a failure the
design must prevent, then derive the mechanism from that case.

Application-specific concepts are valid when the mechanism genuinely exists
only in that application. Name that scope explicitly rather than disguising it
as a reusable concept.

A principle is one concrete scenario that demonstrates the purpose. Start from
empty state, perform setup through the concept's own actions, observe results
through its queries, and include the refusals that distinguish the mechanism. A
principle that requires a peer action describes a workflow or exposes a wrong
boundary.

[Gathering](../../examples/reading-circle/src/concepts/gathering/spec.md) is the
throughline. It creates a named gathering, establishes its host as a member,
allows another person to join and leave, refuses duplicate membership, and makes
membership visible. The scenario needs no selecting, discussing, or alerting
behavior.

<!-- sync-engine-guidance: {"id":"design-state-ownership","anchor":"state-identity-and-ownership","authority":"criteria","topics":["concept-boundaries","state-ownership"],"stages":["design","repair","review"]} -->

## State, identity, and ownership

Abstract state records the identities and relationships a concept knows, the
lifecycle stage of each managed entity, and any order, multiplicity, or invariant
that changes behavior. Tables, documents, indexes, caches, and serialization
formats are implementation choices unless they alter the observable contract.

The optional `State` section in a concept specification is notation for readers;
registration derives no schema or validator from it. See [State
notation](reference/concept-specification.md#state-notation).

External identities are opaque. Gathering may store a `Person` as a member, and
Alerting may store the same value as a recipient, without either concept owning
the person's profile. Sharing an identifier does not imply shared state or a
shared concept boundary.

### State sufficiency

Every precondition, result, and effect must be expressible from the concept's
state and action input, plus explicit non-peer environmental dependencies. When a
fact is missing, choose among these moves in order:

1. Add it to state when the concept owns the fact.
2. Accept it as input when the caller owns and can establish the fact.
3. Inject an environmental dependency such as a clock or identity source.
4. Move the behavior to the concept that owns the fact.
5. Move a non-critical cross-concept policy into composition.

The last move does not protect an invariant from direct action calls and creates
a read-then-act window. A race-sensitive rule belongs in the owner action.

### State ownership

Assign each durable domain fact one semantic owner. If another concept keeps a
copy for indexing, caching, history, or resilience, document:

- which copy is authoritative;
- how the copy is updated;
- how stale it may become; and
- how divergence is detected and repaired.

A historical snapshot is not a cache: an invoice price captured at purchase may
remain authoritative even after the catalog price changes. Store derived state
only when materialization has a stated refresh rule, historical meaning requires
the old value, or recomputation would change semantics.

<!-- sync-engine-guidance: {"id":"design-actions-queries-lifecycle","anchor":"actions-queries-and-lifecycle","authority":"criteria","topics":["actions-queries","concept-design","failure-recovery"],"stages":["design","implementation","repair","review"]} -->

## Actions, queries, and lifecycle

### Semantic actions

Actions name domain transitions: `reserve`, `cancel`, `approve`, `revoke`,
`publish`, `archive`, `acknowledge`. Generic storage operations such as
`setStatus` or `updateRecord` usually transfer invariants to callers. Judge an
action by the event a reaction can name without encoding its meaning in literal
field values.

Local invariants and race-sensitive decisions belong in the action that owns the
state. Gathering checks for an existing membership and creates the new membership
inside `join`; a preceding composition read would not make uniqueness atomic.
Shared durable state also needs a storage transaction or constraint.

Every action must serve the concept's purpose. Remove unrelated operations,
model getters as queries, and avoid loop wrappers that add no domain transition
of their own.

Expected domain rejection is a declared refusal with a stable code. Unexpected
failures are faults. [Actions, refusals, and
faults](reference/semantics.md#actions-refusals-and-faults) defines the observable
distinction.

Document the state after each refusal. The requested transition must not be
partially applied. If a refused attempt deliberately records another fact,
specify and test that effect; the action implementation or backing store must
provide any transaction needed to make it atomic.

Queries read state without side effects. Their `one`, `optional`, or `many`
promise is a domain cardinality claim, not a performance hint. The promise
determines whether composition can require one row, tolerate absence, or fan out.
[Query semantics](reference/semantics.md#queries) defines runtime checking and caching.

Walk each managed entity through the lifecycle stages that apply: creation,
ordinary use, completion, expiry, retention, reversal, deletion, or deliberate
permanence. Do not add CRUD symmetry where the mechanism has no corresponding
transition.

### Failure, reversal, and repetition

These are separate design decisions:

| Decision     | Meaning                                                                          |
| ------------ | -------------------------------------------------------------------------------- |
| Reversal     | A named lifecycle transition returns owned state to an earlier or ended stage.   |
| Compensation | A new effect addresses an effect that cannot be erased; both remain in history.  |
| Deletion     | State is removed, including a decision about dependent history.                  |
| Repetition   | Asking the same action again succeeds again, returns a prior result, or refuses. |

A refund compensates a charge rather than undoing it. Repeated
`Alerting.raise` creates another alert; `Discussing.open` refuses while that
subject already has an open discussion and may succeed after it closes. Where
retries must not duplicate work, the owner action atomically records or checks a
caller-supplied operation identity in durable state. A correlation id is only a
trace token.

## Choosing concept boundaries

Seek the smallest boundary that remains independently meaningful and
behaviorally complete. Action count, file count, table count, screen placement,
deployment grouping, and the mere need for a reaction are not evidence for or
against a split.

### Evidence for and against a split

| Favors separation                                       | Favors keeping together                                     |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| Distinct useful purposes and principles                 | Neither part completes a useful principle alone             |
| Different lifecycles, authorities, or trust assumptions | One invariant requires one owner and atomic transition      |
| State partitions used by mostly disjoint actions        | Every meaningful action spans both state groups             |
| Independent failure, retry, or reversal behavior        | Splitting reconstructs one user operation through reactions |
| One part changes or is reused without the other         | One part is only a passive field or internal mechanism      |

One decisive invariant outweighs several superficial separation signals. Shared
identity alone is not shared state.

### Reaction pressure

After a proposed split, inspect the required reactions. A few rules that state
independent application decisions support the split. One-to-one pass-through
rules for most actions suggest an artificial split, a missing semantic action, or
an explicit external-system adapter. No numeric reaction threshold is useful.

### Worked boundary comparison

An initial Operations Room model can place membership, current mitigation,
discussion responses, and alerts in one `Room` concept. The state partitions,
purposes, authority questions, reuse patterns, and failure behavior separate, so
the shipped design uses
[Gathering](../../examples/operations-room/src/concepts/gathering/spec.md),
[Selecting](../../examples/operations-room/src/concepts/selecting/spec.md),
[Discussing](../../examples/operations-room/src/concepts/discussing/spec.md), and
[Alerting](../../examples/operations-room/src/concepts/alerting/spec.md). Reactions
state the application decisions that a selection opens a discussion and alerts
responders.

Splitting Gathering into a gathering record and a membership concept fails the
same tests in the other direction. Membership has no useful principle without
the gathering's existence, and creating a gathering establishes its host's
membership as one invariant-preserving transition. A reaction would turn that
transition into two independently failing actions.

A familiar concept name carries behavioral expectations. Use one only when the
observable choices, lifecycle, and refusal behavior match the familiar mechanism;
similar terminology, interface, or storage is insufficient. Narrow or rename the
concept when a defining expectation does not fit. Keep reuse domain-specific: a
candidate equally suitable in every domain is often a utility or data structure.
Test change containment by naming likely changes and the concepts or rules each
would touch.

<!-- sync-engine-guidance: {"id":"design-reactions","anchor":"designing-reactions","authority":"criteria","topics":["composition","reactions","reads","runtime-semantics"],"stages":["design","implementation","review"]} -->

## Designing reactions

A reaction states one application decision through three parts:

| Part      | Question                                                                      |
| --------- | ----------------------------------------------------------------------------- |
| Trigger   | Which action ask, return, or refusal makes the rule relevant?                 |
| Condition | Which current cases survive, and which published state supplies the decision? |
| Effect    | Which semantic action does the application ask next?                          |

Name the reaction after the decision rather than an implementation role such as
“handler.” Bind only the identities the decision uses.

Choose rule structure by dependency:

| Structure                | Use when                                                                       |
| ------------------------ | ------------------------------------------------------------------------------ |
| Later `.then(...)` stage | The next effect needs the preceding action's result or must follow its return. |
| Separate reaction        | The consequence is independently selectable or replaceable.                    |
| Named siblings           | Several alternatives are cases of one decision.                                |

Sibling labels establish provenance, not priority or exclusivity. Runtime
matching and settlement are defined under [Reactions](reference/semantics.md#reactions)
and [Sibling paths](reference/semantics.md#sibling-paths-and-endpoint-settlement).

### What belongs in composition

- Cross-concept policy and authorization observations.
- Application workflows and independently selectable consequences.
- Notifications and lifecycle cascades.
- Compensation and repair of an intentional cross-concept relation.
- Adaptation between concepts or between an outside request and concept actions.

### What does not belong in composition

- A concept's own invariant or validation over only its state.
- A race-sensitive decision that must hold when state changes.
- A multi-step reconstruction of one owner operation.
- Direct storage manipulation or hidden mutation.
- Behavior a concept needs to fulfill its own purpose.

## Cross-concept invariants

A reaction can initiate repair across separate owners; it cannot make their
actions atomic. For every cross-concept relation, record:

1. the participating owners;
2. the event that can violate the relation;
3. the rule that repairs or preserves it;
4. the interval during which it may be false;
5. the result when repair refuses or faults; and
6. whether repair is automatic.

If no false interval or failed repair is acceptable, combine ownership or use a
storage transaction that enforces both facts.

<!-- sync-engine-guidance: {"id":"design-cross-concept-authorization","anchor":"authorization-across-concept-boundaries","authority":"criteria","topics":["boundaries","security","state-ownership"],"stages":["design","review"]} -->

## Authorization across concept boundaries

For each protected effect, identify the requesting actor, authenticated identity,
resource, owner of every consulted fact, authorization condition, and effect.
An identifier in a request body is a claim, not authentication.

Composition may name replaceable policy as a view. Operations Room supplies
[host-only](../../examples/operations-room/src/composition/host-may-contribute.ts)
and [responder](../../examples/operations-room/src/composition/responders-may-contribute.ts)
implementations of the same policy contract without changing concepts or
endpoints. A security-critical or race-sensitive decision must still be enforced
by the owner action and, for shared durable state, its storage transaction.

<!-- sync-engine-guidance: {"id":"design-composition-hazards","anchor":"composition-hazards","authority":"criteria","topics":["failure-recovery","operations","reactions","runtime-semantics"],"stages":["design","repair","review"]} -->

## Composition hazards

| Hazard                            | Required design decision                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pass-through or sequencing chains | Identify the decision in each rule; merge rules or add an owner action when none exists.              |
| Cycle                             | State what terminates it, whether repetition is safe, and which execution budget bounds it.           |
| Fan-out                           | State what bounds row count and what happens when only some effects succeed.                          |
| Partial failure                   | Identify durable effects, acceptable partial states, repair, and compensation.                        |
| Retry                             | Put required idempotency in the receiving action or documented delivery infrastructure.               |
| Ordering                          | Encode causal dependency in stages; never infer priority from declaration order.                      |
| Stale observation                 | Move exact decisions into the owner action; otherwise state why the observation window is acceptable. |

The engine does not detect reaction cycles, roll back earlier actions, cancel
accepted work, or provide exactly-once execution. [Execution
semantics](reference/semantics.md) defines these limits; [Operational
limits](reference/operations.md) assigns the corresponding storage and host
responsibilities. Apply this page through the [design review
procedure](guide/reviewing-a-design.md).
