/**
 * Infra module contract — app-agnostic interfaces for pluggable
 * metrics, health, and scheduler modules.
 *
 * This file has zero edumen-specific imports by design and depends on no
 * transport: it only references the engine (framework) types. Routes are
 * described as neutral data ({@link InfraResponse}); an app-side transport
 * driver maps them onto HTTP (or any other transport) and enforces auth.
 */
import type { SyncConcept } from "@sync-engine/engine";

export interface JobStatus {
  name: string;
  lastRun: string | null;
  lastStatus: "success" | "failure" | null;
  lastError: string | null;
  lastDurationMs: number | null;
}

/** Neutral result of an infra route — the driver maps it onto the transport. */
export interface InfraResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface InfraRoute {
  method: "GET";
  path: string;
  /** How to authenticate this route. "metrics-token" means
   *  Authorization: Bearer <METRICS_TOKEN>. "none" means no auth. */
  auth?: "metrics-token" | "none";
  /** Produce the neutral response; the driver serializes and sends it. */
  handler(): InfraResponse | Promise<InfraResponse>;
}

export interface InfraModule {
  readonly name: string;
  /** Subscribe observers to an engine (journal intake). */
  attach?(engine: SyncConcept): void;
  /** Routes to mount on the HTTP adapter. */
  routes?: InfraRoute[];
  /** Start timers or listeners. */
  start?(): void | Promise<void>;
  /** Stop all active resources. */
  stop?(): void | Promise<void>;
}
