# Composing concepts

In this design model, concepts name no peers, so every dependency between two
behaviors is stated outside both of them. A **reaction** is that statement: when
an action is asked, returned, or refused, where current state matches, then ask
further actions. This constraint governs concept specifications; arbitrary class
code remains ordinary TypeScript.

Use a reaction to connect independently complete concepts. If Selecting needs
Discussing to fulfill Selecting's own purpose, revise the concept boundary before
writing the rule.

This page is about designing reactions. [Connect independent
behaviors](../guide/reactions.md) teaches the authoring surface, [the read
construction cookbook](../book.md) shows the read forms with their registered
read-backs, and [execution semantics](../semantics.md#reactions) is authoritative
for matching, ordering, and failure.

## Trigger, condition, and effect

Every reaction has three parts, and each answers a separate design question.

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose({ scope: room }).responds({ selection }))
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(Alerting.raise({ recipient: responder, subject: selection })),
);
```

**Trigger** — _which occurrence makes this rule relevant?_ Here, a `choose` that
returned. The public postures mean different things: `when(C.action(...))`
watches the ask before the body runs, `.responds(...)` watches a returned
outcome, and `.refuses(...)` watches a refusal outcome. Framework reactions can
also observe faults. Choose `.responds(...)` for a consequence that should
follow a returned action; the ask posture is for policy that must run before the
action and does not establish that the action will succeed.

**Condition** — _which cases survive, and what else does the rule need to know?_
For declarative policy, `where` reads concept queries and views and is the usual
place to consult another concept's published state. Formers used to construct
consequence input can also read queries, and named vocabulary computations are
ordinary executable code. Keep those computations narrow and side-effect free;
the engine does not infer that property from their position in a rule.

**Effect** — _what does the application do about it?_ In portable composition,
`then` asks semantic actions. The reaction IR does not write storage or mutate
concept state directly; each action decides whether it returns or refuses.

Name the reaction after the decision.
`SelectedMitigationAlertsResponders` says what the application believes.
`ChooseHandler` says nothing, and a reviewer cannot tell whether the rule is
still wanted.

## Stages, siblings, and separate rules

One set of consequences can be written three ways, and the choice affects the
design. It changes how the correlation between steps is
established, where a failure stops, and whether a reader can tell which parts are
independent.

**A later `.then(...)` stage** when the next step needs a value the preceding
action returned, or must not begin until it returned. The engine pins each later
stage to the exact ask from the preceding one, so the dependency is stated once.
The alternative — a second reaction triggered on `Discussing.respond` — would
have to re-find the discussion, the selection, and the original request's inputs
to reconstruct a correlation the first rule already had. The [`AddResponse`
endpoint](#request-and-response-flow) is the shape: read the policy and the
discussion, ask `Discussing.respond`, then answer with what it returned.

The cost is that a chain has more places to end without an answer. A refusal or
fault stops that path, and no later stage on it runs. See [chain only after a
return](../guide/reactions.md#chain-only-after-a-return) for the authoring form.

**A separate reaction** when the consequence is an independent decision — one
that could be added, removed, or replaced without changing the other. The
Operations Room writes two rules against one `Selecting.choose` for that reason:
one opens a discussion, the other alerts each responder, and an assembly can
include either without the other. Chaining them would claim a dependency that
does not exist, and would let a failure to alert stop the discussion.

**Siblings in one `then(...)` group**, each ending in a stable `.named(...)`
label, when several alternatives are cases of one decision. They read as one
rule with branches, avoiding near-duplicate rules that a reader would have to
diff. The
engine lowers them to separate paths and the group carries no priority,
exclusivity, or coverage claim, so any disjointness is yours to establish and
state — see [sibling paths and endpoint
settlement](../semantics.md#sibling-paths-and-endpoint-settlement). Siblings are
logically independent, but current execution evaluates them sequentially. A
non-settling earlier sibling evaluation can prevent later sibling work.

Shape is what makes composition legible, and legibility is reviewable: a rule
whose decision needs a comment usually wants its condition named as a view or
wants a better name, and a rule that rebuilds a correlation another rule already
established usually wants to be a stage of it.

## Binding and the movement of identities

Names are the wiring. A fresh name in an output pattern opens a binding; reusing
a bound name tests equality. In the reaction above, `room` is bound from the
trigger's `scope` input, `selection` from its result, and `responder` opens once
per row of `_members`. The effect then uses all three.

Two things follow for design. First, a reaction is where meaning is attached to
an identity: Selecting produced a value it calls a selection, and this rule
declares that Alerting should treat it as a subject. Second, an opened name is a
claim that the rule ranges over it, so the binding list should state what the
rule depends on. Registration diagnoses unused fresh bindings opened by
declarative read lines. Unused trigger and result bindings remain outside that
diagnostic's scope.

Bind every identity explicitly. A reaction that passes a whole result object
through obscures which fields matter and breaks when the producing concept adds
one.

## Causal flow

An outside request, direct action, direct query, or direct former evaluation
opens a **flow**, and every consequence inherits it. Trigger matching is
flow-local, so one request's selection cannot fire a reaction against another
request's discussion.

`earlier(...)` reads records earlier in the same flow — the mechanism a later
stage uses to recover the original request's inputs. Ordinary query lines read
concept state when the reaction runs. A reaction late in a cascade may observe state that an earlier
consequence already changed, and the runtime provides no as-of-trigger snapshot.

## What belongs in a reaction

- Translating an outside request into a concept action, and returning a result to
  that request.
- Expressing cross-concept policy from identities and relationships owned by
  other concepts.
- Initiating repair of an intentional cross-concept relation.
- Notifying after a relevant action.
- Cascading a lifecycle event across independently owned state — deleting a post
  removes its comments.
- Connecting several concepts into an application workflow.
- Adapting one concept's output vocabulary to another's input vocabulary.
- Starting compensation after a failure, when compensation is application policy.

## What does not belong in a reaction

- **A concept's own invariant.** If `Discussing` must refuse a response to a
  closed discussion, that check belongs in `respond`. A `where` line that
  performs it leaves the concept defenseless against a direct call and makes the
  rule race — see [decisions that must not
  race](../semantics.md#decisions-that-must-not-race).
- **Validation that reads only one concept's state.** Same reason.
- **A multi-step reconstruction of one operation.** If users experience it as a
  single act and an invariant spans the steps, it should be one action in one
  concept. Reactions cannot make two actions atomic; durable shared-state
  enforcement also needs storage coordination.
- **Storage manipulation or hidden mutation.** Effects are action asks.
- **Behavior a concept needs to fulfill its own purpose.** A notification concept
  that depends on a reaction for delivery has an incomplete concept boundary.
- **Work around a missing action.** When a rule reads three queries and asks four
  actions to achieve what one well-named action would do, add the action.

Repeated workarounds against the same interface are strong evidence that the
concept interface needs revision.

## Cross-concept invariants

A relation that spans independently owned concepts cannot be made continuously
true merely by composition. A reaction can initiate eventual repair. For each
such relation, state six things:

1. the participating concepts;
2. the event that can violate it;
3. the reaction that restores or preserves it;
4. whether an interval exists during which it is false, and how long;
5. what happens when the restoring action refuses or faults; and
6. whether repair is automatic.

"Every current selection has an open discussion" is a relation the Operations
Room can request when its discussion pack is enabled. The concepts are Selecting
and Discussing; a returned `Selecting.choose` occurrence triggers
`SelectedMitigationOpensDiscussion`, which asks `Discussing.open`. A fault can
leave the selection without a discussion. `DISCUSSION_ALREADY_OPEN` means an
open discussion was already observed and the relation currently holds.
The pack can also be absent. The dashboard therefore treats a discussion as
optional.

Do not describe eventual repair as an atomic guarantee. If a design cannot
tolerate a window or a failed repair, it needs combined ownership or a storage
transaction that enforces both facts — a granularity and persistence decision,
not a composition rule.

Readers that span the invariant must handle the window explicitly. The shipped
dashboard reads the discussion under `whether(...)` for exactly this reason.

## Request and response flow

An endpoint is a reaction whose trigger is an outside request. It receives
admitted input, may read views and queries, asks actions, and may produce one
response.

_Source: [`examples/reading-circle/src/composition/reading-circle.ts`](../../examples/reading-circle/src/composition/reading-circle.ts)_

```ts
export const AddResponse = endpoint(
  "/circles/respond",
  ({ circle, reading, member, text, selection, discussion, response }) =>
    receive({ circle, reading, member, text })
      .where(
        memberMayRespond({ member, circle }),
        Selecting._current({ scope: circle }).is({ selection, item: reading }),
        Discussing._openFor({ subject: selection }).is({ discussion }),
      )
      .then(Discussing.respond({ discussion, author: member, text }).responds({ response }))
      .then(respond({ response })),
);
```

Read the identity path: the caller supplies a circle and a reading, the current
selection for that circle is required to be that reading, the discussion open for
that selection is found, and only then is a response added to it. Nothing trusts
the caller to name a discussion.

The second `.then(...)` waits for `Discussing.respond` to return, which is how a
chain gets a value from an action into a response. A refusal or fault stops that
path. In an ordinary assembly, the standard refusal or fault funnel can still
settle a pending boundary request with the refusal code or `INTERNAL_ERROR`.

Two boundary rules shape endpoint design. An endpoint records **at most one**
answer: a second answer is refused with `NOT_PENDING`, and the caller keeps the
first. And nothing enforces coverage — a fault-free request whose conditions all
dropped simply waits for its deadline and returns `TIMED_OUT`. Design explicit
alternatives so unmatched cases receive an authored outcome. See [sibling paths and
endpoint settlement](../semantics.md#sibling-paths-and-endpoint-settlement).

## Authorization across concept boundaries

Composition can express authorization policy when the relevant facts are owned
by different concepts: who the caller is, what relationship they have to the
resource, and what that relationship permits. The owner action and its storage
are additional enforcement points. A security-critical or race-sensitive action must recheck the current
rule in the owner action and, for shared durable state, in the relevant storage
transaction or constraint.

State each of these explicitly: the requesting actor, the authenticated
identity, the resource, the concept that owns each fact, the condition, and the
effect that occurs only after the condition holds.

Naming the condition as a view makes it reviewable and replaceable:

_Source: [`examples/reading-circle/src/composition/reading-circle.ts`](../../examples/reading-circle/src/composition/reading-circle.ts)_

```ts
export const memberMayRespond = view(
  "(member) may respond in (circle)",
  (inputs, _outputs, _bindings) => {
    const { member, circle } = inputs("member", "circle");
    return where(Gathering._membership({ gathering: circle, member }).is({ joined: true }));
  },
).holds();
```

The Operations Room ships two implementations of the same view name — [only the
host may contribute](../../examples/operations-room/src/composition/host-may-contribute.ts)
and [any responder may
contribute](../../examples/operations-room/src/composition/responders-may-contribute.ts)
— and swapping the policy changes no concept and no endpoint body.

Four rules follow.

**Use identities established by authentication.** An identifier in a request
body is a claim. A concept that owns credentials or sessions verifies the claim
and supplies the identity used by the effect.

**Keep the facts in separate concepts.** Authentication, session validity,
profile, ownership, membership, and role assignment are different mechanisms with
different lifecycles. Fusing them produces a concept whose purpose is "everything
about users," and authorization rules that cannot be reviewed one at a time.

**Write explicit complementary branches for protected or case-split paths.**
Endpoints on one path do not fall through in declaration order, and the runtime
does not check that alternatives are disjoint or complete. The Reading Circle
pairs `memberMayRespond` with a deliberately disjoint `nonmemberMayNotRespond`
view driving a rejecting endpoint on the same path, so a nonmember receives a
denial response.

**Treat an authorization read as a current observation.** The membership
read happens when the endpoint evaluates; the action runs afterwards. If the
decision must be exact at the moment of the effect — a capacity check, a
one-time redemption, a first-writer-wins claim — the concept that owns the state
must enforce it inside its action and, when relevant, its storage transaction.
The composition-level check is only an earlier convenience for producing a good
error.

## Hazards

### Pass-through reactions

A rule that maps each action of one concept onto a corresponding action of
another, with no condition and no decision, is a symptom. Either one concept is
an adapter to an external system, or the split has no semantic value.

An adapter is legitimate when its specification identifies the external
interface boundary. A split with no semantic value should be
undone; see [the reaction-pressure
test](granularity.md#the-reaction-pressure-test).

### Rules that only sequence

A sequence carried by separate reactions is a review smell when none of the
rules adds a policy, independently chosen consequence, or state transition that
belongs to its owner. The reactions still encode causal order, but they can
distribute one workflow across rules that decide nothing independently.

The following schematic shape is recognizable: each rule triggers on the
previous rule's effect, and the chain reads as consecutive statements rather
than distinct consequences.

```text
AttemptsClearContext        when Diagnosing.retract      then Composing.clear
ClearedContextsSetSite      when Composing.clear         then Composing.set site
SiteContextsSetCollections  when Composing.set site      then Composing.set collections
CollectionContextsSetData   when Composing.set collections then Composing.set data
DataContextsSetUrl          when Composing.set data      then Composing.set url
```

Ask of each rule what the application decided. Here, the five effects write
different parts of one record and do not depend on each other. Each trigger
states an order, but the causal sequence is distributed across the file.

- **A false dependency propagates failure.** Every rule in the chain can drop
  its case. When one condition finds no row, the rest of the chain never runs,
  and the effects that had nothing to do with that condition are lost with it.
- **A fork can duplicate a tail.** An optional condition often requires the
  later work once for each branch, and the copies can drift.
- **The ordering is harder to inspect.** A reader has to follow each effect to
  the next trigger across a file to reconstruct the dependency.

When the work really is one decision, collapse the chain. Effects that are
independent can be named siblings in one `then(...)` group, with the reads they
need in one `where`. A sibling group is logically independent but currently
evaluates sequentially, so do not use it to promise concurrent dispatch. Effects
that genuinely depend on a preceding action's result belong in later `.then(...)`
stages of the same rule, where the dependency is stated once and the engine pins
each stage to the exact preceding ask. See [stages, siblings, and separate
rules](#stages-siblings-and-separate-rules).

When each step reads state that a prior owner establishes, separate reactions or
stages can be intentional. Review whether one owner should instead expose a
single transition, and whether durable correctness needs a storage transaction;
do not treat that restructuring as automatic.

### Reaction explosion

Many rules between the same two concepts can indicate conflated purposes, a split
below a natural boundary, a missing semantic action, duplicated state, a workflow
expressed at too fine a grain, or the sequencing chain above. They can also be
intentional independent policy or workflow rules.

There is no numeric threshold. Read each rule and ask what application decision
it encodes. Move every effect from a rule that encodes no decision into the rule
or action that should have carried it.

A high number of single-effect, unconditional rules is a prompt to inspect the
whole design. Read the decision and failure behavior of each rule before merging
or removing it.

### Cycles

A cycle exists when a chain of reactions can produce another occurrence that
matches a reaction earlier in the same chain.

The engine does not detect cycles. For public single-trigger reactions, trigger
consumption prevents one reaction from evaluating the _same_ record twice. Each
turn of a cycle produces new records, and those match normally. Manually
registered multi-trigger IR has different reconsideration behavior and remains
available only to manual engines. A cycle therefore runs until something stops it.

A concept refusal, a fault, or a condition that stops matching can stop a cycle.
With an `ExecutionLimits` profile configured, the per-flow action, firing, and
row budgets can also stop it. A limit breach records integrity evidence; a
boundary request that remains pending then settles with opaque `INTERNAL_ERROR`.
An answer already delivered remains authoritative. Without a profile, no
per-flow action, firing, or row budget applies.

For every potential cycle, determine whether it is intentional, what state change
disables it, whether the actions in it are idempotent, whether a retry can
restart it, and how it is tested. One terminating example proves only that run.

Prefer to break cycles by design: trigger on a narrower posture, add a condition
that the effect invalidates, or move the decision into an action that refuses the
second time.

### Fan-out

A plain `many` relation with a fresh output binding can produce one firing per
distinct matching fill. A bound or literal output pattern can filter rows, an
empty output pattern is existential, and several many reads can form a product.
`SelectedMitigationAlertsResponders` opens a fresh `responder` binding, so a room
with forty matching members produces forty `Alerting.raise` asks from one
selection.

Document, for each fan-out: what determines the number of matches, whether the
effects are independent, what a practical bound is, and what happens when some
succeed and others do not. A `where` that finds no rows produces no firing and no
effect, which is usually right and occasionally a silent hole — if a selection in
an empty room should still be visible somewhere, some other rule must say so.

Row limits under `ExecutionLimits` bound engine-owned expansion during matching
and evaluation. Design fan-out independently within those safety limits.

### Partial failure

Each consequence commits independently. Later failure leaves completed effects
in place.

Within one `then(...)` group, members are independent siblings: each matching
sibling is eligible to ask its action, the group carries no priority and no
exclusivity claim, and a refusal or fault on one path does not stop the others.
Current execution is sequential, however, so an earlier sibling evaluation that
does not settle prevents later sibling work. A later `.then(...)` extends each
path after that path's own preceding action returns. Each path advances
independently.

Across a fan-out, some `Alerting.raise` asks can succeed while another faults.
The successful alerts remain. Nothing retries the failed one.

The engine can also fail _between_ asks — while matching a trigger, evaluating a
read, or forming consequence input. It appends a `reaction-failure` entry naming
the reaction, flow, and stage. A failure at the trigger or `where` stage happens
before a firing and does not consume the trigger. A consequence-stage failure can
occur after a firing has been consumed or actions have been asked; those actions
keep their effects. A failure before the branch is marked need not consume it.
See [failures between action
asks](../semantics.md#failures-between-action-asks).

So for any multi-effect reaction, decide and record: whether the effects are
independent, which concept holds the durable outcome, whether a partial result is
acceptable, and what compensation exists. If partial results are unacceptable,
the design normally needs one owning action and the storage transaction or
constraint that protects its durable outcome.

### Compensation

Compensation is a reaction that reacts to a failure: `when` an action refuses,
`then` ask the action that undoes an earlier effect. Use the `.refuses(...)`
posture so the rule names the domain outcome it responds to.

Compensation restores service while preserving the original history. A refund
adds a new fact alongside the charge. The compensating action can itself
refuse or fault, which leaves the system in a third state — decide whether that
state is acceptable before relying on the pattern.

### Repeated firing and idempotency

Do not assume exactly-once execution. The runtime provides no retry
deduplication and no exactly-once guarantee, and a caller retry can repeat a
completed action or overlap work that continued after a timeout.

Decide where idempotency lives, and prefer the first option:

- **In the receiving action**, keyed on state the first call invalidates, or on
  an operation identity the caller supplies. `Discussing.open` is already
  idempotent in effect, because the second open for a subject refuses.
- **In the reaction's condition**, using `no(...)` to check the effect has not
  happened. This is racy by construction and only suitable when a duplicate is
  merely untidy.
- **In infrastructure**, only when its delivery guarantee is documented.

A correlation identifier does not deduplicate work and is not an idempotency key.

### Ordering

Do not infer ordering from source order, file order, or test runs. An assembly
sorts reactions by name before registering them and evaluates reactions for one
trigger record sequentially; none of that is a priority mechanism, and
applications must not use it as one.

Where correctness depends on order, encode it causally: put the dependent effect
in a later `.then(...)` stage, so it runs after the preceding action on its path
returns. Where two effects are genuinely independent, say so, and check that
either order is acceptable — including the case where one fails.

### Stale observations and concurrency

Action bodies targeting the same raw concept instance run one at a time within
one engine. There is no engine-wide serialization: different concepts and flows
can overlap, and separate engines or processes do not share a queue. The queue
awaits native promises and structural `PromiseLike` values. Queries do not enter
the action queue and can overlap an asynchronous action body.

A reaction's read is therefore a snapshot of nothing: it was true when it was
read. Every rule of the form "read a fact, then act on it" has a window. Where
that window matters, move the decision into the action that owns the fact. Where
it does not, say why — usually because the fact changes rarely and the
consequence is reversible.

## Observability and testing

A reaction is independently testable. Assemble the concepts it needs, ask its
trigger action, and check which consequences were asked. It needs no HTTP
boundary and no client.

Three properties of the design make that test worth writing:

- **Portable composition excludes embedded local behavior.** Ordinary assembly
  rejects local executable behavior embedded in a reaction, view, or former, so
  portable definitions can be represented, inspected, and re-registered against
  the same named vocabulary. This does not reject all executable code: concept
  methods and named vocabulary computations remain code supplied by that
  vocabulary. A condition that needs embedded local behavior may belong in a
  named view or an action.
- **Registration produces a read-back.** The engine states each reaction's
  triggers, reads, opened and tested names, fan-out, and dropped cases as text.
  Reading it is the cheapest way to find a rule that fans out where the author
  expected one firing; [the read construction cookbook](../book.md) quotes these
  entry by entry.
- **Occurrences record what happened.** Asks, outcomes, faults, firings, and
  reaction failures are evidence for a specific run. They are not concept state,
  and they are not replayed on restart.

Test the failure paths as deliberately as the success path: the refusal branch,
the fan-out with zero rows, the duplicate request, and the case where a later
stage fails after an earlier effect landed.
