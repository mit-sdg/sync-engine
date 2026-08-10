import { assertPortableRoutePath } from "@mit-sdg/sync-engine/boundary";
import {
  isHttpsOrLoopback,
  normalizeBrowser,
  normalizeOrigin,
  normalizeRequestOrigins,
} from "./browser.ts";
import { normalizeCookies } from "./cookies.ts";
import {
  HttpPolicyBrand,
  type HttpLimits,
  type HttpPolicy,
  type HttpPolicyInit,
  type HttpPublicErrorCategory,
} from "./types.ts";

const PUBLIC_ERROR_CATEGORIES = new Set<HttpPublicErrorCategory>([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
]);

function normalizeHttpBasePath(basePath: string | undefined): string {
  if (basePath === undefined || basePath === "") return "";
  assertPortableRoutePath(basePath, "httpPolicy: basePath");
  return basePath.replace(/\/+$/, "");
}

function normalizePublicErrors(
  declaration: Readonly<Record<string, HttpPublicErrorCategory>> | undefined,
): Readonly<Record<string, HttpPublicErrorCategory>> | undefined {
  if (declaration === undefined) return undefined;
  const categories: Record<string, HttpPublicErrorCategory> = {};
  for (const [code, category] of Object.entries(declaration)) {
    if (code === "") throw new Error("httpPolicy: public error codes must be non-empty strings.");
    if (!PUBLIC_ERROR_CATEGORIES.has(category)) {
      throw new Error(`httpPolicy: public error "${code}" has an unsupported category.`);
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

function normalizeLimits(value: HttpLimits | undefined): HttpLimits | undefined {
  if (value === undefined) return undefined;
  const requestBodyBytes = value.requestBodyBytes;
  if (
    requestBodyBytes !== undefined &&
    (!Number.isSafeInteger(requestBodyBytes) || requestBodyBytes <= 0)
  ) {
    throw new Error("httpPolicy: limits.requestBodyBytes must be a positive safe integer.");
  }
  return Object.freeze(requestBodyBytes === undefined ? {} : { requestBodyBytes });
}

export function isHttpPolicy(value: unknown): value is HttpPolicy {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[HttpPolicyBrand] === true &&
    Object.isFrozen(value)
  );
}

export function httpPolicy(init: HttpPolicyInit): HttpPolicy {
  const browser = normalizeBrowser(init.browser);
  const browserCredentials = browser?.credentials === true;
  const cookies = normalizeCookies(init.cookies, browserCredentials);
  const hasCookies = cookies !== undefined && Object.keys(cookies).length > 0;
  if (init.cookies !== undefined && !hasCookies) {
    throw new Error("httpPolicy: cookies must contain at least one binding.");
  }
  if (hasCookies && init.browser !== undefined && !browserCredentials) {
    throw new Error(
      "httpPolicy: cookies require browser.credentials to be true when browser is declared.",
    );
  }
  if ((hasCookies || browserCredentials) && init.publicOrigin === undefined) {
    throw new Error(
      `httpPolicy: publicOrigin is required for ${hasCookies ? "cookies" : "credentialed browser access"}.`,
    );
  }
  const publicOrigin =
    init.publicOrigin === undefined
      ? undefined
      : normalizeOrigin(init.publicOrigin, "httpPolicy: publicOrigin");
  if ((hasCookies || browserCredentials) && !isHttpsOrLoopback(publicOrigin as string)) {
    throw new Error(
      "httpPolicy: publicOrigin must use HTTPS or a loopback host when cookies or credentialed browser access is declared.",
    );
  }
  const defaults = [
    ...(publicOrigin === undefined ? [] : [publicOrigin]),
    ...(browser?.origins ?? []),
  ];
  const requestOrigins = normalizeRequestOrigins(
    init.requestOrigins,
    [...new Set(defaults)],
    browser?.origins ?? [],
  );
  if (
    requestOrigins === false &&
    Object.values(cookies ?? {}).some((binding) => binding.sameSite === "None")
  ) {
    throw new Error(
      'httpPolicy: requestOrigins cannot be false when a cookie uses SameSite="None".',
    );
  }
  const basePath = normalizeHttpBasePath(init.basePath);
  const policy: Record<PropertyKey, unknown> = {
    ...(publicOrigin === undefined ? {} : { publicOrigin }),
    ...(basePath === "" ? {} : { basePath }),
    ...(init.publicErrors === undefined
      ? {}
      : { publicErrors: normalizePublicErrors(init.publicErrors) }),
    ...(browser === undefined ? {} : { browser }),
    ...(requestOrigins === undefined ? {} : { requestOrigins }),
    ...(cookies === undefined ? {} : { cookies }),
    ...(init.limits === undefined ? {} : { limits: normalizeLimits(init.limits) }),
  };
  Object.defineProperty(policy, HttpPolicyBrand, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return Object.freeze(policy) as unknown as HttpPolicy;
}

export function requireHttpPolicy(value: HttpPolicy | undefined, consumer: string): HttpPolicy {
  if (value === undefined) return httpPolicy({});
  if (!isHttpPolicy(value)) {
    throw new Error(`${consumer}: policy must be created by httpPolicy().`);
  }
  return value;
}
