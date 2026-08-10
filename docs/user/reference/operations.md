# Operational limits

This page states the deployment properties that determine whether sync-engine is
suitable for an application. It applies to the current beta. [Execution
semantics](semantics.md) defines the underlying runtime contract.

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

Use sync-engine only when the application and host can own every requirement in
the final column.

## Appropriate use

Use sync-engine when independently implemented concepts benefit from explicit,
inspectable composition and the host owns storage, validation, workload control,
and process lifecycle. One process can host an ordinary application. Several
instances can share domain state only through concept implementations and storage
that provide the required transactions and coordination.

Do not use the engine as the sole control plane for untrusted or unbounded
traffic. Use another architecture, or add host-level coordination, when
correctness requires a transaction across concepts, distributed serialization,
synchronous cancellation of accepted work, occurrence replay, automatic restart
recovery, or exactly-once processing.

## Beta compatibility

A newer beta may make incompatible changes to every public subpath, including
`/advanced`. Pin an exact version, review the changelog, regenerate artifacts,
and typecheck each consuming application and generated client before upgrading. The [support
policy](../../../SUPPORT.md) defines the support window and generated-format rules.

## Concurrency and atomicity

One action body runs at a time per concept instance within one engine. Different
concept instances, root flows, assemblies, and processes may overlap. Sharing one
raw instance between assemblies creates separate queues; the engine does not
serialize those assemblies.

Queries and read evaluation do not enter the action queue. They may overlap an
asynchronous action and do not receive a transactional snapshot. Query
implementations must be side-effect-free, and storage must provide required
read/write isolation.

Each action commits independently. A later refusal or fault does not roll back an
earlier action. Put uniqueness, capacity, first-writer, and answer-once decisions
inside the action that owns the state. The runtime provides no retry
deduplication; retryable operations need domain idempotency keys and durable
deduplication where required. [Ordering and state-read
timing](semantics.md#ordering-and-state-read-timing) defines the exact ordering.

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

## Timeouts, abort, and shutdown

Without an execution profile, invocation timeout defaults to 30 seconds. A
profile supplies the default and maximum request duration. Timeout and
`AbortSignal` stop waiting; neither cancels accepted concept work nor rolls back
completed actions. Continued work remains subject to flow limits and can outlive
its transport request.

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

Generated wire contracts check TypeScript callers; they do not validate runtime
values. Default admission checks only that input is an object and that required
own keys are present, then applies shallow defaults. It does not infer primitive
or nested schemas from generated types or concept State notation.

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

Concept state and occurrence evidence are separate. Every engine owns a
process-local occurrence index. `FileLogSink` appends JSONL audit output but does
not load it, rebuild the index, restore concept state, or replay reactions on
startup. The engine also does not restore pending requests or interrupted paths.

Persist domain state in concept implementations and design an application-specific
recovery procedure. An occurrence file can support audit or diagnosis, but it is
not a recovery log. `FileLogSink` provides no locking, shared-writer, flush, or
network-filesystem durability contract. Use a host-owned sink when those
properties matter. The [persistence and restart
recipe](../guide/persistence-recovery.md#persistence-restart-and-recovery) demonstrates the
separation.

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

## HTTP host responsibilities

Install the exact matching beta of `@mit-sdg/sync-engine-http`. A plain
`createHttpHandler({ application, gateway })` exposes POST/JSON without policy.
Use one immutable `httpPolicy(...)` value for deployment facts that must also
shape `httpWire(...)`, including a base path, public errors, browser origins,
request-origin protection, cookies, and the request-body limit. The [HTTP Public
API](https://github.com/mit-sdg/sync-engine/blob/main/packages/http/public-surface.md)
defines exact method, body, status, CORS, origin, cookie, correlation, timeout,
and response-limit behavior.

The Fetch handler is not a listener and does not terminate TLS. A declared
browser policy supplies exact-origin CORS and preflight handling; a separate
request-origin policy protects cookie-touched paths. The host still owns
connection and request-rate limits, denial-of-service controls, TLS, HSTS,
certificate and trusted-proxy handling, health checks, autoscaling, listener
lifecycle, and authentication integration. Application concepts own credential
meaning and domain authorization.

Methods other than `POST`, streaming, resource-oriented REST routing,
framework-owned routing, request preprocessing, and unrestricted response
transformation are unsupported. Wrap the handler when middleware must operate
outside the package's security boundary, or implement a custom transport from
supported core subpaths. The HTTP package does not provide a Node cookie jar,
retry policy, idempotency, persistence, or cancellation of accepted work.

## Logs and sensitive values

Occurrence redaction matches field names; it does not search arbitrary string
contents. Do not embed secrets in unstructured strings and assume redaction will
find them. Opaque values passed to a `LogSink`, including class instances,
`Map`, `Set`, and functions, retain their identity and must be treated as
read-only sensitive values.

A sink runs synchronously before an entry reaches the internal occurrence index.
An invocation append failure can prevent the action body from running; an outcome
append failure can occur after concept state changed. The engine neither retries
the append nor rolls back state. Custom sink availability, recovery, and resource
lifecycle are host responsibilities.

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
