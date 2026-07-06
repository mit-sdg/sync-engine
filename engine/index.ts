/**
 * Public entry point for the synchronization engine, imported elsewhere as
 * `@engine`. Concepts are composed by declarative synchronizations matched
 * against an append-only action journal — see the individual modules for the
 * model (flow, frames, when/where/then, synced marks).
 */

export { Frames } from "./frames.ts";
export { actionNameOf, actionNodeId, conceptNameOf } from "./introspect.ts";
export type { EngineObserver, JournalEvent } from "./observer.ts";
export { actions, Logging, SyncConcept, sanitize } from "./sync.ts";
export type {
  ActionList,
  ActionPattern,
  Empty,
  Frame,
  InstrumentedAction,
  Mapping,
  SyncFunction as Sync,
  Vars,
} from "./types.ts";
export type { TypedVars, Var } from "./vars.ts";
export { declareVars } from "./vars.ts";
export type { Gate } from "./where.ts";
export { Where } from "./where.ts";
