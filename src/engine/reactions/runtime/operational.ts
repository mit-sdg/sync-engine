import { logger } from "@engine/utils/logger";
import { serializeError } from "@engine/utils/redaction";
import type { IntegrityFailureRecord, ReactionFailureRecord } from "./log-store.ts";

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

export type OperationalObserver = (event: OperationalEvent) => void;

export interface FlowOperationalContext {
  route: string;
  correlationId: string;
}

/** Synchronous nonblocking handoff. Observers own any queueing or I/O. */
export class OperationalEvents {
  private readonly observers = new Set<OperationalObserver>();
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
    for (const observer of this.observers) {
      try {
        const returned = observer(event) as unknown;
        if (returned instanceof Promise) {
          void returned.catch((error: unknown) => {
            logger.warn("operational observer rejected", { error: serializeError(error) });
          });
        }
      } catch (error) {
        logger.warn("operational observer threw", { error: serializeError(error) });
      }
    }
  }

  withContext<T extends EventBase>(flow: string, event: T): T {
    const context = this.contexts.get(flow);
    return context === undefined ? event : { ...context, ...event };
  }
}
