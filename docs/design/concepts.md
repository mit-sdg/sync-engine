# What a concept is

A concept is a recognizable mechanism that serves one purpose, owns the state
that behavior needs, and can be understood without reading any other concept.
Domain nouns, database records, and package modules define different kinds of
boundaries.

Gathering, shipped in the [Reading Circle
example](../../examples/reading-circle/README.md), runs through this page. It is
small enough to inspect completely and rich enough to have a lifecycle,
duplicate cases, an ordering promise, and three deliberate refusals.

Five pieces of information define a concept: its purpose, its principle, its
state, its actions and queries, and the external types it treats as opaque. The
first two say what the concept is for; the rest say what it does.

## Purpose

The purpose states the need that justifies the concept's existence.

_Source: [`examples/reading-circle/src/concepts/gathering/spec.md`](../../examples/reading-circle/src/concepts/gathering/spec.md)_

```text
## Purpose

Let a host create a named gathering and let people join or leave it, so
belonging is an explicit, visible state.
```

The purpose states an application-independent need: belonging should be
deliberate and visible. The same concept can therefore serve a reading circle,
operations room, book club, or incident-response application.

A purpose fails when it describes the concept's mechanism (`store memberships in
a set keyed by gathering`), enumerates its actions (`create, join, and leave
gatherings`), states an application goal (`let reading circles meet weekly`), or
describes a need the concept cannot fulfill by itself (`let people find and join
groups that match their interests` requires search and interest concepts that
Gathering does not contain).

[Purpose criteria in detail](evaluating-concepts.md#purpose) gives the tests for
each of those failures.

## Principle

The principle is one concrete scenario that demonstrates the behavior fulfilling
the purpose. Concept design calls it the _operational principle_; the
specification section is named `Principle`, and these pages use the shorter
term.

_Source: [`examples/reading-circle/src/concepts/gathering/spec.md`](../../examples/reading-circle/src/concepts/gathering/spec.md)_

```text
## Principle

Asha creates Saturday Workshop and becomes its first member. Bo joins and appears
among its members. When Bo tries to join again, the gathering refuses the
duplicate. Bo leaves; a second attempt to leave is refused because Bo no longer
belongs. When Cy tries to join an unknown gathering, it is refused because the
gathering does not exist.
```

It starts from nothing, performs the setup itself, exercises what distinguishes
Gathering from a plain list of names — duplicate membership is refused, so
belonging is a fact and not a count — and ends in a state that fulfills the
purpose. Every state-changing or refusal step is an action of Gathering; the
observation that Bo appears among the members is a Gathering query. Nobody posts
or votes.

That last property makes the principle a design test. When a principle needs an
action that belongs to another concept
to reach its point, the boundary is wrong: either the scenario describes an
application workflow, or the concept is missing an action it should own. A
principle for a `Room` concept that reads "Asha creates a room,
Bo joins, Asha chooses a mitigation, and the room opens a discussion" is
describing a whole application; see [splitting a conflated
candidate](granularity.md#worked-split-one-room-concept-into-four).

A principle does not have to enumerate every error. Corner cases belong in the
action specifications; the principle covers the archetypal path plus whichever
refusals distinguish the concept.

## State

State is the information the concept needs to decide its own behavior, written
abstractly.

_Source: [`examples/reading-circle/src/concepts/gathering/spec.md`](../../examples/reading-circle/src/concepts/gathering/spec.md)_

````text
```state
a set of Gatherings with
  a name String
  a host Person

a set of Memberships with
  a gathering Gathering
  a member Person
```
````

Two observations decide whether this state is right. First, membership is its
own set because `join` and `leave`
create and remove one membership at a time and `_membership` answers about one
pair. Second, `Person` appears only as an identity. Gathering never stores a
display name, an email address, or a role, because no action of Gathering reads
one.

A `State` section is optional notation for human readers. Registration and
`sync-engine check` do not compare it with class fields, storage, or generated
contracts, and no schema is inferred from it — see [state
notation](../concept-specification.md#state-notation). Its value is as a design
artifact: it makes state that no action reads, or state a precondition needs and
cannot find, visible before the implementation exists.

## Actions and queries

An **action** should name a meaningful state transition. A **query** should read
state without side effects. In an instrumented assembly, a non-underscore member
is recorded as an action and an underscore-prefixed member is invoked as a cached
query. Calling a raw class method directly does not add those engine behaviors.

_Source: [`examples/reading-circle/src/concepts/gathering/spec.md`](../../examples/reading-circle/src/concepts/gathering/spec.md)_

```text
join (gathering: Gathering, member: Person) : return (membership: Membership)
  where gathering not in gatherings
  then
    refuse GATHERING_NOT_FOUND "There is no such gathering."
  where gathering in gatherings and some membership has gathering and member
  then
    refuse ALREADY_JOINED "This person already belongs to the gathering."
  where gathering in gatherings and no membership has gathering and member
  then
    add a new membership with gathering and member
    return membership
```

`join` states every branch it can take and what each one returns. Its two
refusals are part of the contract: `ALREADY_JOINED` is how Gathering's
implementation protects its invariant that at most one membership exists per
gathering and person. A refusal is an expected domain result with a stable code,
and composition can watch it. Faults follow separate behavior; see [actions, refusals, and
faults](../semantics.md#actions-refusals-and-faults).

The specification parser reads the signature and exact `refuse CODE "..."`
lines. It does not execute or validate the `where`, `then`, effect, or output
prose. Principle and implementation tests establish those behavioral branches;
see [what a concept specification checks](../concept-specification.md#complete-example).

Queries carry a promise about how many rows they answer with:

_Source: [`examples/reading-circle/src/concepts/gathering/spec.md`](../../examples/reading-circle/src/concepts/gathering/spec.md)_

````text
```queries
_get (gathering: Gathering) : optional (name: String, host: Person)
_members (gathering: Gathering) : many (member: Person)
_membership (gathering: Gathering, member: Person) : one (joined: Flag)
```
````

The promise is a runtime cardinality decision expressed in the design. `_membership` promises
exactly one source row because every person-gathering pair has a standing, true
or false. A use site can still drop that row when its output pattern does not
match — for example, `.is({ joined: true })` drops the false row. `_get` promises
at most one row because the gathering may not exist; `_members` promises any
number, so a plain read with a fresh output binding can fan a reaction out over
the rows. [Reading:
declarations govern](../semantics.md#reading-declarations-govern) defines what
each promise does at a use site.

[State and action design](state-and-actions.md) covers how to choose the
transitions, the preconditions, and the results.

## Identity and generic external types

`Person` in Gathering's state is a **generic external type**: a value the
concept receives, stores, compares for equality, and hands back, with no
knowledge of what it denotes. The concept never dereferences it.

This lets the same concept design be used in two applications. The Operations
Room binds Gathering to responders in an incident room; the Reading Circle binds
it to members of a workshop. Selecting takes an opaque `Scope` and `Item`; the
Operations Room supplies a room and a mitigation, and the Reading Circle supplies
a circle and a reading.

Two concepts may refer to the same identity while owning separate state.
Alerting's `recipient` and Gathering's `member` may both be the same person
identifier in one assembly. Alerting owns the alert relation; Gathering owns the
membership relation. [State ownership](state-and-actions.md#state-ownership)
develops the distinction.

A concept fails this test when it treats an external value as a structure —
takes a `member` argument and reads `member.email`, or stores a person's
display name so a query can return it. Both make the concept depend on a
neighbor's representation, and both are corrected the same way: keep the
identity, and let a reaction bring in whatever the other concept owns.

## Independence

A concept is independent when its specification can be read and its behavior
understood without reading another specification. The evidence is mechanical:

- the purpose names no other concept and no application;
- the state holds external identities but no other concept's data;
- no action calls another concept;
- no precondition inspects another concept's state; and
- the concept's own lifecycle completes without another concept.

Gathering satisfies these. Its class imports no peer, no composition file, and
no engine base class. [Define one behavior](../guide/concepts.md) shows the full
implementation.

Independence describes the specification. Reactions
can compose independent concepts heavily — with the corresponding packs enabled,
a returned selection asks to open a discussion and asks to alert each responder.
Those consequence actions can still refuse or fault. Gathering and Alerting do
not need to name each other for the application to express that policy.

A separate file, class, package, or service does not make a concept
independent. A `UserService` class in its own module that reads the sessions
table is coupled to sessions regardless of where its source lives.

## Behavioral completeness

A concept is complete when it delivers the value named in its purpose using only
its own state and actions.

Gathering's purpose is that belonging be deliberate and visible. `create`
establishes a gathering and its host's membership, `join` and `leave` change
who belongs, and `_members` and `_membership` make belonging visible. Nothing
outside Gathering is needed to make membership mean anything.

Incompleteness usually appears as a concept that stores something and leaves
the behavior elsewhere. A `ContactInformation` concept holding a phone number
and an email address for each person has no behavior: some other code has to
decide when and how to reach someone. Either the concept is a fragment of state
belonging to a notification concept, or its purpose is wrong and the real
concept is the one that delivers messages through a channel a person chose.

Completeness does not mean absorbing everything nearby. Gathering is complete
without knowing why people gather. Alerting is complete without deciding which
events deserve attention. Each is complete for its own purpose, and the
application composes them. [Choosing granularity](granularity.md) is where that
line gets drawn.

## Reuse and familiarity

Prefer a concept that already exists in the world — reservation, session,
invitation, approval, labeling, commenting, ranking, versioning, delegation —
when it provides the behavior without distortion. A familiar concept brings
vocabulary users already have, a lifecycle whose stages are known, and failure
cases someone has already found.

The principle determines whether two designs describe the same concept. Two designs both called `Reservation`
are the same concept only if the archetypal scenario matches. A restaurant
reservation that holds a table until a party arrives and a library reservation
that queues a person for the next returned copy have different principles,
different state, and different failure cases; forcing them into one concept
produces a specification with two unrelated modes.

## Candidates with different boundaries

| Candidate       | Boundary it defines                                                                                               | What to do                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Object or class | Classes group data with methods; a concept's behavior can span several object kinds and their relations           | Ask which relation the behavior maintains, and let that define the boundary          |
| Domain entity   | An entity is a noun. `Document` attracts every operation whose input contains a document                          | Name the behavior: versioning, sharing, or commenting                                |
| Database table  | Tables follow storage and query shape; one concept may own several, and some tables serve implementation concerns | Choose state from what the actions need, then map to storage separately              |
| Service         | Services are deployment and ownership units and routinely reach into shared data                                  | Keep the concept boundary semantic; a service may host several concepts              |
| Screen or page  | A screen composes the behaviors needed for one interaction                                                        | Build the screen from a former that reads several concepts                           |
| HTTP endpoint   | An endpoint is a caller-shaped interface to behavior                                                              | Declare the endpoint in composition; keep behavior in concepts                       |
| Workflow        | A workflow sequences independently complete behaviors                                                             | Express the sequence as reactions over independent concepts                          |
| Data structure  | Record builders, ordered lists, merges, caches, indexes, glob matchers, and graphs are domain-neutral value types | Keep it as a module the concepts use, or identify the domain mechanism it implements |

The Operations Room dashboard makes the screen case concrete: one former reads
Gathering, Selecting, Discussing, and Alerting to build a single answer, and no
concept knows a dashboard exists. See [views and
formers](../guide/views-and-formers.md).

The data-structure row is the hardest to catch, because a data structure can be
given a plausible purpose and a convincing principle. "Build one record from
pieces supplied separately, so each contributor can add what it knows" reads like
a need and narrates a picnic; it describes assigning fields to an object. Use
reach as a review heuristic: a concept normally serves applications in a domain,
not every domain. Gathering serves book clubs and incident rooms and would be
wrong in a compiler. A record builder is equally at home everywhere, which means
it carries no domain meaning for an application to rely on.
[Reusability](evaluating-concepts.md#reusability) develops this distinction.

Utility code can remain an implementation detail. Gathering's backing maps and membership
lookup helper are private implementation details. `_get` and `_members` are
declared queries, so they are published concept vocabulary that reactions and
formers may use.

The instructive failure is the domain-entity row. A `Project` concept starts as project
creation, then accumulates membership, task assignment, status reporting, file
attachment, and archival, because every one of those operations takes a project
identifier. Shared identity alone provides no evidence of shared behavior;
[granularity](granularity.md#evidence-for-and-against-a-split) gives
the tests that separate them.
