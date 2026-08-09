import { assertPortableRoutePath } from "@mit-sdg/sync-engine/boundary";

export type HttpPublicErrorCategory =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export interface HttpCookieIssue {
  readonly path: string;
  readonly value: string;
  readonly expires: string;
}

export interface HttpCookiePolicy {
  readonly name: string;
  readonly input: string;
  readonly issue: HttpCookieIssue | readonly HttpCookieIssue[];
  readonly clear?: readonly string[];
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly path?: string;
  readonly domain?: string;
  readonly origins?: readonly string[] | false;
}

export interface HttpPolicy {
  readonly origin: string;
  readonly basePath?: string;
  readonly publicErrors?: Readonly<Record<string, HttpPublicErrorCategory>>;
  readonly cookie?: HttpCookiePolicy;
}

const PUBLIC_ERROR_CATEGORIES = new Set<HttpPublicErrorCategory>([
  "INVALID_REQUEST",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
]);

const COOKIE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,63}$/;
const FIELD_NAME = /^[A-Za-z_$][\w$]*$/;
const COOKIE_SAME_SITE = new Set(["Strict", "Lax", "None"]);

function normalizeHttpBasePath(basePath: string | undefined, label: string): string {
  if (basePath === undefined || basePath === "") return "";
  assertPortableRoutePath(basePath, label);
  return basePath.replace(/\/+$/, "");
}

function normalizePublicErrors(
  publicErrors: Readonly<Record<string, HttpPublicErrorCategory>> | undefined,
  label: string,
): Readonly<Record<string, HttpPublicErrorCategory>> | undefined {
  if (publicErrors === undefined) return undefined;
  const categories: Record<string, HttpPublicErrorCategory> = {};
  for (const [code, category] of Object.entries(publicErrors)) {
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

function normalizeOrigin(value: unknown, label: string): URL {
  let origin: URL;
  try {
    origin = new URL(String(value));
  } catch {
    throw new Error(`${label}: origin must be an absolute HTTP or HTTPS origin.`);
  }
  if (
    typeof value !== "string" ||
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error(`${label}: origin must contain only an HTTP or HTTPS origin.`);
  }
  return origin;
}

function normalizeDomain(value: unknown, origin: URL, label: string): string {
  if (typeof value !== "string" || value === "" || value.startsWith(".")) {
    throw new Error(`${label}: domain must be a canonical DNS hostname without a leading dot.`);
  }
  const domain = value.toLowerCase();
  let parsed: URL;
  try {
    parsed = new URL(`https://${domain}`);
  } catch {
    throw new Error(`${label}: domain must be a canonical DNS hostname without a leading dot.`);
  }
  const validLabels = domain
    .split(".")
    .every(
      (part) =>
        part.length > 0 && part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part),
    );
  if (
    !validLabels ||
    domain.length > 253 ||
    parsed.hostname !== domain ||
    parsed.host !== domain ||
    (origin.hostname !== domain && !origin.hostname.endsWith(`.${domain}`))
  ) {
    throw new Error(`${label}: domain must be a parent DNS hostname of the policy origin.`);
  }
  return domain;
}

function normalizeCookieIssue(value: unknown, label: string): HttpCookieIssue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}: issue must be an endpoint declaration or a non-empty array.`);
  }
  const issue = value as Partial<HttpCookieIssue>;
  assertPortableRoutePath(issue.path, `${label}: issue endpoint`);
  const issuedValue = issue.value;
  const issuedExpiry = issue.expires;
  if (typeof issuedValue !== "string" || !FIELD_NAME.test(issuedValue)) {
    throw new Error(`${label}: issued credential value "${String(issuedValue)}" is not a field.`);
  }
  if (typeof issuedExpiry !== "string" || !FIELD_NAME.test(issuedExpiry)) {
    throw new Error(`${label}: issued expiry "${String(issuedExpiry)}" is not a field.`);
  }
  if (issuedValue === issuedExpiry) {
    throw new Error(`${label}: issued credential value and expiry fields must be distinct.`);
  }
  return Object.freeze({ path: issue.path, value: issuedValue, expires: issuedExpiry });
}

function normalizeCookie(
  value: unknown,
  origin: URL,
  policyOrigin: string,
  label: string,
): HttpCookiePolicy {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label}: cookie must be an object.`);
  }
  const declaration = value as Partial<HttpCookiePolicy>;
  if (
    typeof declaration.name !== "string" ||
    !COOKIE_NAME.test(declaration.name) ||
    declaration.name.startsWith("__Host-") ||
    declaration.name.startsWith("__Secure-")
  ) {
    throw new Error(`${label}: cookie name must be a safe logical cookie name.`);
  }
  if (typeof declaration.input !== "string" || !FIELD_NAME.test(declaration.input)) {
    throw new Error(`${label}: cookie input "${String(declaration.input)}" is not a field.`);
  }

  const issueValues = Array.isArray(declaration.issue) ? declaration.issue : [declaration.issue];
  if (issueValues.length === 0) {
    throw new Error(`${label}: issue must be an endpoint declaration or a non-empty array.`);
  }
  const issues = issueValues.map((issue) => normalizeCookieIssue(issue, label));
  const issuePaths = issues.map(({ path }) => path);
  if (new Set(issuePaths).size !== issuePaths.length) {
    throw new Error(`${label}: cookie issuing endpoints must be distinct.`);
  }

  if (declaration.clear !== undefined && !Array.isArray(declaration.clear)) {
    throw new Error(`${label}: clear must be an array of endpoint paths.`);
  }
  const clear = [...(declaration.clear ?? [])];
  for (const path of clear) assertPortableRoutePath(path, `${label}: clear endpoint`);
  if (new Set(clear).size !== clear.length) {
    throw new Error(`${label}: cookie clearing endpoints must be distinct.`);
  }
  const overlap = issuePaths.find((path) => clear.includes(path));
  if (overlap !== undefined) {
    throw new Error(`${label}: "${overlap}" cannot issue and clear the cookie.`);
  }

  const sameSite = declaration.sameSite ?? "Strict";
  if (!COOKIE_SAME_SITE.has(sameSite)) {
    throw new Error(`${label}: sameSite must be Strict, Lax, or None.`);
  }
  if (sameSite === "None" && origin.protocol !== "https:") {
    throw new Error(`${label}: SameSite=None requires an HTTPS policy origin.`);
  }
  const path = declaration.path ?? "/";
  assertPortableRoutePath(path, `${label}: cookie path`);
  let safeCookiePath = true;
  for (let index = 0; index < path.length; index++) {
    const code = path.charCodeAt(index);
    if (code < 32 || code === 59 || code > 126) {
      safeCookiePath = false;
      break;
    }
  }
  if (!safeCookiePath) {
    throw new Error(`${label}: cookie path contains an unsafe cookie attribute character.`);
  }
  const domain =
    declaration.domain === undefined
      ? undefined
      : normalizeDomain(declaration.domain, origin, label);

  let origins: readonly string[] | false;
  if (declaration.origins === false) {
    origins = false;
  } else {
    if (declaration.origins !== undefined && !Array.isArray(declaration.origins)) {
      throw new Error(`${label}: origins must be an explicit array or false.`);
    }
    const declaredOrigins = declaration.origins ?? [policyOrigin];
    if (declaredOrigins.length === 0) {
      throw new Error(`${label}: origins must contain at least one allowed origin.`);
    }
    const normalized = declaredOrigins.map(
      (allowed, index) => normalizeOrigin(allowed, `${label}: origins[${index}]`).origin,
    );
    if (new Set(normalized).size !== normalized.length) {
      throw new Error(`${label}: allowed origins must be distinct.`);
    }
    origins = Object.freeze(normalized);
  }

  const issue = Array.isArray(declaration.issue) ? Object.freeze(issues) : issues[0];
  return Object.freeze({
    name: declaration.name,
    input: declaration.input,
    issue,
    clear: Object.freeze(clear),
    sameSite,
    path,
    ...(domain === undefined ? {} : { domain }),
    origins,
  });
}

export function httpPolicy(declaration: HttpPolicy): HttpPolicy {
  const label = "httpPolicy";
  if (typeof declaration !== "object" || declaration === null || Array.isArray(declaration)) {
    throw new Error(`${label}: policy must be an object.`);
  }
  const origin = normalizeOrigin(declaration.origin, label);
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") {
    throw new Error(`${label}: production requires an HTTPS public origin.`);
  }
  const basePath = normalizeHttpBasePath(declaration.basePath, `${label}: basePath`);
  const publicErrors = normalizePublicErrors(declaration.publicErrors, label);
  const cookie =
    declaration.cookie === undefined
      ? undefined
      : normalizeCookie(declaration.cookie, origin, origin.origin, label);
  return Object.freeze({
    origin: origin.origin,
    ...(basePath === "" ? {} : { basePath }),
    ...(publicErrors === undefined ? {} : { publicErrors }),
    ...(cookie === undefined ? {} : { cookie }),
  });
}
