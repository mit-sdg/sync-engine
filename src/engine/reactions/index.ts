/**
 * Runtime reactions entrypoint, imported by engine modules and focused
 * tests as `@sync-engine/internal/reactions`. It gathers the reaction runtime,
 * its authored vocabulary, and the read-side contracts that runtime uses.
 */

export { normalizeOutcome } from "./actions.ts";
export type { ActionRecord } from "./actions.ts";
export { MemoryStore } from "./log-store.ts";
export type { FiringRecord, LogEntry, LogStore, ReactionFailureRecord } from "./log-store.ts";
export { isRefuse, Refuse, refusalMapping } from "./refuse.ts";
export { contractOf } from "./outcomes.ts";
export type { ActionContract, OutcomeContracts } from "./outcomes.ts";

// Read-side contracts — imported through the reads barrel for explicit dependency tracking.
export { QueryAnswerFault, rowsOfAnswer } from "@engine/reads/queries";

export { parseSpec } from "./concept-spec.ts";
export type { ConceptSpec, SpecAction, SpecQuery, SpecRefusal } from "./concept-spec.ts";
export { faulted, isChannelPattern, refused, returned } from "./channels.ts";
export type { ChannelOptions } from "./channels.ts";

export {
  computationRef,
  is,
  isFusedComputation,
  standardComputations,
} from "@engine/reads/computations";
export type {
  ComputationFn,
  ComputationRef,
  ComputationSource,
  FusedComputation,
} from "@engine/reads/computations";

export {
  applyWhereOps,
  compute,
  conditionOp,
  custom,
  isCondition,
  isWhereOp,
  no,
  whether,
} from "@engine/reads/where-ops";
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
} from "@engine/reads/where-ops";

export { isReadLine, isRelationView } from "@engine/reads/lines";
export type {
  QueryReadLine,
  ReadLine,
  RelationView,
  SlotPattern,
  ViewReadLine,
} from "@engine/reads/lines";

export { count, isCountOp, view, where } from "@engine/reads/views";
export type { CountOp, ViewOp } from "@engine/reads/views";

export { declarationsOf, isReactionPartition } from "./partitions.ts";
export { each, form, former } from "@engine/reads/former-builders";
export type { FreeBindings, InputBindings, OutputBindings } from "@engine/reads/sentence";

export {
  FormerFault,
  fuseFormer,
  isFormerNode,
  isFusedFormer,
  isFormerUse,
} from "@engine/reads/former-nodes";
export { formTree } from "@engine/reads/former-evaluation";
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
} from "@engine/reads/former-nodes";
export type {
  FormNode,
  EachFormNode,
  SelectionBuilder,
  SelectionConsumers,
} from "@engine/reads/former-builders";

export { Frames } from "@engine/reads/frames";
export type { QueryPromise } from "@engine/reads/query-contracts";

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

export { opaqueCount } from "@engine/reads/ir";
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
} from "@engine/reads/ir";

export {
  renderApp,
  renderFormer,
  renderReaction,
  renderRoles,
  renderValue,
  renderView,
  renderWhereOp,
} from "@engine/reads/render";
export type { AppSpecIR } from "@engine/reads/render";

export type { LoweredReaction, LoweredWhereOp } from "@engine/reads/lower";
export { isMatcher, oneOf } from "@engine/reads/matchers";

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
