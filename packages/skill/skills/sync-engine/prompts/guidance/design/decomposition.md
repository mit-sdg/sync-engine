# Decomposition

Write a compact decision index with `## Need placement`, `## Concepts`, and
`## Obligations`. Add `## Open decisions` only when product choices remain unresolved.
Omit signatures, algorithms, storage, evidence plans, catalog censuses, and brief
restatements.

Give each changed need one row with one owner and the decision it owns:

- **concept** — semantic state, lifecycle, and sole authority;
- **composition** — cross-concept policy and coordination;
- **host** — protocol projection;
- **implementation** — operational realization; or
- **evidence** — proof.

Placement does not create a concept. Reuse an approved contract when it already owns the
need.

Give each new or changed concept one row naming its owned state, lifecycle, sole decision,
opaque subject, realistic reuse boundary, and strongest plausible split or merge concern.
Split independent authorities or lifecycles. Merge state that has no product meaning apart
from its nearest owner. Shared identity, workflow order, atomicity, implementation
convenience, fewer obligations, or theoretical reuse alone does not decide a boundary.

Classify each concept as `new`, `changed`, `reused-unchanged`, or `unaffected-context`.
Record catalog disposition only for selected concepts; reference unchanged contracts.

Add one row for each material cross-owner obligation when failure can expose contradictory
state, work must finish before acknowledgement, or recovery is promised. Name the trigger,
effect owner, acknowledgement boundary, possible false interval, retry identity when
retries are promised, and recovery, compensation, or operational limit. Do not add a
recovery protocol when refusal before acknowledgement is the accepted semantics. Choose a
realizable server-side success boundary rather than exactly-once client receipt.

A compact decomposition looks like this:

```markdown
## Need placement

- Prevent overlapping loans — concept: Lending owns item availability.
- Notify a borrower — composition: connect accepted loans to Notifying.

## Concepts

- Lending (`new`) — loans and return lifecycle; decides item availability; Borrower and Item stay opaque; reusable for equipment; strongest split concern is reservation versus active loan.
- Notifying (`reused-unchanged`) — reuse `design/concepts/Notifying.md`.
- Cataloging (`unaffected-context`) — still owns item descriptions.

## Obligations

- Loan notice — after `Lending.checkout`, Notifying sends before success; a send failure leaves the loan active but unacknowledged; retry by loan; retry is the operational recovery limit.
```
