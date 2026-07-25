/** Manual engine construction and explicit escape hatches. */
export { createEngine } from "@engine/reactions/engine";
export type { Engine } from "@engine/reactions/engine";
export { faulted } from "@engine/reactions/channels";
export { compute, custom } from "@engine/reads/where-ops";
export { Refuse } from "@engine/reactions/refuse";
export { Requesting } from "@engine/boundary/invoke";
export { refusalFunnel } from "@engine/boundary/funnel";
export type { EngineObserver, LogEvent } from "@engine/reactions/observer";
