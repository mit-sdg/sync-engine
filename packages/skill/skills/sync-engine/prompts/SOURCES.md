# Prompt compaction source map

This file records where the active workflow's normative content moved before the full
source documents were compacted. Prompt headings contain the retained rules; examples,
extended rationale, and repeated review procedures are intentionally not attached to
routine role prompts.

## Canon semantic review

The compact rules were checked against Canon `daniel` at
`d907e027e70158d78d564b1a0fa961c06b1f76d3`.

| Canon source                                                                                                                                        | Destination                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `background/behavior-description-generally.md`; `background/behavior-structuring-with-concepts.md`; `background/concept-as-behavior-and-service.md` | `common/design.md#useful-independent-concepts`; `#state-and-ownership`; `#actions-and-lifecycle`                       |
| `background/concept-design-method.md`; `background/Negative purposes.md`                                                                            | purpose, boundaries, restraint, and coordination under common design rules                                             |
| `background/concept-specifications.md`; `background/concept-design-rubric.md`                                                                       | purpose and Principle under useful independent concepts; state and action rules                                        |
| `background/concept-design-types.md`; `background/concept-state-notation.md`; conceptbox `concept-state.md`                                         | generic opaque identities in `common/design.md`; complete compact authoring grammar and constraints in `common/ssf.md` |
| `background/concept-synchronizations.md`                                                                                                            | `common/design.md#composition-and-failure`                                                                             |

Canon treats Principle as an explanation of essential behavior, not the complete
contract: it may use more than one archetypal scenario, and variants, refusals, and
errors belong there only when essential to the purpose. It may identify clearly
external context without making concept State or Actions depend on a peer. The core
consumer guidance and compact prompt use that interpretation; the installed grammar
requires nonempty unfenced prose without imposing a scenario count.

## Skill workflow sources

| Previous source                                                | Destination                                                                        |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `SKILL.md` normal path and boundaries                          | `SKILL.md`; `references/workflow.md`                                               |
| `references/workflow.md` setup and baseline                    | `references/workflow.md#start-safely`                                              |
| product discussion and assumptions                             | `references/workflow.md#maintain-the-product-brief`                                |
| analysis selection and fallback                                | `references/workflow.md#start-safely`; `#select-compact-context`                   |
| design approval and renewed approval                           | `references/workflow.md#design-and-criticism`; `#implement-in-bounded-phases`      |
| final checks and acceptance                                    | `references/workflow.md#validate-once-and-stop`                                    |
| `references/design-roles.md` closed context and catalog bounds | `references/workflow.md#select-compact-context`; designer and critic templates     |
| designer read/write/output contract                            | `prompts/roles/designer.md#assignment`; `#return`                                  |
| draft parser protocol                                          | designer self-check; `references/workflow.md#design-and-criticism` gate            |
| critic read/output contract                                    | `prompts/roles/critic.md#assignment`                                               |
| criticism and repair                                           | `references/workflow.md#design-and-criticism`                                      |
| `references/implementation-roles.md` concept isolation         | `references/workflow.md#implement-in-bounded-phases`; concept-worker template      |
| composition and integration isolation                          | application-worker template                                                        |
| evidence isolation                                             | evidence-worker template                                                           |
| framework-internal read exclusion                              | all implementation templates; harness contract; bounded-phase workflow             |
| contract blockers                                              | all implementation templates; `references/workflow.md#implement-in-bounded-phases` |

## HTTP reference

`prompts/inputs/http.md` compacts the `@mit-sdg/sync-engine-http` README, its public
surface, and the message-board example's host, edge policy, and web client. Only the
application and frontend workers receive it, as a `reference` input for web
applications.

## Core concept-design guidance

| Core `docs/user/design.md` section              | Destination                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| Concepts and composition                        | `common/design.md#useful-independent-concepts`                          |
| Recording the application design                | `common/design.md#authored-application-design`                          |
| Purpose and principle                           | `common/design.md#useful-independent-concepts`                          |
| State, identity, and ownership                  | `common/design.md#state-and-ownership`                                  |
| State sufficiency                               | `common/design.md#state-and-ownership`                                  |
| State ownership                                 | `common/design.md#state-and-ownership`                                  |
| Semantic actions                                | `common/design.md#actions-and-lifecycle`                                |
| Failure, reversal, and repetition               | `common/design.md#actions-and-lifecycle`                                |
| Choosing concept boundaries                     | `common/design.md#useful-independent-concepts`                          |
| Reaction pressure                               | `common/design.md#composition-and-failure`                              |
| Worked boundary comparison                      | Removed example; split rules retained under useful independent concepts |
| Modularity across one familiar entity           | Removed example; identity, ownership, and split rules retained          |
| Host and external interactions                  | `common/design.md#authorization-and-external-effects`                   |
| Designing reactions                             | `common/design.md#composition-and-failure`                              |
| What belongs and does not belong in composition | `common/design.md#composition-and-failure`                              |
| Cross-concept invariants                        | `common/design.md#composition-and-failure`                              |
| Authorization across boundaries                 | `common/design.md#authorization-and-external-effects`                   |
| Composition hazards                             | `common/design.md#composition-and-failure`                              |

## Concept specification reference

| Core `docs/user/reference/concept-specification.md` section | Destination                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Recommended layout and draft command                        | designer template; coordinator design stage                                                           |
| Document grammar                                            | `prompts/common/concept-format.md`                                                                    |
| Complete example                                            | Removed; parser supplies exact mechanical feedback                                                    |
| Types                                                       | `common/concept-format.md`; common authored application design                                        |
| State                                                       | designer format; `common/design.md#state-and-ownership`; `common/ssf.md`                              |
| Actions                                                     | `common/concept-format.md`; common actions and lifecycle                                              |
| Queries                                                     | `common/concept-format.md`; common actions and lifecycle                                              |
| Names and type expressions                                  | `common/concept-format.md`                                                                            |
| Agreement with TypeScript                                   | common authored application design; final validation                                                  |
| Definition and instance identity                            | common authored application design; application-worker routine API essentials; final source agreement |
| Source provenance                                           | common authored application design; final source agreement                                            |
| Author obligations                                          | designer assignment; coordinator syntax stage                                                         |

## Design review guide

| Core `docs/user/guide/reviewing-a-design.md` step | Destination                                |
| ------------------------------------------------- | ------------------------------------------ |
| Fix product and document scope                    | brief; common useful independent concepts  |
| Test each useful capability                       | common useful independent concepts         |
| Find peer leakage and duplicate authority         | common state and ownership                 |
| Review actions, refusals, and lifecycle           | common actions and lifecycle               |
| Apply reaction pressure                           | common composition and failure             |
| Check application types and identities            | common authored application design         |
| Review composition beside source                  | common authored application design         |
| Validate strict grammar                           | designer grammar; coordinator syntax stage |
| Verify implemented variant                        | application worker; final validation       |
| Trace objective-driven scenarios                  | evidence-worker template                   |

The critic template orders its review walk after this guide's design-time steps; the
rules each step applies remain in the common design prompt.

The semantic comparison must also inspect source paragraphs outside headings. A table
row proves destination coverage, not preservation of meaning; independent review is
the decision gate.
