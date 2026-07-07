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
export {
  Do,
  Done,
  Err,
  Logging,
  On,
  Parallel,
  sanitize,
  Sequence,
  SyncConcept,
  Then,
  When,
  Workflow,
} from "./sync.ts";
export type {
  ActionList,
  ActionOutcome,
  ActionPattern,
  BranchNode,
  DoChain,
  Empty,
  Frame,
  InstrumentedAction,
  Mapping,
  NestedThenOptions,
  OutcomeKind,
  ParallelNode,
  SequenceNode,
  StepNode,
  SyncFunction as Sync,
  ThenClause,
  ThenNode,
  Vars,
} from "./types.ts";
export type { TypedVars, Var } from "./vars.ts";
export { declareVars } from "./vars.ts";
export type { Gate } from "./where.ts";
export { Where } from "./where.ts";
