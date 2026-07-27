/** Manual engine construction and explicit escape hatches. */
export { createEngine } from "@engine/reactions/engine";
export type { Engine } from "@engine/reactions/engine";
export { faulted } from "@engine/reactions/authoring/channels";
export { compute, custom } from "@engine/reads/where-ops";
export { Refuse } from "@engine/reactions/concepts/refuse";
export { Requesting } from "@engine/boundary/invocation/invoke";
export { refusalFunnel } from "@engine/boundary/invocation/funnel";
export type { EngineObserver, LogEvent } from "@engine/reactions/runtime/observer";
