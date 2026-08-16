# Prompt compaction source map

This file records where the active workflow's normative content moved before the full
source documents were compacted. Prompt headings contain the retained rules; examples,
extended rationale, and repeated review procedures are intentionally not attached to
routine role prompts.

## Canon semantic review

The compact rules were checked against Canon `daniel` at
`d907e027e70158d78d564b1a0fa961c06b1f76d3`.

| Canon source                                                                                                                                        | Destination                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `background/behavior-description-generally.md`; `background/behavior-structuring-with-concepts.md`; `background/concept-as-behavior-and-service.md` | `common/design.md#useful-independent-concepts`; `#state-and-ownership`; `#actions-and-lifecycle`                                                  |
| `background/concept-design-method.md`; `background/Negative purposes.md`                                                                            | purpose, boundaries, restraint, and coordination under common design rules                                                                        |
| `background/concept-specifications.md`; `background/concept-design-rubric.md`                                                                       | purpose and Principle under useful independent concepts; state and action rules                                                                   |
| `background/concept-design-types.md`; `background/concept-state-notation.md`                                                                        | generic opaque external identities and semantic state under state and ownership; SSF grammar omitted because local version 1 does not parse State |
| `background/concept-synchronizations.md`                                                                                                            | `common/design.md#composition-and-failure`                                                                                                        |

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
| draft parser protocol                                          | `references/workflow.md#design-and-criticism`; designer grammar                    |
| critic read/output contract                                    | `prompts/roles/critic.md#assignment`                                               |
| criticism and repair                                           | `references/workflow.md#design-and-criticism`                                      |
| `references/implementation-roles.md` concept isolation         | `references/workflow.md#implement-in-bounded-phases`; concept-worker template      |
| composition and integration isolation                          | application-worker template                                                        |
| evidence isolation                                             | evidence-worker template                                                           |
| contract blockers                                              | all implementation templates; `references/workflow.md#implement-in-bounded-phases` |

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
| Document grammar                                            | `prompts/roles/designer.md#concept-grammar`                                                           |
| Complete example                                            | Removed; parser supplies exact mechanical feedback                                                    |
| Types                                                       | designer grammar; common authored application design                                                  |
| State                                                       | designer grammar; common state and ownership                                                          |
| Actions                                                     | designer grammar; common actions and lifecycle                                                        |
| Queries                                                     | designer grammar; common actions and lifecycle                                                        |
| Names and type expressions                                  | designer grammar                                                                                      |
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

The semantic comparison must also inspect source paragraphs outside headings. A table
row proves destination coverage, not preservation of meaning; independent review is
the decision gate.
