import { readCappedUtf8Stream } from "../stream.ts";

export type RequestTextResult = { ok: true; text: string } | { ok: false };

export async function readRequestText(
  request: Request,
  maxBytes: number,
): Promise<RequestTextResult> {
  const declared = request.headers.get("Content-Length");
  try {
    const result = await readCappedUtf8Stream(
      request.body,
      maxBytes,
      declared === null ? undefined : Number(declared),
      request.signal,
    );
    return "aborted" in result ? { ok: false } : result;
  } catch {
    return { ok: false };
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}
