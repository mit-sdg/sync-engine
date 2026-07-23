/** Manual engine construction and explicit escape hatches. */
export { createEngine } from "../engine/reactions/engine.ts";
export type { Engine } from "../engine/reactions/engine.ts";
export { faulted } from "../engine/reactions/channels.ts";
export { compute, custom } from "../engine/reads/where-ops.ts";
export { Refuse } from "../engine/reactions/refuse.ts";
export { Requesting } from "../engine/boundary/invoke.ts";
export { refusalFunnel } from "../engine/boundary/funnel.ts";
export type { EngineObserver, LogEvent } from "../engine/reactions/observer.ts";
