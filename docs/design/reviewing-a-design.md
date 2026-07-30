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

Also list what the application does _not_ have: a concept that never appears in
any reaction is either unused or reached directly in a way the composition does
not record.

## 2. Review each concept

For each concept in turn, apply [the evaluation
criteria](evaluating-concepts.md) in their order — purpose, boundary, coverage,
failure and authority, durability — and stop at the first group that fails.
There is no value in tuning the actions of a concept whose purpose is an
application goal.

Five checks catch most defects quickly:

- Read the purpose alone and predict the actions. A mismatch means one of the
  two is wrong.
- Walk the principle from empty state using only this concept's actions. If it
  cannot start, setup lives in the wrong place; if it needs a peer's action, the
  boundary is wrong.
- Read each action's conditions and confirm they name only this concept's state
  and the action's inputs.
- Name the action that ends each managed entity's life.
- Find the concept's invariants and confirm each is enforced inside an action,
  not by a caller.

## 3. Review the composition

Read every reaction and endpoint as a set, not one at a time.

- **Does each rule encode an application decision?** A rule that could not
  plausibly have been decided differently is either a concept's own invariant
  that escaped, or a missing action.
- **Is any pair of concepts connected by many rules?** Read them together and ask
  what single decision they collectively express. See [reaction
  explosion](composing-concepts.md#reaction-explosion).
- **Do any rules form a cycle?** Trace consequences back to triggers. The engine
  does not detect cycles, and consumption does not stop one — see
  [cycles](composing-concepts.md#cycles).
- **Which rules fan out?** For each, name what bounds the number of matches.
- **Which cross-concept invariants exist, and which rule maintains each?** State
  the interval during which each is false.
- **Is any policy duplicated?** The same condition written into three endpoints
  should be one named view.
- **Does any endpoint path lack a denial branch?** Endpoints on one path do not
  fall through in declaration order, and an unmatched request waits for its
  deadline.

## 4. Trace scenarios end to end

Pick representative scenarios and trace each one through the whole design. For
each: identify the initiating action, follow every reaction it can match, record
which concept owns each state change, identify every authorization decision,
record the success and error paths, confirm identities stay correctly bound,
note fan-out and possible cycles, and state the final observable result.

Cover at least these nine. The last six are where designs fail.

| Scenario                      | What it exposes                                                         |
| ----------------------------- | ----------------------------------------------------------------------- |
| Ordinary success              | Whether the design does the thing at all                                |
| Invalid input                 | Whether refusals are declared, or conditions silently drop the case     |
| Unauthorized request          | Whether the denial branch exists and answers                            |
| Duplicate request             | Whether repetition is meaningful, refused, or silently doubles work     |
| Cancellation or reversal      | Whether the reversal exists and what it leaves behind                   |
| Deletion with dependent state | Which cascades fire, and what happens to state nothing cascades to      |
| Concurrent actions            | Which decisions race, and whether they are inside an action             |
| Partial failure in a fan-out  | Which effects landed, which did not, and what repairs them              |
| Retry after timeout           | Whether the repeat is safe, and which concept holds the durable outcome |

Trace the interruption at each important step, not only at the start. "The
selection landed and the discussion did not" is a reachable state, and it is the
one a design forgets; the runtime does not offer "both or neither."

## 5. Review the failure paths

Failure review asks one question of every effect: what remains if this step does
not happen?

- **Per action:** what does it refuse, and what does it fault on? An expected
  domain condition that faults instead of refusing cannot be handled by
  composition.
- **Per chain:** which earlier effects persist when a later action refuses or
  faults? Nothing is rolled back.
- **Per fan-out:** what happens when some effects succeed and others do not?
- **Per request:** which paths can leave a request unanswered? A fault-free
  request whose conditions all dropped returns `TIMED_OUT` after its deadline.
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
  the moment of effect is enforced inside the action that owns the state.
- Confirm the denial path answers, rather than dropping the case.
- Check what leaves the boundary: refusal codes projected as public categories,
  and detail that should not cross.

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
joined them. Verify that the merged concept still has one purpose — if it needs
"and," the seam was real and something else is wrong.

**Promote a state component to a concept.** Symptom: a field has acquired
transition rules, permissions, or history. Give it actions, a lifecycle, and a
purpose. Cost: a reaction now maintains what an action used to.

**Demote a concept to state.** Symptom: one passive field, no lifecycle, and
reactions that only forward. Fold it into the concept that reads it.

**Add the missing action.** Symptom: a reaction reads several queries and asks
several actions to accomplish one thing, or the same workaround appears in
several rules. Add the semantic action and delete the workaround. This is the
highest-value revision available, because it removes rules rather than moving
them.

**Move a racing decision into the action.** Symptom: a rule reads a fact and then
asks an action that depends on it, where two callers could interleave. Move the
check inside the action that owns the state, and keep the composition-level read
only to produce a better error.

**Name a duplicated policy as a view.** Symptom: the same condition in several
endpoints. Replace with one named view. This also makes the policy replaceable
without touching any endpoint.

**Rename to the mechanism.** Symptom: a general behavior wearing an
application-specific name. Rename the concept and its generic types, and bind
the meaning in composition.

**Declare an adapter as an adapter.** Symptom: a concept whose actions map
one-to-one onto an external system. Keep it, and say in its specification prose
that it is a boundary to a specific external interface rather than a domain
mechanism, so nobody evaluates it as one.

## Checklist

Suitable for a pull request that adds or changes concepts and composition. It
assumes the reasoning above; it does not replace it.

**Each new or changed concept**

- [ ] Purpose states a need, names no other concept, and no application.
- [ ] Principle starts from empty state and uses only this concept's actions.
- [ ] Every action condition reads only this concept's state and its inputs.
- [ ] Every managed entity has an action that ends its life.
- [ ] Every expected rejection is a declared refusal with a code, not a fault.
- [ ] Actions that composition consumes return object mappings.
- [ ] Query promises match the domain, and queries have no side effects.
- [ ] Local invariants are enforced inside actions, including against direct
      calls.
- [ ] No state is copied from another concept without a stated authority and
      repair rule.
- [ ] The class imports no peer concept and no composition.

**Each new or changed reaction or endpoint**

- [ ] The name states the decision.
- [ ] The trigger posture matches intent: ask, `.responds(...)`, or
      `.refuses(...)`.
- [ ] Every identity is bound explicitly, and no opened name is unused.
- [ ] The condition reads no more than the decision needs.
- [ ] The rule encodes an application decision, not a concept's own invariant.
- [ ] Fan-out is intended, and something bounds the number of matches.
- [ ] The behavior when nothing matches is intended.
- [ ] Repeated firing is safe, refused, or explicitly accepted.
- [ ] The failure path is stated: what persists when a later action refuses or
      faults.
- [ ] Endpoints on a shared path have disjoint conditions and a denial branch.
- [ ] Authorization uses a verified identity, not a claimed one.
- [ ] Any decision that must not race is inside an action.

**The design as a whole**

- [ ] Each cross-concept invariant names its maintaining rule and its false
      interval.
- [ ] No cycle is unintentional; intentional ones name what disables them.
- [ ] No pair of concepts is joined by rules that encode no decision.
- [ ] A likely change touches one concept or one rule, not several of each.
- [ ] Each concept and each rule has a test that runs without the rest of the
      application.
