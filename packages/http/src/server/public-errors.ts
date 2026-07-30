import { FrameworkErrorCode } from "@mit-sdg/sync-engine/boundary";
import type { WireContractsIR } from "@mit-sdg/sync-engine/tooling";
import type { HttpPublicErrorCategory, ProductionHttpProfile } from "./policy.ts";

export type PublicHttpError = HttpPublicErrorCategory | "INTERNAL_ERROR";

function isPublicErrorCategory(value: unknown): value is HttpPublicErrorCategory {
  return (
    value === "INVALID_REQUEST" ||
    value === "UNAUTHORIZED" ||
    value === "FORBIDDEN" ||
    value === "NOT_FOUND" ||
    value === "CONFLICT"
  );
}

export function registeredPublicCategoryOf(
  code: string,
  categories: Readonly<Record<string, HttpPublicErrorCategory>> | undefined,
): PublicHttpError {
  if (categories === undefined || !Object.hasOwn(categories, code)) return "INTERNAL_ERROR";
  const category = categories[code];
  return isPublicErrorCategory(category) ? category : "INTERNAL_ERROR";
}

export function publicFrameworkCategoryOf(code: string): PublicHttpError {
  switch (code) {
    case FrameworkErrorCode.INVALID_INPUT:
      return "INVALID_REQUEST";
    case FrameworkErrorCode.NOT_FOUND:
      return "NOT_FOUND";
    default:
      return "INTERNAL_ERROR";
  }
}

export function publicCategoryOf(
  code: string,
  categories: Readonly<Record<string, HttpPublicErrorCategory>> | undefined,
): PublicHttpError {
  return categories !== undefined && Object.hasOwn(categories, code)
    ? registeredPublicCategoryOf(code, categories)
    : publicFrameworkCategoryOf(code);
}

export function publicErrorStatus(category: PublicHttpError): number {
  switch (category) {
    case "INVALID_REQUEST":
      return 400;
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 500;
  }
}

export function projectProductionHttpWire(
  wire: WireContractsIR,
  profile: ProductionHttpProfile,
): WireContractsIR {
  const categories = profile.publicErrors;
  return {
    endpoints: wire.endpoints.map((endpoint) => {
      const errors = new Set<PublicHttpError>();
      let admissionError = endpoint.inputAdmissionError !== false;
      for (const code of endpoint.errors) {
        if (code === FrameworkErrorCode.INVALID_INPUT && admissionError) {
          errors.add(publicFrameworkCategoryOf(code));
          admissionError = false;
          continue;
        }
        errors.add(registeredPublicCategoryOf(code, categories));
      }
      if (endpoint.openError) errors.add("INTERNAL_ERROR");
      return { ...endpoint, errors: [...errors].sort(), openError: false };
    }),
    appWide: [
      ...new Set(wire.appWide.map((code) => registeredPublicCategoryOf(code, categories))),
    ].sort(),
  };
}
