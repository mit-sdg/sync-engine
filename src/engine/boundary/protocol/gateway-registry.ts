import type { ApplicationInterface } from "./application-interface.ts";

interface RegisteredApplication {
  readonly identity: object;
  readonly publicInterface: ApplicationInterface;
}

interface GatewayRegistry {
  readonly applicationsByInvoker: WeakMap<object, RegisteredApplication>;
  readonly applicationsByGateway: WeakMap<object, RegisteredApplication>;
}

const registryKey = Symbol.for("@mit-sdg/sync-engine/gateway-registry");
const registered = Reflect.get(globalThis, registryKey) as GatewayRegistry | undefined;
const registry =
  registered ??
  ({
    applicationsByInvoker: new WeakMap(),
    applicationsByGateway: new WeakMap(),
  } satisfies GatewayRegistry);
if (registered === undefined) Reflect.set(globalThis, registryKey, registry);

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
