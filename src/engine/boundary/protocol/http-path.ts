const PATH_BASE = new URL("https://sync-engine.invalid");

/** Require a path whose spelling survives WHATWG URL pathname handling exactly. */
export function assertPortableHttpPath(path: unknown, label: string): asserts path is string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`${label}: path must be an absolute URL pathname starting with '/'.`);
  }
  if (path.includes("?") || path.includes("#")) {
    throw new Error(`${label}: path must not contain a query or fragment.`);
  }
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) {
    throw new Error(`${label}: path contains malformed percent encoding.`);
  }
  if (path !== path.normalize("NFC")) {
    throw new Error(`${label}: path must use canonical Unicode.`);
  }

  let canonical: URL;
  try {
    canonical = new URL(path, PATH_BASE);
  } catch {
    throw new Error(`${label}: path is not a valid URL pathname.`);
  }
  if (canonical.origin !== PATH_BASE.origin) {
    throw new Error(`${label}: path must not be scheme-relative or change the URL origin.`);
  }
  if (canonical.pathname !== path) {
    throw new Error(
      `${label}: path must equal its canonical URL pathname "${canonical.pathname}".`,
    );
  }
}

/** Normalize the deliberately supported root and trailing-slash base-path forms. */
export function normalizeHttpBasePath(basePath: string | undefined, label = "basePath"): string {
  if (basePath === undefined || basePath === "") return "";
  assertPortableHttpPath(basePath, label);
  if (basePath === "/") return "";
  return basePath.replace(/\/+$/, "");
}
