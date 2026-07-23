import type { AssembledApp } from "./assemble.ts";

const assemblies = new WeakMap<
  object,
  AssembledApp<Record<string, new (...args: never[]) => object>>
>();

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
