import type { HttpBrowserPolicy, HttpRequestOriginPolicy } from "./types.ts";

export function normalizeOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP or HTTPS origin.`);
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error(`${label} must contain only an HTTP or HTTPS origin.`);
  }
  return parsed.origin;
}

function distinctOrigins(values: readonly string[], label: string): readonly string[] {
  const normalized = values.map((value, index) => normalizeOrigin(value, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must contain distinct exact origins.`);
  }
  return Object.freeze(normalized);
}

function headerName(value: string, label: string): string {
  try {
    new Headers().set(value, "value");
  } catch {
    throw new Error(`${label} must be a valid header name.`);
  }
  return value;
}

function distinctHeaders(values: readonly string[], label: string): readonly string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = headerName(values[index], `${label}[${index}]`);
    const key = value.toLowerCase();
    if (seen.has(key)) throw new Error(`${label} must contain distinct header names.`);
    seen.add(key);
    normalized.push(value);
  }
  return Object.freeze(normalized);
}

export function normalizeBrowser(
  value: HttpBrowserPolicy | undefined,
): HttpBrowserPolicy | undefined {
  if (value === undefined) return undefined;
  const maxAgeSeconds = value.maxAgeSeconds;
  if (maxAgeSeconds !== undefined && (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 0)) {
    throw new Error("httpPolicy: browser.maxAgeSeconds must be a non-negative safe integer.");
  }
  const configuredHeaders = value.allowedHeaders ?? [];
  const allowedHeaders = distinctHeaders(
    configuredHeaders.some((name) => name.toLowerCase() === "content-type")
      ? configuredHeaders
      : ["Content-Type", ...configuredHeaders],
    "httpPolicy: browser.allowedHeaders",
  );
  return Object.freeze({
    origins: distinctOrigins(value.origins, "httpPolicy: browser.origins"),
    ...(value.credentials === true ? { credentials: true } : {}),
    allowedHeaders,
    ...(value.exposedHeaders === undefined
      ? {}
      : {
          exposedHeaders: distinctHeaders(
            value.exposedHeaders,
            "httpPolicy: browser.exposedHeaders",
          ),
        }),
    ...(maxAgeSeconds === undefined ? {} : { maxAgeSeconds }),
  });
}

export function normalizeRequestOrigins(
  value: HttpRequestOriginPolicy | false | undefined,
  defaults: readonly string[],
  browserOrigins: readonly string[],
): HttpRequestOriginPolicy | false | undefined {
  if (value === false) return false;
  const allowed =
    value === undefined
      ? distinctOrigins(defaults, "httpPolicy: requestOrigins.allowed")
      : distinctOrigins(value.allowed, "httpPolicy: requestOrigins.allowed");
  for (const browserOrigin of browserOrigins) {
    if (!allowed.includes(browserOrigin)) {
      throw new Error(
        `httpPolicy: requestOrigins.allowed must include browser origin "${browserOrigin}".`,
      );
    }
  }
  if (value === undefined && allowed.length === 0) return undefined;
  return Object.freeze({
    allowed,
    ...(value?.requireOrigin === true ? { requireOrigin: true } : {}),
  });
}

export function isHttpsOrLoopback(value: string): boolean {
  const parsed = new URL(value);
  return (
    parsed.protocol === "https:" ||
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]"
  );
}
