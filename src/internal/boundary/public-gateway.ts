/** The standard gateway. */
import type { Logging } from "../reactions/logging.ts";
import type { ApplicationInterface } from "./application-interface.ts";
import type { ContractShape } from "./client.ts";
import { createGateway as createGatewayEngine } from "./gateway.ts";
import type { Invoker } from "./invoke.ts";

// One home for the client's error envelope: re-export the gateway engine's.
export type { GatewayClientError } from "./gateway.ts";

export interface GatewayTarget {
  invoker: Invoker<ContractShape>;
  publicInterface: ApplicationInterface;
}

export interface GatewayOptions {
  application: GatewayTarget;
  /** Declarations added beside the standard gateway composition. */
  additionalComposition?: Record<string, unknown>;
  logging?: Logging;
}

export interface Gateway<C extends ContractShape> extends Invoker<C> {}

export function createGateway<C extends ContractShape = ContractShape>(
  options: GatewayOptions,
): Gateway<C> {
  const gateway = createGatewayEngine<C>({
    application: options.application,
    ...(options.additionalComposition === undefined
      ? {}
      : { composition: { Additional: options.additionalComposition } }),
    ...(options.logging === undefined ? {} : { logging: options.logging }),
  });
  return { invoke: gateway.invoke.bind(gateway) };
}
