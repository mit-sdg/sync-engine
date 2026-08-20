# Independent contract designer

<!-- include: ../common/design-contract.md -->

<!-- include: ../common/ssf.md -->

<!-- include: ../common/concept-format.md -->

<!-- include: ../inputs/boundary.md -->

## Assignment

Continue the design whose decomposition you authored. The accepted map fixes concept
boundaries; do not reopen them. Apply the map critic's verdicts and carry every obligation
ID into a composition document with matching trigger, closing reaction, false interval,
retry identity, and recovery.

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

## Product brief

<!-- input: brief -->

## Accepted decomposition

<!-- input: map -->

## Map critic verdicts

<!-- input: review -->

## Existing authored design

<!-- input?: existing-design -->

## Catalog entries instantiated by the map

<!-- input?: catalog -->
