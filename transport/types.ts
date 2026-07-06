/** Neutral request shape: the seam between a transport driver and the bridge. */
export interface AppRequest {
  /** The action path without the base URL prefix, e.g. "registry/auth/login" */
  path: string;
  /** The parsed JSON request body (already validated as a scalar record). */
  body: Record<string, unknown>;
  /** Session token extracted by the driver (cookie, --session flag, etc.). */
  session?: string;
}

/** Neutral response shape: the bridge returns this; the driver maps it to HTTP. */
export interface AppResponse {
  /** The response payload (may contain an "error" field for domain errors). */
  body: Record<string, unknown>;
  /** HTTP status code (bridge maps domain errors to status). Driver applies it. */
  status?: number;
  /** Cookies that the driver should set on the response (name → value). */
  cookies?: Record<string, string>;
}

/** Every transport driver implements this interface. */
export interface Driver {
  start(): { stop(): Promise<void> | void };
}
