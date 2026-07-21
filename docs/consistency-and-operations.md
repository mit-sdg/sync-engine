# Consistency and operations

The ordinary [execution semantics](./semantics.md) cover the guarantees most
application authors use after following the guide. This note owns
the runtime limits that matter when an application depends on ordering,
failure delivery, cancellation, persistence, restart, or boundary operation.

## Ordering and state-read timing

An assembly sorts the authored composition's reactions by name before
registering them, then registers the standard fault and refusal reactions.
It evaluates reactions for one trigger record sequentially. Sibling paths
carry no priority and do not form a join; each path advances when its own
preceding ask returns. Applications must not use evaluation order as a
priority mechanism.

Action bodies run one at a time per concept instance, in arrival order,
including asynchronous bodies. This is an in-process guarantee. A concept's
implementation and storage must supply any atomicity or coordination required
across processes. A reaction consequence chain is not a database transaction:
earlier actions are not rolled back when a later action refuses or faults.

`earlier` reads matching action records whose invocation position precedes the
trigger in the same flow. Ordinary query reads in a reaction or view instead
read concept state when that reaction runs. A later reaction may therefore
observe state changed by an earlier cascade. The runtime does not provide an
as-of-trigger state snapshot.

If two reactions answer the same outside request, the application boundary
accepts the first answer and refuses the next with `NOT_PENDING`. The
[ordinary reaction discipline](./semantics.md#decisions-that-must-not-race) is
to keep race-sensitive decisions in concept actions and treat all matching
answer paths as live alternatives.

## Failures between action asks

Action faults and faults while forming a consequence have an action ask to
mark. The engine records the fault, and the standard boundary reaction can
attempt to answer an unanswered root request with `INTERNAL_ERROR`. If the
request already has an answer, the boundary refuses the second answer with
`NOT_PENDING`; the client keeps the first answer.

A query, view, computation, or other `where` operation can instead fail while
the engine is deciding whether a reaction matches. The runtime logs
the reaction context and exception class, then drops the affected reaction
evaluation. Ordinary logs omit the exception message, stack, cause, and
attached fields. The failure does not create a fault occurrence or invoke the
standard boundary reaction. If no other reaction answers the outside request,
a waiting invoker may time out.

This behavior is a runtime limit, not a recommended error channel. Concepts
should own expected rejection as registered refusals, and authored policy
should make expected alternatives explicit.

## Cancellation

An invocation whose signal is already aborted when invocation begins does not
reach the gateway and is not forwarded. While the outside request is pending,
aborting marks the invocation to resolve with `ABORTED`; it does not guarantee a
prompt return. The signal is not forwarded to the application, so abort does
not cancel, prevent, or roll back work that is forwarded or still waiting to be
forwarded.

Timeout and abort end the boundary's pending wait. Neither path records a
`RequestBoundary.respond` occurrence, so a request already recorded in the
application remains unanswered.

## Logs, concept implementations, and restart

An assembly receives concept implementations and any storage they use. Concept
state remains separate from the assembly's occurrence log.

Within one assembly, the engine sends append-only invocation, outcome, fault,
and firing entries to its `LogStore`. The store folds those entries into
indexes used for matching and inspection. Retention may evict entries from the
indexes, so no assembly promises to retain every entry forever.

Before the engine sends entries to any `LogStore`, it applies the configured
field-name redaction policy to stored inputs, outputs, outcomes, and firing
bindings. Observer events and `inspectAssembly(...)` occurrence summaries use
the same redacted mappings. This also covers entries sent to `MemoryStore`,
`FileStore`, or a custom store. `FileStore` applies the policy again when it
builds its JSONL projection. The policy matches field names; it does not scan
arbitrary string values stored under unmatched names.

While a causal flow is active, the interpreter keeps original action inputs,
outputs, and outcomes in a private runtime map for execution and reaction
matching. It clears that flow's values when the outermost action settles. The
mapping returned directly to an action's caller remains original. The private
runtime mappings themselves are not attached to occurrence records or observer
events. A fault occurrence
stores a recognized framework error code, or `UNKNOWN_ERROR`; ordinary process
logs keep the fixed log message, available action or reaction identifiers, the
action id when available, the error class, level, and timestamp. They omit
exception messages, stacks, causes, and attached fields.

Ordinary `assemble(...)` uses a process-local `MemoryStore` for its occurrence
log and does not accept another log store. Advanced callers may pass a
`FileStore` or custom `LogStore` to `createEngine(store?)`. `FileStore` appends
entries to a JSONL file; retention trims its in-memory fold without rewriting
that file.

`PersistingConcept` has a separate responsibility. It keeps a subject registry
for application-supplied `LogStore` instances. `bind`, `release`, and its query
manage the registry; `prune` delegates to the bound store. The recorded policy
is registry data and is not applied by the concept. Registry entries neither
bind concept state nor install an occurrence-log store in an assembly. See the
[`assembly`](./public-surface.md#assembly) and
[`advanced`](./public-surface.md#advanced) public package subpaths.

An application may give its concept implementations durable storage while
leaving its occurrence logs in memory. Persisting one does not persist the
other.

The shipped engine does not load a prior occurrence file into a new engine,
rebuild concept state from occurrences, resume interrupted reactions, restore
pending outside requests, or replay firings. A JSONL occurrence file is an
append-only occurrence record, not restart recovery. Replay-derived state,
as-of reads, and restart recovery require a deeper consistency model that the
runtime does not implement.

## Boundary operations

In production, the HTTP floor rejects a public origin that is not HTTPS. The
floor does not provide TLS termination, HSTS, or trusted-proxy handling; the
deployment must supply them.

Generated wire contracts check TypeScript callers. The gateway does not
validate a returned value against the generated output type at runtime, and it
does not derive a runtime validator from a concept specification.
