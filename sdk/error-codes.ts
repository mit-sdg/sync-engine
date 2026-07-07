/**
 * Framework-owned error codes emitted by the engine, SDK client,
 * and generic server layer — never by domain rules.
 *
 * Their string values are part of the stable wire protocol and
 * must never change.
 */
export const FrameworkErrorCode = {
  // ═══ Server / Framework ═══
  BODY_TOO_LARGE: "BODY_TOO_LARGE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  INVALID_BODY: "INVALID_BODY",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  TIMED_OUT: "TIMED_OUT",
  UNKNOWN_APP: "UNKNOWN_APP",
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  UNSUPPORTED_MEDIA_TYPE: "UNSUPPORTED_MEDIA_TYPE",
  VALIDATION_FAILED: "VALIDATION_FAILED",

  // ═══ Network / Wire (SDK client only) ═══
  BAD_JSON: "BAD_JSON",
  BAD_STATUS: "BAD_STATUS",
  HEADER_RESOLUTION_FAILED: "HEADER_RESOLUTION_FAILED",
  NETWORK_ERROR: "NETWORK_ERROR",
} as const;

export type FrameworkErrorCode = (typeof FrameworkErrorCode)[keyof typeof FrameworkErrorCode];
