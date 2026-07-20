/** Manual engine construction and explicit escape hatches. */
export { createEngine } from "../internal/reactions/engine.ts";
export type { Engine } from "../internal/reactions/engine.ts";
export { faulted } from "../internal/reactions/channels.ts";
export { compute, custom } from "../internal/reads/where-ops.ts";
export { Refuse } from "../internal/reactions/refuse.ts";
export { Requesting } from "../internal/boundary/invoke.ts";
export { refusalFunnel } from "../internal/boundary/funnel.ts";
export type { EngineObserver, LogEvent } from "../internal/reactions/observer.ts";
