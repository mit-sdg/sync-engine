# Decomposition guidance

Use exactly three canonical sections: `## Need placement`, `## Concepts`, and
`## Obligations`, plus a short `## Open decisions` section only when a material choice is
actually unresolved. Use compact tables throughout. Exact column details are advisory;
semantic completeness decides approval. This artifact is a decision index, not a
preliminary specification.

Group related user-visible needs. Use one row per affected concept and one row per genuine
cross-owner obligation. Keep each cell to one sentence. Do not add action signatures,
protocol or status mappings, algorithms, storage choices, evidence plans, per-concept
essays, a complete catalog census, or restatements of the brief. Catalog disposition
belongs only in rows for concepts actually selected. Commit to the smallest defensible
map; do not narrate alternatives.

## Need placement

Place each affected need before deciding concept boundaries. Give it one owner layer and
name the decision owned there:

- a **concept** owns semantic state, lifecycle, and sole authority;
- **composition** owns cross-concept policy, coordination, and recovery;
- the **host** owns protocol projection;
- **implementation** owns operational realization such as physical persistence; and
- **evidence** owns proof such as restart or failure scenarios.

Placement is ownership, not a reason to add a concept row. Reference existing approved
contracts when they already own a need instead of redescribing the application.

## Concepts

A concept owns one mechanism and one independent reason for state to change. Layout,
workflow, shared identity, endpoint nouns, and a product feature do not define a boundary.
Read concept needs from state, actions, lifecycles, authorities, and failures.

A concept is generic only when a second unrelated application can use it unchanged. Name
the mechanism rather than this product and keep every foreign subject opaque. Parsing,
validating, or constructing a value belongs to the concept whose mechanism is that
format, or outside the concept layer.

Concepts never call, import, or require peers. Split distinct purposes, lifecycles,
authorities, state, failures, or reuse. A part earns a concept by owning a lifecycle that
runs when siblings never fire or sole authority over a decision. Combine only when parts
are useless alone or reactions would merely reassemble one authority's transition. A
shared invariant or desired atomic commit never justifies combining.

Classify each relevant concept as `new`, `changed`, `reused-unchanged`, or
`unaffected-context`. For a new or changed concept, identify the needs served, catalog disposition, opaque
subject, sole authority, lifecycle, and one concrete unrelated second application in its
single compact row. For a reused-unchanged concept, name its approved contract rather than
restating it. Include unaffected-context only when an affected interaction cannot be
understood without it.

## Obligations

For every consequence that crosses concept ownership, assign a stable obligation ID and
record:

- the triggering action;
- the reaction that closes the obligation;
- the interval during which the joint condition may observably be false;
- the stable retry identity; and
- the recovery that eventually closes or compensates the obligation.

Keep an obligation's ID stable across revision. Composition must later realize the same
obligation. A split with an undeclared consequence or no recoverable closure is not
settled.
