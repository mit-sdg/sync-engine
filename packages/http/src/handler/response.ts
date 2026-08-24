import { FrameworkErrorCode, serializeJsonValue } from "@mit-sdg/sync-engine/boundary";

export interface HttpResponseHeadersContext {
  readonly request: Request;
  readonly path: string | undefined;
  readonly status: number;
  readonly correlationId?: string;
}

type HttpHeadersInit = ConstructorParameters<typeof Headers>[0];

export type HttpResponseHeaders =
  | HttpHeadersInit
  | ((context: HttpResponseHeadersContext) => HttpHeadersInit | PromiseLike<HttpHeadersInit>);

const RESERVED_RESPONSE_HEADERS = new Set([
  "cache-control",
  "connection",
  "content-encoding",
  "content-length",
  "content-type",
  "keep-alive",
  "location",
  "proxy-connection",
  "refresh",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "vary",
]);

export function isReservedResponseHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_RESPONSE_HEADERS.has(lower) || lower.startsWith("access-control-");
}

export function internalErrorResponse(): Response {
  return new Response(`{"error":"${FrameworkErrorCode.INTERNAL_ERROR}"}`, {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

export function publicJson(
  body: unknown,
  status: number,
  options: { cookies?: readonly string[]; noStore?: boolean } = {},
): Response {
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    for (const cookie of options.cookies ?? []) headers.append("Set-Cookie", cookie);
    if (options.noStore === true) headers.set("Cache-Control", "no-store");
    return new Response(serializeJsonValue(body), { status, headers });
  } catch {
    return internalErrorResponse();
  }
}

export async function withResponseHeaders(
  response: Response,
  option: HttpResponseHeaders | undefined,
  context: HttpResponseHeadersContext,
): Promise<Response | undefined> {
  if (option === undefined) return response;
  try {
    const source = typeof option === "function" ? await option(context) : option;
    for (const [name, value] of new Headers(source)) {
      if (!isReservedResponseHeader(name)) response.headers.set(name, value);
    }
    return response;
  } catch {
    return undefined;
  }
}
