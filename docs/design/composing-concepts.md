# Composing concepts

Concepts name no peers, so every dependency between two behaviors is stated
outside both of them. A **reaction** is that statement: when an action is asked
or settles, where current state matches, then ask further actions. Concept
design calls this rule a synchronization; sync-engine spells it `reaction`, and
the same design questions apply under either name.

A reaction should make a dependency visible. It is not a way to call one concept
from another with extra syntax — if a rule reads as "Selecting needs Discussing
to finish its job," the boundary is wrong before the rule is written.

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
returned. Three postures exist and mean different things: `when(C.action(...))`
watches the ask before the body runs, `.responds(...)` watches a successful
return, and `.refuses(...)` watches a declared refusal. Choose `.responds(...)`
for a consequence that should follow a state change; the ask posture is for
policy that must run before the action, and it does not know whether the action
will succeed.

**Condition** — _which cases survive, and what else does the rule need to know?_
`where` reads concept queries and views. It is the only place a rule may consult
another concept's published state, and it should read no more than the decision
requires.

**Effect** — _what does the application do about it?_ `then` asks semantic
actions. A reaction never writes storage and never mutates concept state
directly; it asks actions, and each concept decides whether its own action
returns or refuses.

Name the reaction after the decision, not the mechanism.
`SelectedMitigationAlertsResponders` says what the application believes.
`ChooseHandler` says nothing, and a reviewer cannot tell whether the rule is
still wanted.

## Binding and the movement of identities

Names are the wiring. A fresh name in an output pattern opens a binding; reusing
a bound name tests equality. In the reaction above, `room` is bound from the
trigger's `scope` input, `selection` from its result, and `responder` opens once
per row of `_members`. The effect then uses all three.

Two things follow for design. First, a reaction is where meaning is attached to
an identity: Selecting produced a value it calls a selection, and this rule
declares that Alerting should treat it as a subject. Second, a value that no
later line or consequence reads is refused at registration — an opened name is a
claim that the rule ranges over it, so the binding list is an honest statement of
what the rule depends on.

Bind every identity explicitly. A reaction that passes a whole result object
through obscures which fields matter and breaks when the producing concept adds
one.

## Causal flow

An outside request or a direct root action opens a **flow**, and every
consequence inherits it. Trigger matching is flow-local, so one request's
selection cannot fire a reaction against another request's discussion.

`earlier(...)` reads records earlier in the same flow — the mechanism a later
stage uses to recover the original request's inputs. Ordinary query lines are
different: they read concept state at the moment the reaction runs, not as of the
trigger. A reaction late in a cascade may observe state that an earlier
consequence already changed, and the runtime provides no as-of-trigger snapshot.

## What belongs in a reaction

- Translating an outside request into a concept action, and returning a result to
  that request.
- Enforcing authorization from identities and relationships owned by other
  concepts.
- Maintaining an intentional cross-concept invariant.
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
  concept. Reactions cannot make two actions atomic.
- **Storage manipulation or hidden mutation.** Effects are action asks.
- **Behavior a concept needs to fulfill its own purpose.** A notification concept
  that cannot deliver anything without a reaction supplying the delivery step is
  incomplete, not composed.
- **Work around a missing action.** When a rule reads three queries and asks four
  actions to achieve what one well-named action would do, add the action.

The last is the most common. Repeated workarounds against the same concept's
interface are the strongest available evidence that the concept, not the rule,
needs revision.

## Cross-concept invariants

An invariant that spans concepts is maintained by composition and is therefore
not continuously true. For each one, state six things:

1. the participating concepts;
2. the event that can violate it;
3. the reaction that restores or preserves it;
4. whether an interval exists during which it is false, and how long;
5. what happens when the restoring action refuses or faults; and
6. whether repair is automatic.

"Every current selection has an open discussion" in the Operations Room: the
concepts are Selecting and Discussing; `Selecting.choose` violates it;
`SelectedMitigationOpensDiscussion` restores it; the interval runs from
`choose` returning until `open` settles; if `open` refuses
`DISCUSSION_ALREADY_OPEN` or faults, the selection stands and the invariant
stays false; repair is not automatic.

Do not describe eventual repair as an atomic guarantee. If a design cannot
tolerate the window, the two state changes belong in one action of one concept —
which is a granularity decision, not a composition one.

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
path, and the request goes unanswered on it.

Two boundary rules shape endpoint design. An endpoint records **at most one**
answer: a second answer is refused with `NOT_PENDING`, and the caller keeps the
first. And nothing enforces coverage — a fault-free request whose conditions all
dropped simply waits for its deadline and returns `TIMED_OUT`. Design explicit
alternatives rather than relying on timeout as an outcome. See [sibling paths and
endpoint settlement](../semantics.md#sibling-paths-and-endpoint-settlement).

## Authorization across concept boundaries

Authorization is composition's job, because the facts it needs are owned by
different concepts: who the caller is, what relationship they have to the
resource, and what that relationship permits.

State each of these explicitly: the requesting actor, the authenticated
identity, the resource, the concept that owns each fact, the condition, and the
effect that occurs only after the condition holds.

Naming the condition as a view makes it reviewable and replaceable:

_Source: [`examples/reading-circle/src/composition/reading-circle.ts`](../../examples/reading-circle/src/composition/reading-circle.ts)_

```ts
export const memberMayRespond = view(
  "(member) may respond in (circle)",
  ({ member, circle }, _outputs, _bindings) =>
    where(Gathering._membership({ gathering: circle, member }).is({ joined: true })),
).holds();
```

The Operations Room ships two implementations of the same view name — [only the
host may contribute](../../examples/operations-room/src/composition/host-may-contribute.ts)
and [any responder may
contribute](../../examples/operations-room/src/composition/responders-may-contribute.ts)
— and swapping the policy changes no concept and no endpoint body.

Four rules follow.

**Never treat a request-supplied identifier as authenticated.** An identity that
arrives in a request body is a claim. It becomes an identity only after a concept
that owns credentials or sessions has verified it, and the verified value — not
the claimed one — is what the effect must use.

**Keep the facts in separate concepts.** Authentication, session validity,
profile, ownership, membership, and role assignment are different mechanisms with
different lifecycles. Fusing them produces a concept whose purpose is "everything
about users," and authorization rules that cannot be reviewed one at a time.

**Write the denial branch.** Endpoints on one path do not fall through in
declaration order, and the runtime does not check that branches are disjoint or
complete. The reading circle pairs `memberMayRespond` with a deliberately
disjoint `nonmemberMayNotRespond` view driving a rejecting endpoint on the same
path, so a nonmember gets an answer rather than a timeout.

**Treat an authorization read as an observation, not a lock.** The membership
read happens when the endpoint evaluates; the action runs afterwards. If the
decision must be exact at the moment of the effect — a capacity check, a
one-time redemption, a first-writer-wins claim — the concept that owns the state
must enforce it inside its action, and the composition-level check is a
convenience for producing a good error.

## Hazards

### Pass-through reactions

A rule that maps each action of one concept onto a corresponding action of
another, with no condition and no decision, is a symptom. Either one concept is
an adapter to an external system, or the split has no semantic value.

An adapter is legitimate — say so in its specification prose, rather than
presenting it as a domain concept. A split with no semantic value should be
undone; see [the reaction-pressure
test](granularity.md#the-reaction-pressure-test).

### Reaction explosion

Many rules between the same two concepts usually indicate one of: conflated
purposes, a split below a natural boundary, a missing semantic action,
duplicated state, or a workflow expressed at too fine a grain.

There is no numeric threshold. Read each rule and ask what application decision
it encodes. Rules that encode no decision are the ones to remove.

### Cycles

A cycle exists when a chain of reactions can produce another occurrence that
matches a reaction earlier in the same chain.

The engine does not detect cycles. Trigger consumption prevents one reaction
from evaluating the _same_ record twice, and a later record cannot make it
reconsider an earlier trigger — but each turn of a cycle produces _new_ records,
and those match normally. A cycle therefore runs until something stops it.

Three things can stop it: a concept refuses, because its state no longer permits
the action; a condition stops matching; or an execution budget is exceeded. Only
the first two are design. With an `ExecutionLimits` profile configured, exceeding
the per-flow action or firing budget records integrity evidence and settles a
pending request with opaque `INTERNAL_ERROR`. Without a profile, no per-flow
action, firing, or row budget applies.

For every potential cycle, determine whether it is intentional, what state change
disables it, whether the actions in it are idempotent, whether a retry can
restart it, and how it is tested. A cycle that terminates in one example is not a
cycle that terminates.

Prefer to break cycles by design: trigger on a narrower posture, add a condition
that the effect invalidates, or move the decision into an action that refuses the
second time.

### Fan-out

A `where` block that reads a `many` relation produces one firing per row.
`SelectedMitigationAlertsResponders` fires once per room member; a room with
forty responders produces forty `Alerting.raise` asks from one selection.

Document, for each fan-out: what determines the number of matches, whether the
effects are independent, what a practical bound is, and what happens when some
succeed and others do not. A `where` that finds no rows produces no firing and no
effect, which is usually right and occasionally a silent hole — if a selection in
an empty room should still be visible somewhere, some other rule must say so.

Row limits under `ExecutionLimits` bound engine-owned expansion during matching
and evaluation. They are a safety limit, not a design decision.

### Partial failure

Consequences are not atomic and are not rolled back.

Within one `then(...)` group, members are independent siblings: each matching
sibling is eligible to ask its action, the group carries no priority and no
exclusivity claim, and a refusal or fault on one path does not stop the others. A
later `.then(...)` extends each path after that path's own preceding action
returns; it is not a join.

Across a fan-out, some `Alerting.raise` asks can succeed while another faults.
The successful alerts remain. Nothing retries the failed one.

The engine can also fail _between_ asks — while matching a trigger, evaluating a
read, or forming consequence input. It appends a `reaction-failure` entry naming
the reaction, flow, and stage. A failure at the trigger or `where` stage happens
before a firing and does not consume the trigger; a failure at a consequence
stage keeps the firing's consumption, and any actions already asked keep their
effects. See [failures between action
asks](../semantics.md#failures-between-action-asks).

So for any multi-effect reaction, decide and record: whether the effects are
independent, which concept holds the durable outcome, whether a partial result is
acceptable, and what compensation exists. If the answer is that partial results
are unacceptable, the effects belong in one action.

### Compensation

Compensation is a reaction that reacts to a failure: `when` an action refuses,
`then` ask the action that undoes an earlier effect. Use the `.refuses(...)`
posture so the rule names the domain outcome it responds to.

Compensation restores service; it does not erase what happened. A refund is a
new fact, not the absence of a charge. And the compensating action can itself
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

Action bodies run one at a time per concept instance within one engine. Nothing
serializes two concepts, two flows, two engines, or two processes. Queries do not
enter the action queue and can overlap an asynchronous action body.

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

- **Reactions must be portable.** Ordinary assembly rejects closures and other
  local executable behavior, so every rule can be represented, inspected, and
  re-registered. A design that needs a closure to express a condition is telling
  you the condition should be a view or an action.
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
