# How sync-engine applications fit together

sync-engine composes independently implemented stateful behaviors into one
application. This page explains the parts of that application, what each part
owns, and how an outside request reaches concept code. It is an explanation,
not an API reference; use the [Public API](public-surface.md) and [Execution
semantics](semantics.md) for exact signatures and runtime behavior.

## Application layers

The scaffolded application path is built in this order:

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
 read-back + wire contract   gateway / HTTP handler
              |              ^
              v              |
          typed client ------+
```

The first two layers define independent behaviors. Composition defines how an
application connects those behaviors. Assembly validates and installs one
specific combination. The boundary exposes selected behavior to callers.

## Concepts own behavior and state

A **concept** is an ordinary TypeScript class. In the registered path, the class
is paired with a specification and registration. Callable non-underscore
prototype methods are actions; TypeScript `private` and `protected` methods
still exist on that runtime prototype. Use ECMAScript `#private` methods or
module-level functions for helpers that registration must not treat as concept
members. Underscore-prefixed methods are queries. An action may change concept
state; a query reads current state and must not create side effects.

Concept code does not import peer concepts or application composition. For
example, Selecting can own the choice of one item without knowing that the
application will open a discussion after a choice. This separation permits the
same concept implementation to participate in more than one composition.

The Markdown specification records purpose, one principle, action and query
declarations, and expected refusals. Its optional State section is notation for
readers, not a schema. A principle test calls the class directly and checks the
behavior without an assembly. [Concept specification
format](concept-specification.md) defines the parsed boundary.

## Registration gives concepts application names

`registerConcept(...)` joins a class, its specification, refusal mappings, and
optional implementation floors. `conceptSet(...)` assigns each registration an
application name and derives:

- `concepts`, the inert references used while authoring composition;
- `vocabulary`, the names and metadata used by assembly and tooling; and
- implementation factories for the registered concepts.

This is the scaffolded and example-application path. The lower-level
`vocabulary(...)` API also accepts a concept class or inline concept descriptor
directly. Those forms are useful for small assemblies, but they do not make
`registerConcept(...)` mandatory. See the [`language`
API](public-surface.md#language) for the accepted entries.

Calling an action through `concepts` while declaring a reaction does not run the
action. The call creates declaration data. Runtime execution begins only after
an assembly instruments concrete concept instances.

## Composition connects concepts

Composition contains four related declaration forms:

| Form     | Purpose                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| Reaction | Watch an action ask or outcome, read current state when needed, and ask consequence actions |
| View     | Give a reusable relation or policy decision a name                                          |
| Former   | Construct a current result tree from queries, views, or other formers                       |
| Endpoint | Receive an outside input and produce one boundary response through the reaction model       |

A reaction belongs to the application rather than to either participating
concept. A view and a former also live in composition because they may read
several concepts. None of these declarations stores domain state.

## Assembly installs one application

`assemble(...)` receives one vocabulary, one implementation for each concept,
and one composition. It validates the registered design, instruments the
instances, installs reactions and reads, and creates an occurrence index. Each
call creates separate scheduling, query-cache, admission, and retention state,
including its own internal `MemoryStore`. The `retention` option governs that
index. An optional application-owned `LogSink` receives occurrence entries in
addition to the internal index; `logSink` and `retention` may be used together.

The ordinary assembly accepts portable declarations: definitions that can be
represented as canonical JSON and registered again against the same named
vocabulary. Local closures and other explicit executable escape hatches remain
available through the `advanced` package, but they cannot be exposed as an
ordinary assembled application.

An assembly exposes direct concept calls, an application invoker, its public
route interface, direct former evaluation, and drain/idle lifecycle operations.
The [assembly API](public-surface.md#assembly) lists the exact surface.

## One request through the boundary

A representative endpoint request crosses these components:

1. A local or HTTP client typed by a generated contract JSON-projects the input
   and sends a route plus input to its transport. A custom transport defines its
   own projection behavior.
2. The gateway checks route admission, drain state, and configured limits, then
   forwards the request to the assembly's invoker.
3. The endpoint's `receive(...)` pattern opens the admitted input values.
4. The endpoint may read views or queries and ask a concept action.
5. The engine records the action ask, runs the action under that concept
   instance's serial action queue, and records its return, refusal, or fault.
6. Reactions that match the recorded ask or outcome may read current state and
   ask further actions.
7. A matching endpoint path asks `respond(...)`. The invoker accepts at most
   one response for the request.
8. The client resolves to the endpoint's success value or an error envelope.

The local and HTTP clients use the same success-or-error client model. The local
client uses the logical wire contract and still applies a JSON serialization
boundary. Production HTTP can use a projected contract with public error
categories; an HTTP floor can also remove credential and issuance fields. See
[Application boundary](guide/application-boundary.md) for the worked path.

## Concept state and occurrence evidence differ

Concept state is the domain state owned by a concept implementation and its
storage. Occurrence evidence records action asks, outcomes, faults, reaction
firings, and selected runtime failures inside one assembly. The engine folds
that evidence into its internal occurrence index for matching and inspection.
An audit copy does not become concept state merely because it is persistent.

The optional `LogSink` receives each validated, redacted entry synchronously
before the engine folds the entry into its index. A sink failure prevents that
fold. Failure while appending an invocation can prevent the action body from
running; failure while appending its outcome can occur after the action changed
concept state. The supplied `FileLogSink` appends JSONL audit output, but the
engine never reads or replays that file. `FileLogSink` has no close operation;
the host owns any resources used by a custom sink.

Applications that require durable state and restart recovery must implement
both in their concept storage and host process. [Persistence, restart, and
recovery](advanced-recipes.md) demonstrates the separation.

## Guarantee boundaries

The runtime serializes action bodies per concept instance within one assembly.
It does not serialize all concepts, all assemblies, or several processes. A
reaction chain is not a transaction: an earlier state change remains when a
later action refuses or faults. Timeout and abort stop waiting but do not cancel
accepted work.

Generated wire contracts provide TypeScript checks for callers using those
types. They do not validate runtime values. Endpoint validators provide the
separate runtime input, successful-output, and domain-error checks when an
application needs them. A configured `rawFaultReporter` is a privileged path
for original action and interpreter failures and endpoint-validator throws;
ordinary occurrence evidence, process logs, and framework errors do not expose
those raw values.

Use [Operational limits](operations.md) to decide whether these boundaries fit
a deployment. Use [Execution semantics](semantics.md) when correctness depends
on ordering, cardinality, failure delivery, cancellation, retention, or HTTP
projection.

## Continue

- [Designing with concepts](design/index.md) decides what the concepts of an
  application should be, and how to review a decomposition.
- [Getting started](guide/getting-started.md) creates and runs the smallest
  complete application.
- [Define one behavior](guide/concepts.md) begins the larger Operations Room
  case study.
- [Read construction cookbook](book.md) compares small query, view, and former
  constructions.
- [Public API](public-surface.md) lists every supported package subpath and
  export.
