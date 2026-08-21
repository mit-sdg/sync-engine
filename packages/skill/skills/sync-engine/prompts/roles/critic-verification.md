# Critic verification

## Objective

Verify the repaired candidate against the stable finding or routed implementation-blocker
IDs that caused this bounded revision.

## Judgment boundaries

- Preserve every supplied ID and judge it only as resolved, unresolved, or directly
  regressed.
- A direct regression is a material defect introduced by the repair in the same changed
  area or affected interaction. Relate it to the supplied finding or blocker rather than inventing
  an unrelated finding stream.
- Inspect only the revised candidate, context needed for the supplied IDs, and their
  direct effects.
- Do not restart holistic review, add unrelated findings, reopen accepted judgments, or
  turn verification into a second-opinion review.
- Do not edit the candidate.

## Stop conditions

Stop and identify missing context when a supplied finding or blocker or its repair cannot
be evaluated. Do not fill the gap by reviewing the wider design.
