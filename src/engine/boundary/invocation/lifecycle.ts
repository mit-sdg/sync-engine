export interface ExecutionLimits {
  maxActiveRootFlows: number;
  maxPendingRequests: number;
  maxActionsPerFlow: number;
  maxFiringsPerFlow: number;
  maxRowsPerEvaluation: number;
  maxRequestDurationMs: number;
}

type AdmissionRejection = "draining" | "active-flow-limit" | "pending-request-limit";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/** Resolve one caller timeout against optional host execution limits. */
export function requestTimeout(timeoutMs: number | undefined, limits?: ExecutionLimits): number {
  return timeoutMs ?? limits?.maxRequestDurationMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
}

function assertPositiveInteger(value: number, name: keyof ExecutionLimits): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(`executionLimits.${name} must be a positive finite integer.`);
  }
}

function assertExecutionLimits(limits: ExecutionLimits): void {
  const names: (keyof ExecutionLimits)[] = [
    "maxActiveRootFlows",
    "maxPendingRequests",
    "maxActionsPerFlow",
    "maxFiringsPerFlow",
    "maxRowsPerEvaluation",
    "maxRequestDurationMs",
  ];
  for (const name of names) {
    assertPositiveInteger(limits[name], name);
  }
  if (limits.maxRequestDurationMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `executionLimits.maxRequestDurationMs must not exceed ${MAX_TIMER_DELAY_MS}, ` +
        "the reliable platform timer maximum.",
    );
  }
}

/** Owns admission and quiescence independently of caller waits and log retention. */
export class RuntimeLifecycle {
  private readonly active = new Set<string>();
  private readonly pending = new Set<string>();
  private readonly actionCounts = new Map<string, number>();
  private readonly firingCounts = new Map<string, number>();
  private readonly idleWaiters = new Set<() => void>();
  private draining = false;
  private drainIdleEmitted = false;

  constructor(
    readonly limits?: ExecutionLimits,
    readonly events: OperationalEvents = new OperationalEvents(),
  ) {
    if (limits !== undefined) assertExecutionLimits(limits);
  }

  admit(flow: string, route: string, correlationId: string): AdmissionRejection | undefined {
    const rejection = this.admissionRejection(flow, route, correlationId, true);
    if (rejection !== undefined) return rejection;
    this.events.setContext(flow, { route, correlationId });
    this.active.add(flow);
    this.pending.add(flow);
    return undefined;
  }

  /** Admit a direct action root, which has active work but no boundary request wait. */
  admitFlow(flow: string, route: string, correlationId: string): AdmissionRejection | undefined {
    const rejection = this.admissionRejection(flow, route, correlationId, false);
    if (rejection !== undefined) return rejection;
    this.events.setContext(flow, { route, correlationId });
    this.active.add(flow);
    return undefined;
  }

  private admissionRejection(
    flow: string,
    route: string,
    correlationId: string,
    pending: boolean,
  ): AdmissionRejection | undefined {
    if (this.draining) return "draining";
    if (this.limits !== undefined && this.active.size >= this.limits.maxActiveRootFlows) {
      this.events.emit({
        type: "execution-limit-breached",
        at: Date.now(),
        flow,
        route,
        correlationId,
        limit: "active-root-flows",
        accepted: false,
      });
      return "active-flow-limit";
    }
    if (
      pending &&
      this.limits !== undefined &&
      this.pending.size >= this.limits.maxPendingRequests
    ) {
      this.events.emit({
        type: "execution-limit-breached",
        at: Date.now(),
        flow,
        route,
        correlationId,
        limit: "pending-requests",
        accepted: false,
      });
      return "pending-request-limit";
    }
    return undefined;
  }

  pendingSettled(flow: string): void {
    this.pending.delete(flow);
    this.clearSettledContext(flow);
  }

  flowSettled(flow: string): void {
    this.clearFlowCounts(flow);
    if (!this.active.delete(flow)) return;
    this.clearSettledContext(flow);
    this.resolveIdle();
  }

  abandon(flow: string): void {
    this.pending.delete(flow);
    this.clearFlowCounts(flow);
    if (!this.active.delete(flow)) return;
    this.events.clearContext(flow);
    this.resolveIdle();
  }

  beginDrain(): Promise<void> {
    if (!this.draining) {
      this.draining = true;
      this.events.emit({ type: "drain-state", state: "draining", at: Date.now() });
    }
    if (this.active.size === 0) this.emitDrainIdle();
    return this.whenIdle();
  }

  whenIdle(): Promise<void> {
    if (this.active.size === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.add(resolve));
  }

  validateTimeout(timeoutMs: number): string | undefined {
    if (!Number.isFinite(timeoutMs) || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return "timeoutMs must be a positive finite integer";
    }
    if (timeoutMs > MAX_TIMER_DELAY_MS) {
      return `timeoutMs exceeds the reliable platform timer maximum of ${MAX_TIMER_DELAY_MS} ms`;
    }
    if (this.limits !== undefined && timeoutMs > this.limits.maxRequestDurationMs) {
      return `timeoutMs exceeds the configured ${this.limits.maxRequestDurationMs} ms maximum`;
    }
    return undefined;
  }

  action(flow: string): boolean {
    if (this.limits === undefined) return true;
    const count = (this.actionCounts.get(flow) ?? 0) + 1;
    this.actionCounts.set(flow, count);
    return count <= this.limits.maxActionsPerFlow;
  }

  firing(flow: string): boolean {
    if (this.limits === undefined) return true;
    const count = (this.firingCounts.get(flow) ?? 0) + 1;
    this.firingCounts.set(flow, count);
    return count <= this.limits.maxFiringsPerFlow;
  }

  rows(count: number): boolean {
    return this.limits === undefined || count <= this.limits.maxRowsPerEvaluation;
  }

  private resolveIdle(): void {
    if (this.active.size !== 0) return;
    for (const resolve of this.idleWaiters) resolve();
    this.idleWaiters.clear();
    if (this.draining) this.emitDrainIdle();
  }

  private clearFlowCounts(flow: string): void {
    this.actionCounts.delete(flow);
    this.firingCounts.delete(flow);
  }

  private clearSettledContext(flow: string): void {
    if (!this.active.has(flow) && !this.pending.has(flow)) this.events.clearContext(flow);
  }

  private emitDrainIdle(): void {
    if (this.drainIdleEmitted) return;
    this.drainIdleEmitted = true;
    this.events.emit({ type: "drain-state", state: "idle", at: Date.now() });
  }
}
import { OperationalEvents } from "@engine/reactions/runtime/operational";
