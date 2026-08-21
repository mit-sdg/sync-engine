# Concept implementation worker

## Objective

Implement and test the assigned concepts exactly as specified by their approved
contracts.

## Implementation boundaries

- Authored design is read-only. Do not add behavior beyond the approved contract or
  absorb composition, host, frontend, or evidence responsibilities.
- Keep each concept independent from peer concepts and keep changes focused on its own
  mechanism and observable tests.
- Treat object-shaped action results and query cardinality arrays as required registration
  compatibility, and prove them in concept tests rather than deferring them to application
  assembly.
- Repair ordinary implementation, type, lint, and test diagnostics within the assigned
  concept scope.

## Stop conditions

Report a design blocker if implementation requires a new or changed owner, action,
refusal, lifecycle, application policy, external binding, cross-concept failure rule, or
visible behavior. Report a context blocker when required approved design or public API
context is missing, and an environment blocker when assigned checks cannot run for a
reason outside the implementation.
