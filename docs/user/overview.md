# How sync-engine applications fit together

sync-engine composes independently implemented stateful behaviors into one
application. This page maps the setup files to the runtime and follows one
request through them. Use [Designing with concepts](design.md) before choosing
concept boundaries, [Public API](reference/public-api.md) for signatures and
defaults, and [Execution semantics](reference/semantics.md) for runtime behavior.

## Application layers

A registered application moves from declarations to an assembly and,
optionally, to a public boundary in this order:

```text
concept specifications + TypeScript classes
                    |
                    v
       registrations + concept set
                    |
                    v
 composition: reactions, views, formers, endpoints
                    |
                    v
                  assembly
               /            \
              v              v
           tooling    application invoker
              |              ^
              v              |
 read-back + wire contract   gateway / transport
              |              ^
              v              |
          typed client ------+
```

Concepts define independent behavior, composition connects it, and assembly
installs one combination. Tooling and a generated client are optional. The
lower-level `vocabulary(...)` path can assemble concepts without specification
registration.

## Concepts own behavior and state

A **concept** is an ordinary TypeScript class paired, in the registered path,
with a Markdown specification. Non-underscore prototype methods are actions;
underscore-prefixed methods are queries. An action may change concept state. A
query reads current state and must not create side effects.

Concept code does not import peer concepts or application composition. Selecting,
for example, can own one current choice without knowing that one application
opens a discussion after a choice. The application states that connection in a
reaction, so the same Selecting implementation can participate in another
composition.

The specification records the concept's purpose, principle, actions, queries,
and expected refusals. Its optional State section is not a runtime schema.
[Concept specification format](reference/concept-specification.md) defines what
registration and source checking parse.

## Registration names the concepts

`registerConcept(...)` joins a class, its specification, refusal mappings, and
optional implementation floors. `conceptSet(...)` assigns application names and
derives the inert concept references used in composition, the vocabulary used by
assembly and tooling, and implementation factories. The lower-level
`vocabulary(...)` API can describe small assemblies without registration. See
the [`language` API](reference/public-api.md#language) for accepted entries.

Calling an action through a concept reference while authoring composition creates
declaration data. Execution begins only after assembly instruments concrete
concept instances.

## Composition connects concepts

Composition has four declaration forms:

| Form     | Purpose                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| Reaction | Watch an action ask or outcome, read current state when needed, and ask consequence actions |
| View     | Name a reusable relation or policy decision                                                 |
| Former   | Construct a current result tree from queries, views, or other formers                       |
| Endpoint | Receive outside input and produce a boundary response through the reaction model            |

These declarations carry application policy and references; concepts retain
domain state. Declarations may be nested in TypeScript records or created by
factory functions before `assemble(...)`.

## Assembly installs one application

`assemble(...)` receives a vocabulary, concept implementations, and composition.
It validates machine-checkable registration, declaration, portability, and
boundary constraints; instruments the instances; installs reactions and reads;
and creates the process-local runtime state used for scheduling, query caching,
admission, and occurrence matching. It does not validate purpose, ownership, or
concept independence. A second call creates a separate runtime; it does not
reconfigure the first.

Ordinary assembly accepts portable declarations: definitions whose canonical
JSON can be registered again against the same named vocabulary. Local closures
and other executable escape hatches are available only through `advanced` manual
construction. The [assembly API](reference/public-api.md#assembly) defines the returned
surface and [portable and local behavior](reference/semantics.md#portable-and-local-behavior)
defines the rejection boundary.

## One request through the boundary

A representative request crosses these components:

1. A client sends a generated route and input through its selected transport.
2. The gateway checks route admission, drain state, and configured limits, then
   forwards accepted work to the assembly's invoker.
3. The endpoint's `receive(...)` pattern binds admitted input.
4. The endpoint may read views or queries and ask a concept action.
5. The engine records the ask, runs the action on that concept instance's serial
   action queue, and records its return, refusal, or fault.
6. Matching reactions may read current state and ask further actions.
7. A matching endpoint path asks `respond(...)`; at most one response is accepted.
8. The client resolves to the success value or an error envelope.

The boundary is transport-neutral. The local client applies a JSON projection;
other transports define their own protocol behavior.

## Concept state and occurrence evidence

Concept state is domain state owned by concept implementations and their storage.
Occurrence evidence records asks, outcomes, faults, reaction firings, and selected
runtime failures inside one assembly. These are different data: occurrence
records describe execution, while concept storage is the source from which
queries obtain domain state. The engine uses a process-local occurrence index
for matching and inspection. An optional `LogSink` may receive an audit copy,
but a sink does not replace concept storage or provide replay.

The engine does not rebuild concept state, pending requests, or interrupted
reactions from occurrence output. Applications that require durable state and
restart recovery implement both in concept storage and host procedures. See
[logs, concept implementations, and restart](reference/semantics.md#logs-concept-implementations-and-restart)
and [persistence, restart, and recovery](guide/persistence-recovery.md).

## Guarantee boundaries

The runtime serializes action bodies per concept instance within one assembly.
Other instances, assemblies, and processes execute independently. Each action
commits independently; timeout and abort stop waiting but do not cancel accepted
work. Generated wire contracts provide TypeScript checks, while runtime value
validation requires explicit endpoint validators.

[Operational limits](reference/operations.md) states the resulting deployment
requirements. Use [Execution semantics](reference/semantics.md) when correctness depends
on ordering, failure delivery, cancellation, retention, or boundary settlement.
