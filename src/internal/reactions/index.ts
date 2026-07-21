/**
 * Internal reactions entrypoint, imported by engine modules and focused
 * tests as `@sync-engine/internal/reactions`. It gathers the reaction runtime,
 * its authored vocabulary, and the read-side contracts that runtime uses.
 */

export { normalizeOutcome } from "./actions.ts";
export type { ActionRecord } from "./actions.ts";
export { MemoryStore } from "./log-store.ts";
export type { FiringRecord, LogEntry, LogStore } from "./log-store.ts";
export { isRefuse, Refuse, refusalMapping } from "./refuse.ts";
export { contractOf } from "./outcomes.ts";
export type { ActionContract, OutcomeContracts } from "./outcomes.ts";
export { QueryAnswerFault, rowsOfAnswer } from "../reads/queries.ts";
export { parseSpecProse } from "./concept-spec.ts";
export type { ConceptSpecProse } from "./concept-spec.ts";
export { faulted, isChannelPattern, refused, returned } from "./channels.ts";
export type { ChannelOptions } from "./channels.ts";
export {
  computationRef,
  is,
  isFusedComputation,
  standardComputations,
} from "../reads/computations.ts";
export type {
  ComputationFn,
  ComputationRef,
  ComputationSource,
  FusedComputation,
} from "../reads/computations.ts";
export {
  applyWhereOps,
  compute,
  conditionOp,
  custom,
  isCondition,
  isWhereOp,
  no,
  whether,
} from "../reads/where-ops.ts";
export type {
  AnyWhereOp,
  ComputeOp,
  Condition,
  CustomOp,
  EarlierOp,
  FindOp,
  HoldsOp,
  NoOp,
  WhereOp,
  WhetherOp,
} from "../reads/where-ops.ts";
export { isReadLine, isRelationView } from "../reads/lines.ts";
export type {
  QueryReadLine,
  ReadLine,
  RelationView,
  SlotPattern,
  ViewReadLine,
} from "../reads/lines.ts";
export { count, isCountOp, view, where } from "../reads/views.ts";
export type { CountOp, ViewOp } from "../reads/views.ts";
export { declarationsOf, isReactionPartition } from "./partitions.ts";
export { each, form, former } from "../reads/former-builders.ts";
export type { FreeBindings, InputBindings, OutputBindings } from "../reads/sentence.ts";
export {
  FormerFault,
  fuseFormer,
  isFormerNode,
  isFusedFormer,
  isFormerUse,
} from "../reads/former-nodes.ts";
export { formTree } from "../reads/former-evaluation.ts";
export type {
  Arranged,
  CountNode,
  DistinctNode,
  EachNode,
  FirstNode,
  FormerEntry,
  FormerNode,
  FormerRef,
  FusedFormer,
  LeafNode,
  RecordNode,
  FormerUse,
} from "../reads/former-nodes.ts";
export type {
  FormNode,
  EachFormNode,
  SelectionBuilder,
  SelectionConsumers,
} from "../reads/former-builders.ts";
export { Frames } from "../reads/frames.ts";
export type { QueryPromise } from "../reads/query-contracts.ts";
export {
  isActionRef,
  isQueryRef,
  isReaction,
  reaction,
  vocabulary,
  vocabularyClasses,
  vocabularyComputations,
  vocabularyMetadata,
} from "./refs.ts";
export type {
  ActionRef,
  ConceptClass,
  ConceptClassesOf,
  ConceptDeclaration,
  ConceptEntry,
  ConceptRef,
  ComputationRefs,
  DeclaredVocabulary,
  QueryRef,
  VocabularyDeclaration,
  VocabularyRefs,
} from "./refs.ts";
export type { ConceptMetadata, ErrorConstructor, RefusalContracts } from "./concept-metadata.ts";
export {
  actionNameOf,
  actionNodeId,
  CONCEPT_NAME,
  conceptNameOf,
  inventoryOf,
  rolesOf,
} from "./introspect.ts";
export type { EngineObserver, LogEvent } from "./observer.ts";
export { opaqueCount } from "../reads/ir.ts";
export type {
  ActionInventoryIR,
  ActionTriggerIR,
  AppIR,
  ArrangedIR,
  ChannelTriggerIR,
  ConceptInventoryIR,
  ConsequenceIR,
  FormerIR,
  FormerNodeIR,
  FormerWhereOpIR,
  PatternIR,
  QueryInventoryIR,
  QueryRefIR,
  ReactionIR,
  TriggerIR,
  UnloweredIR,
  ValueIR,
  ViewIR,
  ViewOpIR,
  WhereOpIR,
} from "../reads/ir.ts";
export {
  renderApp,
  renderFormer,
  renderReaction,
  renderRoles,
  renderValue,
  renderView,
  renderWhereOp,
} from "../reads/render.ts";
export type { AppSpecIR } from "../reads/render.ts";
export type { LoweredReaction, LoweredWhereOp } from "../reads/lower.ts";
export { isMatcher, oneOf } from "../reads/matchers.ts";
export { Logging } from "./logging.ts";
export { Reacting } from "./reacting.ts";
export { earlier, when } from "./words.ts";

export type {
  ActionOutcome,
  ActionPattern,
  ChannelPattern,
  ChannelPosture,
  Empty,
  Frame,
  InstrumentedAction,
  InstrumentedQuery,
  Matcher,
  Mapping,
  OutcomeKind,
  StepNode,
  ReactionDeclaration,
  ReactionPartition,
  ReactionResult,
  Reaction,
  ThenNode,
  TriggerPattern,
  Vars,
  WhenBuilder,
  WhenBuilderWithWhere,
  WhenBuilderWithFunctionWhere,
  WhereFn,
} from "./types.ts";
export { $vars } from "./vars.ts";
