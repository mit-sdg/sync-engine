# Glossary

These definitions apply throughout sync-engine documentation. The [Public
API](public-surface.md) defines the named interfaces; [Execution
semantics](semantics.md) defines their observable behavior.

## Action

A concept operation that may change concept state. An assembled action is
instrumented: the engine records its ask and then its return, refusal, or fault.

## Admission

The decision to accept a new root action or request for execution. Route and
input checks, drain state, and configured limits may reject work before a root
action occurrence is recorded.

## Ask

The invocation occurrence for an action. An ask records the concept, action,
input, action identifier, causal flow, and—when a reaction made the ask—the
asking reaction.

## Assembly

One installed vocabulary, concept implementation set, and composition. An
assembly owns its execution lifecycle and an internal `MemoryStore` occurrence
index governed by `"keepAll"` or a settled-flow window. An optional
application-owned `LogSink` receives an audit copy; the sink does not replace
the index. Creating another assembly creates another runtime; it does not
reconfigure an existing assembly.

## Binding

One named value in a reaction, view, or former match. A fresh name in an output
pattern opens a binding. Reusing a bound name tests equality.

## Composition

The application-level collection of reactions, views, formers, and endpoints.
Composition connects concepts without adding peer imports to their
implementations.

## Concept

An independently implemented behavior with its own state, actions, queries,
expected refusals, specification, and principle test.

## Concept floor

A named, complete implementation map for one concept set, grouped with
host-owned resources and an asynchronous `close()` operation. Assembly does not
call the floor's lifecycle operation.

## Consequence

An action ask produced by a matching reaction. Consequences in one `then(...)`
group are independent siblings. A later group starts after the preceding action
on its own path returns.

## Correlation ID

A tracing identifier carried through gateway and application observation.
Deduplication requires a domain-owned idempotency key.

## Domain error

An application-authored failure value, such as a concept refusal or an endpoint
response with a top-level `error` field. The invoker distinguishes domain errors
from framework errors even though a client receives both as error envelopes. An
endpoint's `domainError` validator checks the value under that top-level field.

## Endpoint

A reaction specialized for an outside request. An endpoint has a route,
receives admitted input, and may produce one boundary response.

## Fault

An unexpected failure attached to an action ask, such as an action throw or a
former-evaluation failure. A refusal is the corresponding deliberate domain
outcome.

## Firing

One successful reaction match after its trigger and `where` conditions. A
firing records bindings, consumed triggers, and produced asks.

## Flow

The causal identity shared by one root action or outside request and its
consequences. Reaction matching and `earlier(...)` correlation are flow-local.

## Former

A named current-state read that constructs a value tree. A former is evaluated
when asked; the engine does not store its result.

## Framework error

A boundary or transport failure classified by `FrameworkErrorCode`, such as
`INVALID_INPUT`, `TIMED_OUT`, or `TRANSPORT_ERROR`. Framework errors are
separate from application-authored domain errors. Transport packages may add
their own error unions.

## Gateway

An `Invoker` decorator that performs public route admission, forwarding,
limits, observation, timeout and abort handling, and ordered drain around the
target application's reaction engine and occurrence index.

## HTTP floor

The production HTTP profile plus one same-origin cookie credential binding. An
HTTP floor consumes the logical credential input from protected requests and
projects issued credential fields into the cookie.

## Input contract

The outer request-object contract for one endpoint route. It declares required
keys and shallow defaults. Runtime value validators are a separate endpoint
option.

## Integrity failure

Evidence that accepted execution violated an engine-owned contract, such as an
invalid successful endpoint output, an invalid domain error, or an
execution-budget breach. An integrity failure is distinct from an action fault.

## Invoker

The transport-neutral interface that accepts an endpoint route, input, and call
options and resolves to a structured success, domain-error, or framework-error
result.

## Local behavior

A declaration containing executable state that cannot be reconstructed from
its serialized representation, such as a closure or object-identity pattern.
Ordinary assembly rejects local behavior; manual engines under `advanced` may
execute it.

## Log sink

An optional synchronous, application-owned destination for validated and
redacted occurrence entries. The engine calls the sink before folding an entry
into its internal occurrence index. `LogSink.append` must return `undefined`
synchronously; a throw or any other return value fails before the fold. A sink
entry copies and freezes arrays and plain records and replaces invocation
identities with frozen name-bearing representatives. Opaque leaves retain their
runtime identity and are not recursively frozen; sinks must treat them as
read-only sensitive values. A sink does not supply matching, retention, or
replay. `LogSink` has no close method. `FileLogSink` is the supplied append-only
JSONL implementation.

## Occurrence

Recorded execution evidence for an action ask, return, refusal, or fault. The
occurrence log also contains firing, reaction-failure, and integrity-failure
evidence. The engine retains occurrences in its internal index and may copy them
to a `LogSink`. Concept implementations own domain state separately.

## Portable behavior

A declaration whose canonical JSON representation can be round-tripped and
registered against the same named vocabulary. Ordinary assemblies and
generated application contracts contain portable behavior only.

## Principle

A concrete behavioral sequence in a concept specification. A principle test
runs the concept class directly and verifies the sequence without an assembly.

## Public error category

The production HTTP classification registered for a concept refusal, such as
`CONFLICT` or `UNAUTHORIZED`. Production HTTP exposes registered categories and
keeps private refusal codes inside the application boundary.

## Query

An underscore-prefixed concept operation that reads current state. A registered
query promises `one`, `optional`, or `many` rows. Queries must not create side
effects. TypeScript links a literal authored promise to the method's return
container, and runtime evaluation checks the promise. Assembly memoizes queries
unless `queryCache` is `"none"`.

## Raw fault report

A privileged report containing the original `unknown` value thrown by an action,
interpreter stage, or endpoint validator. Raw fault reports bypass ordinary
fault redaction and must be handled as sensitive data. Reporter failure does not
replace the runtime result.

## Reaction

An application-level declaration that watches an action ask or outcome,
optionally reads current state, and asks consequence actions for each surviving
binding.

## Read

One query or view line evaluated against a current binding. The relation's
declared promise and the line's `no`, `whether`, or matching posture determine
whether the case continues, drops, or expands.

## Read-back

A generated textual description of one assembled application's reactions,
views, formers, paths, bindings, and cardinality behavior. Read-back has no
execution semantics.

## Refusal

A concept's deliberate rejection of an action. A registered exception class
maps a specification code to a refusal outcome. Refusals are expected domain
results; faults are unexpected execution failures.

## View

A named relation over concept queries or other views. A predicate view answers
whether a relation holds. An output view returns rows with a declared
cardinality. In sync-engine, `view` always refers to this authored relation.

## Vocabulary

The named action and query references for a concept set, together with concept
metadata and optional named computations. `conceptSet` may construct those
computation references from a second record of pure functions. Vocabulary
references are inert until resolved against an engine.

## Wire contract

Generated TypeScript mapping endpoint routes to JSON-projected input, output,
and error types. Applications provide runtime schema validators separately.
