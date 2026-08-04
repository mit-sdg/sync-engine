# Operational limits

This page states the deployment properties that should determine whether
sync-engine is suitable for an application. It applies to the current beta
implementation. [Execution semantics](semantics.md) defines the lower-level
runtime contract.

## Deployment fit at a glance

| Requirement                                     | Engine contract                                       | Required owner or action                                                          |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Serialize actions on one concept instance       | Yes, within one assembly                              | Use concept storage for cross-process coordination                                |
| Transaction across several actions or concepts  | No                                                    | Put the atomic decision in one owning concept action and storage transaction      |
| Persist concept state and recover after restart | No                                                    | Concept implementation and host recovery policy                                   |
| Validate endpoint values at runtime             | Explicit endpoint hooks only                          | Application-supplied input, successful-output, and domain-error validators        |
| Bound engine-owned work                         | Optional `ExecutionLimits`                            | Configure limits; keep host connection, rate, and queue limits                    |
| Cancel work after acceptance                    | No                                                    | Design idempotency and recovery for work that outlives the caller                 |
| Serve a public JSON boundary                    | Fetch handler with a production profile or HTTP floor | Host supplies TLS, listener, CORS policy, traffic controls, and process lifecycle |

Use sync-engine only when the application and host can own every requirement in
the final column.

## Appropriate use

Use sync-engine when independently implemented concepts benefit from explicit,
inspectable composition. One process can host an ordinary application; several
independent instances can share domain state only when their concept
implementations and host-owned storage provide the required transactions and
coordination. The ordinary runtime is suitable for deterministic application
tests and for hosts that provide their own storage, validation, outer traffic
controls, and process lifecycle.

Do not use the engine as the sole control plane for untrusted or unbounded
traffic. Configure `ExecutionLimits` for engine-owned work and retain host
limits for connections, rates, DDoS protection, and exporter queues.

Use a different architecture, or add host-level coordination, when correctness
requires a transaction across concepts, synchronous cancellation of accepted
work, distributed serialization, occurrence replay, exactly-once processing,
or automatic restart recovery.

## Stable compatibility

Public subpaths, including `/advanced`, and documented behavior follow Semantic
Versioning. Use `@beta` for the current release or pin an exact beta version
for reproducibility. Review the changelog, regenerate artifacts, and typecheck a
packed consumer before upgrading. Generated assembly compatibility is governed
by the application manifest format and package SemVer. Core generator
identities must name `@mit-sdg/sync-engine` at a 1.x version. Projector
provenance may name any nonblank package at any valid SemVer version; it
is not restricted to 1.x. The [support policy](../SUPPORT.md) defines the
version and format rules.

## Concurrency and atomicity

One action body runs at a time per concept instance within one engine. The queue
awaits native promises and structural `PromiseLike` values, including promises
from another JavaScript realm. A structural thenable is an object or function
with a callable `then` property. A throwing `then` accessor, or a `then` call
that throws before settlement, faults the action. A thenable that never settles
holds the serial line. Different concept instances and separate root flows may
overlap. Sharing one raw instance between assemblies creates separate queues and
query caches. Two processes using the same external storage are not serialized
by the engine. The concept implementation and storage layer must provide any
cross-process locking, transactions, isolation, and conflict handling.

Queries and read evaluation do not enter the action queue. They can overlap an
asynchronous action body and other queries, and they do not receive a
transactional or as-of-action snapshot. Query implementations must be
side-effect-free. The storage layer must provide any read/write isolation the
application requires. Assembly defaults to `queryCache: "memoize"`;
`queryCache: "none"` disables memoization and makes repeated reads execute the
query implementation independently. In `"memoize"` mode, a structural thenable
is normalized and cached once, equivalent reads share that normalized promise,
and rejection evicts the entry. A thenable that never settles remains cached
until invalidation.

Each action in a reaction chain commits independently. If an early consequence
changes state and a later consequence refuses or faults, the earlier change remains. Put
uniqueness, capacity, first-writer, and answer-once decisions inside the action
that owns the relevant state.

The engine does not define retry or deduplication semantics. A host retry can
invoke an action again after the original call completed or continued after a
timeout. Concepts that receive retryable requests must define their own
idempotency keys and durable deduplication where required.

## Supported multi-instance topology

A supported multi-instance deployment gives every instance a separate
assembly, concept instance set, action scheduler, gateway, occurrence index,
and gateway observer stream. Concept implementations may connect those
instances to one transactional domain store. Every race-sensitive decision and
domain idempotency check must occur atomically in the owning concept action,
using storage constraints or equivalent storage coordination. Use a durable
domain `operationId` for retry semantics; correlation ids are tracing tokens,
not idempotency keys.

The negative contract is explicit:

- no exactly-once action or surrounding-reaction execution;
- no distributed reaction scheduler;
- no restart replay or resumption from occurrence logs;
- no rollback of an earlier action when a later action refuses or faults;
- no cross-process serialization without storage coordination; and
- no correlation-id deduplication.

An idempotent action can return the same committed result from two instances
while both successful occurrences run their local surrounding reactions. A
process starting against existing durable concept state does not replay prior
domain operations. Database adapters, schema constraints, transactions, locks,
migrations, and application recovery stay outside the engine.

## Timeouts, abort, and shutdown

Without an execution profile, the default invocation timeout is 30 seconds. A
profile uses its maximum request duration as the default and rejects longer
deadlines. Timeout and `AbortSignal` stop the caller's wait. Neither mechanism
forwards cancellation into accepted concept work or rolls back completed
actions. A timed-out flow can continue consuming queue, query, reaction, and
storage resources within its flow budgets.

The HTTP client implements `timeoutMs` by aborting its local Fetch operation. It
accepts positive finite integers through `2_147_483_647` milliseconds; a larger
or otherwise invalid value returns core `INVALID_INPUT` before Fetch. This
transport-local ceiling is separate from gateway and application defaults and
configured maximum request durations. The HTTP protocol has no cancellation
message for accepted server work. The server handler passes the host-provided
`Request.signal` to its invoker, where the signal ends waiting while accepted
concept work may continue.

Tracking HTTP promises is insufficient because a timed-out request can outlive
its transport wait. A host can stop accepting new requests and apply a hard
shutdown deadline. Call `beginDrain()` to stop root admission and await its
promise (or `whenIdle()`) until accepted causal flows settle. Timed-out and
aborted calls remain active until their real work settles. During gateway drain,
accepted gateway roots cross application admission before the application
begins draining. Do not expose the downstream application invoker as a second
public admission path during this interval.

`ConceptFloor.close()` is a descriptor operation supplied by the host. Assembly
does not call it automatically. The host owns listener shutdown, process
signals, hard deadlines, and resource close ordering. `LogSink` has no lifecycle
method, and `FileLogSink` has no close API. If a custom sink owns files,
connections, queues, or workers, the host closes those resources through its
own API after drain.

The host sequence is: stop the listener, call `beginDrain()`, await it up to the
host's hard deadline, invoke each concept floor's `close()` exactly once, close
host-owned log-sink resources, then exit. Closing resources after the hard
deadline is forced shutdown: it can interrupt accepted work, so the application
must define recovery for partially completed operations.

## Runtime validation

Generated wire contracts are compile-time TypeScript contracts. Gateway
admission checks that input is a non-null, non-array object and that required
own keys are present. It permits extra keys, uses shallow defaults for absent
keys, and does not validate primitive types, nested shapes, or the value of a
present key.
Explicit `null` and, for direct invocation, explicit `undefined` satisfy
required-key presence unless an endpoint input validator rejects them.

Applications may attach runtime input, successful-output, and domain-error
validators to an endpoint without adopting a particular schema library. Input
validation runs before application work. The domain-error validator receives
the value under the authored response's top-level `error` field. Invalid output
and invalid domain error values are retained as `invalid-output` or
`invalid-domain-error` integrity evidence and become opaque `INTERNAL_ERROR`.
A validator throw is also reported to `rawFaultReporter` when the application
configures that privileged channel. Output and domain-error evidence retains the
`ValidatorFault` class only; an input-validator throw returns
`INVALID_INPUT` before the boundary ask. Validators are explicit application
contracts; the engine does not infer them from generated types or optional,
uninterpreted concept State notation.

## Endpoint completeness

Ordinary assembly and artifact generation reject every local reaction, view, or
former. Closures, custom operations, object-identity patterns, raw transforms,
and whole unlowered reactions are local. Validation completes before a public
route set or generated artifact plan is exposed, so direct invocation,
gateways, HTTP, and generated clients use the same complete portable design.
Manual engines under the `advanced` subpath retain explicit local constructs
without acquiring an application boundary override.

Ordinary assembly accepts an advanced `Refuse` marker only when the action's
refusal contract declares its code. An undeclared code is an action fault.
Manual `createEngine(...)` remains open to
undeclared `Refuse` codes.

Endpoint branches have no priority or exclusivity. If more than one branch
responds, one answer is accepted and the others receive `NOT_PENDING`; callers
must not rely on which matching answer wins. If no branch responds and no
interpreter failure occurs, the request waits until its deadline.

## Persistence and restart

Concept state and occurrence evidence are separate. Every engine owns a
process-local internal `MemoryStore` occurrence index. `FileLogSink` appends an
audit projection as JSONL synchronously but does not load the file, rebuild the
index, replay reactions, or restore concept state on startup. In-memory
retention does not rewrite the JSONL file. The [persistence and restart
recipe](./advanced-recipes.md#persistence-restart-and-recovery) demonstrates
those boundaries with separate state and evidence files.

The engine does not restore pending requests, interrupted reaction paths, or
prior firings after restart. Persist concept state in the concept
implementation, and design application-specific recovery. An occurrence file
can support audit or diagnosis. Recovery must use concept-owned state and an
application-specific procedure.

`FileLogSink` performs append operations but provides no locking, shared-writer,
flush, or network-filesystem durability contract. Use a host-owned sink with
documented concurrency and durability behavior when those properties matter.

## Retention and memory

Ordinary assembly uses an internal occurrence index with a default window of the
100 most recent settled flows. `RetentionPolicy` accepts `"keepAll"` or a
non-negative finite-integer `{ window: number }`. Manual `createEngine(...)`
defaults to `"keepAll"`; configure a window explicitly when its retained index
must be bounded by settled-flow count.

Window enforcement runs automatically only after a causal flow settles and does
not evict active flows. Active work can therefore exceed a configured window
until settlement. `{ window: 0 }` removes a flow after it settles. `"keepAll"`
retains all indexed evidence for the engine lifetime. There is no manual prune
operation. Increasing a window or using `"keepAll"` increases memory use. No
hard retained-byte limit is provided. `logSink` and `retention` are independent
and may be configured together; retention never removes previously emitted sink
output.

## Operational observation

Use an assembly observer for application-engine telemetry and a gateway
observer for gateway admission, limits, drain, and final settlement. The
gateway emits one `invocation-settled` event after the final result visible to
the caller. It identifies the requested application route, effective
correlation id, result class, and applicable framework code, and may omit
`flow`. The event does not imply causal quiescence. Accepted sibling work can
continue afterward; use `whenIdle()` or a completed drain to observe
quiescence.

Observer handoff is synchronous but isolated: throws and rejected promises do
not alter invocation behavior. Keep callbacks bounded and move queueing,
export, retries, and network I/O into host-owned infrastructure.

## HTTP host responsibilities

Install `@mit-sdg/sync-engine-http` and use
`productionHttpProfile(...)` from `/server` for a public JSON boundary that does
not need engine-managed credentials. It accepts only `POST`, limits each request
body to 1,048,576 bytes, preserves success values, and exposes only policy-mapped
public error categories plus opaque protocol categories. Unknown or private
refusals become `INTERNAL_ERROR`. Framework `INVALID_INPUT` and `NOT_FOUND`
become `INVALID_REQUEST` and `NOT_FOUND`; other framework server failures become
`INTERNAL_ERROR`. Use `httpFloor(...)` only when the application also needs the
narrow cookie binding with a conditional origin check. Reuse that immutable
policy value in `httpWire(...)` when
generating the public client contract.

Both production descriptors require an HTTPS public origin when
`NODE_ENV=production`, but the Fetch handlers do not terminate TLS. The
credential floor enforces its configured origin when an `Origin` header is
present and does not implement CORS preflight. Its cookies are `HttpOnly`,
`SameSite=Strict`, and `Path=/`; HTTPS cookies are `Secure` and use the
`__Host-` prefix.

The fetch client defaults to credentials mode `include`, but this does not add a
cookie jar. Browsers own their cookie storage. A Node.js or custom `fetch`
implementation must provide cookie persistence when floor-protected calls span
multiple requests. Set `maxResponseBytes` when the client must bound response
buffering; an exceeded declared or streamed byte count returns
`RESPONSE_TOO_LARGE`. The default leaves response size uncapped.

Every handler adapts Fetch requests. The host owns CORS,
connection and request-rate limits, denial-of-service controls, TLS termination,
HSTS, trusted-proxy and reverse-proxy policy, deployment health, autoscaling,
listener lifecycle, and authentication integration. Application concepts own
credential meaning and domain authorization.

The [security policy](../SECURITY.md) defines private vulnerability reporting
and the supported security-fix window. It does not transfer these host and
application responsibilities to the engine.

## Logs and sensitive values

An optional `LogSink` receives every validated, redacted occurrence entry
synchronously before the internal index folds it. `append` must return
`undefined` synchronously. A throw or any other return value, including a
promise or structural thenable, fails the append before the fold. An invocation
append failure can prevent the action body from running; an outcome append
failure can occur after the body changed state. The engine does not retry the
append or roll back concept state. Custom sink availability and recovery are
host responsibilities.

Sink-entry isolation covers structural data. Arrays and plain
records are copied and frozen; invocation identities are replaced by frozen
name-bearing representatives; and `Date` values are copied. Opaque leaves such
as class instances, `Map`, `Set`, and function values retain their runtime
identity and are not recursively frozen. Treat opaque leaves as read-only
sensitive values.

Assembly-scoped field-name redaction runs before occurrence entries reach the
internal index, a `LogSink`, observers, or inspection. Each assembly creates its
own redactor and copies the policy's exact field names and pattern list, but
retains the supplied `RegExp` objects. Do not mutate those expressions after
constructing an assembly. Redaction matches field names; it does not search
arbitrary string contents. During an active flow, the interpreter privately
retains original values needed for matching and clears them when the outermost
action settles.

Do not place secrets in unstructured strings and assume field-name redaction
will find them. Stable operational events omit action values. Review custom
sinks and manual-engine observers as sensitive-data destinations.

`rawFaultReporter` is deliberately outside this sanitized path. It receives the
original `unknown` value from action faults, interpreter failures, and endpoint
validator throws. Reporter throws and rejected returned promise-like values are
isolated from runtime results, but the reporter itself is privileged application
code. Restrict access, bound its work, and keep raw reports out of ordinary
public errors and logs.

## Operational checklist

Before serving an assembly outside a test environment:

1. Pin an exact beta version and review its changelog and support window.
2. Run the concept, type, test, and generated-artifact checks.
3. Validate untrusted inputs outside or inside the receiving concept.
4. Define concept-state persistence, transaction, retry, and deduplication
   behavior explicitly.
5. Add host limits for connections, request rate, concurrency, and shutdown.
6. Verify that every endpoint is represented in generated artifacts and that
   every admitted case answers explicitly.
7. Verify that the assembly contains portable behavior only.
8. Review occurrence retention, sink failure behavior, redaction, and raw-fault
   access.
9. Test process interruption and storage failure against the application's own
   recovery design.
