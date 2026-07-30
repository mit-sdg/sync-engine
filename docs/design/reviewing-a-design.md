# Reviewing a design

A set of individually defensible concepts can still be a poor application. This
page is a review sequence: purposes and boundaries first, then state and
actions, then composition, then the whole system under scenarios that are not
the happy path.

Review in that order. A boundary defect found late invalidates the state and
action review that preceded it, so do not begin with field-level questions.

## 1. Take the inventory

Before judging anything, write down what exists. For each concept: its name, its
purpose in one line, the entities it manages, and the external identities it
receives. For each reaction: its trigger, what it reads, what it asks, and the
decision it encodes. For each endpoint: its path, its input, the concepts it
touches, and its answer.

Two defects usually appear at this step, before any criterion is applied.

**A purpose that cannot be written in one line** is a concept with more than one
purpose. **A reaction whose decision cannot be stated** is either a workaround
for a missing action or a dependency that should not exist.

Also list what the application does _not_ have. A concept absent from reactions
may still be used by an endpoint, view, former, or intentional direct root.
Absence from all of those places suggests unused code or an unrecorded access
path.

## 2. Review each concept

For each concept in turn, apply [the evaluation
criteria](evaluating-concepts.md) in their order — purpose, boundary, coverage,
failure and authority, durability — and stop at the first group that fails.
There is no value in tuning the actions of a concept whose purpose is an
application goal.

Five checks catch most defects quickly:

- Read the purpose alone and predict the actions. A mismatch means one of the
  two is wrong.
- Walk the principle from empty state using this concept's actions and queries.
  If it cannot start, setup lives in the wrong place; if it needs a peer's
  action, the boundary is wrong.
- Read each action's conditions and confirm they name this concept's state, its
  inputs, or an explicit non-peer environmental dependency that can be tested.
- Name the lifecycle stages that apply to each managed entity, including any
  end, retention, expiry, or deliberate-permanence rule.
- Find the concept's invariants and confirm the owning action implementation —
  and, when needed, its storage coordination — enforces them rather than a
  caller.

## 3. Review the composition

Read every reaction and endpoint as a set, not one at a time.

- **Does each rule have a documented purpose?** It can express policy, a
  workflow, notification, lifecycle cascade, compensation, adapter, or repair
  of a cross-concept relation. Investigate pass-through and reconstruction rules;
  they may expose a missing action or an accidental split.
- **Is any pair of concepts connected by many rules?** Read them together and ask
  whether each expresses a distinct purpose. See [reaction
  explosion](composing-concepts.md#reaction-explosion).
- **Do any rules form a cycle?** Trace consequences back to triggers. For an
  intentional cycle, review idempotency, retry behavior, tests, and its
  execution-budget decision. The engine does not detect cycles — see
  [cycles](composing-concepts.md#cycles).
- **Which rules fan out?** For each, name what bounds the number of matches.
- **Which cross-concept invariants exist, and which rule maintains each?** State
  the interval during which each is false.
- **Is any policy duplicated?** The same condition written into three endpoints
  should be one named view.
- **Do protected or case-split endpoint paths cover denial and fallback?**
  Endpoints on one path do not fall through in declaration order. Alternatives
  that can produce competing answers need intentional overlap or disjointness;
  an admitted, fault-free unmatched request waits for its deadline.

## 4. Trace scenarios end to end

Pick representative scenarios and trace each one through the whole design. For
each: identify the initiating action, follow every reaction it can match, record
which concept owns each state change, identify every authorization decision,
record the success and error paths, confirm identities stay correctly bound,
note fan-out and possible cycles, and state the final observable result.

Cover ordinary success and the failures that apply to the application.

| Scenario                      | What it exposes                                                         |
| ----------------------------- | ----------------------------------------------------------------------- |
| Ordinary success              | Whether the design does the thing at all                                |
| Malformed boundary input      | Whether admission validation rejects the request before it becomes work |
| Expected domain refusal       | Whether an ordinary rejected condition has a stable code                |
| Unauthorized request          | Whether the denial branch exists and answers                            |
| Duplicate request             | Whether repetition is meaningful, refused, or silently doubles work     |
| Domain cancellation or reversal | Whether the reversal exists and what it leaves behind                 |
| Deletion with dependent state | Which cascades fire, and what happens to state nothing cascades to      |
| Concurrent actions            | Which decisions race, and whether storage also coordinates them         |
| Partial failure in a fan-out  | Which effects landed, which did not, and what repairs them              |
| Retry after timeout           | Whether the repeat is safe, and which concept holds the durable outcome |
| Timeout or abort              | Which accepted work can continue after the caller stops waiting         |
| Action or interpreter fault   | How a pending boundary request is settled and what evidence remains     |

Trace the interruption at each important step, not only at the start. "The
selection landed and the discussion did not" is a reachable state, and it is the
one a design forgets; the runtime does not offer "both or neither."

## 5. Review the failure paths

Failure review asks one question of every effect: what remains if this step does
not happen?

- **Per action:** what does it refuse, and what does it fault on? An expected
  domain condition that faults instead of refusing cannot be handled as an
  ordinary domain alternative. Framework reactions can observe faults, and the
  standard boundary can settle a pending request with `INTERNAL_ERROR`.
- **Per chain:** which earlier effects persist when a later action refuses or
  faults? Nothing is rolled back.
- **Per fan-out:** what happens when some effects succeed and others do not?
- **Per request:** which paths can leave a request unanswered? An admitted,
  fault-free request whose conditions all dropped returns `TIMED_OUT` after its
  deadline. Timeout and abort end the caller's wait; they do not cancel accepted
  work.
- **Per compensation:** what does compensation restore, what does it leave, and
  what happens if the compensating action itself fails?

Write down anything the design does not handle. An unhandled case that is
recorded is a decision; an unhandled case that is not recorded is a defect.

## 6. Review the security decisions

Security review reads the design for the facts that decide access and where each
one comes from.

- For each protected effect, name the actor, the authenticated identity, the
  resource, the concept owning each fact, and the condition.
- Confirm no privileged action receives a caller-supplied identity that nothing
  verified.
- Confirm authentication, session validity, ownership, membership, and role
  assignment are owned separately, or that a stated reason exists for combining
  them.
- Identify every authorization decision made from a read that could be stale by
  the time the effect runs, and confirm that any decision needing exactness at
  the moment of effect is enforced inside the action that owns the state and, for
  shared durable state, its storage transaction or constraint.
- Confirm protected or case-split paths have an intentional denial or fallback
  result rather than dropping the case.
- Check direct `Assembly.concepts` roots as well as endpoints. Either they are
  trusted internal calls or they independently enforce the required policy.
- Check what leaves the boundary. The production HTTP profile projects mapped
  refusal codes as public categories; the default logical boundary exposes
  refusal codes without that profile's projection.

[Authorization across concept
boundaries](composing-concepts.md#authorization-across-concept-boundaries) has
the design rules; [the production HTTP
profile](../semantics.md#production-http-profile) defines what the shipped
policy projects.

## Revision strategies

Fix one defect at a time, and re-run the principle tests after each. Revisions
interact: extracting a concept often removes the reason for two reactions that
looked necessary before.

**Extract a concept from a container.** Symptom: state divides into groups used
by disjoint actions. Move one group and its actions out, give it its own purpose
and principle, and connect what remains with reactions. Cost: the operations
that spanned the seam are no longer atomic. Verify by writing the new concept's
principle without mentioning the old one.

**Merge two fragments.** Symptom: neither part has a principle it can complete
alone, and every action spans both. Combine them and delete the reactions that
joined them. Verify that the merged concept still has one purpose. "And" is
suspicious only when it joins independent mechanisms.

**Promote a state component to a concept.** Symptom: a field has acquired
transition rules, permissions, or history. Give it actions, a lifecycle, and a
purpose. Cost: a reaction now maintains what an action used to.

**Demote a concept to state.** Symptom: one passive field, no lifecycle, and
reactions that only forward. Fold it into the concept that reads it.

**Add the missing action.** Symptom: a reaction reads several queries and asks
several actions to accomplish one thing, or the same workaround appears in
several rules. Add the semantic action and delete the workaround. This is the
right revision when the work belongs to one owner; it removes rules rather than
moving them.

**Move a racing decision into the action.** Symptom: a rule reads a fact and then
asks an action that depends on it, where two callers could interleave. Move the
check inside the action that owns the state, protect shared durable state with
the relevant storage transaction or constraint, and keep the composition-level
read only to produce a better error.

**Name a duplicated policy as a view.** Symptom: the same condition in several
endpoints. Replace with one named view. This also makes the policy replaceable
without touching any endpoint.

**Rename to the mechanism.** Symptom: a behavior intended for reuse wears an
application-specific name. Rename the concept and its generic types, and bind
the meaning in composition. An explicitly scoped application-specific concept is
also legitimate when the behavior does not exist elsewhere.

**Declare an adapter as an adapter.** Symptom: a concept whose actions map
one-to-one onto an external system. Keep it, and say in its specification prose
that it is a boundary to a specific external interface rather than a domain
mechanism, so nobody evaluates it as one.

## Checklist

Suitable for a pull request that adds or changes concepts and composition. It
assumes the reasoning above; it does not replace it.

**Each new or changed concept**

- [ ] Purpose states a need. It names no peer; it is generic only when reuse is
      intended.
- [ ] Principle starts from empty state and uses this concept's actions and
      queries.
- [ ] Every action condition reads this concept's state, its inputs, or an
      explicit non-peer environmental dependency.
- [ ] Each managed entity has the lifecycle stages that apply, including an end,
      retention, expiry, or deliberate-permanence rule where relevant.
- [ ] Every ordinary expected rejection is a declared refusal with a stable code,
      not a fault.
- [ ] Actions return object mappings when composition must bind result fields.
- [ ] Query promises match the domain, and query implementations are written
      without side effects.
- [ ] Local invariants are enforced by their owner actions, including direct
      calls, with storage coordination where needed.
- [ ] Replicated state has an authority plus update, staleness, and repair rules,
      or an explicit historical-snapshot rationale.
- [ ] The specification and implementation name no peer concept or composition.
      Treat an import as a design-review finding; registration does not check it.

**Each new or changed reaction or endpoint**

- [ ] The name states the decision.
- [ ] The trigger posture matches intent: ask, `.responds(...)`,
      `.refuses(...)`, `returned(...)`, or `refused(...)`.
- [ ] Every identity is bound explicitly. Fresh names opened by declarative reads
      have a later use; inspect trigger and result bindings separately.
- [ ] The condition reads no more than the decision needs.
- [ ] The rule has a documented purpose — policy, workflow, notification,
      cascade, compensation, adapter, or cross-concept repair — rather than a
      concept's own invariant.
- [ ] Fan-out is intended, and something bounds the number of matches.
- [ ] The behavior when nothing matches is intended.
- [ ] Repeated firing is safe, refused, or explicitly accepted.
- [ ] The failure path is stated: what persists when a later action refuses or
      faults.
- [ ] Endpoint alternatives that can produce competing answers have intentional
      overlap or disjoint conditions. Protected or case-split paths have a
      denial or fallback result.
- [ ] Authorization uses a verified identity, not a claimed one.
- [ ] Any decision that must not race is inside an owner action and, for shared
      durable state, protected by storage coordination.

**The design as a whole**

- [ ] Each cross-concept invariant names its maintaining rule and its false
      interval.
- [ ] No cycle is unintentional; intentional ones name what disables them,
      define idempotency and retry behavior, have tests, and have an execution
      budget decision.
- [ ] Rules between one pair of concepts have documented independent purposes;
      pass-through and reconstruction rules have been reviewed.
- [ ] A likely change touches one concept or one rule, not several of each.
- [ ] Each changed concept and rule has focused evidence or a test that exercises
      its ordinary and relevant failure behavior.
