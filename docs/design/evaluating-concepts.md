# Evaluating a concept

A candidate concept is judged on five questions, in this order: is its purpose
real, is its boundary right, does it cover its own behavior, does it survive
failure and state its authority, and will it hold up as the application changes.
The order matters — a concept with the wrong purpose cannot be repaired by
adding actions, and a concept with the wrong boundary cannot be repaired by
tidying its state.

Each criterion below states what to check, the evidence that settles it, the
failure it detects, and the move that corrects the failure. Evidence means
something you can point at in the specification, the tests, or the composition,
not a judgment about elegance.

## Purpose

### The purpose names a need, not a mechanism or a behavior list

A purpose is the reason the concept exists. It is the only part of a
specification that can tell you the concept should not exist at all.

_Evidence:_ the purpose can be read to someone who has not seen the actions, and
they can predict roughly what the concept does and why someone would want it.
Alerting's purpose — keep an alert visible to its recipient until they
acknowledge it, so pending matters do not depend on memory — predicts `raise`
and `acknowledge` without naming them.

_Failure:_ "Store labels on documents." That is a data structure. It says
nothing about why labels exist or what makes a label useful, so no design
decision can be argued from it.

_Correction:_ restate the need. "Let people classify items using categories they
create and revise" names the value and leaves the storage model open. Now
questions like _may two people share a category?_ and _what happens to items when
a category is deleted?_ have somewhere to be decided.

### The purpose can be evaluated against the design

A purpose earns its place by settling arguments. If every candidate design
satisfies it equally, it is decoration.

_Evidence:_ you can name a plausible design the purpose rejects. Selecting's
purpose — keep one current item for a shared scope, so everyone working in that
scope can begin from the same choice — rejects a design that lets a scope have
two current items. Whether a prior selection's identity is retained is a separate
state and lifecycle decision.

_Failure:_ "Manage user data." No design is excluded.

_Correction:_ narrow until at least one reasonable alternative is ruled out. If
nothing can be narrowed, the candidate is probably several concepts.

### The concept can fulfill its purpose alone

_Evidence:_ walk the purpose from an empty state using only this concept's
actions and reach the value it promises.

_Failure:_ "Let people connect with each other and share updates." Connecting is
one mechanism and sharing is another; the concept cannot deliver the second, so
its specification will either grow a posting mechanism or quietly depend on one.

_Correction:_ split the purpose and keep the part this concept can deliver. The
connection between them becomes a reaction, which is where an application-level
goal belongs.

A related failure runs the other way: a purpose so narrow that fulfilling it
produces nothing anyone wants. "Record whether each student is present" is
complete and useless. Ask what the recorded fact is _for_ — attendance reports,
eligibility, alerts to guardians — and either extend the purpose to the point
where value appears or accept that the concept is a fragment of a larger one.

## Boundary

Independence, coherence, and separation of concerns are three views of one
question: does this specification describe one thing? Independence looks
outward, coherence looks inward, and separation of concerns looks for a seam.

### Independence

The specification can be read and understood without reading any other
specification.

_Evidence:_ the checklist in [independence](concepts.md#independence) — the
purpose names no peer, the state holds identities rather than a peer's data, no
action calls or inspects a peer, and the lifecycle completes alone. In this
repository, a concept class that imports a peer concept or a composition file
fails design review. Registration does not inspect those imports.

_Failure:_ a `Commenting` concept whose `post` action refuses when the target
article is unpublished. Commenting has no way to know that, so either it stores
a copy of publication status — duplicating state it does not own — or it reads
Article's state, which breaks independence.

_Correction:_ move a non-critical policy condition to composition. The endpoint
or reaction that asks `Commenting.post` can read publication status through a
view and then ask the action. Commenting stays usable on targets that have no
notion of publication. If the rule must be exact at the moment of posting, the
owner action and its storage transaction must also enforce the current policy;
the composition read can only provide an earlier denial.

### Coherence

Every piece of state and every action serves the one purpose.

_Evidence:_ a one-sentence answer to _why must these behaviors be designed and
understood together?_ that does not use the word "and" to join two mechanisms.
For Gathering: because membership is the fact that create, join, leave, and the
membership queries all establish, change, or report.

_Failure:_ the answer is "they all involve a project," "they appear on the same
screen," or "they are written by the same team." None of those is a behavioral
reason.

_Correction:_ keep whichever group answers the question and extract the rest.

### Separation of concerns

No two responsibilities that could vary independently are fused into one
concept.

_Evidence:_ the state does not divide into groups touched by disjoint sets of
actions; the concept's name does not need "and"; explaining it does not require
switching vocabularies.

_Failure patterns worth recognizing on sight:_

| Conflation                                                                                | Independent parts hiding inside                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `User` holding credentials, profile fields, preferences, roles, and notification channels | authentication, profile, preferences, authorization, notification routing |
| A content concept holding comments, reactions, sharing, ranking, and moderation           | commenting, rating, sharing, ranking, moderation                          |
| A reservation concept that also charges a card                                            | reservation and payment, which fail and reverse differently               |
| A file concept holding upload transport, access control, version history, and sharing     | storage, authorization, versioning, sharing                               |

_Correction:_ split along the seam and connect with reactions. Splitting is not
free; [choosing granularity](granularity.md) gives the tests that decide whether
a specific seam is real and what the split costs.

Do not split to make concepts smaller. A split is justified when each side
becomes independently meaningful and complete, not when the file gets shorter.

## Coverage

Coverage asks whether the concept actually does what its purpose claims.
Completeness and state sufficiency are the two directions of the same check:
weak state produces actions that cannot state their conditions, and weak actions
leave state that nothing can reach.

### Behavioral completeness

The concept delivers its purpose's value through its own actions.

_Evidence:_ the principle runs end to end using only this concept's actions,
starting from empty state.

_Failure:_ the principle cannot start, because setup happens elsewhere — a
product-catalog concept whose principle begins with a customer searching, with
no action that put anything in the catalog.

_Correction:_ add the setup actions, or move the concept boundary so setup lands
inside it.

### State sufficiency

Every domain precondition, result, and effect is expressible from this concept's
state and the action's inputs, plus any explicitly documented environmental
dependency such as a clock or identity source.

_Evidence:_ read each action's `where` branches and confirm each one names this
concept's state, the action's arguments, or an explicit non-peer dependency that
can be controlled in tests.

_Failure:_ a `Token` concept whose `validate` action must reject expired tokens,
with no expiry in its state. The implementation ends up taking the current time
and a validity window as arguments on every call, or reaching for a peer.

_Correction:_ add the missing state; use an explicit trusted input when the
caller owns the fact; use an injected trusted dependency such as a clock when
the environment owns it; move the behavior to the concept that owns the fact; or
move a non-critical cross-concept policy into a reaction. Never let one concept
read another's state.

### Lifecycle coverage

Each managed entity has the lifecycle stages that apply to it: creation,
ordinary use, completion, expiry, retention, reversal, or deliberate permanence.

_Evidence:_ for each kind of object in the state, name the action that creates
it, each action that changes it, and any applicable end or retention rule.
Gathering memberships are created by `create` and `join` and ended by `leave`.

_Failure:_ accounts can be created but never closed; reservations can be made
but never cancelled; a temporary grant is issued with no expiry or revocation.

_Correction:_ add the transition the lifecycle needs. Do not add CRUD symmetry
for its own sake — a concept whose entities genuinely never end does not need a
delete action, and one that would leave a dangling reference should say so
rather than offering a delete that quietly breaks an invariant.

### Action minimality

No action exists that the purpose does not require.

_Evidence:_ removing the action loses behavior a user or a composition depends
on.

_Failure:_ an action that loops another action over a set with no distinct
meaning of its own; a getter exposed as an action; a `setStatus` that lets a
caller move an entity into any state, which erases every transition rule the
concept was supposed to enforce.

_Correction:_ delete it, turn it into a query, or replace it with the named
transitions it was hiding.

Minimality is not "fewest actions." Removing `cancel` from a reservation concept
makes it smaller and incomplete. Removing an action that closes a lifecycle,
reverses an effect, or preserves an invariant is a coverage failure, not a
simplification.

## Failure, reversal, and authority

These two criteria are what most specifications skip, and they are where a
design is most likely to be wrong in a way tests do not catch.

### Failure and reversal behavior

The concept states what it refuses, and what can be undone.

_Evidence:_ each action lists its refusals with stable codes; each effect that
users can regret has a named reversal (`cancel`, `revoke`, `restore`,
`acknowledge`); the specification says whether repeating an action is
meaningful.

_Failure:_ an action that throws for an expected domain condition. A throw that
is neither a registered refusal error nor the advanced `Refuse` marker is a
**fault**: it leaves the ask without an outcome, and ordinary composition cannot
watch it as a domain result. See
[actions, refusals, and
faults](../semantics.md#actions-refusals-and-faults).

_Correction:_ declare the refusal in the specification, register an error class
for its code, and let composition branch on it. Reserve faults for conditions
the concept did not anticipate.

Reversal deserves a separate decision from deletion. `Discussing.close` ends a
discussion but keeps its responses, because the responses happened. A design
that deletes them instead is making a claim about history that its purpose
should defend.

### Authority and security boundaries

The concept states which facts it owns and which it merely receives, so that
authorization can be placed deliberately.

_Evidence:_ actions take the actor as an ordinary identity argument and do not
attempt to authenticate it. Gathering's `join` takes a `member` and refuses
duplicates; it never asks whether the caller is that person, because Gathering
does not own identity.

_Failure:_ a concept that decides both what a person may do and who that person
is, or an action that accepts a caller-supplied user identifier from an outside
request and treats it as authenticated.

_Correction:_ keep authentication, session validity, ownership, membership, and
authorization decisions in the concepts that own each fact, and connect them at
the boundary. [Authorization across concept
boundaries](composing-concepts.md#authorization-across-concept-boundaries)
covers the composition side, including which observations can go stale.

A decision that must not race is different from an authorization decision, and
it does not belong in composition at all. Uniqueness, capacity, first-come, and
answer-once decisions belong inside the action that owns the state, because the
engine gives no snapshot between a reaction's read and its consequence. See
[decisions that must not race](../semantics.md#decisions-that-must-not-race).

## Durability

The last group predicts how the concept ages.

### Reusability

The concept could be assembled into a different application without carrying
this one with it.

_Evidence:_ the specification contains no application vocabulary, and every
external type is generic. Gathering, Selecting, and Discussing are each used by
two shipped applications with different meanings bound to their generic types.

_Failure:_ `Selecting` renamed `MitigationChoosing`, with `scope` renamed
`room`. The behavior is identical and the reuse is gone.

_Correction:_ name the mechanism, not the application. Bind the meaning in
composition, where the reaction that asks `Selecting.choose({ scope: room })`
already says what the scope is here.

Not every concept must be reusable. An application-specific concept is a
legitimate outcome when the behavior genuinely exists only here — say it
explicitly rather than dressing it in generic names.

Use the following as a review heuristic, not a runtime classification.
Reusability has a ceiling, and passing it can be a more expensive mistake than
falling short. Aim for a concept reusable across applications **in a domain**,
not across every domain.

_Evidence:_ name two plausible applications the concept fits and one it clearly
does not. Gathering fits book clubs and incident rooms and would be nonsense in
a compiler. A concept that fits every application equally has stopped carrying
domain meaning.

_Failure:_ a concept whose actions would be equally correct anywhere —
`set(subject, path, value)`, `merge(layer, rank)`, `record(list, item, score)`.
These are value types with a purpose sentence attached. The narration is
frictionless precisely because there is no domain to contradict it.

_Correction:_ ask what the generic thing was standing in for. If a real domain
mechanism is behind it, name that mechanism and give it the transitions and
refusals the domain implies. If nothing is behind it, it is a module the concept
implementations import, not a concept.

Two risks follow from getting this wrong, and both can land outside the concept.
Its actions can become generic, so composition may recover meaning from literal
constants in trigger patterns rather than from action names — see [semantic
actions](state-and-actions.md#semantic-actions). Domain rules that the concept
could have enforced may also become application obligations. Inspect the actual
triggers and invariants rather than treating either result as automatic.

### Familiarity

Where the behavior matches a mechanism people already know, the concept uses
that mechanism's name and lifecycle.

_Evidence:_ a user or a new developer predicts the actions from the name.

_Failure:_ a familiar name over unfamiliar behavior, which is worse than an
unfamiliar name. A `Session` concept that never expires and cannot be ended
imports every expectation of sessions and honors none.

_Correction:_ either implement the expected lifecycle or rename the concept to
what it actually is.

### Change containment

A likely change touches one concept, or touches composition, but not both, and
not many concepts.

_Evidence:_ take three changes the application is likely to face and name the
files each would touch. "Alert responders when a mitigation is chosen" touches
one reaction. "Alerts expire after a day" touches Alerting. "Only the host may
contribute" swaps the contribution-policy pack, including complementary policy
views and its denial response.

_Failure:_ a change to who may contribute requires editing Discussing,
Gathering, and two endpoints.

_Correction:_ find the responsibility that is duplicated across those places and
give it one owner. In the Operations Room, that owner is a named view; see [the
policy views shipped with the
example](../../examples/operations-room/src/composition/responders-may-contribute.ts).

## Applying the criteria together

The criteria interact, and a candidate that fails several usually has one
underlying defect.

| Symptom                                                                               | Usual defect                                        | Start at                                                                                       |
| ------------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Purpose needs "and"; state divides cleanly                                            | Two concepts fused                                  | [granularity](granularity.md#evidence-for-and-against-a-split)                                 |
| Principle needs another concept's action                                              | Workflow described as a concept                     | [concepts](concepts.md#principle)                                                              |
| Preconditions reach for facts the concept lacks                                       | Wrong owner for the decision                        | [state sufficiency](state-and-actions.md#state-sufficiency)                                    |
| Only CRUD actions                                                                     | Storage exposed instead of behavior                 | [semantic actions](state-and-actions.md#semantic-actions)                                      |
| Many reactions between the same two concepts                                          | Split below a natural boundary, or a missing action | [reaction pressure](granularity.md#the-reaction-pressure-test)                                 |
| Composition reads a concept's state to decide what that concept should already refuse | Invariant escaped its owner                         | [what does not belong in a reaction](composing-concepts.md#what-does-not-belong-in-a-reaction) |

Fix the defect, not the symptom. Adding a reaction to work around a missing
action leaves both problems in place.
