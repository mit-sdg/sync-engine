import { globalRegistry } from "@engine/utils/global-registry";
import type { ApplicationInterface } from "./application-interface.ts";

interface RegisteredApplication {
  readonly identity: object;
  readonly publicInterface: ApplicationInterface;
}

interface GatewayRegistry {
  readonly applicationsByInvoker: WeakMap<object, RegisteredApplication>;
  readonly applicationsByGateway: WeakMap<object, RegisteredApplication>;
}

const registry = globalRegistry<GatewayRegistry>("@mit-sdg/sync-engine/gateway-registry", () => ({
  applicationsByInvoker: new WeakMap(),
  applicationsByGateway: new WeakMap(),
}));

export function rememberApplicationInvoker(
  invoker: object,
  identity: object,
  publicInterface: ApplicationInterface,
): void {
  registry.applicationsByInvoker.set(invoker, { identity, publicInterface });
}

export function applicationBehindInvoker(invoker: object): RegisteredApplication | undefined {
  return registry.applicationsByInvoker.get(invoker);
}

export function rememberGatewayApplication(
  gateway: object,
  application: RegisteredApplication,
): void {
  registry.applicationsByGateway.set(gateway, application);
}

export function applicationBehindGateway(gateway: object): object | undefined {
  return registry.applicationsByGateway.get(gateway)?.identity;
}
