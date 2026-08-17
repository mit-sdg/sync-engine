# Review an application design

Use this procedure to decide whether application Markdown is ready to implement and,
after implementation, whether the selected assembly still realizes it. Review useful
capabilities and ownership before syntax or link coverage. A parser can reject an
invalid contract; it cannot turn the wrong concept boundary into a good one.

## 1. Fix the product and document scope

Write down the current objective, settled product decisions, visible success,
expected refusals, and explicit non-goals. Review only behavior needed by that scope.
A plausible future feature is not evidence for adding state or actions now. Reject
unnecessary behavior or complexity that does not serve the objective.

For a new application, expect this authoring layout:

```text
design/concepts/*.md
design/compositions/*.md
design/types.md
```

Inventory every Markdown file in those locations. Conventionally, one composition
document corresponds to one `src/compositions/*.ts` module with the same application
responsibility. This is an authoring and review recommendation, not a checker
restriction: an established application may register another local layout or map
prose to source differently when the mapping remains explicit.

For an implemented variant, also record its one generated config and the exact
assembly selection. Do not infer a union of alternatives from several configs.
Only explicit local `file:` URLs participate in checker coverage.

## 2. Test every proposed concept as a useful capability

A concept is not justified merely because it matches an entity, table, class, package,
service, endpoint, or screen. Ask what useful capability would be lost if the concept
did not exist and whether the concept owns a complete mechanism without depending on a
peer.

| Criterion          | Evidence required                                                                                                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Purpose            | Names one useful capability and the loss or failure it prevents, without listing methods                                    |
| Principle          | Uses concise archetypal scenarios with enough setup and occurrences to demonstrate how the mechanism fulfills its purpose   |
| Independence       | State and Actions name no peer API or peer-owned fact; external identities stay opaque and Principle marks external context |
| Completeness       | Can perform its own meaningful lifecycle rather than relying on reactions to reconstruct one owner operation                |
| Restraint          | Contains no behavior, customization, or lifecycle state outside the current objective                                       |
| Change containment | A likely change to this mechanism touches this concept while an unrelated change does not                                   |

Trace each purpose commitment into Principle, State, actions, queries, and refusals.
Trace every state member and action back to the purpose. Reject a broad noun owner
when independent mechanisms merely share its identity. Also reject a split when
neither half has a useful principle or one local invariant would become two
independently failing actions.

Compare relevant catalog entries as alternatives, not templates. An application may
copy, simplify, split, combine, rename, or reject a catalog design. Similar names do
not require similar contracts.

## 3. Find peer leakage and duplicate authority

A concept never calls or imports a peer concept. It may retain an opaque identity that
another concept also uses, but it must not interpret the identity or copy the peer's
facts into its own contract.

For every durable fact, name one semantic owner. When another concept retains a copy,
require the design to state which copy is authoritative, how updates arrive, permitted
staleness, divergence detection, and repair. Distinguish a cache from an intentional
historical snapshot.

Check every precondition, result, and effect against the concept's state and action
input. A missing fact must be handled by one of these explicit choices:

1. the concept owns and stores it;
2. the caller supplies it;
3. an environmental capability supplies it;
4. the behavior moves to the fact's owner; or
5. non-critical application policy moves to composition.

The fifth choice permits a read-then-act window. Race-sensitive or security-critical
rules must remain in the action that owns the changed state.

## 4. Review actions, refusals, and lifecycle

Actions name semantic transitions rather than generic writes such as `setStatus` or
`updateRecord`. Local invariants and atomic decisions stay in the owner action. Queries
have no side effects, and their `one`, `optional`, or `many` cardinality states a real
domain promise.

For each action, review:

- every accepted branch and expected refusal;
- state after each refusal, including any deliberate recorded attempt;
- repeated calls and retries;
- concurrent calls that can contend for one fact;
- required storage constraints or transactions;
- reversal versus compensation versus deletion; and
- the returned identities and facts needed by callers.

Then cover every applicable lifecycle stage: creation, use, completion, expiry,
reversal, retention, deletion, or deliberate permanence. Do not demand CRUD symmetry
when the mechanism has no corresponding transition. Do demand an explicit decision
when the objective makes a stage visible.

## 5. Apply reaction pressure to the boundaries

List the reactions needed to make the proposed concepts useful together. A few rules
that state independent application decisions support the decomposition. Repeated
one-to-one pass-through, broad mirroring, or a reaction required after nearly every
action suggests an artificial split, a missing semantic action, or an explicit
external-system adapter.

Composition owns application workflow, cross-concept policy, authorization
observations, notifications, adaptation, and intentional repair. It does not own a
concept's local invariant, direct storage mutation, or a race-sensitive decision over
one owner's state.

For every cross-concept relation, record the owners, the event that can make the
relation false, the repair rule, the permitted false interval, the result of repair
refusal or fault, and whether repair is automatic. If no false interval is acceptable,
combine ownership or use one storage transaction that can enforce both facts.

Inspect host and user-interface policy explicitly. Command arguments, filesystem loading,
clock reads, process holds, and network exchange are strong concept candidates when
they have observable choices, state, lifecycle, or expected failure. Application
command grammar and interface policy belong in composition, not in a generic host
concept. A direct inert adapter is permitted when it introduces none of those
semantics; do not manufacture a pass-through concept solely to wrap an API call.

## 6. Check instances, application types, and external identities

Compare the configured corpus with the exact assembled variant. Require one globally
unique authored declaration for every selected application instance and no others;
the specification H1 must match the authored definition. Do not require the core-owned
`RequestBoundary`. Review each config independently rather than accepting a union of
possible variants.

Inventory every `ConceptInstance.ExternalType` and require one direct binding. An
instance supplies all bindings inline in its `instances` declaration or all through
detached `bindings` fences. Reject a split between placements, repeated bindings even
when equal, unknown or missing externals, and bindings on undeclared instances. An
instance with no external parameters has no placement mode.

A right side must directly name either:

- an application `concrete` type with a nonempty prose definition; or
- a type the bounded SSF parser proves is owned by another declared, selected
  instance's definition.

Reject external-to-external targets, alias chains, unresolved names, and unused
concrete declarations. Do not reject a cycle merely because instance A targets an
owned type of B while B targets an owned type of A: direct qualified targets resolve
independently and such dependency cycles are valid. A binding establishes identity
correspondence, not transferred ownership, runtime validation, general TypeScript
assignability, adapter configuration, or durable storage isolation.

## 7. Review each composition document beside its source responsibility

A composition document should explain application decisions, not repeat a generated
inventory. Place each exact typed link next to the decision it realizes. Under the
recommended pairing, compare `design/compositions/<name>.md` with
`src/compositions/<name>.ts`; helper modules may remain unpaired when they introduce no
independent application decision.

Build this bidirectional coverage table for an implemented assembly:

| Executable declaration             | Authored evidence                                               |
| ---------------------------------- | --------------------------------------------------------------- |
| Authored reaction or endpoint tree | At least one exact `reaction:` link to its selected dotted path |
| Named view                         | At least one exact `view:` link                                 |
| Named former                       | At least one exact `former:` link                               |
| Executable computation             | Exactly one `computations` declaration                          |

Reject wildcards, namespace-only claims, implied children, wrong link kinds, and links
to declarations absent from the selected variant. Retain multiple honest references;
there is no primary marker. A resolved link proves identity and coverage, not the
truth of surrounding prose.

Review authorization as an application decision. For each protected effect identify
the requesting actor, authenticated identity, resource, owner of each consulted fact,
condition, and enforcement point. A request-body identifier is a claim, not
authentication. Composition may provide early policy denial, but an owner action must
still enforce any rule that direct calls cannot bypass.

## 8. Validate the preassembly forms

Before implementation, parse the explicit design corpus without loading application
code or configuration:

```sh
sync-engine check-design design/concepts/*.md design/compositions/*.md design/types.md
```

This command checks strict concept syntax and the form of composition links,
computations, concrete types, instances, and bindings. It deliberately leaves
resolution and coverage for config-based `sync-engine check` because the supplied corpus can be partial.

For every concept, also verify manually that:

- one H1 names the reusable definition rather than an application instance;
- Purpose, Principle, Types, State, Actions, and Queries occur exactly once, in that
  order, with no subordinate headings;
- Purpose and Principle are unfenced prose, and Principle uses one or more concise
  archetypal scenarios rather than becoming a complete specification or a container
  for reference material;
- Types contains one `types` fence with only explicit `external` declarations;
  concept-owned and conventional names do not need local declarations;
- State contains one `state` fence and follows SSF declaration, identity, type,
  multiplicity, naming, and indentation rules; `check-design` parses the bounded
  structural declarations and inventories owned names, while invariant sentences
  and other admitted prose remain a manual semantic review;
- every action has explicit `where`/`then` branches and one terminal return or refusal
  per branch;
- action results and query rows use parenthesized named fields;
- every query has indented prose stating what it answers, its unknown or empty case,
  and deterministic ordering for `many`;
- concept files contain no application links or computations; and
- each refusal sentence states the same rule as its branch condition.

Parser success establishes grammar only. Purpose, ownership, lifecycle, prose
conditions, and State meaning remain review obligations.

## 9. Verify the implemented variant

After registration and composition exist, run:

```sh
sync-engine check
sync-engine artifacts check
```

Inspect failed-closed TypeScript shape diagnostics; do not waive unresolved input,
action-result, or query-row shapes. Confirm definition-name duplicates have identical
canonical specifications, the authored instance inventory exactly matches the
assembled variant, every selected external type is bound in one placement, every
typed link resolves, every executable computation has one declaration, and generated
source locations point to the prose that honestly covers each declaration.

Generated read-back is evidence of the selected assembly, not a replacement for
Markdown or behavior tests. Registration does not prove semantic type equivalence,
State/storage agreement, invariant or natural-language effects, persistence,
transactions, or durability. Distinct instance declarations do not prove that their
implementations use separate collections, schemas, files, caches, or remote
resources.

## 10. Trace objective-driven scenarios

Finish with scenarios that can disprove the design:

| Scenario                 | Review question                                                         |
| ------------------------ | ----------------------------------------------------------------------- |
| Ordinary success         | Does the selected design deliver the stated purpose?                    |
| Expected refusal         | Is the code stable, and is partial state absent or explicitly recorded? |
| Unauthorized request     | Which authenticated fact, owner, and enforcement point deny it?         |
| Duplicate or retry       | Is repetition meaningful, refused, or durably deduplicated?             |
| Concurrent actions       | Which decisions race, and where does storage coordinate them?           |
| Partial chain or fan-out | Which effects remain, and what repairs or compensates them?             |
| Timeout or abort         | Which accepted work continues after the caller stops waiting?           |
| Process interruption     | Which concept-owned state supports cleanup or recovery?                 |

Do not describe a multi-action path as atomic unless one owner and transaction
establish that property. The engine does not detect reaction cycles, roll back prior
actions, cancel accepted work, or provide exactly-once execution; use the
[execution semantics](../reference/semantics.md) and
[operational limits](../reference/operations.md) when those assumptions matter.
