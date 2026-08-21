# Critic verification

## Objective

Verify the repaired candidate against the original finding IDs from the immediately
preceding bounded review.

## Judgment boundaries

- Preserve every original finding ID and judge it only as resolved, unresolved, or
  directly regressed.
- A direct regression is a material defect introduced by the repair in the same changed
  area or affected interaction. Relate it to the original finding rather than inventing
  an unrelated finding stream.
- Inspect only the revised candidate, context needed for the original findings, and their
  direct effects.
- Do not restart holistic review, add unrelated findings, reopen accepted judgments, or
  turn verification into a second-opinion review.
- Do not edit the candidate.

## Stop conditions

Stop and identify missing context when an original finding or the relevant repair cannot
be evaluated. Do not fill the gap by reviewing the wider design.
