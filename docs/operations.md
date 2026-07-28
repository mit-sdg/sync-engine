# Operational limits

This page states the deployment properties that should determine whether
sync-engine is suitable for an application. It applies to the current alpha
implementation. [Execution semantics](semantics.md) defines the lower-level
runtime contract.

## Appropriate use

Use sync-engine when independently implemented concepts benefit from explicit,
inspectable composition. One process can host an ordinary application; several
independent instances can share domain state only when their concept
implementations and host-owned storage provide the required transactions and
coordination. The ordinary runtime is suitable for evaluation, prototypes,
deterministic application tests, and hosts that provide their own storage,
validation, outer traffic controls, and process lifecycle.

Do not use the current alpha as the sole production control plane for untrusted
or unbounded traffic. Configure `ExecutionLimits` for engine-owned work and
retain host limits for connections, rates, DDoS protection, and exporter queues.

Use a different architecture, or add host-level coordination, when correctness
requires a transaction across concepts, synchronous cancellation of accepted
work, distributed serialization, occurrence replay, exactly-once processing,
or automatic restart recovery.

## Alpha compatibility

Public subpaths and generated files may change incompatibly between alpha
versions. Pin an exact package version, review the changelog, regenerate both
artifacts, and typecheck a packed consumer before upgrading. Generated
Markdown, IR, and wire output are not stable interchange formats during alpha.

## Concurrency and atomicity

One action body runs at a time per concept instance within one engine. The
queue awaits native Promises from the same JavaScript realm, including ordinary
`async` methods; arbitrary thenables are outside that guarantee. Different
concept instances and separate root flows may overlap. Sharing one raw instance
between assemblies creates separate queues and query caches. Two processes
using the same external storage are not serialized by the engine. The concept
implementation and storage layer must provide any cross-process locking,
transactions, isolation, and conflict handling.

A reaction chain is not a transaction. If an early consequence changes state
and a later consequence refuses or faults, the earlier change remains. Put
uniqueness, capacity, first-writer, and answer-once decisions inside the action
that owns the relevant state.

The engine does not define retry or deduplication semantics. A host retry can
invoke an action again after the original call completed or continued after a
timeout. Concepts that receive retryable requests must define their own
idempotency keys and durable deduplication where required.

## Supported multi-instance topology

A supported multi-instance deployment gives every instance a separate
assembly, concept instance set, action scheduler, gateway, application log
store, and gateway log store. Concept implementations may connect those
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

Tracking HTTP promises is insufficient because a timed-out request can outlive
its transport wait. A host can stop accepting new requests and apply a hard
shutdown deadline. Call `beginDrain()` to stop root admission and await its
promise (or `whenIdle()`) until accepted causal flows settle. Timed-out and
aborted calls remain active until their real work settles.

`ConceptFloor.close()` is a descriptor operation supplied by the host. Assembly
does not call it automatically. The host owns listener shutdown, process
signals, hard deadlines, and resource close ordering. Assembly and gateway also
do not close a supplied `logStore`; if a custom store owns resources, close them
through its host-defined API after drain.

The host sequence is: stop the listener, call `beginDrain()`, await it up to the
host's hard deadline, invoke each concept floor's `close()` exactly once, close
host-owned log-store resources, then exit.

## Runtime validation

Generated wire contracts are compile-time TypeScript contracts. Gateway
admission checks that input is a non-null, non-array object and that required
own keys are present. It permits extra keys, uses shallow defaults for absent
keys, and does not validate primitive types, nested shapes, or the value of a
present key.
Explicit `null` and, for direct invocation, explicit `undefined` satisfy
required-key presence unless an endpoint input validator rejects them.

Applications may attach runtime input and successful-output validators to an
endpoint without adopting a particular schema library. Input validation runs
before application work. Invalid output is retained as integrity evidence and
becomes opaque `INTERNAL_ERROR`. Validators are explicit application contracts;
the engine does not infer them from generated types or optional, uninterpreted
concept State notation.

## Endpoint completeness

Ordinary assembly and artifact generation reject local behavior in an endpoint,
in a transitively referenced endpoint view or former, or in a local ordinary
reaction that touches `RequestBoundary`. Closures, custom operations,
object-identity patterns, raw transforms, and whole unlowered reactions are
local. There is no endpoint override. Validation completes before a public route
set or generated artifact plan is exposed, so direct invocation, gateways,
HTTP, and generated clients use the same complete route set.

Non-boundary local reactions, views, and formers require
`AssemblyOptions.localBehavior`. Treat its non-empty revision as a reviewed
application change identifier and its canonical `{ kind, name }` list as an
exact allowlist, not a wildcard. Assembly rejects missing, stale, extra,
duplicate, malformed, unsorted, and unused contracts. Review the manifest's
observed reasons and bump the revision whenever local implementation behavior
changes, including changes that leave the serialized marker unchanged.

Endpoint branches have no priority or exclusivity. If more than one branch
responds, one answer is accepted and the others receive `NOT_PENDING`; callers
must not rely on which matching answer wins. If no branch responds and no
interpreter failure occurs, the request waits until its deadline.

## Persistence and restart

Concept state and occurrence evidence are separate. `MemoryStore` is
process-local. `FileStore` appends JSONL synchronously but does not load the
file, rebuild indexes, replay reactions, or restore concept state on startup.
In-memory pruning does not rewrite the JSONL file. The [persistence and restart
recipe](./advanced-recipes.md#persistence-restart-and-recovery) demonstrates
those boundaries with separate state and evidence files.

The engine does not restore pending requests, interrupted reaction paths, or
prior firings after restart. Persist concept state in the concept
implementation, and design application-specific recovery. An occurrence file
can support audit or diagnosis; it is not a recovery log.

The supplied sources do not establish safe shared access to one `FileStore`
path from several processes or network filesystems. Use a host-owned store with
documented concurrency and durability behavior when those properties matter.

## Retention and memory

Ordinary assembly and the standard gateway each use a separate `MemoryStore`
with a default window of the 100 most recent settled flows. Automatic window
enforcement does not evict an active flow, so active work may exceed the
configured window. Explicit `evictFlow` and custom stores are outside that
protection.

`"keepAll"` retains all indexed evidence until the process or store releases
it. `"evictConsumed"` removes only a consumed suffix when `prune()` is called;
settlement does not invoke that prune operation automatically. Increasing
retention increases memory use. No hard retained-byte limit is provided.

## Operational observation

Use an assembly observer for application-engine telemetry and a gateway
observer for gateway-boundary telemetry. Gateway action, interpreter,
integrity, limit, and drain events identify the gateway's internal concepts and
routes. For request-level counts and latency, use its single
`invocation-settled` event: it is emitted after final downstream completion and
identifies the caller-requested application route, effective correlation id,
result class, and applicable framework code. The internal `/gateway/receive`
settlement is deliberately hidden, and the public settlement may have no
`flow` field.

Observer handoff is synchronous but isolated: throws and rejected promises do
not alter invocation behavior. Keep callbacks bounded and move queueing,
export, retries, and network I/O into host-owned infrastructure.

## HTTP host responsibilities

Use `productionHttpProfile(...)` for a public JSON boundary that does not need
engine-managed credentials. It accepts only `POST`, limits each request body to
1,048,576 bytes, preserves success values, and exposes only registered public
error categories plus opaque protocol categories. Unknown or private refusals
and all framework server failures become `INTERNAL_ERROR`. Use `httpFloor(...)`
only when the application also needs the narrow same-origin cookie binding.

The gateway/invoker-only `createHttpHandler` forms are lower-level raw envelope
adapters. They preserve logical domain codes and selected framework statuses;
do not expose them directly unless a host-owned outer policy deliberately
provides the public projection.

Both production descriptors require an HTTPS public origin when
`NODE_ENV=production`, but the Fetch handlers do not terminate TLS. The
credential floor enforces its configured origin when an `Origin` header is
present and does not implement CORS preflight. Its cookies are `HttpOnly`,
`SameSite=Strict`, and `Path=/`; HTTPS cookies are `Secure` and use the
`__Host-` prefix.

Every handler is a Fetch adapter, not a complete server. The host owns CORS,
connection and request-rate limits, denial-of-service controls, TLS termination,
HSTS, trusted-proxy and reverse-proxy policy, deployment health, autoscaling,
listener lifecycle, and authentication integration. Application concepts own
credential meaning and domain authorization.

## Logs and sensitive values

Assembly-scoped field-name redaction runs before occurrence entries reach
stores, observers, or inspection, so separate applications cannot mix domain
policies. Each assembly keeps an immutable snapshot of its own policy. Only the
standalone `configureRedaction(...)` / `redact(...)` compatibility utility uses
mutable process-global state. Redaction matches field names; it does not search
arbitrary string contents. During an active flow, the interpreter privately
retains original values needed for matching and clears them when the outermost
action settles.

Do not place secrets in unstructured strings and assume field-name redaction
will find them. Stable operational events omit action values. Review custom
stores and legacy advanced observers as sensitive-data sinks.

## Operational checklist

Before serving an assembly outside a test environment:

1. Pin an exact alpha version and review its changelog.
2. Run the concept, type, test, and generated-artifact checks.
3. Validate untrusted inputs outside or inside the receiving concept.
4. Define concept-state persistence, transaction, retry, and deduplication
   behavior explicitly.
5. Add host limits for connections, request rate, concurrency, and shutdown.
6. Verify that every endpoint is represented in generated artifacts and that
   every admitted case answers explicitly.
7. Review every local-behavior owner and reason, and verify the contract revision.
8. Review log retention, redaction, and diagnostic access.
9. Test process interruption and storage failure against the application's own
   recovery design.
