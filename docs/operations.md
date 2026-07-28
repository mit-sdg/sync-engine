# Operational limits

This page states the deployment properties that should determine whether
sync-engine is suitable for an application. It applies to the current alpha
implementation. [Execution semantics](semantics.md) defines the lower-level
runtime contract.

## Appropriate use

Use sync-engine when one process can host independently implemented concepts
and the application benefits from explicit, inspectable composition. The
ordinary runtime is suitable for evaluation, prototypes, deterministic
application tests, and hosts that provide their own storage, validation,
outer traffic controls, and process lifecycle.

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
signals, hard deadlines, and resource close ordering.

The host sequence is: stop the listener, call `beginDrain()`, await it up to the
host's hard deadline, close concept-floor and log-store resources, then exit.

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
the engine does not infer them from generated types or concept state prose.

## Endpoint completeness

Ordinary assembly and artifact generation reject executable endpoints that
cannot be lowered to the portable representation. Direct invocation, gateways,
HTTP, and generated clients therefore use the same complete public route set.

Endpoint branches have no priority or exclusivity. If more than one branch
responds, one answer is accepted and the others receive `NOT_PENDING`; callers
must not rely on which matching answer wins. If no branch responds and no
interpreter failure occurs, the request waits until its deadline.

## Persistence and restart

Concept state and occurrence evidence are separate. `MemoryStore` is
process-local. `FileStore` appends JSONL synchronously but does not load the
file, rebuild indexes, replay reactions, or restore concept state on startup.
In-memory pruning does not rewrite the JSONL file.

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

## HTTP host responsibilities

The generic HTTP adapter accepts JSON `POST` requests and limits each request
body to 1,048,576 bytes. It is a Fetch handler, not a complete server. The host
owns connection limits, request-rate limits, denial-of-service controls, TLS,
HSTS, trusted-proxy handling, deployment health, and autoscaling.

The credential HTTP floor enforces its configured origin when an `Origin`
header is present and does not implement CORS preflight. In production mode it
requires an HTTPS public origin, but it does not terminate TLS. Cookies are
`HttpOnly`, `SameSite=Strict`, and `Path=/`; HTTPS cookies are `Secure` and use
the `__Host-` prefix.

## Logs and sensitive values

Configured field-name redaction runs before occurrence entries reach stores,
observers, or inspection. Redaction matches field names; it does not search
arbitrary string contents. The policy is mutable process-global state. During
an active flow, the interpreter privately retains original values needed for
matching and clears them when the outermost action settles.

Do not place secrets in unstructured strings and assume field-name redaction
will find them. Review custom stores and observers as sensitive-data sinks.

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
7. Review log retention, redaction, and diagnostic access.
8. Test process interruption and storage failure against the application's own
   recovery design.
