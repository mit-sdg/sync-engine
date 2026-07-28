import type { Assembly } from "../assembly/assembly-facade.ts";
import { assemblyBehind } from "../assembly/assembly-registry.ts";
import { publicCategoryOf } from "../protocol/public-errors.ts";
import type { WireContractsIR } from "../wire/wire-contracts.ts";
import type { PublicErrorCategory } from "@engine/reactions/concepts/concept-metadata";
import { normalizeHttpBasePath } from "../protocol/http-path.ts";

export { normalizeHttpBasePath } from "../protocol/http-path.ts";

export interface ProductionHttpProfile {
  origin: string;
  basePath?: string;
}

export function normalizeProductionHttpProfile(
  declaration: ProductionHttpProfile,
  label = "productionHttpProfile",
  productionReason = "",
): ProductionHttpProfile {
  let origin: URL;
  try {
    origin = new URL(declaration.origin);
  } catch {
    throw new Error(`${label}: origin must be an absolute HTTP or HTTPS origin.`);
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== declaration.origin.replace(/\/$/, "")
  ) {
    throw new Error(`${label}: origin must contain only an HTTP or HTTPS origin.`);
  }
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error(`${label}: production requires an HTTPS public origin${productionReason}.`);
  }
  const basePath = normalizeHttpBasePath(declaration.basePath, `${label}: basePath`);
  return Object.freeze({
    origin: origin.origin,
    ...(basePath === "" ? {} : { basePath }),
  });
}

export function productionHttpProfile(declaration: ProductionHttpProfile): ProductionHttpProfile {
  return normalizeProductionHttpProfile(declaration);
}

export function projectProductionHttpWire(
  wire: WireContractsIR,
  categories: Readonly<Record<string, PublicErrorCategory>>,
): WireContractsIR {
  return {
    endpoints: wire.endpoints.map((endpoint) => ({
      ...endpoint,
      errors: [
        ...new Set(endpoint.errors.map((code) => publicCategoryOf(code, categories))),
      ].sort(),
      openError: false,
    })),
    appWide: [...new Set(wire.appWide.map((code) => publicCategoryOf(code, categories)))].sort(),
  };
}

export function projectAssemblyProductionHttpWire(
  application: Assembly<Record<string, new (...args: never[]) => object>>,
  wire: WireContractsIR,
): WireContractsIR {
  return projectProductionHttpWire(wire, assemblyBehind(application).publicErrors);
}
