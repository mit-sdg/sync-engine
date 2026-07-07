/**
 * Public entry point for the synchronization engine, imported elsewhere as
 * `@engine`. Concepts are composed by declarative synchronizations matched
 * against an append-only action journal — see the individual modules for the
 * model (flow, frames, when/where/then, synced marks).
 */

export { normalizeOutcome } from "./actions.ts";
export { Frames } from "./frames.ts";
export { actionNameOf, actionNodeId, conceptNameOf } from "./introspect.ts";
export type { EngineObserver, JournalEvent } from "./observer.ts";
export { act, Logging, on, onError, par, sanitize, seq, sync, SyncConcept, when } from "./sync.ts";
export type {
  ActChain,
  ActionList,
  ActionOutcome,
  ActionPattern,
  BranchNode,
  Empty,
  Frame,
  InstrumentedAction,
  Mapping,
  NestedThenOptions,
  OutcomeKind,
  ParallelNode,
  SequenceNode,
  StepNode,
  SyncDeclaration,
  SyncFunction as Sync,
  ThenClause,
  ThenNode,
  Vars,
  WhenBuilder,
  WhenBuilderWithWhere,
  WhereFn,
} from "./types.ts";
export type { TypedVars, Var } from "./vars.ts";
export { declareVars } from "./vars.ts";
export type { Gate } from "./where.ts";
export { Where } from "./where.ts";
