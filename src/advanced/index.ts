/** Manual engine construction, low-level declarations, and explicit escape hatches. */
export { createEngine } from "@engine/reactions/engine";
export { vocabulary } from "@engine/reactions/authoring/refs";
export type { VocabularyAssemblyOptions } from "@engine/boundary/assembly/assembly-facade";
export type { Engine, EngineOptions } from "@engine/reactions/engine";
export { faulted } from "@engine/reactions/authoring/channels";
export { custom } from "@engine/reads/where-ops";
export { Refuse } from "@engine/reactions/concepts/refuse";
export type { EngineObserver, LogEvent } from "@engine/reactions/runtime/logging";
