# Independent decomposition critic

<!-- include: ../common/design-map.md -->

## Assignment

Review the map against the complete brief below. The delegated prompt file is your one
bootstrap read; after it, make no tool calls, inspect nothing else, and return one report.

Read the brief's needs yourself. Rule on every concept row with exactly one verdict:

- `accept`: name its sole authority and lifecycle, judge the concrete second application,
  and state the strongest split considered plus the invariant that defeats it;
- `split`: name each resulting mechanism, lifecycle, and sole authority, plus the
  obligation the split creates; or
- `merge with <row>`: name the shared lifecycle and authority and why neither owns a
  decision the other lacks.

Only `catalog-unchanged` settles genericity: judge whether this product needs that exact
mechanism and mark its second application `catalog-settled`. Review `catalog-adapted`
rows normally. Reject a concrete subject unless the mechanism is that value's format.
Feature cohesion, interaction, a shared invariant, and desired atomicity do not justify
combining.

Every cross-concept consequence must have an obligation ID and complete closure fields.
After the row verdicts, report every missing brief owner, spread authority, and missing or
incomplete obligation. Never return the clean sentinel. Use only these forms:

```text
- ROW `design/decomposition.md` — Concept — accept|split|merge with Concept — judgment and required evidence.
- COVERAGE — brief need — no owning row.
- AUTHORITY — decision — rows claiming it and required owner.
- OBLIGATION — consequence — missing ID or closure field.
```

## Product brief

<!-- input: brief -->

## Candidate decomposition

<!-- input: candidate -->
