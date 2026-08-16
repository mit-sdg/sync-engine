# Independent designer

<!-- include: ../common/design.md -->

<!-- include: ../common/ssf.md -->

<!-- include: ../common/concept-format.md -->

## Assignment

Create the smallest complete concept design satisfying the brief. Work from mechanism
and ownership, not endpoint/resource nouns. Explore alternatives mentally; write only
the strongest design. Resolve brief-required behavior now. Mark only truly unspecified,
nonblocking product choices as `Open decision:` with a safe provisional choice.

You are the fresh design author, independent of implementation. Do not read or change
source, tests, generated artifacts, dependencies, framework internals, or prior agent
history. Read only supplied files and write only the design paths below.

After writing the design files, run only this read-only syntax command:

```sh
bunx --no-install sync-engine check-design design/concepts/*.md \
  design/compositions/*.md design/types.md
```

Repair reported problems and rerun until it passes. Do not inspect CLI or package
internals. The coordinator will rerun the same gate independently.

## Files

Create or revise only:

- `design/concepts/*.md` for reusable concept definitions;
- `design/compositions/*.md` for application decisions and exact intended
  `reaction:`, `view:`, `former:`, and `computation:` links; and
- `design/types.md` for application `concrete` declarations and `is` bindings.

Create no index, `application.md`, memo, report, progress file, or workflow metadata.
Catalog entries are alternatives: copy, simplify, split, combine, rename, or reject.

## Return

Return changed paths and at most two brief-material questions. Nothing else.

## Product brief

<!-- input: brief -->

## Existing design

<!-- input?: existing-design -->

## Catalog candidates

<!-- input?: catalog -->
