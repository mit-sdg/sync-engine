/** The standard gateway. */
import type { LogStore, RetentionPolicy } from "@engine/reactions/runtime/log-store";
import type { Logging } from "@engine/reactions/runtime/logging";
import type { OperationalObserver } from "@engine/reactions/runtime/operational";
import type { RedactionPolicy } from "@engine/utils/redaction";
import type { ApplicationInterface } from "../protocol/application-interface.ts";
import type { ContractShape } from "../protocol/contract-shape.ts";
import type { Invoker } from "../invocation/invoke.ts";
import type { ExecutionLimits } from "../invocation/lifecycle.ts";
import { createGateway as createGatewayEngine } from "./gateway.ts";

// One home for the client's error envelope: re-export the gateway engine's.
export type { GatewayClientError } from "./gateway.ts";

export interface GatewayTarget {
  invoker: Invoker<ContractShape>;
  publicInterface: ApplicationInterface;
  beginDrain?: () => Promise<void>;
  whenIdle?: () => Promise<void>;
}

export interface GatewayOptions {
  application: GatewayTarget;
  /** Declarations added beside the standard gateway composition. */
  additionalComposition?: Record<string, unknown>;
  /** Gateway interpreter diagnostics; defaults to `Logging.OFF`. */
  logging?: Logging;
  /** In-memory gateway occurrence retention; defaults to 100 settled flows. */
  retention?: RetentionPolicy;
  /** Application-owned gateway occurrence store. It cannot be combined with `retention`. */
  logStore?: LogStore;
  /** Opt-in limits for the gateway's own execution. */
  executionLimits?: ExecutionLimits;
  /** Internal gateway events plus one final public-call settlement; bounded synchronous handoff. */
  observers?: readonly OperationalObserver[];
  /** Additional sensitive field names for the gateway only. */
  redaction?: RedactionPolicy;
}

export interface Gateway<C extends ContractShape> extends Invoker<C> {
  beginDrain(): Promise<void>;
  whenIdle(): Promise<void>;
}

export function createGateway<C extends ContractShape = ContractShape>(
  options: GatewayOptions,
): Gateway<C> {
  const gateway = createGatewayEngine<C>({
    application: options.application,
    ...(options.additionalComposition === undefined
      ? {}
      : { composition: { Additional: options.additionalComposition } }),
    ...(options.logging === undefined ? {} : { logging: options.logging }),
    ...(options.retention === undefined ? {} : { retention: options.retention }),
    ...(options.logStore === undefined ? {} : { logStore: options.logStore }),
    ...(options.executionLimits === undefined ? {} : { executionLimits: options.executionLimits }),
    ...(options.observers === undefined ? {} : { observers: options.observers }),
    ...(options.redaction === undefined ? {} : { redaction: options.redaction }),
  });
  return {
    invoke: gateway.invoke.bind(gateway),
    beginDrain: gateway.beginDrain.bind(gateway),
    whenIdle: gateway.whenIdle.bind(gateway),
  };
}
