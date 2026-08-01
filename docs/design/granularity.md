# Choosing granularity

Granularity is the choice of how much behavior lives inside one concept
boundary. It is the decision that most often determines whether a design is
workable, and the one most often made by habit.

Seek the smallest concepts that are still independently meaningful and
behaviorally complete. Smaller than that produces fragments that only make sense
together; larger produces a container that accumulates whatever shares an
identifier.

## What does not determine granularity

None of the following is evidence either way. Each one is a property of the
implementation or the interface, and the boundary is a property of the behavior.

- **How many actions or state components the candidate has.** Selecting has two
  actions and is a complete concept. A conflated `User` may have three and hide
  four concepts.
- **How many files or classes it takes to implement.** One concept can be a
  package; several can share a module.
- **How many database tables it uses.** Gathering owns two collections and is one
  concept.
- **Whether two responsibilities appear on the same screen.** The Operations Room
  dashboard reads four concepts at once. Screens compose; that is their job.
- **Whether one service usually implements both.** Common implementation
  practice records deployment grouping. Concept boundaries follow behavioral
  variation.
- **Whether splitting would require a reaction.** A correct split may require a
  reaction. What matters is whether the
  reaction expresses a real application decision or merely reassembles one
  operation.

## Evidence for and against a split

Evaluate the force of the evidence. One decisive item — two purposes, or an
invariant that requires both parts to change atomically — settles the question
against several weak ones.

Here, "atomically" describes the needed domain transition. The engine supplies
no transaction. One action serializes its body for one raw concept instance within
one engine, but does not create rollback, durable atomicity, or cross-process
coordination. A durable implementation that changes shared state needs the
appropriate storage transaction or constraint.

| Favors separation                                         | Favors keeping together                                  | Investigate before deciding                                 |
| --------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- |
| Two purposes, each stateable without the other            | One purpose; neither part has a principle alone          | Parts share an identity but no other state                  |
| Each part has its own principle                           | Every meaningful action spans both parts                 | One part is currently trivial but has an obvious lifecycle  |
| The parts have different lifecycles                       | One invariant requires both to change atomically         | The parts change together today for a reason nobody recalls |
| Different actors, permissions, or trust assumptions       | One part is an internal mechanism of the other           | A split would produce concepts that only forward calls      |
| One part can fail and be retried independently            | The split would need a reaction to rebuild one operation | Users describe the whole as one familiar mechanism          |
| State divides into groups used by disjoint actions        | One proposed concept exists only to hold a field         |                                                             |
| One part is already familiar as a concept elsewhere       | The parts cannot be initialized, used, or retired apart  |                                                             |
| One part could grow substantially without the other       |                                                          |                                                             |
| The name needs "and"; explaining it switches vocabularies |                                                          |                                                             |

## Tests

Run several. Each is cheap, and they disagree usefully.

### The purpose test

Can each proposed part state a purpose that the other does not share?

Membership and current-selection behavior pass: _make belonging deliberate and
visible_ and _keep one current item for a shared scope_ are unrelated needs.
Gathering-without-membership fails: the residue is _give a group a name_, which
no application wants on its own.

### The principle test

Can each part demonstrate a complete principle without invoking the other?

This is the sharpest test, because a principle that cannot start reveals a
fragment immediately. A `Membership` concept split out of Gathering cannot write
one: its `join` must refuse when the gathering does not exist, and it has no way
to know that.

### The removal test

Delete one part. Does the other still provide coherent value?

Reading Circle supplies the concrete removal result: it uses Gathering,
Selecting, and Discussing without Alerting. The Operations Room can disable the
alerting reaction pack, but its shipped dashboard also reads Alerting and would
need a different result shape if the concept were removed. Remove Discussing
from a candidate that fused discussion with response storage and nothing is
left.

### The reuse test

Would another application plausibly use one part without the other?

Reading Circle uses Gathering, Selecting, and Discussing without Alerting; the
Operations Room uses all four. That single fact justifies Alerting's boundary
better than any argument about cohesion.

### The state partition test

Can the state be divided so that each action reads and writes mainly one
partition?

A clean partition favors separation. Heavy overlap favors combination — but a
shared _identity_ is not overlap. Alerting's `recipient` and Gathering's
`member` may be the same identifier; neither concept stores a fact the other
owns, so there is nothing to partition.

### The change test

Can policy in one part change without redesigning the other?

Alert expiry, acknowledgement rules, and per-recipient ordering are all internal
to Alerting. None of them affects who belongs to a room.

### The authority test

Do the parts have different actors, permissions, or trust assumptions?

Creating a room, joining it, acknowledging an alert, and contributing to a
discussion raise different authorization questions against different facts. That
is strong evidence that the behaviors are separate. The shipped examples do not
authenticate caller-supplied identifiers, and `Alerting.acknowledge` does not
check that its caller is the recipient; treat these as policy questions to decide,
not as guarantees supplied by the example.

### The failure test

Can one part fail, be retried, or be compensated independently?

Reservation and payment fail differently: a declined card is an expected
outcome with a defined next step, and a lost reservation is a data problem.
Their reversals differ too — cancelling a reservation frees a slot, refunding a
charge moves money and may be partial. Fusing them forces one action to have two
failure models.

### The reaction-pressure test

After splitting, read the reactions the split requires.

A few reactions that each state a real application decision confirm the split.
The Operations Room needs two: a selection opens a discussion, and a selection
alerts each responder. Both are decisions the application could plausibly make
differently, and one of them can be removed by choosing a different pack.

Dense pass-through — a reaction for each action of one concept, mapping
one-to-one onto the other's actions, with no condition and no decision — is
evidence the split cut below a natural boundary, or that one side is an
external-system adapter. Reactions that only exist to reassemble an operation
users perform as one step point the same way.

Do not use a reaction count as a threshold. One reaction can encode severe
coupling; several simple ones can be clean composition. Read what each rule
decides.

## Worked split: one Room concept into four

A plausible first design gives the Operations Room a single concept:

```text
Room
  purpose  run an operations room where responders coordinate on the current
           mitigation
  state    a set of Rooms with a name, a host, a set of responders, an optional
           current mitigation, a seq of messages, and a set of open alerts
  actions  create, join, leave, chooseMitigation, postMessage, raiseAlert,
           acknowledgeAlert
```

It is internally consistent and easy to implement. Six tests reject it.

- **Purpose.** "Run an operations room" is an application goal. It cannot rule
  out any design, so it cannot be used to argue one.
- **Principle.** The archetypal scenario switches vocabulary four times —
  belonging, choosing, discussing, alerting — and no shorter scenario
  demonstrates the concept.
- **State partition.** `responders` is touched only by `join`, `leave`, and the
  roster read; `currentMitigation` only by `chooseMitigation`; `messages` only by
  `postMessage`; `alerts` only by `raiseAlert` and `acknowledgeAlert`. Four
  disjoint groups.
- **Reuse.** A reading circle needs belonging, a current reading, and a
  discussion, and has no use for alerts.
- **Authority.** The candidate creates distinct authorization questions against
  several facts. Those questions need separate policy and enforcement decisions.
- **Failure.** Alerting a responder can fail and be retried without touching the
  selection that caused it.

The revision is the shipped design: [Gathering](../../examples/reading-circle/src/concepts/gathering/spec.md),
[Selecting](../../examples/reading-circle/src/concepts/selecting/spec.md),
[Discussing](../../examples/reading-circle/src/concepts/discussing/spec.md), and
[Alerting](../../examples/operations-room/src/concepts/alerting/spec.md), joined
by two reactions:

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationOpensDiscussion = reaction(({ selection }) =>
  when(Selecting.choose({}).responds({ selection })).then(Discussing.open({ subject: selection })),
);
```

_Source: [`examples/operations-room/src/composition/packs.ts`](../../examples/operations-room/src/composition/packs.ts)_

```ts
export const SelectedMitigationAlertsResponders = reaction(({ room, selection, responder }) =>
  when(Selecting.choose({ scope: room }).responds({ selection }))
    .where(Gathering._members({ gathering: room }).is({ member: responder }))
    .then(Alerting.raise({ recipient: responder, subject: selection })),
);
```

### What the split costs

State these costs when proposing the split; they do not reverse the decision,
but they change what the application must handle.

**Choosing a mitigation and opening its discussion are separate actions.** The
reaction asks `Discussing.open` after the returned `Selecting.choose` occurrence
lands. An instrumented direct caller's `choose()` promise waits for outcome
reactions, but another read can still observe a current mitigation before `open`
settles. If `open` faults, the selection stays and nothing rolls it back. A
`DISCUSSION_ALREADY_OPEN` refusal means an open discussion already exists, so it
is not itself a missing-discussion case. The discussion pack is optional, which
is another reason readers must tolerate no discussion. See [ordering and
state-read timing](../semantics.md#ordering-and-state-read-timing).

**Every read that spans the gap must handle the window.** The shipped dashboard
does this deliberately, reading the discussion under `whether(...)` so a room
whose selection has no discussion still forms an answer:

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
    current: where(
      whether(Selecting._current({ scope: room }).is({ selection, item: mitigation })), // whether() allows optional matching — the row still exists if no selection is found
      whether(Discussing._openFor({ subject: selection }).is({ discussion })),
    ).form({
```

**Meaning now travels as an identity.** The selection identity becomes
Discussing's `subject` and Alerting's `subject`. Recovering the mitigation
behind an alert requires joining back through `Selecting._get`, which the
dashboard does. That indirection is the price of concepts that do not know what
a mitigation is.

**Two more units to test.** Each reaction needs its own test, and the four
concepts need their own principle tests.

## Worked non-split: membership stays inside Gathering

The same reasoning rejects a split that looks symmetrical with the one above.
Gathering owns two collections, so why not separate `Gathering` (name, host)
from `Membership` (gathering, member)?

- The purpose test fails in one direction: _make belonging deliberate and
  visible_ is Gathering's purpose, and the residue is a naming fragment.
- The principle test fails in the other: `Membership.join` must refuse
  `GATHERING_NOT_FOUND`, and a separated Membership cannot see whether the
  gathering exists.
- An invariant requires both to change together. Creating a gathering also
  creates its host's membership, in one action:

_Source: [`examples/reading-circle/src/concepts/gathering/spec.md`](../../examples/reading-circle/src/concepts/gathering/spec.md)_

```text
create (name: String, host: Person) : return (gathering: Gathering)
  then
    add a new gathering with name and host
    add a new membership with gathering and member host
    return gathering
```

A split turns that into two actions joined by a reaction. The engine provides no
multi-action transaction: if the membership action faults, a hosted gathering
can exist with no host inside it. Keeping the transition in one action gives it
one owner and per-instance serialization. Durable or cross-process enforcement
still requires storage coordination.

Every meaningful action — `create`, `join`, `leave` — spans both proposed
concepts. That is the combination signal.

## When the seam is real but the timing is wrong

Sometimes a candidate should split eventually and not yet. A trivial part with
an obvious lifecycle — a room's `status` field today that will become
open/triaging/resolved with transition rules, permissions, and history — is
worth splitting when the lifecycle arrives. Record the expectation
in the concept's specification prose so the next reader knows the boundary is
provisional, and re-run the purpose and principle tests when a second transition
appears.

The reverse mistake is more expensive. A part that grows inside a container
takes the container's state with it, and by the time the split is obvious the
seam is buried under actions that touch both sides. If the principle test
already passes for both parts, split now.
