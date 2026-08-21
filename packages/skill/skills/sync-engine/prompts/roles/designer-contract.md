# Independent contract designer

<!-- include: ../common/design-contract.md -->

<!-- include: ../common/ssf.md -->

<!-- include: ../common/concept-format.md -->

<!-- include: ../inputs/boundary.md -->

## Assignment

Continue the design from the context below. Normally you are the map designer and the
compiler hash-binds retained brief, map, and review bytes. Under direct user override the
compiler expands those bytes and a fresh designer may continue supplied work. The map
fixes concept boundaries; do not reopen them. Carry every
obligation ID into a composition document with matching trigger, closing reaction, false
interval, retry identity, and recovery.

Write only:

- `design/concepts/<Concept>.md` for reusable concept contracts;
- `design/compositions/*.md` for application decisions and exact `reaction:`, `view:`,
  `former:`, and `computation:` links; and
- `design/types.md` for application concretes, the complete `instances` inventory, and
  external bindings.

Do not change `design/decomposition.md`. Create no index, application memo, report,
progress file, workflow metadata, source, test, configuration, dependency, or generated
file.

Run only this syntax command, at most three times total:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md \
  design/compositions/*.md design/types.md
```

After one informed repair, if the same diagnostic signature recurs, stop and report it.
Return exactly `Changed:` with path bullets, `Check:` with the command outcome, and
`Blocker: none` or one material blocker. Use at most twenty tool calls.

## Design context

<!-- bind: brief -->

<!-- bind: map -->

<!-- bind?: review -->

## Existing authored design

<!-- input?: existing-design -->

## Exact catalog contracts

Only `catalog-unchanged` entries appear below. Preserve their complete mechanism and
surface. For `catalog-adapted` rows, use the operation inventory retained from the map
phase and author only the actions and queries this product needs; do not import generic
cancellation, clearing, replacement, or revocation symmetry merely because the catalog
mechanism offers it.

<!-- input?: catalog -->
