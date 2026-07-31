import { assertPortableRoutePath } from "@mit-sdg/sync-engine/boundary";

export type HttpPublicErrorCategory =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export interface HttpPublicErrorPolicy {
  readonly publicErrors?: Readonly<Record<string, HttpPublicErrorCategory>>;
}

export interface ProductionHttpProfile extends HttpPublicErrorPolicy {
  readonly origin: string;
  readonly basePath?: string;
}

const PUBLIC_ERROR_CATEGORIES = new Set<HttpPublicErrorCategory>([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
]);

export function normalizeHttpBasePath(basePath: string | undefined, label = "basePath"): string {
  if (basePath === undefined || basePath === "") return "";
  assertPortableRoutePath(basePath, label);
  return basePath.replace(/\/+$/, "");
}

function normalizePublicErrors(
  declaration: HttpPublicErrorPolicy,
  label: string,
): Readonly<Record<string, HttpPublicErrorCategory>> | undefined {
  if (declaration.publicErrors === undefined) return undefined;
  const categories: Record<string, HttpPublicErrorCategory> = {};
  for (const [code, category] of Object.entries(declaration.publicErrors)) {
    if (code === "") {
      throw new Error(`${label}: public error codes must be non-empty strings.`);
    }
    if (!PUBLIC_ERROR_CATEGORIES.has(category as HttpPublicErrorCategory)) {
      throw new Error(`${label}: public error "${code}" has an unsupported category.`);
    }
    Object.defineProperty(categories, code, {
      configurable: false,
      enumerable: true,
      value: category,
      writable: false,
    });
  }
  return Object.freeze(categories);
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
  const publicErrors = normalizePublicErrors(declaration, label);
  return Object.freeze({
    origin: origin.origin,
    ...(basePath === "" ? {} : { basePath }),
    ...(publicErrors === undefined ? {} : { publicErrors }),
  });
}

export function productionHttpProfile(declaration: ProductionHttpProfile): ProductionHttpProfile {
  return normalizeProductionHttpProfile(declaration);
}
