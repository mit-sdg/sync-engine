# State and actions

State and actions are designed against each other. State that is shaped wrong
produces actions that cannot state their own conditions; actions that are shaped
wrong reveal state the concept is missing or should not own. Work back and forth
until every precondition reads only this concept's state and every state
component is reachable by some action.

## State

### Abstract state, not storage

Describe what the concept knows, not how it is stored. State should establish
which identities exist, which relationships hold among them, which values change
behavior, which lifecycle stage each managed entity occupies, and which
invariants this concept enforces.

Selecting's state is five lines:

_Source: [`examples/reading-circle/src/concepts/selecting/spec.md`](../../examples/reading-circle/src/concepts/selecting/spec.md)_

````text
```state
a set of Selections with
  a scope Scope
  an item Item

a Current set of Selections
```
````

`Current` is a subset, not a boolean field, which is how the design says that
being current is a stage a selection is in — and that a selection which stops
being current still exists and keeps its identity. The prose beside it states
the invariant the concept owns: at most one current selection per scope.

Postpone tables, documents, classes, indexes, cache layouts, serialization
formats, and framework models. Reach for an implementation detail only when it
changes observable behavior or constrains the design — a value that must be
unique under concurrent writes, for instance, forces a decision about where that
uniqueness is enforced.

Two representation choices do carry meaning and belong in the abstract state.
Order is one: Discussing declares responses as a `seq` because `_responses`
promises arrival order, and a design using a set would need a timestamp and an
ordering rule to make the same promise. Use a set when order is incidental.
Multiplicity is the other: `an optional parent` and `a set of parents` state
different constraints, and the constraint is behavior.

A `State` section is uninterpreted notation: nothing compares it with the class,
the storage, or the generated contract, and no validator is derived from it. See
[state notation](../concept-specification.md#state-notation). Its purpose is to
expose design defects — state no action reads, or a precondition that cannot be
expressed — before implementation.

### State sufficiency

Every precondition, result, and effect must be expressible from this concept's
state and the action's inputs.

Read each action branch and check that it names only those two sources.
`Selecting.clear` refuses when no current selection has that scope; both the
scope and the current-selection relation are in Selecting's state, so the
condition is expressible.

When an action needs something the state does not have, choose in this order:

1. **Add the missing state**, when the fact is genuinely this concept's. A token
   concept that must reject expired tokens needs an expiry.
2. **Pass it as an input**, when the fact belongs to the caller. An action that
   records who performed something takes the actor as an argument.
3. **Move the behavior** to the concept that owns the fact, when the decision
   really belongs there.
4. **Move the condition into composition**, when it is a cross-concept policy
   rather than the concept's own rule.

Never let one concept read another's state. The fourth option is the one to
watch: moving an invariant that is genuinely local into a reaction leaves the
concept unable to protect itself against a caller that asks the action directly.
See [what does not belong in a
reaction](composing-concepts.md#what-does-not-belong-in-a-reaction).

### State ownership

Each durable fact has exactly one concept that owns its meaning and its mutation
rules.

Several concepts may refer to the same identity without sharing ownership. A
person identifier can appear as Gathering's `member`, Alerting's `recipient`,
and Discussing's `author` simultaneously. None of them owns the person: what
each owns is a relation it established — a membership, an alert, a response.

Do not copy a neighbor's descriptive fields for convenience. Storing a display
name inside Discussing so that `_responses` can return it creates two problems:
the name is now maintained in two places, and Discussing has acquired an opinion
about what an author is. Let the former that builds the answer read the profile
concept instead.

When duplication is deliberate — for indexing, caching, history, or resilience —
state four things in the concept's prose: which copy is authoritative, how the
copy is updated, how stale it may be, and how divergence is detected or
repaired. A snapshot taken for historical meaning is a different decision from a
cache: an invoice line that records the price at purchase time is authoritative
for that invoice and must not be refreshed.

### Derived state

Do not store a value because an interface displays it. Compute it.

Store a derived value only for a reason you can name:

- **Materialized for performance**, with a stated refresh rule and staleness
  bound.
- **Snapshotted for historical meaning**, where the stored value is authoritative
  and recomputing it would be wrong.
- **Stored because recomputation would change semantics**, such as a ranking
  frozen at publication.

The Operations Room computes response counts rather than storing them; a former
folds the rows at read time.

_Source: [`examples/operations-room/src/composition/room.ts`](../../examples/operations-room/src/composition/room.ts)_

```ts
      responseCount: each(
        Discussing._responses({ discussion }).is({ response, author, text }),
      ).count(),
```

Note where that count lives: in composition, not in Discussing. A count that
only one application's dashboard needs is not part of the discussion mechanism.

### Local and cross-concept invariants

A **local invariant** is enforced by one concept inside its own actions.
Gathering's "at most one membership per gathering and person" is local: `join`
refuses `ALREADY_JOINED`, and no caller can bypass it.

A **cross-concept invariant** spans owners and can only be maintained by
composition. "Every current selection has an open discussion" is cross-concept,
and it is not an invariant in the strict sense: it is false during the interval
between `Selecting.choose` returning and `Discussing.open` settling, and it stays
false if the second action refuses.

Classify each invariant before deciding where to enforce it. A local invariant
placed in composition is unenforced; a cross-concept invariant described as
guaranteed is a false claim. [Cross-concept
invariants](composing-concepts.md#cross-concept-invariants) covers what to state
about each one.

## Actions

### Semantic actions

An action names a transition that means something to the people using the
system: `reserve`, `cancel`, `approve`, `revoke`, `publish`, `archive`,
`restore`, `assign`, `expire`, `acknowledge`, `close`.

Compare two designs of the same behavior:

```text
weak      updateSelection (scope, item, isCurrent)
          deleteSelection (selection)

shipped   choose (scope, item)   makes item the current selection for scope
          clear  (scope)         removes the scope's current selection
```

`updateSelection` puts the invariant in the caller's hands: nothing stops two
selections in one scope from being current, because the rule "at most one" is
now enforced by whoever passes the flags. `choose` owns the rule — it removes
the previous current selection and adds the new one in one action — so the
invariant holds no matter who calls it.

Generic verbs are correct when arbitrary record editing genuinely is the
purpose. A concept whose reason to exist is that people maintain free-form
entries should say so in its purpose and offer `update`. The failure is not the
word; it is a purpose that promises a mechanism and an interface that delivers
storage.

Ask, of any candidate CRUD set: why is this data stored, what behavior makes it
useful, which transitions matter to the people involved, and which invariants
distinguish it from an ordinary record. If the answers are thin, the candidate
is state belonging to some other concept.

### Preconditions and refusals

Each action states the conditions under which it acts and the conditions under
which it declines. A declined condition that the design anticipates is a
**refusal** — an expected domain outcome with a stable code, not an error.

_Source: [`examples/reading-circle/src/concepts/discussing/spec.md`](../../examples/reading-circle/src/concepts/discussing/spec.md)_

```text
respond (discussion: Discussion, author: Person, text: String) : return (response: Response)
  where discussion in open
  then
    add a new response with discussion, author, and text
    return response
  where discussion not in open
  then
    refuse DISCUSSION_NOT_OPEN "This discussion is not open."
```

Both branches are stated, and the refusal carries a code and a normative
sentence. Registration requires one distinct error class per declared code, so
the specification and the implementation cannot drift apart silently.

The distinction is operational, not stylistic. A registered refusal is recorded
as an outcome that composition can watch with `.refuses(...)` and branch on. An
unregistered throw is a **fault**: the engine records it against the ask, the ask
has no outcome, and no reaction can treat it as a domain result. See [actions,
refusals, and faults](../semantics.md#actions-refusals-and-faults).

Design refusals as part of the interface. Every condition an ordinary caller can
hit — the entity does not exist, it is already in that state, the actor is not
the owner of the relation — should have a code. Faults are for conditions the
concept did not anticipate.

### Results

Return an object mapping whenever composition needs the outcome. This is an
engine constraint with a design consequence: a non-object return is normalized to
an empty successful result for matching, so a reaction cannot bind fields from a
scalar. An action returning a bare identifier string cannot feed the next step of
a chain.

Return the identities a caller or a reaction will need next. `Gathering.join`
returns the `membership` it created; `Selecting.choose` returns the `selection`,
which is exactly the value the two Operations Room reactions bind and pass on as
a subject.

### Queries

Queries read current state and change nothing. Keep them separate from actions,
and give each one a promise — `one`, `optional`, or `many`.

The promise is a behavioral claim that the engine checks on every read: an
answer outside the declared cardinality raises a fault naming the query. Choose
it from the domain, not from the current implementation. `_membership` promises
`one` because every person-gathering pair has a standing; `_openFor` promises
`optional` because a subject may have no open discussion; `_members` promises
`many`. Each choice determines whether a reader can drop a case, fan out, or
neither — see [reading: declarations
govern](../semantics.md#reading-declarations-govern).

Three constraints follow from how queries execute, and each is a design
constraint rather than an implementation detail:

- **Queries must not have side effects.** They are memoized per instance and
  argument between invalidation points, so a side effect would occur only on
  cache misses, at times the author does not control.
- **Queries do not see a transactional snapshot.** A query can overlap an
  asynchronous action body. Do not design a decision that requires reading two
  queries consistently.
- **Queries do not enter the action queue.** They are not a place to enforce
  anything.

Do not expose as an action what is really a query. A `getAuthor` action pollutes
the occurrence record with reads and invites reactions to trigger on lookups.

### Lifecycle coverage

Walk each kind of entity the concept manages from creation to end, and name the
action responsible for each stage that applies: creation or registration,
activation, ordinary use, modification, cancellation, revocation, expiration,
completion, archival, deletion, restoration.

Include only the stages the concept actually has. An alert is raised, read, and
acknowledged, so Alerting needs exactly two actions; adding an `updateAlert` for
symmetry would create a transition with no meaning. A session has one more,
because expiring and being ended deliberately are different events that reach
the same stage:

_Source: [`examples/production-http/src/concepts/sessioning/spec.md`](../../examples/production-http/src/concepts/sessioning/spec.md)_

```text
current (session: Session) : return (active: Flag)
  where session is unknown, ended, or expired
  then
    delete session if expired
    refuse UNKNOWN_SESSION "This session is not active."
  where session is active
  then
    return active true
```

Expiry has no action of its own here: it is enforced on every use and collected
lazily. That is a design decision worth stating, because the alternative — a
scheduled sweep — would need a trigger the concept does not own.

Missing lifecycle actions are the most common completeness defect. Accounts that
cannot be closed, reservations that cannot be cancelled, grants that cannot be
revoked, and catalogs that cannot be populated all leave the application to
improvise, usually by writing storage directly.

### Atomicity at the concept boundary

One action is the unit of atomicity available to a design. Within one engine,
action bodies run one at a time per concept instance, in arrival order. Across
actions there is nothing: a reaction chain is not a transaction, and an earlier
state change is not rolled back when a later action refuses or faults.

This has one direct design consequence. **Any decision that must not race
belongs inside the action that owns the state** — uniqueness, capacity,
first-come, and answer-once. Reading a query in a reaction's `where` and then
asking an action does not make the pair atomic; the state can change in between,
and the engine provides no as-of-trigger snapshot. See [decisions that must not
race](../semantics.md#decisions-that-must-not-race).

Gathering follows this: `join` checks for an existing membership and creates one
in the same action, rather than exposing a `_membership` query for composition
to check first. The query exists for reads and policy, not for enforcement.

The per-instance guarantee is in-process and per-assembly. Sharing one concept
instance with a second engine does not share its queue, and several application
instances over one database do not serialize each other. A concept whose
uniqueness rule must hold across processes needs a storage constraint or a
transaction inside the action — see the [supported multi-instance
topology](../semantics.md#supported-multi-instance-topology).

### Reversal and compensation

Distinguish three ways an effect can be undone, and choose deliberately.

**Reversal** returns the concept to an earlier stage and is part of the
lifecycle: `clear` reverses `choose`, `leave` reverses `join`, `close` ends what
`open` began. If users can regret an action, it needs a reversal.

**Compensation** applies when the effect cannot be erased. A refund compensates
a charge; it does not undo it, and the ledger keeps both. Model the compensating
action explicitly rather than deleting the original record, and say in the
purpose that history is retained.

**Idempotent repetition** is neither. Decide, for each action, whether asking it
twice with the same input is meaningful, and state the answer. `Alerting.raise`
called twice raises two alerts, which is correct — two things happened.
`Discussing.open` called twice for one subject refuses the second, which is also
correct. An action whose repetition is neither meaningful nor refused is a
design gap, and it becomes visible the first time a retry duplicates work: the
runtime provides no retry deduplication and no exactly-once execution.

Where repetition must be suppressed, the suppression belongs in the action, keyed
on something the caller supplies — the operation's own identity, or a state
precondition that the first call invalidates. A correlation identifier is not
that key; it is a tracing value and does not deduplicate work.
