import type { ValidatedCookieBinding } from "../policy/cookies.ts";

const MAX_COOKIE_BYTES = 4096;

export function cookieValue(header: string | null, name: string): string | undefined {
  if (
    header === null ||
    header.length > 16_384 ||
    new TextEncoder().encode(header).byteLength > 16_384
  ) {
    return undefined;
  }
  let found: string | undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator === -1 || item.slice(0, separator).trim() !== name) continue;
    if (found !== undefined) return undefined;
    try {
      const decoded = decodeURIComponent(item.slice(separator + 1).trim());
      if (/[^\u0020-\u007e]/.test(decoded)) return undefined;
      found = decoded;
    } catch {
      return undefined;
    }
  }
  return found;
}

function attributes(binding: ValidatedCookieBinding["binding"]): string {
  return (
    `; HttpOnly; SameSite=${binding.sameSite}; Path=${binding.path}` +
    (binding.domain === undefined ? "" : `; Domain=${binding.domain}`) +
    "; Secure"
  );
}

export function issuedCookie(
  facts: ValidatedCookieBinding,
  value: unknown,
  sourceExpiry: unknown,
  now = Date.now(),
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > MAX_COOKIE_BYTES ||
    /[^\u0020-\u007e]/.test(value)
  ) {
    return undefined;
  }
  const expires = sourceExpiry instanceof Date ? sourceExpiry : new Date(String(sourceExpiry));
  if (Number.isNaN(expires.getTime()) || expires.getTime() <= now) return undefined;
  const serialized =
    `${facts.cookieName}=${encodeURIComponent(value)}` +
    attributes(facts.binding) +
    `; Expires=${expires.toUTCString()}`;
  return new TextEncoder().encode(serialized).byteLength <= MAX_COOKIE_BYTES
    ? serialized
    : undefined;
}

export function clearedCookie(facts: ValidatedCookieBinding): string {
  return (
    `${facts.cookieName}=` +
    attributes(facts.binding) +
    "; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0"
  );
}
