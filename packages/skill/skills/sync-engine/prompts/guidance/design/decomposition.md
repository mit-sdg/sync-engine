# Decomposition

Use compact `## Need placement`, `## Concepts`, and `## Obligations` tables. Add `## Open decisions` only for unresolved product choices. This is a decision index: omit signatures, algorithms, storage, evidence plans, catalog censuses, and brief restatements.

## Place needs before drawing boundaries

Give each affected need one owner and name its decision:

- **concept** — semantic state, lifecycle, and sole authority;
- **composition** — cross-concept policy, coordination, and recovery;
- **host** — protocol projection;
- **implementation** — operational realization;
- **evidence** — proof.

Placement does not automatically create a concept. Reference an approved contract when it already owns the need.

## Test every concept boundary

A concept owns one reusable mechanism and one independent reason for state to change. Keep foreign subjects opaque; concepts never call or inspect peers.

For each new or changed concept, answer in one compact row:

- Which needs does it serve?
- What state and lifecycle does it alone own?
- Which decision is it the sole authority for?
- What foreign subject remains opaque?
- Could an unrelated application reuse the whole mechanism unchanged?
- What does the deletion test show for each independently nameable state family or decision?
- What is the strongest plausible split, and why is it worse for semantic reasons rather than convenience or atomicity?
- If this concept merged with its nearest neighbor, which independent authority or lifecycle would be lost? If none, why is it not needless fragmentation?

Split distinct purposes, lifecycles, authorities, failures, or independently reusable state. Apply a deletion test to every independently nameable state family: if removing it leaves the rest coherent and the removed family remains meaningful over an opaque subject, split it even when only composition triggers its changes. Treat a concept owning several such families as presumptively overloaded. Combine only when the parts have no useful independent life. Shared identity, workflow order, desired atomicity, fewer obligations, UI placement, or a product feature name does not justify a merge; composition and recoverable false intervals exist precisely to coordinate independent owners.

Also require every concept to pass a minimum-mechanism test: it owns a semantic lifecycle or decision meaningful apart from its neighbor. A namespace or index for another concept's primary records, a retry ledger introduced only to close an obligation, or coordination with no independent product lifecycle belongs with the owner or in composition. Prefer adapting an effect owner to accept a stable operation identity over inventing a helper concept solely for retry. A reaction that merely reassembles one authority's transition is evidence that the boundary may be wrong.

Classify relevant concepts as `new`, `changed`, `reused-unchanged`, or `unaffected-context`. Record catalog disposition only for selected concepts. Reference reused contracts instead of restating them.

## Make cross-owner consequences recoverable

For each consequence crossing concept ownership, assign a stable obligation ID and record:

- triggering action;
- reaction that closes it;
- interval during which the joint condition may observably be false;
- stable retry identity accepted by the effect owner; and
- available recovery or compensation action.

A split with undeclared effects, duplicate effect owners, no stable retry, or no recoverable closure is incomplete.
