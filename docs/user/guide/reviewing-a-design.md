# Review an application design

Use this procedure before accepting a config-based version-1 application design.
Review semantic boundaries first, then strict authored contracts and complete
link coverage, then runtime failure behavior. Generated read-back is evidence of
what the selected assembly contains; it does not replace authored intent or
behavior tests.

## 1. Fix the review scope

Start from one generated config. Record the exact assembly variant, configured
application document URLs, and every application `types` fence. Review another
variant from its own config. Do not infer a union of runtime options.

Confirm that every URL is an explicit local `file:` URL. Design files may live
anywhere in the checkout; matching source and design directory structures are
not a criterion. Ignore unregistered introductions, history, and unresolved
notes unless the config selects them.

## 2. Review each concept boundary

Stop at the first failed semantic criterion; syntax cannot repair a wrong
boundary.

| Criterion         | Evidence                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Purpose           | Names one useful capability and what would be lost without it; the concept can fulfill it alone.           |
| Principle         | Demonstrates that purpose using only the concept's own actions and queries.                                |
| Independence      | Does not depend on peer APIs or facts and treats external identities as opaque.                            |
| State sufficiency | Preconditions, results, and effects follow from owned state, input, or an explicit environment dependency. |
| Ownership         | Every durable fact has one authority; copies state their update, staleness, and repair rules.              |
| Actions           | Name semantic transitions, preserve local invariants, and declare expected refusals.                       |
| Lifecycle         | Covers applicable creation, use, completion, expiry, reversal, retention, deletion, or permanence.         |
| Durability        | Required race and idempotency guarantees have storage-level enforcement.                                   |

Trace each purpose commitment to the principle, State, actions, queries, and
refusals. Trace every owned fact and member back to a purpose commitment. A
reaction needed only to reconstruct one owner operation is evidence that the
concept was split incorrectly.

## 3. Validate the strict concept contract

For every selected concept specification, verify:

- one H1 names the reusable definition rather than an application instance;
- Purpose, Principle, Types, State, Actions, and Queries occur exactly once and
  in that order, with no subordinate headings;
- Purpose and Principle are unfenced prose, and Principle is one concrete
  scenario rather than a container for reference material;
- Types contains only one `types` fence of explicit `external` declarations;
  concept-owned and conventional names do not need local declarations;
- State contains one raw `state` fence and no claim that version 1 parses SSF;
- Actions contains at least one action, explicit `where`/`then` branches, and
  exactly one terminal return or refusal per branch;
- action and query results use parenthesized named fields;
- query bodies use prose only when State and the signature are insufficient;
- concept files contain no application typed links or computations; and
- each refusal sentence states the same rule as its branch condition.

If two selected registrations claim the same definition name, compare their
canonical specifications. They must be identical even when implementation
classes or floors differ.

Run the config check and inspect any failed-closed TypeScript shape diagnostic.
Do not waive unresolved input, action-result, or query-row shapes as if the
checker had established agreement. Remember that type-name equivalence and
State/storage agreement are not proven.

## 4. Review application type closure

When a selected concept has an external type, require one direct binding in a
`types` fence in the registered application documents. Inventory every left side as `ConceptInstance.ExternalType` and check
that it is bound exactly once.

For every `is` binding, verify that the right side directly names either:

- an application `concrete` type with a nonempty prose definition; or
- a type owned by a selected concept instance.

Reject bindings to external parameters, chains, cycles, duplicate or missing
bindings, unresolved names, and unused concrete declarations. Several external
parameters may resolve to the same target.

Because SSF is deferred, treat a qualified owned-type target as checked only up
to the selected concept instance. Review the intended state ownership manually;
do not claim that tooling proved the final type name occurs in State.

## 5. Review application prose and coverage

Read registered prose as prose, not as a generated inventory. It may use any
heading layout and may explain declarations from several source modules. Check
that each passage states an application decision and places exact links beside
the claims they support.

Build a bidirectional coverage table for the selected assembly:

| Declaration                        | Required evidence                                               |
| ---------------------------------- | --------------------------------------------------------------- |
| Authored reaction or endpoint tree | At least one exact `reaction:` link to its selected dotted path |
| Named view                         | At least one exact `view:` link                                 |
| Named former                       | At least one exact `former:` link                               |
| Executable computation             | Exactly one `computations` declaration                          |

Resolve every typed link. Reject wildcards, namespace-only claims, implied
children, wrong link kinds, and references to declarations absent from this
variant. Retain multiple honest references; there is no primary marker.

Review every named view and former, including helpers. For reactions and
endpoints, version 1 covers the top-level authored tree, not each lowered stage
or branch. Confirm that core-generated boundary and outcome reactions, rather
than missing authored declarations, account for any exemption.

## 6. Review identity and installation

Check each authored dotted path segment for the allowed identifier grammar.
Confirm that one declaration object is not installed under multiple composition
paths. Reusing a view or former by import is valid; reinstalling or re-exporting
it under another path is not.

Compare source locations in generated read-back with the prose passages that
claim coverage. A link proves only that a declaration was cited. Reviewers must
still decide whether the prose describes it honestly.

## 7. Review computations

Search all registered application documents, including dedicated type documents, for
`computations` fences. Confirm that every executable computation has exactly one
nonempty prose declaration and every authored declaration resolves to one
executable computation. Compare executable input names and optionality.

Do not infer TypeScript-equivalent semantic types, body correctness, or runtime
validation from this check. Optional `computation:` links elsewhere must resolve
but do not replace the sole definition.

## 8. Trace runtime scenarios

For each representative scenario, follow every matching rule and record state
after each failure:

| Scenario                 | Review question                                                              |
| ------------------------ | ---------------------------------------------------------------------------- |
| Ordinary success         | Does the selected design deliver its purpose?                                |
| Expected refusal         | Is the code stable, and is partial state ruled out or explicitly documented? |
| Unauthorized request     | Which authenticated fact, owner, and enforcement point produce denial?       |
| Duplicate or retry       | Is repetition meaningful, refused, or durably deduplicated?                  |
| Concurrent actions       | Which decisions race, and where does storage coordinate them?                |
| Partial chain or fan-out | Which effects remain, and what repairs them?                                 |
| Timeout or abort         | Which accepted work continues after the caller stops waiting?                |
| Process interruption     | Which concept-owned state supports recovery?                                 |

A composition read can provide an early denial, but a security-critical rule
must remain in the owner action so direct calls cannot bypass it. Do not describe
a multi-action path as atomic unless one owner and transaction establish that
property.

## 9. Verify provenance and migration state

Run:

```sh
sync-engine check
sync-engine artifacts check
```

Confirm that `check` used `generated.config.ts` or the intended explicit
`--config`, and that no script still uses `--vocabulary-module`. Review source
links, one-based lines, all design references, and changed input digests.

Reject a mixed migration. Version 1 has no legacy concept parser, automatic
format detection, compatibility flag, old manifest decoder, or runtime
composition or application-type Markdown import path. All old artifacts must be
regenerated together.
