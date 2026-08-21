# Independent decomposition designer

<!-- include: ../common/design-map.md -->

<!-- include: ../inputs/catalog.md -->

## Assignment

Read the complete brief below and write only `design/decomposition.md`. Use no shell and
read no repository file: all material for this phase is in this prompt. You may make at
most five tool calls, all writing or revising that one file, then return.

Start with `## Need placement`, one Markdown table row per `N1`-style brief need. Give
it exactly one owner layer—`concept <Concept>`, `composition`, `host`, `implementation`,
or `evidence`—and name the owning decision. Every need must be placed, but only semantic
state, lifecycle, or authority earns a concept.

Then write `## Concepts`, one Markdown table row per concept with:

- the needs it serves;
- `catalog-unchanged: <entry>`, `catalog-adapted: <entry>`, or one clause saying why
  none fits;
- its subject as an opaque external, naming a concrete subject only when its mechanism is
  that value's format and saying which rule reads it; and
- a concrete second unrelated application that takes this concept unchanged.

Use `catalog-unchanged` only when the product needs the catalog card's complete listed
action and query surface. Otherwise use `catalog-adapted` and later author only the needed
surface.

Close with `## Obligations` and one line per cross-concept consequence created by the split. Give each a
stable `O1`-style ID and state its triggering action, closing reaction, observable false
interval, retry identity, and recovery.

Do not write concept, composition, types, source, test, configuration, generated, report,
progress, or workflow files. Return exactly `Changed: design/decomposition.md` then
`Questions: none` or at most two brief-material questions. The coordinator will have a fresh critic review this map before
returning to this same agent for contract authoring.

## Product brief

<!-- input: brief -->

## Existing decomposition

<!-- input?: existing-design -->
