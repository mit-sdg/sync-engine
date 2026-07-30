# Designing with concepts

These pages are about deciding what an application's concepts are, what each one
owns, and how the application connects them. They are design documentation, not
an authoring tutorial: [Define one behavior](../guide/concepts.md) shows how to
write, implement, and register a concept, and [Execution
semantics](../semantics.md) defines what the runtime guarantees.

A **concept** is a unit of behavior with its own purpose, state, and actions that
can be understood without reading any other concept. Concepts never call each
other and never read each other's state. Everything an application does that
involves two concepts therefore lives outside both of them, in **composition**.

Concept design calls a composition rule a **synchronization**, or _sync_.
sync-engine spells that rule as a **reaction**: `when` an action is asked or
settles, `where` current state matches, `then` ask further actions. These pages
use `reaction`, because that is the term used by the code, the
[glossary](../glossary.md), and the rest of the documentation. Views, formers,
and endpoints are the other three composition forms; a reaction carries the
causal rule, and the others name conditions and shape answers for it.

## What the decomposition buys

Each of these follows from one rule — a concept names no peer — rather than from
modularity in general.

- **Unrelated responsibilities cannot reach each other's state.** The only thing
  two concepts share is an opaque identity. Alerting holds a `recipient` and a
  `subject`; it cannot read who that person is or what the subject means, so a
  change to either cannot break it.
- **Every cross-behavior dependency has a name and a location.** "Choosing a
  mitigation opens a discussion" is a declaration in composition, not a call
  inside `Selecting.choose`. Reviewers can enumerate the application's policy by
  reading composition alone.
- **Connections change without touching behavior.** Adding responder alerts to
  the Operations Room adds one reaction; Selecting, Gathering, Discussing, and
  Alerting keep the same specifications, classes, and tests.
- **Concepts are reusable because they carry no collaborators.** Gathering,
  Selecting, and Discussing appear unchanged in both the reading-circle and
  operations-room applications, which give their generic identities different
  meanings.
- **Each part is testable alone.** A concept is tested by constructing the class
  and calling it. A reaction is tested by asking its trigger action against an
  assembly and observing which consequences were asked.

## What the model does not decide

- **It is not a transaction model.** A reaction chain is not atomic: an earlier
  state change remains when a later action refuses or faults, and nothing rolls
  it back. See [ordering and state-read
  timing](../semantics.md#ordering-and-state-read-timing).
- **It is not a deployment or packaging decision.** Semantic independence says
  nothing about processes, packages, classes, or databases. Several concepts can
  share one process and one database; one concept can be backed by several
  tables.
- **It is not a storage schema.** A specification's `State` section is
  uninterpreted human notation. Nothing derives a schema, validator, or
  migration from it — see [concept specification
  format](../concept-specification.md#state-notation).
- **It does not supply distributed correctness.** Uniqueness under concurrency,
  idempotency across retries, durability, and restart recovery stay with concept
  implementations and their storage.
- **It does not rescue a purpose nobody needs.** A well-formed concept serving a
  need that does not exist is still the wrong concept.

## Reading path

| Page                                           | Answers                                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| [What a concept is](concepts.md)               | What information defines a concept, and what a concept is not                 |
| [Evaluating a concept](evaluating-concepts.md) | Whether a candidate is good, with evidence for each criterion                 |
| [Choosing granularity](granularity.md)         | Whether to split one candidate into several or keep responsibilities together |
| [State and actions](state-and-actions.md)      | What a concept stores and which transitions it offers                         |
| [Composing concepts](composing-concepts.md)    | How reactions connect concepts without hidden coupling                        |
| [Reviewing a design](reviewing-a-design.md)    | How to review and revise a whole design, not one concept at a time            |

Read them in that order the first time. When reviewing an existing design, start
from [Reviewing a design](reviewing-a-design.md) and follow its links back into
the criteria it applies.

The examples throughout are concepts this repository ships: Gathering,
Selecting, Discussing, and Alerting from [Reading
Circle](../../examples/reading-circle/README.md) and [Operations
Room](../../examples/operations-room/README.md), and Sessioning from
[Production HTTP](../../examples/production-http/README.md). A
reservation-and-payment pair appears where lifecycle, failure, and compensation
need a case the repository does not ship. Reusing a small set of concepts across
pages makes the differences between decisions visible.
