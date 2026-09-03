# Decomposition

Write a compact decision index with `## Need placement`, `## Concepts`, and `## Obligations`. Add `## Open decisions` only when product choices remain unresolved. Omit signatures, algorithms, storage, evidence plans, catalog censuses, and brief restatements.

## Place changed needs

Give each changed need one owner and name the decision:

- **concept** — semantic state, lifecycle, and sole authority;
- **composition** — cross-concept policy and coordination;
- **host** — protocol projection;
- **implementation** — operational realization; or
- **evidence** — proof.

Placement does not create a concept. Reuse an approved contract when it already owns the need.

## Choose minimum useful concepts

A concept owns one reusable mechanism and one independent reason for state to change. Keep foreign subjects opaque; concepts never inspect or call peers.

Give each new or changed concept one row covering:

- owned state, lifecycle, and sole decision;
- the opaque subject and realistic reuse boundary; and
- the strongest plausible split or merge concern.

Split independently meaningful authorities or lifecycles. Merge a namespace for another owner's records, a status marker whose only meaning is suppressing those records, a retry-only ledger, or coordination without its own product lifecycle. Shared identity, workflow order, desired atomicity, implementation convenience, or fewer obligations does not justify a merge. Conversely, theoretical reuse alone does not justify a concept whose state has no meaning apart from its neighbor.

Classify concepts as `new`, `changed`, `reused-unchanged`, or `unaffected-context`. Record catalog disposition only for selected concepts and reference unchanged contracts instead of restating them.

## Record only material obligations

Add an obligation when a required effect crosses owners and failure can leave caller-visible contradictory state, when the effect must finish before acknowledgement, or when recovery is an explicit product guarantee. Synchronous calls are not atomic, but they do not need a recovery protocol when the accepted semantics simply refuse the request before acknowledgement.

For each material obligation, record:

- trigger and effect owner;
- acknowledgement boundary and possible false interval;
- retry identity when retries are promised; and
- available recovery, compensation, or explicit operational limit.

Choose a realizable server-side success boundary. Do not invent a two-phase concept or promise exactly-once client receipt to model transport-delivery uncertainty. State what the application counts or guarantees before acknowledgement and stop there.
