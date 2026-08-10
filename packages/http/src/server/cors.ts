import type { HttpBrowserPolicy } from "../policy/types.ts";

function appendVary(headers: Headers, names: readonly string[]): void {
  const values = new Map<string, string>();
  for (const value of (headers.get("Vary") ?? "").split(",")) {
    const trimmed = value.trim();
    if (trimmed !== "") values.set(trimmed.toLowerCase(), trimmed);
  }
  for (const name of names) values.set(name.toLowerCase(), name);
  headers.set("Vary", [...values.values()].join(", "));
}

export function corsOriginAllowed(request: Request, browser: HttpBrowserPolicy): boolean {
  const origin = request.headers.get("Origin");
  return origin !== null && browser.origins.includes(origin);
}

export function withCors(
  response: Response,
  request: Request,
  browser: HttpBrowserPolicy | undefined,
  preflight = false,
): Response {
  if (browser === undefined) return response;
  appendVary(
    response.headers,
    preflight
      ? ["Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers"]
      : ["Origin"],
  );
  if (!corsOriginAllowed(request, browser)) return response;
  response.headers.set("Access-Control-Allow-Origin", request.headers.get("Origin") as string);
  if (browser.credentials === true) {
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }
  if (browser.exposedHeaders !== undefined && browser.exposedHeaders.length > 0) {
    response.headers.set("Access-Control-Expose-Headers", browser.exposedHeaders.join(", "));
  }
  if (preflight) {
    response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.headers.set(
      "Access-Control-Allow-Headers",
      browser.allowedHeaders?.join(", ") ?? "Content-Type",
    );
    if (browser.maxAgeSeconds !== undefined) {
      response.headers.set("Access-Control-Max-Age", String(browser.maxAgeSeconds));
    }
  }
  return response;
}

export function preflightAllowed(request: Request, browser: HttpBrowserPolicy): boolean {
  if (!corsOriginAllowed(request, browser)) return false;
  if (request.headers.get("Access-Control-Request-Method")?.toUpperCase() !== "POST") return false;
  const allowed = new Set(
    (browser.allowedHeaders ?? ["Content-Type"]).map((name) => name.toLowerCase()),
  );
  const requested = (request.headers.get("Access-Control-Request-Headers") ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return requested.every((name) => allowed.has(name));
}
