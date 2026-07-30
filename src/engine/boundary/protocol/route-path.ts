const PATH_BASE = new URL("file://sync-engine.invalid");

/** Require a path whose spelling survives URL pathname handling exactly. */
export function assertPortableRoutePath(path: unknown, label: string): asserts path is string {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`${label}: path must be an absolute route pathname starting with '/'.`);
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
