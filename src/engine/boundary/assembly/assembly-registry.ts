import type { AssembledApp } from "./assemble.ts";

type AssemblyRegistry = WeakMap<
  object,
  AssembledApp<Record<string, new (...args: never[]) => object>>
>;

const registryKey = Symbol.for("@mit-sdg/sync-engine/assembly-registry");
const registered = Reflect.get(globalThis, registryKey) as unknown;
const assemblies: AssemblyRegistry =
  registered instanceof WeakMap ? (registered as AssemblyRegistry) : new WeakMap();
if (registered === undefined) Reflect.set(globalThis, registryKey, assemblies);

export function rememberAssembly(
  facade: object,
  assembled: AssembledApp<Record<string, new (...args: never[]) => object>>,
): void {
  assemblies.set(facade, assembled);
}

export function assemblyBehind(
  facade: object,
): AssembledApp<Record<string, new (...args: never[]) => object>> {
  const assembled = assemblies.get(facade);
  if (assembled === undefined) {
    throw new Error("inspectAssembly(...) takes the object returned by assemble(...).");
  }
  return assembled;
}
