# Operational limits

Sync-engine is an in-process execution component. Storage, transport, traffic
control, and restart policy remain application and host responsibilities in the
current beta. [Execution semantics](semantics.md) defines the runtime contract.

## Deployment fit at a glance

| Requirement                                     | Engine contract              | Required owner or action                                            |
| ----------------------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| Serialize actions on one concept instance       | Within one assembly          | Use concept storage for cross-process coordination                  |
| Transact across actions or concepts             | Not provided                 | Put the atomic decision in one owner action and storage transaction |
| Persist concept state and recover after restart | Not provided                 | Concept implementation and host recovery policy                     |
| Validate endpoint values at runtime             | Explicit endpoint validators | Application-supplied input, output, and domain-error checks         |
| Bound engine-owned work                         | Optional `ExecutionLimits`   | Configure limits and retain host traffic limits                     |
| Cancel work after acceptance                    | Not provided                 | Design idempotency and recovery for work that outlives the caller   |
| Serve a public JSON boundary                    | Maintained Fetch handler     | Host supplies listener, TLS, traffic controls, and lifecycle        |

## Appropriate use

Use sync-engine when independently implemented concepts benefit from explicit,
inspectable composition and the host can own every requirement in the final
column. Several instances may share domain state only through concept
implementations and storage that provide required transactions and coordination.

Do not use the engine as the sole control plane for untrusted or unbounded
traffic. Choose another architecture or add host coordination when correctness
requires cross-concept transactions, distributed serialization, synchronous
cancellation, occurrence replay, automatic restart recovery, or exactly-once
processing.

## Beta compatibility

A newer beta may make incompatible changes to every public subpath, including
`/advanced`. Pin an exact version, review the changelog, regenerate artifacts,
and typecheck each consuming application and generated client before upgrading. The [support
policy](../../../SUPPORT.md) defines the support window and generated-format rules.

## Concurrency and atomicity

One action body runs at a time per concept instance within one engine. Different
concept instances, root flows, assemblies, and processes may overlap. One
assembly requires a distinct raw implementation object for every selected name.
The same raw object may be used as one selected name in separate assemblies;
each assembly creates its own queue and does not serialize the other.

Queries and read evaluation do not enter the action queue. They may overlap an
asynchronous action and do not receive a transactional snapshot. Query
implementations must be side-effect-free, and storage must provide required
read/write isolation.

Each action commits independently; a later refusal or fault does not roll back an
earlier action. Put uniqueness, capacity, first-writer, and answer-once decisions
inside the state-owning action. Retryable operations need domain idempotency keys
and durable deduplication where required. [Ordering and state-read
timing](semantics.md#ordering-and-state-read-timing) defines exact ordering.

## Supported multi-instance topology

Give each process-local instance its own assembly, concept objects, gateway,
scheduler, occurrence index, and observer stream. Concept implementations may
connect those instances to one transactional domain store. Every race-sensitive
decision and idempotency check must execute atomically in its owner action using
storage constraints, transactions, or equivalent coordination. Correlation ids
are tracing tokens, not idempotency keys.

Reactions remain local to the assembly that observed the action. The engine does
not provide a distributed scheduler, cross-process serialization, occurrence
replay, reaction resumption, rollback across actions, correlation-id
deduplication, or exactly-once action or reaction execution.

## Concept construction and resources

A successful `conceptSet.implementations(floor, context)` call invokes each
selected floor factory exactly once, with the exact context and its selected
concept-set key. The helper is not a singleton registry: each later call invokes
the factories again and constructs another map. Factories remain responsible
for the identities and external resources they return.

Assembly does not invoke a floor factory merely because the floor was
registered. It can default-construct canonical classes, apply `initialize`
arguments, or accept ready `instances`. A host selects a floor by calling
`implementations(...)` and passing the result as `instances`; the host also
owns that floor's resource lifecycle.

The per-assembly raw-object identity check prevents two selected names from
sharing instrumentation identity. It cannot detect two distinct objects using
the same database collection, schema, file, cache key space, remote account, or
service. Configure per-instance resources explicitly when durable isolation is
required.

## Timeouts, abort, and shutdown

Without an execution profile, invocation timeout defaults to 30 seconds. With a
profile, `maxRequestDurationMs` is both the default and the maximum accepted
`timeoutMs`. Timeout and `AbortSignal` stop waiting; neither cancels accepted
concept work nor rolls back completed actions. Continued work remains subject to
flow limits and can outlive its transport request.

Shutdown must account for that continued work. Stop public admission, call
`beginDrain()`, and wait for the returned promise or `whenIdle()` until accepted
causal flows settle. A gateway drains its own roots before the downstream
assembly. Do not expose the downstream invoker as another public admission path
during this interval.

`ConceptFloor.close()` is host-owned and assembly does not call it. `LogSink` has
no lifecycle method, and `FileLogSink` has no close API. The host shutdown order
is:

1. Stop the listener.
2. Call `beginDrain()` and wait up to a host-defined hard deadline.
3. Close each selected concept floor once.
4. Close resources owned by custom log sinks and other host adapters.
5. Exit.

Forced shutdown after the deadline may interrupt accepted work. The application
must define recovery for partially completed operations.

## Runtime validation

Generated wire contracts do not validate runtime values. Default admission
requires an object with all required own keys, then applies shallow defaults. It
does not infer primitive or nested schemas from generated types or concept State
notation.

Attach explicit synchronous endpoint validators for untrusted input, successful
output, and domain errors. Input validation runs before application work. Invalid
output or domain errors become integrity evidence and opaque `INTERNAL_ERROR`.
[Runtime validation](semantics.md#runtime-validation) defines validation order
and failure handling.

## Endpoint completeness

Ordinary assembly rejects local reactions, views, and formers before exposing a
route set or generated artifact plan. Direct invocation, gateways, transports,
and generated clients therefore share the same portable design.

Endpoint branches have no priority or exclusivity. More than one branch may
answer, and a fault-free uncovered request waits until its deadline. Diagnostics
are conservative and do not prove arbitrary policy or concurrent-state logic.
Test every admitted case and every intended overlap. See [sibling paths and
endpoint settlement](semantics.md#sibling-paths-and-endpoint-settlement).

## Persistence and restart

Concept state and occurrence evidence are separate. Every engine owns a local
occurrence index. `FileLogSink` appends JSONL but does not load it, rebuild the
index, restore concept state, replay reactions, or restore pending work.

Persist domain state in concept implementations. Drain accepted work before
replacement, then reconstruct derived state from durable state before admission.
Overlapping old and new processes require storage coordination because their
action queues are independent.

An occurrence file supports audit or diagnosis, not recovery. `FileLogSink`
appends synchronously without locking, shared-writer coordination, flush,
network-filesystem durability, or a close method. Use a host-owned sink when
those properties matter.
The [persistence and restart recipe](../guide/persistence-recovery.md#persistence-restart-and-recovery)
demonstrates the separation.

## Retention and memory

Ordinary assembly retains the 100 most recent settled flows by default.
`RetentionPolicy` accepts `"keepAll"` or a non-negative finite-integer
`{ window: number }`. Manual `createEngine(...)` defaults to `"keepAll"`.

Window enforcement runs only after a flow settles and never evicts active flows,
so active work can exceed the configured window. `{ window: 0 }` evicts each flow
after settlement. There is no manual prune operation or hard retained-byte
limit. Retention affects the internal index only; it does not remove output
already sent to a `LogSink`.

## Operational observation

Use assembly observers for engine events and gateway observers for public
admission, limits, drain, and final caller settlement. An
`invocation-settled` event does not imply causal quiescence; accepted sibling
work may continue. Use `whenIdle()` or completed drain for quiescence.

Observer callbacks are synchronous, isolated handoffs. Throws and rejected
promises do not change invocation behavior. Keep callbacks bounded and move
queueing, retries, and network export into host-owned infrastructure.

## Transport host responsibilities

A transport adapter does not change execution, persistence, or cancellation
guarantees. Its package documentation defines protocol behavior and limits.

The host owns connection and request-rate limits, denial-of-service controls,
TLS, HSTS, certificate and trusted-proxy handling, static-file and SPA routing,
health checks, autoscaling, listener and process lifecycle, and authentication
integration. Application concepts own credential meaning and domain
authorization.

## Logs and sensitive values

Occurrence redaction matches field names; it does not search arbitrary string
contents. Do not embed secrets in unstructured strings and assume redaction will
find them. Opaque values passed to a `LogSink`, including class instances,
`Map`, `Set`, and functions, retain their identity and must be treated as
read-only sensitive values.

A sink runs synchronously before an entry reaches the occurrence index. An
invocation append failure can prevent the action body; an outcome append failure
can follow a concept-state change. The engine neither retries the append nor
rolls back state. Sink availability, recovery, and lifecycle are host
responsibilities.

`rawFaultReporter` receives original thrown values outside the sanitized
occurrence path. Treat it as privileged application code, restrict access, and
keep its output out of public errors and ordinary logs.

## Operational checklist

Before serving an assembly outside a test environment:

1. Pin an exact beta and review its changelog and support window.
2. Define concept-state transactions, persistence, retry, deduplication, and
   recovery.
3. Add runtime validators and host traffic limits.
4. Test every endpoint case, overlap, timeout, abort, and partial failure.
5. Configure execution limits, retention, observation, and sensitive-data sinks.
6. Test drain, forced shutdown, process interruption, and storage failure.
