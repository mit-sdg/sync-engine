import { globalRegistry } from "@engine/utils/global-registry";
import type { AssembledApp } from "./assemble.ts";

type AssemblyRegistry = WeakMap<
  object,
  AssembledApp<Record<string, new (...args: never[]) => object>>
>;

const assemblies = globalRegistry<AssemblyRegistry>(
  "@mit-sdg/sync-engine/assembly-registry",
  () => new WeakMap(),
  (value): value is AssemblyRegistry => value instanceof WeakMap,
);

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
