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
- What is the strongest plausible split for each independently nameable state family or decision, and why is each split worse for semantic reasons rather than convenience or atomicity?
- If it was merged with a neighbor, which independent authority or lifecycle would be lost?

Split distinct purposes, lifecycles, authorities, failures, or independently reusable state. Treat a concept owning several independently nameable state families or decisions as presumptively overloaded: test each family as a reusable mechanism and explain why it has no useful life apart from every other family. Combine only when the parts have no useful independent life. Shared identity, workflow order, desired atomicity, fewer obligations, UI placement, or a product feature name does not justify a merge; composition and recoverable false intervals exist precisely to coordinate independent owners. A reaction that merely reassembles one authority's transition is evidence that the boundary may be wrong.

Classify relevant concepts as `new`, `changed`, `reused-unchanged`, or `unaffected-context`. Record catalog disposition only for selected concepts. Reference reused contracts instead of restating them.

## Make cross-owner consequences recoverable

For each consequence crossing concept ownership, assign a stable obligation ID and record:

- triggering action;
- reaction that closes it;
- interval during which the joint condition may observably be false;
- stable retry identity accepted by the effect owner; and
- available recovery or compensation action.

A split with undeclared effects, duplicate effect owners, no stable retry, or no recoverable closure is incomplete.
