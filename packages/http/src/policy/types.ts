export type HttpPublicErrorCategory =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT";

export interface HttpBrowserPolicy {
  readonly origins: readonly string[];
  readonly credentials?: boolean;
  readonly allowedHeaders?: readonly string[];
  readonly exposedHeaders?: readonly string[];
  readonly maxAgeSeconds?: number;
}

export interface HttpRequestOriginPolicy {
  readonly allowed: readonly string[];
  readonly requireOrigin?: boolean;
}

export interface HttpLimits {
  readonly requestBodyBytes?: number;
}

interface HttpCookieIssue {
  readonly path: string;
  readonly value: string;
  readonly expires: string;
}

export interface HttpCookieBinding {
  readonly name: string;
  readonly input: string;
  readonly issue: readonly HttpCookieIssue[];
  readonly clear: readonly string[];
  readonly sameSite?: "Strict" | "Lax" | "None";
  readonly path?: string;
  readonly domain?: string;
}

/**
 * How an endpoint's value reaches a client that cannot post. Each `{name}` path segment
 * names an endpoint input.
 */
export interface HttpDirectRoute {
  readonly method: "GET";
  readonly path: string;
  readonly endpoint: string;
  readonly redirect?: string;
  readonly status?: number;
}

export interface HttpPolicyInit {
  readonly publicOrigin?: string;
  readonly basePath?: string;
  readonly publicErrors?: Readonly<Record<string, HttpPublicErrorCategory>>;
  readonly browser?: HttpBrowserPolicy;
  readonly requestOrigins?: HttpRequestOriginPolicy | false;
  readonly cookies?: Readonly<Record<string, HttpCookieBinding>>;
  readonly limits?: HttpLimits;
  readonly direct?: readonly HttpDirectRoute[];
}

/** Runtime marker shared by every installed copy of this package. */
export const HttpPolicyBrand: unique symbol = Symbol.for(
  "@mit-sdg/sync-engine-http/HttpPolicy",
) as never;

export interface HttpPolicy extends HttpPolicyInit {
  readonly [HttpPolicyBrand]: true;
}
