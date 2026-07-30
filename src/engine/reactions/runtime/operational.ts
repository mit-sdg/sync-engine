import { ListenerSet } from "@engine/utils/listener-set";
import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import { normalizePromiseLike } from "@engine/utils/promise-like";
import type { IntegrityFailureRecord, ReactionFailureRecord } from "./log-store.ts";

export interface ExecutionControl {
  action(flow: string): boolean;
  firing(flow: string): boolean;
  rows(count: number): boolean;
  admitFlow?(flow: string, route: string, correlationId: string): unknown;
  abandon?(flow: string): void;
  flowSettled?(flow: string): void;
}

export type OperationalResultClass =
  | "success"
  | "domain-error"
  | "framework-error"
  | "refusal"
  | "fault";

interface EventBase {
  readonly type: string;
  readonly at: number;
  readonly flow?: string;
  readonly route?: string;
  readonly correlationId?: string;
}

export type OperationalEvent =
  | (EventBase & {
      type: "action-settled";
      flow: string;
      actionId: string;
      concept: string;
      action: string;
      reaction?: string;
      result: "success" | "refusal" | "fault";
      durationMs: number;
    })
  | (EventBase & {
      type: "interpreter-failed";
      flow: string;
      reaction: string;
      stage: ReactionFailureRecord["stage"];
      action?: string;
      actionId?: string;
      errorClass: string;
    })
  | (EventBase & {
      type: "integrity-failed";
      flow: string;
      kind: IntegrityFailureRecord["kind"];
      errorClass: string;
    })
  | (EventBase & {
      type: "invocation-settled";
      result: "success" | "domain-error" | "framework-error";
      frameworkCode?: string;
      durationMs: number;
    })
  | (EventBase & {
      type: "execution-limit-breached";
      limit: "active-root-flows" | "pending-requests" | "actions" | "firings" | "rows";
      accepted: boolean;
    })
  | (EventBase & {
      type: "drain-state";
      state: "draining" | "idle";
    });

interface RawFaultBase {
  readonly error: unknown;
  readonly at: number;
  readonly flow?: string;
  readonly route?: string;
  readonly correlationId?: string;
}

/** A privileged, unsanitized host report that is never persisted or made public. */
export type RawFaultReport =
  | (RawFaultBase & {
      readonly kind: "action";
      readonly concept: string;
      readonly action: string;
      readonly actionId: string;
      readonly reaction?: string;
    })
  | (RawFaultBase & {
      readonly kind: "interpreter";
      readonly reaction: string;
      readonly stage: ReactionFailureRecord["stage"];
      readonly action?: string;
      readonly actionId?: string;
    })
  | (RawFaultBase & {
      readonly kind: "endpoint-validator";
      readonly phase: "input" | "output" | "domain-error";
    });

export type RawFaultReporter = (report: RawFaultReport) => void;

/** Deliver a privileged report without allowing the reporter to affect runtime behavior. */
export function reportRawFault(
  reporter: RawFaultReporter | undefined,
  report: RawFaultReport,
): void {
  if (reporter === undefined) return;
  try {
    const promise = normalizePromiseLike(reporter(report));
    if (promise !== undefined) {
      void promise.catch((error) =>
        logger.warn("raw fault reporter failed", { error: serializeError(error) }),
      );
    }
  } catch (error) {
    logger.warn("raw fault reporter failed", { error: serializeError(error) });
  }
}

export type OperationalObserver = (event: OperationalEvent) => void;

export interface FlowOperationalContext {
  route: string;
  correlationId: string;
}

/** Synchronous nonblocking handoff. Observers own any queueing or I/O. */
export class OperationalEvents {
  private readonly observers = new ListenerSet<OperationalObserver>();
  private readonly contexts = new Map<string, FlowOperationalContext>();

  constructor(observers: readonly OperationalObserver[] = []) {
    for (const observer of observers) this.observers.add(observer);
  }

  context(flow: string): FlowOperationalContext | undefined {
    return this.contexts.get(flow);
  }

  setContext(flow: string, context: FlowOperationalContext): void {
    this.contexts.set(flow, context);
  }

  clearContext(flow: string): void {
    this.contexts.delete(flow);
  }

  emit(event: OperationalEvent): void {
    this.observers.notify(
      (observer, current) => observer(current),
      event,
      (error) => logger.warn("operational observer failed", { error: serializeError(error) }),
    );
  }

  withContext<T extends EventBase>(flow: string, event: T): T {
    const context = this.contexts.get(flow);
    return context === undefined ? event : { ...context, ...event };
  }
}
